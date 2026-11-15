'use strict';
const path = require('path');

// Carga .env si existe (Node >= 20.12). Si no existe o no está soportado, se ignora.
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* sin .env */ }

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

module.exports = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  bridgeUrl: (process.env.BRIDGE_URL || 'http://127.0.0.1:8765/api').replace(/\/$/, ''),
  bridgeKey: process.env.BRIDGE_KEY || '',
  demo: process.argv.includes('--demo') || process.env.DEMO === '1',
  serverName: process.env.SERVER_NAME || 'Arenita SMP',
  currency: process.env.CURRENCY || 'monedas',
  minBet: 1,
  maxBet: num(process.env.MAX_BET, 10000),
  maxCash: num(process.env.MAX_CASH, 100000),
  rake: Math.min(0.5, Math.max(0, num(process.env.RAKE, 0.05))), // comisión de la casa en Truco y La Loba
  cookieSecure: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),   // correo para entrar a /admin.html
  adminPassword: process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY || '', // contraseña (mínimo 12 caracteres); vacía = panel desactivado
  sessionDays: 7,
};
