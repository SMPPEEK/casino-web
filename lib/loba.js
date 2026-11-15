'use strict';
/**
 * La Loba ("Loba de menos", rummy argentino): 2 a 4 jugadores, 2 mazos ingleses + 4 comodines (108 cartas),
 * 9 cartas cada uno. Gana quien queda sin cartas; los demás suman penalidad (menos es mejor) y se
 * eliminan al pasar el límite (100 o 50). Sin reenganche.
 *
 * Reglas (fuente: pagat.com/rummy/loba):
 *  - PIERNA: 3 a 6 cartas del mismo número en exactamente 3 palos distintos (se pueden repetir esos palos
 *    con la carta del otro mazo, nunca un 4.º palo). Sin comodines.
 *  - ESCALERA: 3 o más cartas seguidas de un palo. El as vale bajo (A-2-3) o alto (Q-K-A), no los dos a la vez.
 *    Máximo UN comodín por escalera.
 *  - Turno: robar (del mazo, o la carta de arriba del pozo si se usa de inmediato) → bajar/agregar → descartar.
 *    Con al menos una combinación propia bajada en la ronda se pueden agregar cartas a cualquier combinación.
 *  - El comodín no se descarta salvo que sea la última carta (o todas las que quedan sean comodines).
 *    Un comodín en un extremo de una escalera se mueve al otro extremo si se agrega la carta natural que reemplaza.
 *  - Termina la ronda cuando alguien se queda sin cartas (bajando todo, o bajando todo menos una y descartándola).
 *    Si baja todo en un solo turno sin haber bajado antes en la ronda: −10 a su total.
 *  - Penalidad: 2–9 = su valor; 10, J, Q, K, A y comodín = 10. Eliminado con total > límite.
 *
 * ---- Interfaz de motor (la usa lib/match.js) ----
 *   create({names, bots, options:{limit}}), view(st, seat), act(st, seat, action), actors(st), turnSeconds(st),
 *   botAction(st, seat), autoAction(st, seat), isOver(st), winner(st)
 *
 * Acciones:
 *   { type:'draw', from:'stock'|'discard' }
 *   { type:'meld', cards:[id,…] }          bajar una combinación nueva (pierna o escalera)
 *   { type:'add', meld:'m3', card:id }     agregar una carta a una combinación de la mesa
 *   { type:'discard', card:id }            termina el turno
 *   { type:'ready' }                       seguir a la ronda siguiente
 *
 * ---- VIEW SHAPE (lo que recibe el cliente) ----
 *   { round, limit, you, turn, phase:'draw'|'play'|'roundOver'|'over', dealer,
 *     hand:[card], handCounts:[n], stockCount, discardTop:card|null, discard:[card] (últimas 8, abajo→arriba),
 *     melds:[{id, type:'pierna'|'escalera', owner, rank?, suit?, suits?, cards:[{id,r,s,pos?,as?}]}],
 *     meldedThisRound:[bool], forced:cardId|null, canTakeDiscard:bool (solo en tu fase de robo),
 *     scores:[n], eliminated:[bool], names, bots, ready:[bool],
 *     summary:null | { outOf:seat|null, via:'meld'|'discard'|'stalemate', bonus:bool, hands:[[card]], points:[n], totals:[n] },
 *     winner:seat|null, log:[{id,seat,kind,text}] (últimos 40) }
 *   card = { id:'QH1', r:'A'|'2'..'10'|'J'|'Q'|'K'|'JOKER', s:'S'|'H'|'D'|'C'|null }
 *   Dentro de una escalera cada carta trae pos (1–14) y los comodines `as` (el número que representan).
 */
const crypto = require('crypto');
const { GameError } = require('./games');

const rnd = (n) => crypto.randomInt(n);

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RV = {};
RANKS.forEach((r, i) => { RV[r] = i + 1; });
const rankAt = (pos) => (pos === 14 ? 'A' : RANKS[pos - 1]);

