'use strict';
/**
 * Cliente de la API del plugin CasinoBridge (Paper + Vault).
 * Cada función devuelve { status, data } con la respuesta HTTP del plugin y LANZA si no hubo
 * conexión (timeout, plugin apagado). El servidor trata ese caso como "resultado desconocido"
 * y reintenta con el mismo txId, que el plugin nunca procesa dos veces.
 *
 * En modo demo (--demo) no se contacta a nadie: hay un "Minecraft" falso en memoria donde
 * cada jugador empieza con 10.000 monedas.
 */
const crypto = require('crypto');
const cfg = require('./config');

// ------------------------------------------------------------------ modo demo
const demoBalances = new Map(); // uuid -> saldo "en el servidor"
const demoTx = new Set();       // txId ya procesados (idempotencia, igual que el plugin)

const demoBalance = (uuid) => {
  if (!demoBalances.has(uuid)) demoBalances.set(uuid, 10000);
  return demoBalances.get(uuid);
};

function demoUuid(code) {
  const h = crypto.createHash('sha1').update('demo:' + code).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const demo = {
  async verify(code) {
    // En demo cualquier código sirve; cada código distinto es un jugador distinto.
    return { status: 200, data: { uuid: demoUuid(code), name: 'Demo_' + code.slice(0, 6) } };
  },
  async balance(uuid) {
    return { status: 200, data: { uuid, balance: demoBalance(uuid) } };
  },
  async withdraw(uuid, amount, txId) {
    if (demoTx.has(txId)) return { status: 409, data: { error: 'duplicate_transaction' } };
    if (demoBalance(uuid) < amount) return { status: 402, data: { error: 'insufficient_funds' } };
    demoTx.add(txId);
    demoBalances.set(uuid, demoBalance(uuid) - amount);
    return { status: 200, data: { status: 'ok', txId, balance: demoBalance(uuid) } };
  },
  async deposit(uuid, amount, txId) {
    if (demoTx.has(txId)) return { status: 409, data: { error: 'duplicate_transaction' } };
    demoTx.add(txId);
    demoBalances.set(uuid, demoBalance(uuid) + amount);
    return { status: 200, data: { status: 'ok', txId, balance: demoBalance(uuid) } };
  },
};

// ------------------------------------------------------------------ puente real
async function call(method, pathname, body) {
  const res = await fetch(cfg.bridgeUrl + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + cfg.bridgeKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  let data = {};
  try { data = await res.json(); } catch { /* respuesta sin JSON */ }
  return { status: res.status, data };
}

const real = {
  verify: (code) => call('POST', '/link/verify', { code }),
  balance: (uuid) => call('GET', '/balance/' + encodeURIComponent(uuid)),
  withdraw: (uuid, amount, txId) => call('POST', '/withdraw', { uuid, amount, txId }), // Minecraft -> casino
  deposit: (uuid, amount, txId) => call('POST', '/deposit', { uuid, amount, txId }),   // casino -> Minecraft
};

const impl = () => (cfg.demo ? demo : real);

module.exports = {
  verify: (...a) => impl().verify(...a),
  balance: (...a) => impl().balance(...a),
  withdraw: (...a) => impl().withdraw(...a),
  deposit: (...a) => impl().deposit(...a),
};
