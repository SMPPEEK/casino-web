'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/truco');
const { GameError } = require('../lib/games');

const parse = (s) => ({ n: parseInt(s, 10), s: s.slice(-1) });

/** Mano armada a mano: c0 y c1 son las cartas de cada asiento, mano = quién juega primero. */
function fixed({ c0, c1, mano = 0, scores = [0, 0] }) {
  const st = T.create({ names: ['A', 'B'], bots: [false, false] });
  st.mano = mano;
  st.scores = scores.slice();
  const cards = [c0.map(parse), c1.map(parse)];
  st.hand = {
    cards, orig: [cards[0].slice(), cards[1].slice()], played: [[], []], tricks: [], turn: mano,
    truco: { level: 0, owner: null, pending: null }, envido: { done: false, pending: null }, suspended: null,
  };
  return st;
}
const play = (st, seat, card) => T.act(st, seat, { type: 'play', card });
const call = (st, seat, c) => T.act(st, seat, { type: 'call', call: c });
const say = (st, seat, answer) => T.act(st, seat, { type: 'respond', answer });
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof GameError && e.code === code);

test('jerarquía de las cartas', () => {
  const order = ['1E', '1B', '7E', '7O', '3C', '2O', '1C', '1O', '12E', '11E', '10E', '7C', '7B', '6E', '5E', '4E'];
  const p = order.map((c) => T.power(parse(c)));
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1] >= p[i], `${order[i - 1]} >= ${order[i]}`);
  assert.equal(T.power(parse('3E')), T.power(parse('3O')));
  assert.equal(T.power(parse('1C')), T.power(parse('1O')));
  assert.ok(T.power(parse('7E')) > T.power(parse('3C')));
  assert.ok(T.power(parse('7C')) < T.power(parse('10E')));
});

test('tanto del envido', () => {
  assert.equal(T.tanto(['7E', '6E', '1C'].map(parse)), 33);
  assert.equal(T.tanto(['12E', '11C', '5O'].map(parse)), 5);
  assert.equal(T.tanto(['7E', '12E', '4B'].map(parse)), 27);
  assert.equal(T.tanto(['12E', '10E', '11E'].map(parse)), 20);
  assert.equal(T.tanto(['7E', '6E', '5E'].map(parse)), 33); // tres del mismo palo: las dos más altas
  assert.equal(T.tanto(['12E', '11C', '10O'].map(parse)), 0);
});

test('quién gana la mano según las bazas', () => {
  const w = T.handWinner;
  assert.equal(w([0, 0], 1), 0);
  assert.equal(w([1, 1], 0), 1);
  assert.equal(w([0, 1], 0), null);
  assert.equal(w(['t', 1], 0), 1);   // parda en la primera: define la segunda
  assert.equal(w([0, 't'], 1), 0);   // ganó la primera y empató la segunda
  assert.equal(w(['t', 't'], 1), null);
  assert.equal(w(['t', 't', 't'], 1), 1); // todo parda: gana la mano
  assert.equal(w(['t', 't', 0], 1), 0);
  assert.equal(w([0, 1, 't'], 1), 0);  // 1-1 y tercera parda: gana quien ganó la primera
  assert.equal(w([1, 0, 't'], 0), 1);
  assert.equal(w([0, 1, 1], 0), 1);
});

test('mano normal con truco querido: vale 2', () => {
  const st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'truco');
  throwsCode(() => play(st, 0, '1E'), 'not_your_turn');
  say(st, 1, 'quiero');
  play(st, 0, '1E'); play(st, 1, '4B');
  play(st, 0, '3C'); play(st, 1, '5B');
  assert.deepEqual(st.scores, [2, 0]);
  assert.equal(st.phase, 'handOver');
});

test('truco no querido: 1 punto; retruco no querido: 2; vale cuatro no querido: 3', () => {
  let st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'truco'); say(st, 1, 'noquiero');
  assert.deepEqual(st.scores, [1, 0]);

  st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'truco'); call(st, 1, 'retruco'); say(st, 0, 'noquiero');
  assert.deepEqual(st.scores, [0, 2]);

  st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'truco'); call(st, 1, 'retruco'); say(st, 0, 'quiero');
  assert.deepEqual(T.legal(st, 0).calls.filter((c) => c === 'vale4'), ['vale4']);
  call(st, 0, 'vale4'); say(st, 1, 'noquiero');
  assert.deepEqual(st.scores, [3, 0]); // cobra 3 quien cantó el vale cuatro
});

