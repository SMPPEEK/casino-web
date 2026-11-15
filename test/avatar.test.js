'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const avatar = require('../lib/avatar');

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const fake = (over = {}) => {
  const calls = [];
  const fn = async (url) => { calls.push(url); return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png, ...over }; };
  fn.calls = calls;
  return fn;
};

test('ids válidos e inválidos', () => {
  assert.ok(avatar.validId('Steve_01'));
  assert.ok(avatar.validId('069a79f4-44e9-4726-a5be-fca90e38aaf5'));
  for (const bad of ['', 'a/b', '../x', 'a b', 'x'.repeat(17), 'name?x=1', 'http://evil', null]) assert.equal(avatar.validId(bad), false, String(bad));
});

test('descarga, guarda en memoria y no vuelve a pedir', async () => {
  avatar._cache.clear();
  const f = fake();
  assert.deepEqual(await avatar.get('Alex', 64, f), png);
  assert.deepEqual(await avatar.get('alex', 64, f), png);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0], 'https://mc-heads.net/avatar/Alex/64');
});

test('tamaño fuera de lista se normaliza a 64', async () => {
  avatar._cache.clear();
  const f = fake();
  await avatar.get('Bob', 9999, f);
  assert.ok(f.calls[0].endsWith('/Bob/64'));
});

test('rechaza lo que no es PNG, lo muy grande y los errores de red; recuerda el fallo', async () => {
  avatar._cache.clear();
  assert.equal(await avatar.get('Eve', 64, fake({ headers: { get: () => 'text/html' } })), null);
  assert.equal(await avatar.get('Big', 64, fake({ arrayBuffer: async () => Buffer.alloc(200 * 1024) })), null);
  const boom = async () => { throw new Error('sin red'); };
  assert.equal(await avatar.get('Net', 64, boom), null);
  const f = fake();
  assert.equal(await avatar.get('Net', 64, f), null, 'el fallo queda en caché un rato');
  assert.equal(f.calls.length, 0);
});

test('un id inválido nunca llega a la red', async () => {
  const f = fake();
  assert.equal(await avatar.get('../etc/passwd', 64, f), null);
  assert.equal(f.calls.length, 0);
});
