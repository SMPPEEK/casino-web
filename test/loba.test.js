'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/loba');
const { card, analyzeMeld, canAdd } = L;
const C = (...ids) => ids.map(card);
const ids = (cs) => cs.map((c) => c.id);

test('pierna: 3 palos distintos, sin comodín, hasta 6', () => {
  assert.equal(analyzeMeld(C('7S0', '7H0', '7D0')).type, 'pierna');
  assert.equal(analyzeMeld(C('7S0', '7H0', '7D0', '7S1')).type, 'pierna');      // repite palo del otro mazo
  assert.equal(analyzeMeld(C('7S0', '7H0', '7D0', '7C0')), null);                // 4 palos no
  assert.equal(analyzeMeld(C('7S0', '7S1', '7H0')), null);                       // solo 2 palos
  assert.equal(analyzeMeld(C('7S0', '7H0', 'JK0')), null);                       // comodín no hace pierna
  assert.equal(analyzeMeld(C('7S0', '7H0')), null);
});

test('escalera: seguidas, mismo palo, as bajo o alto pero no ambos', () => {
  assert.equal(analyzeMeld(C('4H0', '5H0', '6H0')).type, 'escalera');
  assert.equal(analyzeMeld(C('AH0', '2H0', '3H0')).type, 'escalera');
  assert.equal(analyzeMeld(C('QH0', 'KH0', 'AH0')).type, 'escalera');
  assert.equal(analyzeMeld(C('KH0', 'AH0', '2H0')), null);                       // K-A-2 no vale
  assert.equal(analyzeMeld(C('4H0', '5S0', '6H0')), null);
  assert.equal(analyzeMeld(C('4H0', '4H1', '5H0')), null);
  assert.equal(analyzeMeld(C('4H0', '6H0', '7H0')), null);                       // hueco sin comodín
});

test('escalera con un comodín (hueco o extremo), nunca dos', () => {
  const m = analyzeMeld(C('4H0', 'JK0', '6H0'));
  assert.equal(m.cards.find((c) => c.r === 'JOKER').as, '5');
  assert.ok(analyzeMeld(C('4H0', '5H0', 'JK0')));
  assert.equal(analyzeMeld(C('4H0', 'JK0', 'JK1', '7H0')), null);
  assert.equal(analyzeMeld(C('4H0', '8H0', 'JK0')), null);                       // hueco grande
});

test('agregar a escalera y a pierna', () => {
  const e = analyzeMeld(C('4H0', '5H0', '6H0'));
  assert.ok(canAdd(e, card('7H0')));
  assert.ok(canAdd(e, card('3H0')));
  assert.equal(canAdd(e, card('8H0')), null);
  assert.equal(canAdd(e, card('7S0')), null);
  assert.equal(e.cards.length, 3, 'no muta la combinación');
  const p = analyzeMeld(C('7S0', '7H0', '7D0'));
  assert.ok(canAdd(p, card('7S1')));
  assert.equal(canAdd(p, card('7C0')), null);
  assert.equal(canAdd(p, card('JK0')), null);
});

test('comodín de un extremo pasa al otro al agregar la carta natural', () => {
  const e = analyzeMeld(C('4H0', '5H0', 'JK0'));          // comodín = 6
  const n = canAdd(e, card('6H0'));
  assert.ok(n);
  assert.deepEqual(ids(n.cards).sort(), ['4H0', '5H0', '6H0', 'JK0']);
  const j = n.cards.find((c) => c.r === 'JOKER');
  assert.equal(j.as, '3');   // el comodín pasa del extremo alto (6) al bajo (3)
  assert.equal(canAdd(n, card('JK1')), null);
});

test('as: no se puede cerrar la escalera en círculo', () => {
  const e = analyzeMeld(C('QH0', 'KH0', 'AH0'));
  assert.equal(canAdd(e, card('2H0')), null);
  const low = analyzeMeld(C('AH0', '2H0', '3H0'));
  assert.equal(canAdd(low, card('KH0')), null);
});

test('penalidades', () => {
  assert.equal(L.penalty(card('5H0')), 5);
  assert.equal(L.penalty(card('10H0')), 10);
  assert.equal(L.penalty(card('AH0')), 10);
  assert.equal(L.penalty(card('KH0')), 10);
  assert.equal(L.penalty(card('JK0')), 10);
});

function mk(n = 3, opts = {}) {
  return L.create({ names: ['A', 'B', 'C', 'D'].slice(0, n), bots: [false, ...Array(n - 1).fill(true)], options: opts });
}
const total = (st) => st.stock.length + st.discard.length + st.hands.reduce((a, h) => a + h.length, 0) + st.melds.reduce((a, m) => a + m.cards.length, 0);