test('solo quien aceptó puede subir el truco, y se juega a 4', () => {
  const st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'truco'); say(st, 1, 'quiero');
  assert.ok(!T.legal(st, 0).calls.includes('retruco'), 'quien cantó no puede subirse solo');
  play(st, 0, '1E');
  assert.ok(T.legal(st, 1).calls.includes('retruco'));
  call(st, 1, 'retruco'); say(st, 0, 'quiero');
  throwsCode(() => call(st, 0, 'vale4'), 'not_your_turn'); // todavía le toca jugar al rival
  play(st, 1, '4B');
  call(st, 0, 'vale4'); say(st, 1, 'quiero');
  play(st, 0, '3C'); play(st, 1, '5B');
  assert.deepEqual(st.scores, [4, 0]);
});

test('envido: gana el tanto más alto, empata la mano, puntos de cada canto', () => {
  let st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'] }); // 33 contra 32
  call(st, 0, 'envido'); say(st, 1, 'quiero');
  assert.deepEqual(st.scores, [2, 0]);

  st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'], mano: 1 }); // mismo envido pero el rival es mano
  call(st, 1, 'envido'); call(st, 0, 'real'); say(st, 1, 'quiero');
  assert.deepEqual(st.scores, [5, 0]); // envido + real = 5, gana el 33

  st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '6C', '4O'] }); // 33 contra 33: gana la mano (asiento 0)
  call(st, 0, 'envido'); say(st, 1, 'quiero');
  assert.deepEqual(st.scores, [2, 0]);

  st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'envido'); call(st, 1, 'envido'); say(st, 0, 'noquiero');
  assert.deepEqual(st.scores, [0, 2]); // envido envido no querido: vale lo anterior (2)
});

test('falta envido vale lo que le falta al que va ganando', () => {
  let st = fixed({ c0: ['7E', '6E', '4B'], c1: ['1C', '5B', '6B'], scores: [3, 9] });
  call(st, 0, 'falta'); say(st, 1, 'quiero');
  assert.equal(st.scores[0], 3 + (15 - 9));
  st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'], scores: [3, 9] });
  call(st, 0, 'falta'); say(st, 1, 'noquiero');
  assert.deepEqual(st.scores, [4, 9]); // falta no querida: 1 punto
});

test('el envido puede terminar el partido', () => {
  const st = fixed({ c0: ['7E', '6E', '4B'], c1: ['1C', '5B', '6B'], scores: [14, 5] });
  call(st, 0, 'envido'); say(st, 1, 'quiero');
  assert.equal(st.phase, 'over');
  assert.equal(T.winner(st), 0);
  assert.deepEqual(T.actors(st), []);
  throwsCode(() => play(st, 0, '7E'), 'game_over');
});

test('"el envido está primero": se responde un truco con envido y después se vuelve al truco', () => {
  const st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'], mano: 0 });
  call(st, 0, 'truco');
  assert.ok(T.legal(st, 1).calls.includes('envido'));
  call(st, 1, 'envido');
  assert.deepEqual(T.actors(st), [0]);
  say(st, 0, 'quiero');                    // gana el 0 con 33 → +2
  assert.deepEqual(st.scores, [2, 0]);
  assert.deepEqual(T.actors(st), [1]);     // el rival todavía debe contestar el truco
  assert.deepEqual(T.legal(st, 1).respond, true);
  say(st, 1, 'quiero');
  assert.equal(st.hand.truco.level, 1);
});

test('el envido se cierra al jugar la primera carta, tras un truco querido y una vez cantado', () => {
  const calls = (s, seat) => T.legal(s, seat).calls || [];
  let st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'] });
  play(st, 0, '7E');
  assert.ok(calls(st, 1).includes('envido'), 'el segundo todavía no jugó su primera carta');
  play(st, 1, '7C');
  assert.ok(!calls(st, 0).includes('envido'));

  st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'] });
  call(st, 0, 'truco'); say(st, 1, 'quiero');
  assert.ok(!calls(st, 0).includes('envido'));

  st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'] });
  call(st, 0, 'envido'); say(st, 1, 'noquiero');
  assert.ok(!calls(st, 0).includes('envido'));
  throwsCode(() => call(st, 0, 'envido'), 'illegal_call');
});

test('encadenar envidos: máximo dos envidos, real una vez, falta al final', () => {
  const st = fixed({ c0: ['7E', '6E', '4B'], c1: ['7C', '5C', '1O'] });
  call(st, 0, 'envido');
  assert.deepEqual(T.legal(st, 1).calls, ['envido', 'real', 'falta']);
  call(st, 1, 'envido');
  assert.deepEqual(T.legal(st, 0).calls, ['real', 'falta']);
  call(st, 0, 'real');
  assert.deepEqual(T.legal(st, 1).calls, ['falta']);
  call(st, 1, 'falta');
  assert.deepEqual(T.legal(st, 0).calls, []);
});

