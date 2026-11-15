'use strict';
// Cabezas de jugadores: las descarga el servidor y se las entrega a los navegadores, para que ningún visitante
// (ni su IP) hable directo con un sitio de terceros. Se guardan en memoria un rato.
const HOST = 'https://mc-heads.net/avatar/';
const OK_TTL = 60 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const MAX_BYTES = 100 * 1024;
const MAX_ENTRIES = 300;
const SIZES = new Set([40, 64]);
const ID_RE = /^(?:[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}|[A-Za-z0-9_]{1,16})$/;
const cache = new Map(); // clave -> { until, buf|null }

function validId(id) { return typeof id === 'string' && ID_RE.test(id); }
function normSize(s) { const n = Number(s); return SIZES.has(n) ? n : 64; }

/** Devuelve un Buffer PNG o null si no se pudo. `fetchImpl` solo se cambia en las pruebas. */
async function get(id, size, fetchImpl = fetch) {
  if (!validId(id)) return null;
  size = normSize(size);
  const key = `${id.toLowerCase()}:${size}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.buf;
  let buf = null;
  try {
    const res = await fetchImpl(`${HOST}${encodeURIComponent(id)}/${size}`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    const type = String(res.headers.get('content-type') || '');
    if (res.ok && type.startsWith('image/png')) {
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > 0 && data.length <= MAX_BYTES) buf = data;
    }
  } catch { /* sin red o sitio caído: se usa la cabeza genérica */ }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { until: Date.now() + (buf ? OK_TTL : FAIL_TTL), buf });
  return buf;
}

module.exports = { get, validId, normSize, _cache: cache };
