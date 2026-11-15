'use strict';
/**
 * Lógica de los juegos. Todo el azar sale de crypto.randomInt (nunca Math.random) y se resuelve
 * SIEMPRE en el servidor: el navegador solo anima el resultado que recibe.
 * Los pagos son el total que recupera el jugador (apuesta incluida); 0 si pierde.
 */
const crypto = require('crypto');

/** Error de validación o de regla de juego; el servidor lo convierte en HTTP 400 con { error: code }. */
class GameError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const rnd = (n) => crypto.randomInt(n); // entero uniforme en [0, n)

// ------------------------------------------------------------------ tragamonedas
// Pesos sobre 100 por rodillo. RTP exacto = Σ (peso/100)³·premio + P(dos cerezas)·TWO_CHERRIES = 97,28 %.
const SLOT_SYMBOLS = [
  { id: 'cherry', weight: 30, pay: 8 },
  { id: 'lemon', weight: 25, pay: 12 },
  { id: 'bell', weight: 20, pay: 25 },
  { id: 'star', weight: 12, pay: 75 },
  { id: 'diamond', weight: 8, pay: 100 },
  { id: 'seven', weight: 5, pay: 500 },
];
/** Cereza en los dos primeros rodillos y otra cosa en el tercero. */
const TWO_CHERRIES = 2;

function pickSymbol() {
  let n = rnd(100);
  for (const s of SLOT_SYMBOLS) {
    if (n < s.weight) return s.id;
    n -= s.weight;
  }
  throw new Error('pesos de tragamonedas inválidos');
}

function slotsSpin(bet) {
  const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
  let mult = 0;
  let win = null;
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    mult = SLOT_SYMBOLS.find((s) => s.id === reels[0]).pay;
    win = 'triple';
  } else if (reels[0] === 'cherry' && reels[1] === 'cherry') {
    mult = TWO_CHERRIES;
    win = 'cherry2';
  }
  return { reels, mult, win, payout: bet * mult };
}

// ------------------------------------------------------------------------ ruleta
// Ruleta europea (un solo cero): el pleno paga 35 a 1 → devuelve 36 veces la ficha.
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16,
  33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const ROULETTE_PAYS = { straight: 36, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2, dozen: 3, column: 3 };

const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

function betWins(b, n) {
  switch (b.type) {
    case 'straight': return n === b.value;
    case 'red': return n !== 0 && RED.has(n);
    case 'black': return n !== 0 && !RED.has(n);
    case 'odd': return n !== 0 && n % 2 === 1;
    case 'even': return n !== 0 && n % 2 === 0;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'dozen': return n !== 0 && Math.ceil(n / 12) === b.value;
    case 'column': return n !== 0 && n % 3 === b.value % 3; // columna 3 = múltiplos de 3
    default: return false;
  }
}

/** Valida las fichas y devuelve { bets, total }. Rechaza cualquier cosa fuera de lo esperado. */
function validateRouletteBets(input, minBet, maxTotal) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 80) throw new GameError('invalid_bet');
  const bets = [];
  let total = 0;
  for (const b of input) {
    if (!b || typeof b !== 'object' || !(b.type in ROULETTE_PAYS)) throw new GameError('invalid_bet');
    if (!Number.isInteger(b.amount) || b.amount < minBet || b.amount > maxTotal) throw new GameError('invalid_bet');
    const clean = { type: b.type, amount: b.amount };
    if (b.type === 'straight') {
      if (!Number.isInteger(b.value) || b.value < 0 || b.value > 36) throw new GameError('invalid_bet');
      clean.value = b.value;
    } else if (b.type === 'dozen' || b.type === 'column') {
      if (!Number.isInteger(b.value) || b.value < 1 || b.value > 3) throw new GameError('invalid_bet');
      clean.value = b.value;
    }
    total += b.amount;
    if (total > maxTotal) throw new GameError('invalid_bet');
    bets.push(clean);
  }
  return { bets, total };
}

function rouletteSpin(bets) {
  const number = WHEEL_ORDER[rnd(WHEEL_ORDER.length)];
  let payout = 0;
  const results = bets.map((b) => {
    const win = betWins(b, number);
    if (win) payout += b.amount * ROULETTE_PAYS[b.type];
    return { type: b.type, value: b.value, amount: b.amount, win };
  });
  return { number, color: colorOf(number), payout, results };
}

// ------------------------------------------------------------------------- dados
// Tirada de 1 a 100. "under": gana con tirada ≤ objetivo (probabilidad = objetivo %).
// "over": gana con tirada > objetivo (probabilidad = 100 − objetivo %). Devuelve DICE_RTP % de lo apostado.
const DICE_RTP = 97;
const DICE_RANGE = { under: [2, 95], over: [5, 98] };