test('irse al mazo da el valor del truco al rival', () => {
  let st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  T.act(st, 0, { type: 'fold' });
  assert.deepEqual(st.scores, [0, 1]);
  st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  call(st, 0, 'truco'); say(st, 1, 'quiero'); play(st, 0, '1E');
  call(st, 1, 'retruco'); say(st, 0, 'quiero');
  T.act(st, 1, { type: 'fold' });
  assert.deepEqual(st.scores, [3, 0]);
});

test('no se puede jugar fuera de turno ni cartas que no se tienen', () => {
  const st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  throwsCode(() => play(st, 1, '4B'), 'not_your_turn');
  throwsCode(() => play(st, 0, '4B'), 'illegal_card');
  throwsCode(() => T.act(st, 0, { type: 'respond', answer: 'quiero' }), 'illegal_answer');
  throwsCode(() => T.act(st, 0, { type: 'nada' }), 'invalid_action');
  throwsCode(() => T.act(st, 0, null), 'invalid_action');
});

test('la vista no revela las cartas del rival', () => {
  const st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  const json = JSON.stringify(T.view(st, 0));
  for (const c of ['4B', '5B', '6B']) assert.ok(!json.includes(`"n":${parseInt(c, 10)},"s":"${c.slice(-1)}"`), `no debe filtrar ${c}`);
  assert.equal(T.view(st, 0).oppCount, 3);
  assert.equal(T.view(st, 1).hand.length, 3);
});

test('tras la mano hay que confirmar para repartir y rota la mano', () => {
  const st = fixed({ c0: ['1E', '3C', '4O'], c1: ['4B', '5B', '6B'] });
  T.act(st, 0, { type: 'fold' });
  assert.deepEqual(T.actors(st), [0, 1]);
  T.act(st, 0, { type: 'ready' });
  assert.deepEqual(T.actors(st), [1]);
  T.act(st, 1, { type: 'ready' });
  assert.equal(st.phase, 'play');
  assert.equal(st.mano, 1);
  assert.equal(st.hand.cards[0].length, 3);
});

test('simulación: 600 partidas bot contra bot terminan y respetan las reglas', () => {
  let hands = 0;
  const wins = [0, 0];
  for (let g = 0; g < 600; g++) {
    const st = T.create({ names: ['A', 'B'], bots: [true, true] });
    let steps = 0;
    while (!T.isOver(st)) {
      const seat = T.actors(st)[0];
      T.act(st, seat, T.botAction(st, seat));
      assert.ok(++steps < 5000, 'la partida no termina');
      assert.ok(st.scores.every((s) => s >= 0));
    }
    hands += st.handNo;
    wins[T.winner(st)]++;
    assert.ok(st.scores[T.winner(st)] >= 15);
  }
  const avg = hands / 600;
  console.log(`  manos por partida: ${avg.toFixed(1)} · victorias asiento0/asiento1: ${wins}`);
  assert.ok(avg > 3 && avg < 40);
  assert.ok(Math.abs(wins[0] - wins[1]) < 120, 'ningún asiento debería tener ventaja enorme');
});

test('fuzz: acciones legales al azar nunca rompen el motor', () => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  for (let g = 0; g < 300; g++) {
    const st = T.create({ names: ['A', 'B'], bots: [false, false] });
    let steps = 0;
    while (!T.isOver(st)) {
      const seat = T.actors(st)[0];
      const L = T.legal(st, seat);
      const opts = [];
      if (L.ready) opts.push({ type: 'ready' });
      for (const c of L.play || []) opts.push({ type: 'play', card: c });
      for (const c of L.calls || []) opts.push({ type: 'call', call: c });
      if (L.respond) opts.push({ type: 'respond', answer: 'quiero' }, { type: 'respond', answer: 'noquiero' });
      if (L.fold) opts.push({ type: 'fold' });
      assert.ok(opts.length > 0, 'siempre hay una acción legal');
      T.act(st, seat, pick(opts));
      assert.ok(++steps < 8000, 'la partida no termina');
    }
  }
});

test('autoAction siempre es legal', () => {
  for (let g = 0; g < 100; g++) {
    const st = T.create({ names: ['A', 'B'], bots: [false, false] });
    let steps = 0;
    while (!T.isOver(st) && steps++ < 3000) {
      const seat = T.actors(st)[0];
      T.act(st, seat, T.autoAction(st, seat));
    }
    assert.ok(T.isOver(st));
  }
});