const isJoker = (c) => c.r === 'JOKER';
const penalty = (c) => (isJoker(c) || ['A', '10', 'J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));
const label = (c) => (isJoker(c) ? 'comodín' : `${c.r}${SUIT_SYM[c.s]}`);

/** 'QH1' -> carta (para tests y utilidades). */
function card(id) {
  if (id.startsWith('JK')) return { id, r: 'JOKER', s: null };
  return { id, r: id.slice(0, -2), s: id.slice(-2, -1) };
}

function newShoe() {
  const d = [];
  for (let k = 0; k < 2; k++) for (const s of SUITS) for (const r of RANKS) d.push({ id: `${r}${s}${k}`, r, s });
  for (let j = 0; j < 4; j++) d.push({ id: `JK${j}`, r: 'JOKER', s: null });
  return shuffle(d);
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ------------------------------------------------------------------ combinaciones
/** Devuelve la combinación formada por `cards` (pierna o escalera) o null si no es válida. */
function analyzeMeld(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return null;
  const jokers = cards.filter(isJoker);
  const nat = cards.filter((c) => !isJoker(c));
  if (jokers.length > 1) return null;

  if (!jokers.length && nat.every((c) => c.r === nat[0].r)) {
    const suits = [...new Set(nat.map((c) => c.s))];
    if (suits.length === 3 && cards.length <= 6) return { type: 'pierna', rank: nat[0].r, suits, cards: nat.slice() };
    return null;
  }

  if (nat.length < 2) return null;
  const suit = nat[0].s;
  if (!nat.every((c) => c.s === suit)) return null;
  if (new Set(nat.map((c) => c.r)).size !== nat.length) return null;
  const hasAce = nat.some((c) => c.r === 'A');

  for (const aceHigh of hasAce ? [false, true] : [false]) {
    const entries = nat.map((c) => ({ ...c, pos: c.r === 'A' ? (aceHigh ? 14 : 1) : RV[c.r] })).sort((a, b) => a.pos - b.pos);
    const lo = entries[0].pos;
    const hi = entries[entries.length - 1].pos;
    const gaps = hi - lo + 1 - entries.length;
    const list = entries.slice();
    if (jokers.length) {
      let pos = null;
      if (gaps === 1) {
        for (let p = lo; p <= hi; p++) if (!entries.some((e) => e.pos === p)) pos = p;
      } else if (gaps === 0) {
        if (hi + 1 <= 14 && !(hi + 1 === 14 && hasAce && !aceHigh)) pos = hi + 1;      // arriba (as alto solo si el as no está bajo)
        else if (lo - 1 >= 1 && !(lo - 1 === 1 && hasAce && aceHigh)) pos = lo - 1;     // abajo
      }
      if (pos === null) continue;
      list.push({ ...jokers[0], pos, as: rankAt(pos) });
      list.sort((a, b) => a.pos - b.pos);
    } else if (gaps !== 0) continue;
    return { type: 'escalera', suit, cards: list };
  }
  return null;
}

/** ¿Se puede agregar `c` a la combinación? Devuelve la combinación nueva (sin modificar la original) o null. */
function canAdd(meld, c) {
  if (meld.type === 'pierna') {
    if (isJoker(c) || c.r !== meld.rank || !meld.suits.includes(c.s) || meld.cards.length >= 6) return null;
    return { ...meld, cards: [...meld.cards, c] };
  }
  const cards = meld.cards;
  const lo = cards[0].pos;
  const hi = cards[cards.length - 1].pos;
  const jk = cards.find(isJoker);
  const aceLow = cards.some((x) => !isJoker(x) && x.r === 'A' && x.pos === 1);
  const aceHigh = cards.some((x) => !isJoker(x) && x.r === 'A' && x.pos === 14);
  const topOk = (p) => p <= 14 && !(p === 14 && aceLow);
  const botOk = (p) => p >= 1 && !(p === 1 && aceHigh);
  const mk = (list) => ({ ...meld, cards: list });

  if (isJoker(c)) {
    if (jk) return null;
    if (topOk(hi + 1)) return mk([...cards, { ...c, pos: hi + 1, as: rankAt(hi + 1) }]);
    if (botOk(lo - 1)) return mk([{ ...c, pos: lo - 1, as: rankAt(lo - 1) }, ...cards]);
    return null;
  }
  if (c.s !== meld.suit) return null;
  for (const p of c.r === 'A' ? [1, 14] : [RV[c.r]]) {
    if (p === hi + 1 && topOk(p)) return mk([...cards, { ...c, pos: p }]);
    if (p === lo - 1 && botOk(p)) return mk([{ ...c, pos: p }, ...cards]);
    if (jk && jk.pos === p && (p === lo || p === hi)) { // reemplazar el comodín de un extremo: pasa al otro extremo
      const rest = cards.filter((x) => x !== jk);
      const nat = { ...c, pos: p };
      if (p === hi) {
        const np = rest[0].pos - 1;
        if (botOk(np)) return mk([{ ...jk, pos: np, as: rankAt(np) }, ...rest, nat]);
      } else {
        const np = rest[rest.length - 1].pos + 1;
        if (topOk(np)) return mk([nat, ...rest, { ...jk, pos: np, as: rankAt(np) }]);
      }
    }
  }
  return null;
}

// -------------------------------------------------------------------- búsquedas
function* masks(n) { for (let m = 1; m < (1 << n); m++) yield m; }
const pick = (arr, mask) => arr.filter((_, i) => mask & (1 << i));
const bits = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

/** Todas las combinaciones válidas que se pueden armar con la mano (máscara de bits + combinación). */
function findMelds(hand) {
  const out = [];
  for (const m of masks(hand.length)) {
    if (bits(m) < 3) continue;
    const meld = analyzeMeld(pick(hand, m));
    if (meld) out.push({ mask: m, meld });
  }
  return out.sort((a, b) => bits(b.mask) - bits(a.mask)).slice(0, 70);
}

/** Mejor reparto en combinaciones disjuntas (máximo de cartas usadas, hasta 3 combinaciones). */
function bestPartition(hand) {
  const melds = findMelds(hand);
  let best = { used: 0, parts: [] };
  const go = (start, used, parts, depth) => {
    const n = bits(used);
    if (n > best.used) best = { used: n, parts: parts.slice() };
    if (depth === 3) return;
    for (let i = start; i < melds.length; i++) {
      if (melds[i].mask & used) continue;
      parts.push(melds[i]);
      go(i + 1, used | melds[i].mask, parts, depth + 1);
      parts.pop();
    }
  };
  go(0, 0, [], 0);
  return best;
}

/** Combinaciones válidas (o adición) en las que entra `c` usando cartas de la mano. */
function meldWith(hand, c) {
  const others = hand.filter((x) => x.id !== c.id);
  for (const m of masks(others.length)) {
    if (bits(m) < 2) continue;
    const meld = analyzeMeld([c, ...pick(others, m)]);
    if (meld) return pick(others, m);
  }
  return null;
}

function usableDiscard(st, seat) {
  const top = st.discard[st.discard.length - 1];
  if (!top) return false;
  if (st.meldedThisRound[seat] && st.melds.some((m) => canAdd(m, top))) return true;
  return !!meldWith(st.hands[seat], top);
}

// ----------------------------------------------------------------------- estado
function say(st, seat, kind, text) {
  st.log.push({ id: ++st.logId, seat, kind, text });
  if (st.log.length > 60) st.log.shift();
}

const aliveSeats = (st) => st.names.map((_, i) => i).filter((i) => !st.eliminated[i]);
function nextAlive(st, from) {
  for (let k = 1; k <= st.names.length; k++) {
    const s = (from + k) % st.names.length;
    if (!st.eliminated[s]) return s;
  }
  return from;
}

function create({ names, bots, options = {} }) {
  const n = names.length;
  if (n < 2 || n > 4 || bots.length !== n) throw new GameError('invalid_options');
  const st = {
    id: 'loba', names, bots, limit: options.limit === 50 ? 50 : 100, round: 0, dealer: rnd(n), turn: 0, phase: 'draw',
    scores: names.map(() => 0), eliminated: names.map(() => false), hands: [], stock: [], discard: [], melds: [], meldSeq: 0,
    meldedThisRound: names.map(() => false), meldedBefore: false, forced: null, ready: names.map(() => false),
    summary: null, winner: null, log: [], logId: 0,
  };
  startRound(st);
  return st;
}

function startRound(st) {
  const deck = newShoe();
  st.round++;
  st.hands = st.names.map((_, i) => (st.eliminated[i] ? [] : []));
  for (let k = 0; k < 9; k++) for (const i of aliveSeats(st)) st.hands[i].push(deck.pop());
  let top = deck.pop();
  while (isJoker(top)) { deck.unshift(top); top = deck.pop(); } // el primer descarte nunca es comodín
  st.discard = [top];
  st.stock = deck;
  st.melds = [];
  st.meldedThisRound = st.names.map(() => false);
  st.forced = null;
  st.summary = null;
  st.ready = st.names.map(() => false);
  st.turn = nextAlive(st, st.dealer);
  st.phase = 'draw';
  say(st, null, 'info', `Ronda ${st.round}: reparte ${st.names[st.dealer]} y empieza ${st.names[st.turn]}.`);
}

// --------------------------------------------------------------------- acciones
function removeFromHand(st, seat, ids) {
  const hand = st.hands[seat];
  const out = [];
  for (const id of ids) {
    const i = hand.findIndex((c) => c.id === id);
    out.push(hand.splice(i, 1)[0]);
  }
  return out;
}

function getCards(st, seat, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) throw new GameError('invalid_meld');
  const hand = st.hands[seat];
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) throw new GameError('invalid_meld');
  return cards;
}

function refillStock(st) {
  if (st.stock.length) return true;
  if (st.discard.length <= 1) return false;
  const top = st.discard.pop();
  st.stock = shuffle(st.discard);
  st.discard = [top];
  say(st, null, 'info', 'Se terminó el mazo: se barajó el pozo.');
  return true;
}

function endRound(st, outOf, via, bonus) {
  const points = st.names.map((_, i) => {
    if (st.eliminated[i]) return 0;
    if (i === outOf) return bonus ? -10 : 0;
    return st.hands[i].reduce((a, c) => a + penalty(c), 0);
  });
  points.forEach((p, i) => { st.scores[i] += p; });
  st.summary = {
    outOf, via, bonus, hands: st.hands.map((h) => h.slice()), points, totals: st.scores.slice(),
  };
  for (const i of aliveSeats(st)) if (st.scores[i] > st.limit) st.eliminated[i] = true;
  const alive = aliveSeats(st);
  if (outOf !== null) say(st, outOf, 'info', `${st.names[outOf]} se quedó sin cartas${bonus ? ' (−10 por bajar todo de una)' : ''}.`);
  else say(st, null, 'info', 'Se acabaron las cartas: nadie cortó.');
  if (alive.length <= 1) {
    st.phase = 'over';
    st.winner = alive.length === 1 ? alive[0] : st.scores.indexOf(Math.min(...st.scores));
    say(st, st.winner, 'info', `${st.names[st.winner]} ganó la partida.`);
    return;
  }
  st.phase = 'roundOver';
  st.ready = st.names.map(() => false);
}

function goOut(st, seat, via) {
  endRound(st, seat, via, via === 'meld' && !st.meldedBefore);
}

function nextTurn(st) {
  st.turn = nextAlive(st, st.turn);
  st.phase = 'draw';
  st.forced = null;
}

function act(st, seat, a) {
  if (!a || typeof a !== 'object') throw new GameError('invalid_action');
  if (st.phase === 'over') throw new GameError('game_over');
  if (st.phase === 'roundOver') {
    if (a.type !== 'ready' || st.eliminated[seat]) throw new GameError('wrong_phase');
    st.ready[seat] = true;
    if (aliveSeats(st).every((i) => st.ready[i])) { st.dealer = nextAlive(st, st.dealer); startRound(st); }
    return;
  }
  if (seat !== st.turn) throw new GameError('not_your_turn');
  const name = st.names[seat];

  switch (a.type) {
    case 'draw': {
      if (st.phase !== 'draw') throw new GameError('wrong_phase');
      if (a.from === 'stock') {
        if (!refillStock(st)) { endRound(st, null, 'stalemate', false); return; }
        st.hands[seat].push(st.stock.pop());
        say(st, seat, 'draw', `${name} robó del mazo.`);
      } else if (a.from === 'discard') {
        if (!usableDiscard(st, seat)) throw new GameError('discard_unusable');
        const c = st.discard.pop();
        st.hands[seat].push(c);
        st.forced = c.id;
        say(st, seat, 'draw', `${name} tomó del pozo ${label(c)}.`);
      } else throw new GameError('invalid_action');
      st.meldedBefore = st.meldedThisRound[seat];
      st.phase = 'play';
      return;
    }
    case 'meld': {
      if (st.phase !== 'play') throw new GameError('wrong_phase');
      const cards = getCards(st, seat, a.cards);
      if (st.forced && !a.cards.includes(st.forced)) throw new GameError('must_play_discard');
      const meld = analyzeMeld(cards);
      if (!meld) throw new GameError('invalid_meld');
      removeFromHand(st, seat, a.cards);
      st.melds.push({ id: `m${++st.meldSeq}`, owner: seat, ...meld });
      st.meldedThisRound[seat] = true;
      st.forced = null;
      say(st, seat, 'meld', `${name} bajó ${meld.type === 'pierna' ? `una pierna de ${meld.rank}` : `una escalera de ${SUIT_SYM[meld.suit]}`} (${cards.length}).`);
      if (!st.hands[seat].length) goOut(st, seat, 'meld');
      return;
    }
    case 'add': {
      if (st.phase !== 'play') throw new GameError('wrong_phase');
      const [c] = getCards(st, seat, [a.card]);
      if (st.forced && a.card !== st.forced) throw new GameError('must_play_discard');
      if (!st.meldedThisRound[seat]) throw new GameError('need_meld_first');
      const i = st.melds.findIndex((m) => m.id === a.meld);
      if (i < 0) throw new GameError('cannot_add');
      const next = canAdd(st.melds[i], c);
      if (!next) throw new GameError('cannot_add');
      removeFromHand(st, seat, [a.card]);
      st.melds[i] = next;
      st.forced = null;
      say(st, seat, 'meld', `${name} agregó ${label(c)} a la combinación de ${st.names[next.owner]}.`);
      if (!st.hands[seat].length) goOut(st, seat, 'meld');
      return;
    }
    case 'discard': {
      if (st.phase !== 'play') throw new GameError('wrong_phase');
      if (st.forced) throw new GameError('must_play_discard');
      const [c] = getCards(st, seat, [a.card]);
      const hand = st.hands[seat];
      if (isJoker(c) && hand.some((x) => !isJoker(x))) throw new GameError('joker_discard');
      removeFromHand(st, seat, [a.card]);
      st.discard.push(c);
      say(st, seat, 'discard', `${name} descartó ${label(c)}.`);
      if (!hand.length) goOut(st, seat, 'discard');
      else nextTurn(st);
      return;
    }
    default:
      throw new GameError('invalid_action');
  }
}

const actors = (st) => {
  if (st.phase === 'over') return [];
  if (st.phase === 'roundOver') return aliveSeats(st).filter((i) => !st.ready[i]);
  return [st.turn];
};
const turnSeconds = (st) => (st.phase === 'roundOver' ? 20 : 90);

// ------------------------------------------------------------------------ vista
function view(st, seat) {
  return {
    round: st.round, limit: st.limit, you: seat, turn: st.turn, phase: st.phase, dealer: st.dealer,
    hand: st.hands[seat], handCounts: st.hands.map((h) => h.length), stockCount: st.stock.length,
    discardTop: st.discard[st.discard.length - 1] || null, discard: st.discard.slice(-8),
    melds: st.melds, meldedThisRound: st.meldedThisRound, forced: seat === st.turn ? st.forced : null,
    canTakeDiscard: st.phase === 'draw' && seat === st.turn ? usableDiscard(st, seat) : false,
    scores: st.scores, eliminated: st.eliminated, names: st.names, bots: st.bots, ready: st.ready,
    summary: st.summary, winner: st.winner, log: st.log.slice(-40),
  };
}

// -------------------------------------------------------------------------- bot
/** Cuánto vale conservar la carta (parejas, cartas seguidas, o que entre en la mesa). */
function keepScore(st, seat, c, hand) {
  if (isJoker(c)) return 100;
  let k = 0;
  for (const d of hand) {
    if (d.id === c.id || isJoker(d)) continue;
    if (d.r === c.r && d.s !== c.s) k += 3;
    if (d.s === c.s) {
      const gap = Math.abs(RV[d.r] - RV[c.r]);
      if (gap === 1 || (gap === 12)) k += 3;
      else if (gap === 2) k += 2;
    }
  }
  if (st.melds.some((m) => canAdd(m, c))) k += st.meldedThisRound[seat] ? 4 : 1;
  return k;
}

function botDiscard(st, seat) {
  const hand = st.hands[seat];
  const cands = hand.filter((c) => !isJoker(c) || hand.every(isJoker));
  let best = cands[0];
  let bestV = Infinity;
  for (const c of cands) {
    const v = keepScore(st, seat, c, hand) - penalty(c) / 12;
    if (v < bestV) { bestV = v; best = c; }
  }
  return { type: 'discard', card: best.id };
}

function botAction(st, seat) {
  if (st.phase === 'roundOver') return { type: 'ready' };
  if (st.phase === 'draw') {
    return { type: 'draw', from: usableDiscard(st, seat) ? 'discard' : 'stock' };
  }
  const hand = st.hands[seat];

  if (st.forced) {
    const c = hand.find((x) => x.id === st.forced);
    if (st.meldedThisRound[seat]) {
      const m = st.melds.find((x) => canAdd(x, c));
      if (m) return { type: 'add', meld: m.id, card: c.id };
    }
    const mates = meldWith(hand, c);
    return { type: 'meld', cards: [c.id, ...mates.map((x) => x.id)] };
  }

  // 1) bajar el mayor número de cartas posible (si alcanza para cortar, se corta)
  const { used, parts } = bestPartition(hand);
  if (parts.length) {
    const first = parts[0];
    return { type: 'meld', cards: pick(hand, first.mask).map((c) => c.id) };
  }
  void used;
  // 2) agregar cartas sueltas a la mesa
  if (st.meldedThisRound[seat]) {
    for (const c of hand) {
      const m = st.melds.find((x) => canAdd(x, c));
      if (m && hand.length > 1) return { type: 'add', meld: m.id, card: c.id };
      if (m && hand.length === 1) return { type: 'add', meld: m.id, card: c.id };
    }
  }
  // 3) descartar
  return botDiscard(st, seat);
}

function autoAction(st, seat) {
  if (st.phase === 'roundOver') return { type: 'ready' };
  if (st.phase === 'draw') return { type: 'draw', from: 'stock' };
  if (st.forced) return botAction(st, seat);
  return botDiscard(st, seat);
}

module.exports = {
  id: 'loba', create, view, act, actors, turnSeconds, botAction, autoAction,
  isOver: (st) => st.phase === 'over',
  winner: (st) => st.winner,
  // públicos para la interfaz y los tests
  analyzeMeld, canAdd, card, penalty, findMelds, bestPartition, usableDiscard,
};
