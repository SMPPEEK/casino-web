// Punto de entrada para hostings con "Setup Node.js App" de cPanel (Passenger carga el archivo con require,
// por eso no alcanza con server.js, que solo arranca cuando se ejecuta directamente).
'use strict';
const cfg = require('./lib/config');
if (!cfg.demo && (!cfg.bridgeKey || cfg.bridgeKey.length < 32)) {
  console.error('Falta BRIDGE_KEY (la misma api-key del plugin, mínimo 32 caracteres).');
} else {
  require('./server').start().then((s) => console.log('Casino iniciado', s.address()));
}
