'use strict';
/**
 * Truco argentino 1 contra 1, baraja española de 40 cartas, a 15 puntos, SIN flor.
 *
 * Motor puro y síncrono. La interfaz es la misma que usa lib/match.js para cualquier juego:
 *   create, view, act, actors, turnSeconds, botAction, autoAction, isOver, winner.
 *
 * Acciones (JSON):
 *   { type:'play',    card:'1E' }                     jugar una carta (id = número + palo: E B O C)
 *   { type:'call',    call:'truco'|'retruco'|'vale4'|'envido'|'real'|'falta' }   cantar o subir
 *   { type:'respond', answer:'quiero'|'noquiero' }    responder a un canto
 *   { type:'fold' }                                   irse al mazo
 *   { type:'ready' }                                  seguir a la mano siguiente
 */
const crypto = require('crypto');
const { GameError } = require('./games');

const rnd = (n) => crypto.randomInt(n);
const chance = (p) => rnd(1000) < p * 1000;

const SUITS = ['E', 'B', 'O', 'C']; // espadas, bastos, oros, copas
const NUMS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
const POINTS = [1, 2, 3, 4];       // valor de la mano según el truco aceptado
const CALL_LEVEL = { truco: 1, retruco: 2, vale4: 3 };
const CALL_TEXT = {
  truco: '¡Truco!', retruco: '¡Retruco!', vale4: '¡Vale cuatro!', envido: '¡Envido!', real: '¡Real envido!', falta: '¡Falta envido!',
};

const idOf = (c) => `${c.n}${c.s}`;

/** Jerarquía de las cartas: 14 = ancho de espadas … 1 = cuatros. */
function power(c) {
  if (c.n === 1 && c.s === 'E') return 14;
  if (c.n === 1 && c.s === 'B') return 13;
  if (c.n === 7 && c.s === 'E') return 12;
  if (c.n === 7 && c.s === 'O') return 11;
  switch (c.n) {
    case 3: return 10;
    case 2: return 9;
    case 1: return 8;
    case 12: return 7;
    case 11: return 6;
    case 10: return 5;
    case 7: return 4;
    case 6: return 3;
    case 5: return 2;
    default: return 1;
  }
}

const tantoValue = (c) => (c.n >= 10 ? 0 : c.n);

/** Tanto del envido: dos del mismo palo = 20 + las dos más altas (figuras valen 0); si no, la carta más alta. */
function tanto(cards) {
  let best = 0;
  for (const s of SUITS) {
    const v = cards.filter((c) => c.s === s).map(tantoValue).sort((a, b) => b - a);
    if (v.length >= 2) best = Math.max(best, 20 + v[0] + v[1]);
  }
  return best || Math.max(...cards.map(tantoValue));
}