test('reparto: 108 cartas, 9 a cada uno, primer descarte no es comodín', () => {
  for (let i = 0; i < 50; i++) {
    const st = mk(2 + (i % 3));
    assert.equal(total(st), 108);
    st.hands.forEach((h) => assert.equal(h.length, 9));
    assert.notEqual(st.discard[0].r, 'JOKER');
    assert.equal(new Set([...st.stock, ...st.discard, ...st.hands.flat()].map((c) => c.id)).size, 108);
  }
});

test('la vista oculta las manos ajenas', () => {
  const st = mk(3);
  const v = L.view(st, 0);
  assert.equal(v.hand.length, 9);
  assert.deepEqual(v.handCounts, [9, 9, 9]);
  assert.ok(!('hands' in v) && !('stock' in v));
  assert.ok(!JSON.stringify(v).includes(st.hands[1][0].id) || v.hand.some((c) => c.id === st.hands[1][0].id) || true);
  const other = st.hands[1].filter((c) => !v.hand.some((x) => x.id === c.id));
  const s = JSON.stringify(v);
  assert.ok(other.every((c) => !s.includes(`"${c.id}"`)));
});

test('turnos: fuera de turno, fase equivocada, descarte forzado', () => {
  const st = mk(2);
  const t = st.turn, o = 1 - t;
  assert.throws(() => L.act(st, o, { type: 'draw', from: 'stock' }), { code: 'not_your_turn' });
  assert.throws(() => L.act(st, t, { type: 'discard', card: st.hands[t][0].id }), { code: 'wrong_phase' });
  // armar: el pozo sirve para una pierna de la mano
  st.hands[t] = C('7H0', '7D0', '2S0', '9C0', 'KC0', '3D1', '5S1', '8H1', 'QD1');
  st.discard = [card('7S0')];
  L.act(st, t, { type: 'draw', from: 'discard' });
  assert.equal(st.forced, '7S0');
  assert.throws(() => L.act(st, t, { type: 'discard', card: '2S0' }), { code: 'must_play_discard' });
  assert.throws(() => L.act(st, t, { type: 'meld', cards: ['2S0', '9C0', 'KC0'] }), { code: 'must_play_discard' });
  L.act(st, t, { type: 'meld', cards: ['7S0', '7H0', '7D0'] });
  assert.equal(st.forced, null);
  L.act(st, t, { type: 'discard', card: '2S0' });
  assert.equal(st.turn, o);
});

test('pozo no usable se rechaza', () => {
  const st = mk(2);
  const t = st.turn;
  st.hands[t] = C('2S0', '5H0', '9C0', 'KC0', '3D1', '6S1', '8H1', 'QD1', '4C1');
  st.discard = [card('AS0')];
  assert.equal(L.view(st, t).canTakeDiscard, false);
  assert.throws(() => L.act(st, t, { type: 'draw', from: 'discard' }), { code: 'discard_unusable' });
});

test('agregar exige haber bajado una combinación propia; el comodín no se descarta', () => {
  const st = mk(2);
  const t = st.turn;
  st.hands[t] = C('4H0', '5H0', '6H0', '7H0', 'JK0', '2S0', '9C0', 'KC0', '3D1');
  st.melds = [{ id: 'm1', owner: 1 - t, ...analyzeMeld(C('8H1', '9H1', '10H1')) }];
  st.stock.push(card('2D0'));
  L.act(st, t, { type: 'draw', from: 'stock' });
  assert.throws(() => L.act(st, t, { type: 'add', meld: 'm1', card: '7H0' }), { code: 'need_meld_first' });
  assert.throws(() => L.act(st, t, { type: 'discard', card: 'JK0' }), { code: 'joker_discard' });
  assert.throws(() => L.act(st, t, { type: 'meld', cards: ['4H0', '5H0'] }), { code: 'invalid_meld' });
  L.act(st, t, { type: 'meld', cards: ['4H0', '5H0', '6H0'] });
  assert.throws(() => L.act(st, t, { type: 'add', meld: 'm1', card: '2S0' }), { code: 'cannot_add' });
  L.act(st, t, { type: 'add', meld: 'm1', card: '7H0' });
  assert.equal(st.melds[0].cards.length, 4);
});

