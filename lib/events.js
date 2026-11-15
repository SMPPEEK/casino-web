'use strict';
// Eventos en memoria para el panel de administración (ingresos, jugadas, fallos del puente). Se pierden al reiniciar.
const MAX = 500;
const list = [];
let nextId = 1;
const lastBridge = new Map();

function emit(type, data) {
  list.push({ id: nextId++, t: Date.now(), type, ...data });
  if (list.length > MAX) list.shift();
}

/** Fallos de conexión con Minecraft: a lo sumo uno por minuto y por motivo, para no llenar el panel. */
function bridgeError(reason, detail = '') {
  const now = Date.now();
  if (now - (lastBridge.get(reason) || 0) < 60000) return;
  lastBridge.set(reason, now);
  emit('bridge', { reason, detail });
}

const since = (id) => list.filter((e) => e.id > id);
const lastId = () => nextId - 1;

module.exports = { emit, bridgeError, since, lastId };
