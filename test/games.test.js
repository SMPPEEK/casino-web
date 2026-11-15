'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../lib/games');

test('tragamonedas: RTP teórico ≈ 97,3 % (simulación de 1.000.000 giros)', () => {
  const N = 1_000_000;
  let paid = 0;
  for (let i = 0; i < N; i++) paid += g.slotsSpin(1).payout;
  const rtp = paid / N;
  console.log('  RTP tragamonedas:', rtp.toFixed(4));
  assert.ok(Math.abs(rtp - 0.9728) < 0.035, `RTP fuera de rango: ${rtp}`);
});

test('tragamonedas: los pesos suman 100 y la tabla de premios es coherente', () => {
  assert.strictEqual(g.SLOT_SYMBOLS.reduce((a, s) => a + s.weight, 0), 100);
  let rtp = 0;
  for (const s of g.SLOT_SYMBOLS) rtp += Math.pow(s.weight / 100, 3) * s.pay;
  rtp += 0.3 * 0.3 * 0.7 * g.TWO_CHERRIES;
  assert.ok(Math.abs(rtp - 0.9728) < 0.001, `RTP exacto: ${rtp}`);
});

test('ruleta: el pleno devuelve ≈ 97,3 % (1.000.000 giros)', () => {
  const N = 1_000_000;
  let paid = 0;
  for (let i = 0; i < N; i++) paid += g.rouletteSpin([{ type: 'straight', value: 17, amount: 1 }]).payout;
  console.log('  RTP ruleta (pleno):', (paid / N).toFixed(4));
  assert.ok(Math.abs(paid / N - 36 / 37) < 0.03);
});

test('ruleta: validación de apuestas', () => {
  const ok = g.validateRouletteBets([{ type: 'red', amount: 10 }, { type: 'straight', value: 0, amount: 5 }], 1, 1000);
  assert.strictEqual(ok.total, 15);
  const bad = [
    [], null, [{ type: 'nope', amount: 5 }], [{ type: 'straight', value: 37, amount: 5 }],
    [{ type: 'straight', amount: 5 }], [{ type: 'red', amount: 0 }], [{ type: 'red', amount: 1.5 }],
    [{ type: 'red', amount: '5' }], [{ type: 'red', amount: 2000 }], [{ type: 'dozen', value: 4, amount: 5 }],
    [{ type: 'red', amount: 600 }, { type: 'black', amount: 600 }], // suma sobre el máximo
  ];
  for (const b of bad) assert.throws(() => g.validateRouletteBets(b, 1, 1000), (e) => e instanceof g.GameError, JSON.stringify(b));
});

test('ruleta: cada tipo de apuesta paga según su cuota (frecuencia sobre 370.000 giros)', () => {
  const N = 370_000;
  const expected = { red: 18, black: 18, odd: 18, even: 18, low: 18, high: 18, dozen: 12, column: 12 };
  const counts = {};
  const bets = [
    { type: 'red', amount: 1 }, { type: 'black', amount: 1 }, { type: 'odd', amount: 1 }, { type: 'even', amount: 1 },
    { type: 'low', amount: 1 }, { type: 'high', amount: 1 }, { type: 'dozen', value: 2, amount: 1 }, { type: 'column', value: 3, amount: 1 },
  ];
  for (let i = 0; i < N; i++) {
    for (const r of g.rouletteSpin(bets).results) if (r.win) counts[r.type] = (counts[r.type] || 0) + 1;
  }
  for (const [type, k] of Object.entries(expected)) {
    const p = counts[type] / N;
    assert.ok(Math.abs(p - k / 37) < 0.01, `${type}: ${p} vs ${k / 37}`);
  }
});

test('dados: RTP 97 % en under y over', () => {
  for (const [mode, target] of [['under', 50], ['under', 5], ['over', 90], ['over', 50]]) {
    const N = 400_000;
    let paid = 0;
    for (let i = 0; i < N; i++) paid += g.diceRoll(1000, mode, target).payout;
    const rtp = paid / N / 1000;
    assert.ok(Math.abs(rtp - 0.97) < 0.04, `${mode} ${target}: ${rtp}`);
  }
  assert.throws(() => g.diceRoll(10, 'under', 1), g.GameError);
  assert.throws(() => g.diceRoll(10, 'under', 96), g.GameError);
  assert.throws(() => g.diceRoll(10, 'over', 4), g.GameError);
  assert.throws(() => g.diceRoll(10, 'over', 99), g.GameError);
  assert.throws(() => g.diceRoll(10, 'sideways', 50), g.GameError);
});

test('cara o cruz: ≈ 98 %', () => {
  const N = 400_000;
  let paid = 0;
  let heads = 0;
  for (let i = 0; i < N; i++) { const r = g.coinFlip(1000, 'heads'); paid += r.payout; if (r.result === 'heads') heads++; }
  assert.ok(Math.abs(paid / N / 1000 - 0.98) < 0.02);
  assert.ok(Math.abs(heads / N - 0.5) < 0.01);
  assert.throws(() => g.coinFlip(10, 'edge'), g.GameError);
});