function shuffledDeck() {
  const d = [];
  for (const s of SUITS) for (const n of NUMS) d.push({ n, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Ganador de la mano según las bazas (0|1|'t' por baza) o null si todavía no se define. */
function handWinner(tricks, mano) {
  const wins = [0, 0];
  for (const t of tricks) if (t === 0 || t === 1) wins[t]++;
  if (wins[0] >= 2) return 0;
  if (wins[1] >= 2) return 1;
  if (tricks.length === 2) {
    if (tricks[0] === 't' && tricks[1] !== 't') return tricks[1];
    if (tricks[0] !== 't' && tricks[1] === 't') return tricks[0];
    return null;
  }
  if (tricks.length === 3) {
    if (tricks[0] === 't' && tricks[1] === 't') return tricks[2] === 't' ? mano : tricks[2];
    return tricks[2] === 't' ? tricks[0] : tricks[2];
  }
  return null;
}

// ------------------------------------------------------------------------- estado
function say(st, seat, kind, text) {
  st.log.push({ id: ++st.logId, seat, kind, text });
  if (st.log.length > 60) st.log.shift();
}

function create({ names, bots, options = {} }) {
  const st = {
    id: 'truco', names, bots, target: options.target === 30 ? 30 : 15, scores: [0, 0], mano: rnd(2),
    phase: 'play', handNo: 0, hand: null, ready: [false, false], log: [], logId: 0, winner: null, summary: null,
  };
  dealHand(st);
  return st;
}

function dealHand(st) {
  const deck = shuffledDeck();
  const cards = [deck.slice(0, 3), deck.slice(3, 6)];
  st.handNo++;
  st.phase = 'play';
  st.ready = [false, false];
  st.summary = null;
  st.hand = {
    cards, orig: [cards[0].slice(), cards[1].slice()], played: [[], []], tricks: [], turn: st.mano,
    truco: { level: 0, owner: null, pending: null },
    envido: { done: false, pending: null },
    suspended: null,
  };
  say(st, null, 'info', `Mano ${st.handNo}: reparte y juega primero ${st.names[st.mano]}.`);
}

const mustAct = (st) => {
  const h = st.hand;
  if (h.envido.pending) return 1 - h.envido.pending.from;
  if (h.truco.pending) return 1 - h.truco.pending.from;
  return h.turn;
};

function envidoOpen(st, seat) {
  const h = st.hand;
  return !h.envido.done && !h.envido.pending && h.truco.level === 0 && h.tricks.length === 0 && h.played[seat].length === 0;
}

function envidoRaises(chain) {
  const last = chain[chain.length - 1];
  if (last === 'real') return ['falta'];
  if (last === 'falta') return [];
  return chain.filter((c) => c === 'envido').length < 2 ? ['envido', 'real', 'falta'] : ['real', 'falta'];
}

/** Acciones que puede hacer `seat` ahora mismo (la UI y los bots usan esto). */
function legal(st, seat) {
  if (st.phase === 'handOver') return { ready: !st.ready[seat] };
  if (st.phase !== 'play' || mustAct(st) !== seat) return {};
  const h = st.hand;
  const out = { play: [], calls: [], respond: false, fold: false };
  if (h.envido.pending) {
    out.respond = true;
    out.calls = envidoRaises(h.envido.pending.chain);
    return out;
  }
  if (h.truco.pending) {
    out.respond = true;
    const lv = h.truco.pending.level;
    if (lv === 1) out.calls.push('retruco');
    if (lv === 2) out.calls.push('vale4');
    if (lv === 1 && envidoOpen(st, seat)) out.calls.push('envido', 'real', 'falta');
    return out;
  }
  out.play = h.cards[seat].map(idOf);
  out.fold = true;
  if (h.truco.level === 0) out.calls.push('truco');
  else if (h.truco.level === 1 && h.truco.owner === seat) out.calls.push('retruco');
  else if (h.truco.level === 2 && h.truco.owner === seat) out.calls.push('vale4');
  if (envidoOpen(st, seat)) out.calls.push('envido', 'real', 'falta');
  return out;
}

// ----------------------------------------------------------------------- puntos
function addPoints(st, seat, pts, text) {
  st.scores[seat] += pts;
  say(st, seat, 'point', `${text} (+${pts} para ${st.names[seat]})`);
  if (st.scores[seat] >= st.target) {
    st.phase = 'over';
    st.winner = seat;
    say(st, seat, 'info', `${st.names[seat]} ganó el partido.`);
    return true;
  }
  return false;
}

function endHand(st, winner, pts, reason) {
  const h = st.hand;
  const over = addPoints(st, winner, pts, reason);
  st.summary = { winner, points: pts, reason, cards: [h.orig[0], h.orig[1]], tricks: h.tricks.slice() };
  if (!over) { st.phase = 'handOver'; st.ready = [false, false]; }
}

function chainValue(st, chain) {
  if (chain.includes('falta')) return Math.max(1, st.target - Math.max(...st.scores));
  return chain.reduce((a, c) => a + (c === 'real' ? 3 : 2), 0);
}
const rejectValue = (st, chain) => (chain.length === 1 ? 1 : chainValue(st, chain.slice(0, -1)));

function resolveEnvido(st, p) {
  const h = st.hand;
  const pts = chainValue(st, p.chain);
  const tm = tanto(h.orig[st.mano]);
  const to = tanto(h.orig[1 - st.mano]);
  const w = tm >= to ? st.mano : 1 - st.mano; // empate: gana la mano
  say(st, null, 'info', `Tantos: ${st.names[st.mano]} ${tm} · ${st.names[1 - st.mano]} ${to}.`);
  return addPoints(st, w, pts, 'Envido');
}

// ---------------------------------------------------------------------- acciones
function playCard(st, seat, id) {
  const h = st.hand;
  const i = h.cards[seat].findIndex((c) => idOf(c) === id);
  const card = h.cards[seat].splice(i, 1)[0];
  const t = h.tricks.length;
  h.played[seat][t] = card;
  say(st, seat, 'play', `${st.names[seat]} jugó ${card.n} de ${{ E: 'espadas', B: 'bastos', O: 'oros', C: 'copas' }[card.s]}.`);
  const other = 1 - seat;
  if (h.played[other][t]) {
    const pa = power(h.played[0][t]);
    const pb = power(h.played[1][t]);
    const res = pa > pb ? 0 : pb > pa ? 1 : 't';
    h.tricks.push(res);
    say(st, res === 't' ? null : res, 'info', res === 't' ? 'Parda: empatan la baza.' : `${st.names[res]} gana la baza.`);
    const w = handWinner(h.tricks, st.mano);
    if (w !== null) { endHand(st, w, POINTS[h.truco.level], 'Mano'); return; }
    h.turn = res === 't' ? st.mano : res;
  } else {
    h.turn = other;
  }
}

function doCall(st, seat, call) {
  const h = st.hand;
  say(st, seat, 'call', `${st.names[seat]}: ${CALL_TEXT[call]}`);
  if (call in CALL_LEVEL) {
    if (h.truco.pending) { h.truco.level = h.truco.pending.level; h.truco.owner = seat; } // subir = aceptar lo anterior
    h.truco.pending = { level: CALL_LEVEL[call], from: seat };
    return;
  }
  if (h.envido.pending) {
    h.envido.pending.chain.push(call);
    h.envido.pending.from = seat;
    return;
  }
  if (h.truco.pending) { h.suspended = h.truco.pending; h.truco.pending = null; } // "el envido está primero"
  h.envido.pending = { chain: [call], from: seat };
}

function doRespond(st, seat, answer) {
  const h = st.hand;
  say(st, seat, 'call', `${st.names[seat]}: ${answer === 'quiero' ? '¡Quiero!' : '¡No quiero!'}`);
  if (h.envido.pending) {
    const p = h.envido.pending;
    h.envido.pending = null;
    h.envido.done = true;
    const over = answer === 'quiero'
      ? resolveEnvido(st, p)
      : addPoints(st, p.from, rejectValue(st, p.chain), 'Envido no querido');
    if (!over && h.suspended) { h.truco.pending = h.suspended; h.suspended = null; }
    return;
  }
  const p = h.truco.pending;
  if (answer === 'quiero') {
    h.truco.level = p.level;
    h.truco.owner = seat;
    h.truco.pending = null;
  } else {
    h.truco.pending = null;
    endHand(st, p.from, POINTS[p.level - 1], 'Truco no querido');
  }
}

function fold(st, seat) {
  const h = st.hand;
  say(st, seat, 'call', `${st.names[seat]} se fue al mazo.`);
  endHand(st, 1 - seat, POINTS[h.truco.level], 'Al mazo');
}

function act(st, seat, a) {
  if (!a || typeof a !== 'object') throw new GameError('invalid_action');
  if (st.phase === 'over') throw new GameError('game_over');
  if (st.phase === 'handOver') {
    if (a.type !== 'ready') throw new GameError('hand_over');
    st.ready[seat] = true;
    if (st.ready[0] && st.ready[1]) { st.mano = 1 - st.mano; dealHand(st); }
    return;
  }
  if (mustAct(st) !== seat) throw new GameError('not_your_turn');
  const L = legal(st, seat);
  switch (a.type) {
    case 'play':
      if (!L.play.includes(a.card)) throw new GameError('illegal_card');
      playCard(st, seat, a.card);
      break;
    case 'call':
      if (!L.calls.includes(a.call)) throw new GameError('illegal_call');
      doCall(st, seat, a.call);
      break;
    case 'respond':
      if (!L.respond || (a.answer !== 'quiero' && a.answer !== 'noquiero')) throw new GameError('illegal_answer');
      doRespond(st, seat, a.answer);
      break;
    case 'fold':
      if (!L.fold) throw new GameError('illegal_fold');
      fold(st, seat);
      break;
    default:
      throw new GameError('invalid_action');
  }
}

const actors = (st) => {
  if (st.phase === 'over') return [];
  if (st.phase === 'handOver') return [0, 1].filter((s) => !st.ready[s]);
  return [mustAct(st)];
};

const turnSeconds = (st) => (st.phase === 'handOver' ? 12 : 45);

// --------------------------------------------------------------------------- vista
function view(st, seat) {
  const h = st.hand;
  const rel = (s) => (s === seat ? 'you' : 'opp');
  const relTrick = (t) => (t === 't' ? 'tie' : rel(t));
  const L = legal(st, seat);
  return {
    you: seat, names: st.names, bots: st.bots, scores: st.scores, target: st.target, mano: st.mano,
    phase: st.phase, handNo: st.handNo, turn: st.phase === 'play' ? mustAct(st) : null,
    hand: h.cards[seat], oppCount: h.cards[1 - seat].length,
    table: [0, 1, 2].map((t) => ({ you: h.played[seat][t] || null, opp: h.played[1 - seat][t] || null })),
    tricks: h.tricks.map(relTrick),
    truco: {
      level: h.truco.level, owner: h.truco.owner === null ? null : rel(h.truco.owner),
      pending: h.truco.pending ? { level: h.truco.pending.level, from: rel(h.truco.pending.from) } : null,
    },
    envido: {
      done: h.envido.done,
      pending: h.envido.pending ? { chain: h.envido.pending.chain, from: rel(h.envido.pending.from) } : null,
    },
    myTanto: tanto(h.orig[seat]),
    handPoints: POINTS[h.truco.level],
    actions: L,
    ready: st.ready,
    summary: st.summary,
    winner: st.winner,
    log: st.log.slice(-30),
  };
}

// ----------------------------------------------------------------------------- bot
const W = (p) => (p >= 12 ? 1 : p >= 10 ? 0.8 : p === 9 ? 0.6 : p === 8 ? 0.45 : p >= 5 ? 0.25 : 0.1);

/** 0..1: qué tan buena es la mano, ajustada por cómo viene la mano en juego. */
function strength(st, seat) {
  const h = st.hand;
  const w = h.orig[seat].map((c) => W(power(c))).sort((a, b) => b - a);
  let s = w[0] * 0.45 + w[1] * 0.35 + w[2] * 0.2;
  if (h.tricks.length) {
    const rest = h.cards[seat].map((c) => W(power(c)));
    const best = rest.length ? Math.max(...rest) : 0;
    if (h.tricks[0] === seat) s += 0.2;
    else if (h.tricks[0] === 1 - seat) s += best >= 0.8 ? 0 : -0.15;
  }
  return Math.min(1, Math.max(0, s));
}

function botPlay(st, seat) {
  const h = st.hand;
  const mine = h.cards[seat].slice().sort((a, b) => power(a) - power(b));
  const t = h.tricks.length;
  const opp = h.played[1 - seat][t];
  if (opp) {
    const po = power(opp);
    const beat = mine.find((c) => power(c) > po);
    if (beat) return beat;
    const tie = mine.find((c) => power(c) === po);
    if (tie && (t === 0 || h.tricks[0] === seat)) return tie;
    return mine[0];
  }
  if (t === 0 && mine.length === 3) {
    const r = rnd(100);
    return r < 50 ? mine[1] : r < 75 ? mine[2] : mine[0];
  }
  return mine[mine.length - 1];
}

function botAction(st, seat) {
  const L = legal(st, seat);
  if (L.ready) return { type: 'ready' };
  const h = st.hand;
  const s = strength(st, seat);
  const my = tanto(h.orig[seat]);

  if (L.respond && h.envido.pending) {
    const chain = h.envido.pending.chain;
    const need = chain.includes('falta') ? 31 : chain.includes('real') ? 30 : 27;
    if (L.calls.includes('falta') && my >= 33 && chance(0.5)) return { type: 'call', call: 'falta' };
    if (L.calls.includes('real') && my >= 31 && chance(0.5)) return { type: 'call', call: 'real' };
    if (L.calls.includes('envido') && my >= 29 && chance(0.4)) return { type: 'call', call: 'envido' };
    if (my >= need || (my >= need - 2 && chance(0.35)) || chance(0.08)) return { type: 'respond', answer: 'quiero' };
    return { type: 'respond', answer: 'noquiero' };
  }
  if (L.respond) {
    const lv = h.truco.pending.level;
    const thr = [0.45, 0.55, 0.65][lv - 1];
    if (L.calls.includes('envido') && my >= 29 && chance(0.6)) return { type: 'call', call: 'envido' }; // envido primero
    if (lv === 1 && L.calls.includes('retruco') && s >= thr + 0.25 && chance(0.5)) return { type: 'call', call: 'retruco' };
    if (lv === 2 && L.calls.includes('vale4') && s >= thr + 0.25 && chance(0.5)) return { type: 'call', call: 'vale4' };
    return { type: 'respond', answer: s >= thr || chance(0.12) ? 'quiero' : 'noquiero' };
  }

  if (L.calls.includes('envido')) {
    if (my >= 31 && chance(0.35)) return { type: 'call', call: 'real' };
    if (my >= 28 && chance(0.85)) return { type: 'call', call: 'envido' };
    if (my >= 26 && chance(0.4)) return { type: 'call', call: 'envido' };
    if (chance(0.05)) return { type: 'call', call: 'envido' };
  }
  const raise = L.calls.find((c) => c in CALL_LEVEL);
  if (raise === 'truco' && ((s >= 0.62 && chance(0.55)) || (h.tricks[0] === seat && s >= 0.5 && chance(0.5)) || chance(0.04))) {
    return { type: 'call', call: 'truco' };
  }
  if ((raise === 'retruco' || raise === 'vale4') && s >= 0.75 && chance(0.5)) return { type: 'call', call: raise };
  return { type: 'play', card: idOf(botPlay(st, seat)) };
}

function autoAction(st, seat) {
  const L = legal(st, seat);
  if (L.ready) return { type: 'ready' };
  if (L.respond) return { type: 'respond', answer: 'noquiero' };
  const mine = st.hand.cards[seat].slice().sort((a, b) => power(a) - power(b));
  return { type: 'play', card: idOf(mine[0]) };
}

module.exports = {
  id: 'truco', create, view, act, actors, turnSeconds, botAction, autoAction,
  isOver: (st) => st.phase === 'over',
  winner: (st) => st.winner,
  // expuestos para tests
  power, tanto, handWinner, legal, idOf,
};