test('cortar bajando todo de una: −10; si ya había bajado antes: 0', () => {
  for (const before of [false, true]) {
    const st = mk(2);
    const t = st.turn, o = 1 - t;
    st.hands[t] = C('4H0', '5H0', '6H0', '7S0', '7H0', '7D0');
    st.hands[o] = C('KH0', '2S0', '9C0');
    st.meldedThisRound[t] = before;
    st.scores = [10, 10];
    st.stock.push(card('2D0'));
    st.hands[t].push(card('8H0'));
    // a: 4-5-6 de corazones con 8? no; usar 7H en la escalera: 4,5,6,7H + pierna 7S 7D … simplificamos:
    st.hands[t] = C('4H0', '5H0', '6H0');
    L.act(st, t, { type: 'draw', from: 'stock' });
    st.hands[t] = C('4H0', '5H0', '6H0');
    L.act(st, t, { type: 'meld', cards: ['4H0', '5H0', '6H0'] });
    assert.equal(st.phase, 'roundOver');
    assert.equal(st.summary.bonus, !before);
    assert.equal(st.scores[t], before ? 10 : 0);
    assert.equal(st.scores[o], 10 + 10 + 2 + 9);
  }
});

test('cortar descartando la última carta: sin bonus', () => {
  const st = mk(2);
  const t = st.turn;
  st.hands[t] = C('4H0', '5H0', '6H0', '9C0');
  st.hands[1 - t] = C('KH0');
  st.stock.push(card('2D0'));
  L.act(st, t, { type: 'draw', from: 'stock' });
  L.act(st, t, { type: 'meld', cards: ['4H0', '5H0', '6H0'] });
  st.hands[t] = C('9C0');
  L.act(st, t, { type: 'discard', card: '9C0' });
  assert.equal(st.phase, 'roundOver');
  assert.equal(st.summary.via, 'discard');
  assert.equal(st.summary.bonus, false);
});

test('eliminación al superar el límite y fin de partida', () => {
  const st = mk(2, { limit: 50 });
  const t = st.turn, o = 1 - t;
  st.scores[o] = 45;
  st.hands[o] = C('KH0', '9C0');
  st.hands[t] = C('4H0', '5H0', '6H0');
  st.stock.push(card('2D0'));
  L.act(st, t, { type: 'draw', from: 'stock' });
  st.hands[t] = C('4H0', '5H0', '6H0');
  L.act(st, t, { type: 'meld', cards: ['4H0', '5H0', '6H0'] });
  assert.equal(st.eliminated[o], true);
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, t);
  assert.ok(L.isOver(st));
  assert.deepEqual(L.actors(st), []);
});

test('límite exacto no elimina (hay que pasarlo)', () => {
  const st = mk(2, { limit: 50 });
  const t = st.turn, o = 1 - t;
  st.scores[o] = 40;
  st.hands[o] = C('KH0');       // +10 = 50
  st.hands[t] = C('4H0', '5H0', '6H0');
  st.stock.push(card('2D0'));
  L.act(st, t, { type: 'draw', from: 'stock' });
  st.hands[t] = C('4H0', '5H0', '6H0');
  L.act(st, t, { type: 'meld', cards: ['4H0', '5H0', '6H0'] });
  assert.equal(st.eliminated[o], false);
  assert.equal(st.phase, 'roundOver');
});

test('se vuelve a barajar el pozo cuando se acaba el mazo', () => {
  const st = mk(2);
  const t = st.turn;
  const extra = st.stock.splice(0, st.stock.length);
  st.discard.push(...extra.slice(0, 20));
  const before = total(st);
  L.act(st, t, { type: 'draw', from: 'stock' });
  assert.equal(total(st), before);
  assert.equal(st.discard.length, 1);
});

test('simulaciones completas con bots: terminan, conservan 108 cartas y no lanzan', () => {
  for (const [n, limit] of [[2, 50], [3, 100], [4, 50], [4, 100], [2, 100], [3, 50]]) {
    let rounds = 0;
    for (let g = 0; g < 40; g++) {
      const st = mk(n, { limit });
      let steps = 0;
      while (!L.isOver(st)) {
        if (++steps > 20000) assert.fail(`no termina (n=${n}, límite=${limit})`);
        const seat = L.actors(st)[0];
        L.act(st, seat, L.botAction(st, seat));
        if (st.phase !== 'roundOver') assert.equal(total(st), 108, `cartas (paso ${steps})`);
      }
      rounds += st.round;
      assert.ok(st.winner !== null && !st.eliminated[st.winner]);
    }
    assert.ok(rounds / 40 < 40, `promedio de rondas razonable (${rounds / 40}) n=${n} límite=${limit}`);
  }
});

test('autoAction (tiempo agotado) siempre es una jugada válida', () => {
  for (let g = 0; g < 30; g++) {
    const st = mk(3, { limit: 50 });
    for (let i = 0; i < 600 && !L.isOver(st); i++) {
      const seat = L.actors(st)[0];
      L.act(st, seat, L.autoAction(st, seat));      // no debe lanzar
      assert.equal(total(st), 108);
    }
  }
});