test('blackjack: valores de mano, ases y pagos', () => {
  const c = (r) => ({ r, s: 'S' });
  assert.strictEqual(g.handValue([c('A'), c('K')]), 21);
  assert.strictEqual(g.handValue([c('A'), c('A'), c('9')]), 21);
  assert.strictEqual(g.handValue([c('A'), c('A'), c('A')]), 13);
  assert.strictEqual(g.handValue([c('K'), c('Q'), c('5')]), 25);
  assert.strictEqual(g.handValue([c('A'), c('6')]), 17);
  assert.strictEqual(g.handValue([c('A'), c('6'), c('10')]), 17);

  const hand = (player, dealer, deck = [], bet = 100) => ({ bet, deck, player, dealer, doubled: false, done: false, outcome: null, payout: 0 });

  // el jugador planta con 20, el crupier tiene 16 y saca un 10 → se pasa
  let hd = hand([c('K'), c('Q')], [c('10'), c('6')], [c('10')]);
  g.bj.stand(hd);
  assert.strictEqual(hd.outcome, 'win');
  assert.strictEqual(hd.payout, 200);

  // el crupier planta en 17 blando (A+6): no pide carta
  hd = hand([c('10'), c('7')], [c('A'), c('6')], [c('5')]);
  g.bj.stand(hd);
  assert.strictEqual(hd.dealer.length, 2);
  assert.strictEqual(hd.outcome, 'push');
  assert.strictEqual(hd.payout, 100);

  // el jugador se pasa
  hd = hand([c('10'), c('6')], [c('9'), c('7')], [c('9')]);
  g.bj.hit(hd);
  assert.strictEqual(hd.outcome, 'lose');
  assert.strictEqual(hd.payout, 0);

  // doblar: la apuesta se duplica y paga el doble de lo apostado
  hd = hand([c('5'), c('6')], [c('10'), c('7')], [c('10')]);
  assert.ok(g.bj.canDouble(hd));
  g.bj.double(hd);
  assert.strictEqual(hd.bet, 200);
  assert.strictEqual(hd.outcome, 'win'); // 21 contra 17
  assert.strictEqual(hd.payout, 400);
  assert.throws(() => g.bj.hit(hd), g.GameError); // mano terminada

  // la vista pública nunca filtra el mazo ni la carta oculta
  hd = hand([c('9'), c('8')], [c('K'), c('7')], [c('2')]);
  const v = g.bj.view(hd);
  assert.strictEqual(v.dealer[1], null);
  assert.ok(!('deck' in v));
});

test('blackjack: blackjack natural paga 3:2 (redondeo hacia abajo) y el empate devuelve la apuesta', () => {
  let bj = 0, push = 0, lose = 0;
  for (let i = 0; i < 200_000 && (bj < 20 || push < 2 || lose < 2); i++) {
    const hd = g.bj.deal(101);
    if (hd.done && hd.outcome === 'blackjack') { bj++; assert.strictEqual(hd.payout, 101 + 151); }
    if (hd.done && hd.outcome === 'push') { push++; assert.strictEqual(hd.payout, 101); }
    if (hd.done && hd.outcome === 'lose') { lose++; assert.strictEqual(hd.payout, 0); }
  }
  assert.ok(bj >= 20);
});

test('blackjack: estrategia del crupier (pedir hasta 17) devuelve entre 90 % y 99 %', () => {
  const N = 300_000;
  let staked = 0, paid = 0;
  for (let i = 0; i < N; i++) {
    const hd = g.bj.deal(100);
    while (!hd.done) {
      if (g.handValue(hd.player) < 17) g.bj.hit(hd); else g.bj.stand(hd);
    }
    staked += hd.bet;
    paid += hd.payout;
  }
  const rtp = paid / staked;
  console.log('  RTP blackjack (estrategia simple):', rtp.toFixed(4));
  assert.ok(rtp > 0.9 && rtp < 0.99, `rtp ${rtp}`);
});

test('chicken road: RTP ≈ 97 % con cobro tras k pasos y multiplicadores crecientes', () => {
  const ck = require('../lib/chicken');
  for (const [lv, L] of Object.entries(ck.LEVELS)) {
    const t = ck.table(lv);
    assert.strictEqual(t.length, L.lanes);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
    for (const k of [1, Math.min(3, L.lanes)]) {
      const N = 200000; let paid = 0;
      for (let n = 0; n < N; n++) {
        const r = ck.start(100, lv);
        for (let i = 0; i < k && !r.done; i++) ck.step(r);
        if (!r.done) ck.cashout(r);
        paid += r.payout;
      }
      const rtp = paid / (N * 100);
      assert.ok(Math.abs(rtp - 0.97) < 0.03, `${lv} k=${k} rtp=${rtp}`);
    }
  }
  const r = ck.start(10, 'easy');
  assert.throws(() => ck.cashout(r), /no_steps/);
  assert.throws(() => ck.start(10, 'x'), /invalid_level/);
});
