'use strict';
/**
 * Chicken Road: la gallina cruza carriles. En cada paso hay una probabilidad fija de trampa;
 * el multiplicador sube con cada carril superado y se puede retirar en cualquier momento (desde el 1.º).
 * Multiplicador tras k pasos = RTP / P(sobrevivir)^k, redondeado hacia abajo a 2 decimales (RTP 97 %).
 * El azar se tira en el servidor en cada paso (crypto.randomInt); el navegador solo anima.
 */
const crypto = require('crypto');
const { GameError } = require('./games');

const RTP = 0.97;
const MAX_MULT = 1000;
/** trap/den = probabilidad de trampa por carril. */
const LEVELS = {
  easy: { trap: 1, den: 10, lanes: 20 },
  medium: { trap: 1, den: 5, lanes: 16 },
  hard: { trap: 1, den: 3, lanes: 12 },
  extreme: { trap: 1, den: 2, lanes: 8 },
};

/** Multiplicador (×100, entero) tras `step` carriles superados. */
function multCents(level, step) {
  const L = LEVELS[level];
  const surv = (L.den - L.trap) / L.den;
  return Math.min(MAX_MULT * 100, Math.floor((100 * RTP) / Math.pow(surv, step) + 1e-9));
}
const table = (level) => Array.from({ length: LEVELS[level].lanes }, (_, i) => multCents(level, i + 1) / 100);

function start(bet, level) {
  if (!Object.prototype.hasOwnProperty.call(LEVELS, level)) throw new GameError('invalid_level');
  return { bet, level, step: 0, done: false, outcome: null, payout: 0, trapAt: null };
}

function step(r) {
  if (r.done) throw new GameError('round_over');
  const L = LEVELS[r.level];
  if (crypto.randomInt(L.den) < L.trap) {
    r.done = true; r.outcome = 'trap'; r.payout = 0; r.trapAt = r.step + 1;
  } else {
    r.step += 1;
    if (r.step >= L.lanes) cashout(r, true); // llegó al final: cobra solo
  }
}

function cashout(r, auto = false) {
  if (r.done) throw new GameError('round_over');
  if (r.step < 1) throw new GameError('no_steps');
  r.done = true; r.outcome = auto ? 'end' : 'cash';
  r.payout = Math.floor((r.bet * multCents(r.level, r.step)) / 100);
}

function view(r) {
  const L = LEVELS[r.level];
  return {
    level: r.level, bet: r.bet, step: r.step, lanes: L.lanes, done: r.done, outcome: r.outcome,
    payout: r.payout, trapAt: r.trapAt,
    mult: r.step ? multCents(r.level, r.step) / 100 : 1,
    next: r.step < L.lanes ? multCents(r.level, r.step + 1) / 100 : null,
    cashValue: r.step ? Math.floor((r.bet * multCents(r.level, r.step)) / 100) : 0,
    chance: Math.round(((L.den - L.trap) / L.den) * 1000) / 10,
  };
}

module.exports = { RTP, LEVELS, multCents, table, start, step, cashout, view };