function diceRoll(bet, mode, target) {
  const range = DICE_RANGE[mode];
  if (!range) throw new GameError('invalid_target');
  if (!Number.isInteger(target) || target < range[0] || target > range[1]) throw new GameError('invalid_target');
  const chance = mode === 'under' ? target : 100 - target;
  const roll = 1 + rnd(100);
  const win = mode === 'under' ? roll <= target : roll > target;
  const mult = DICE_RTP / chance;
  return { roll, win, chance, mult, payout: win ? Math.floor((bet * DICE_RTP) / chance) : 0 };
}

// -------------------------------------------------------------------- cara o cruz
function coinFlip(bet, side) {
  if (side !== 'heads' && side !== 'tails') throw new GameError('invalid_side');
  const result = rnd(2) === 0 ? 'heads' : 'tails';
  const win = result === side;
  // 1,96×; con apuesta de 1 se paga 2 para que ganar siempre deje ganancia.
  return { result, win, payout: win ? Math.max(bet + 1, Math.floor(bet * 1.96)) : 0 };
}

// --------------------------------------------------------------------- blackjack
// 6 mazos barajados en cada mano, el crupier planta en cualquier 17, blackjack paga 3:2, sin split ni seguro.
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function newShoe(decks = 6) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) { // Fisher–Yates
    const j = rnd(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { total += 11; aces++; }
    else if (c.r === 'K' || c.r === 'Q' || c.r === 'J' || c.r === '10') total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const isNatural = (cards) => cards.length === 2 && handValue(cards) === 21;

/** Fija el resultado. hand.bet ya incluye la apuesta extra si se dobló. */
function finish(hand) {
  const p = handValue(hand.player);
  const d = handValue(hand.dealer);
  hand.done = true;
  if (p > 21) { hand.outcome = 'lose'; hand.payout = 0; }
  else if (isNatural(hand.player) && isNatural(hand.dealer)) { hand.outcome = 'push'; hand.payout = hand.bet; }
  else if (isNatural(hand.player)) { hand.outcome = 'blackjack'; hand.payout = hand.bet + Math.floor(hand.bet * 1.5); }
  else if (isNatural(hand.dealer)) { hand.outcome = 'lose'; hand.payout = 0; }
  else if (d > 21 || p > d) { hand.outcome = 'win'; hand.payout = hand.bet * 2; }
  else if (p === d) { hand.outcome = 'push'; hand.payout = hand.bet; }
  else { hand.outcome = 'lose'; hand.payout = 0; }
}

function dealerPlays(hand) {
  while (handValue(hand.dealer) < 17) hand.dealer.push(hand.deck.pop());
  finish(hand);
}

function assertOpen(hand) {
  if (hand.done) throw new GameError('no_active_hand');
}

const bj = {
  deal(bet) {
    const deck = newShoe();
    const hand = { bet, deck, player: [], dealer: [], doubled: false, done: false, outcome: null, payout: 0 };
    hand.player.push(deck.pop());
    hand.dealer.push(deck.pop());
    hand.player.push(deck.pop());
    hand.dealer.push(deck.pop());
    // el crupier "mira" su carta tapada: si alguien tiene blackjack natural la mano se resuelve ya
    if (isNatural(hand.player) || isNatural(hand.dealer)) finish(hand);
    return hand;
  },

  hit(hand) {
    assertOpen(hand);
    hand.player.push(hand.deck.pop());
    const v = handValue(hand.player);
    if (v > 21) finish(hand);
    else if (v === 21) dealerPlays(hand);
  },

  stand(hand) {
    assertOpen(hand);
    dealerPlays(hand);
  },

  canDouble(hand) {
    return !hand.done && hand.player.length === 2 && !hand.doubled;
  },

  /** Quien llama debe haber cobrado antes la apuesta extra (igual a hand.bet). */
  double(hand) {
    assertOpen(hand);
    if (!bj.canDouble(hand)) throw new GameError('cannot_double');
    hand.bet *= 2;
    hand.doubled = true;
    hand.player.push(hand.deck.pop());
    if (handValue(hand.player) > 21) finish(hand);
    else dealerPlays(hand);
  },

  /** Lo que ve el navegador: sin mazo y con la carta tapada del crupier como null. */
  view(hand) {
    return {
      player: hand.player,
      dealer: hand.done ? hand.dealer : [hand.dealer[0], null],
      playerTotal: handValue(hand.player),
      dealerTotal: hand.done ? handValue(hand.dealer) : handValue([hand.dealer[0]]),
      bet: hand.bet,
      done: hand.done,
      outcome: hand.outcome,
      payout: hand.payout,
      canDouble: bj.canDouble(hand),
    };
  },
};

module.exports = {
  GameError, SLOT_SYMBOLS, TWO_CHERRIES, slotsSpin,
  WHEEL_ORDER, validateRouletteBets, rouletteSpin,
  DICE_RTP, diceRoll, coinFlip,
  handValue, bj,
};
