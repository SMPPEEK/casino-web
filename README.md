# Casino web para tu servidor de Minecraft

Casino con **tragamonedas, ruleta, blackjack, dados y cara o cruz** que usa el dinero del servidor
a través del plugin **CasinoBridge** (Paper + Vault). Sin dependencias: solo Node.js ≥ 20.12.

```
Jugador ──/casino link──▶ código ──▶ esta web ──▶ API de CasinoBridge ──▶ Vault ──▶ dinero del jugador
```

## Probarlo ya (sin Minecraft)

```bash
npm run demo        # http://localhost:3000
```

En modo demo cualquier código sirve para entrar (6–12 letras/números, por ejemplo `PRUEBA1`) y cada
jugador arranca con 10.000 monedas "del servidor" simuladas. Nada se conecta a ningún lado.

## Conectarlo a tu servidor

1. Instalá el plugin **CasinoBridge** en Paper (con Vault y un plugin de economía) y poné su `api-key`.
2. Copiá `.env.example` como `.env` y completá:
   - `BRIDGE_URL=http://127.0.0.1:8765/api` (el plugin escucha solo en esa máquina por defecto)
   - `BRIDGE_KEY=` la **misma** clave que el `api-key` del plugin (mínimo 32 caracteres)
   - `SERVER_NAME`, `CURRENCY`, `MAX_BET`, `MAX_CASH` a gusto
3. `npm start`.

Cómo juega un jugador: entra al servidor, escribe `/casino link`, ingresa el código en la web, abre el
**cajero** y carga fichas (se descuentan de su dinero en Minecraft). Cuando quiere, retira y el dinero
vuelve a su cuenta del servidor.

## Juegos y devolución al jugador (RTP)

Todo el azar se resuelve en el servidor con `crypto.randomInt`; el navegador solo anima el resultado.

| Juego | Reglas | Devuelve |
|-------|--------|----------|
| Tragamonedas | 3 rodillos, premios ×8 a ×500, dos cerezas a la izquierda ×2 | 97,28 % |
| Ruleta | Europea (un cero). Pleno ×36, docenas/columnas ×3, resto ×2 | 97,30 % |
| Blackjack | 6 mazos, crupier planta en 17, blackjack 3:2, doblar; sin split ni seguro | ≈ 94 % con estrategia simple |
| Dados | Elegís la probabilidad (2 %–95 %), premio hasta ×48 | 97 % |
| Cara o cruz | 50/50, paga ×1,96 | 98 % |
| Chicken Road | 4 dificultades (carril seguro 90 / 80 / 67 / 50 %), cobrás cuando quieras desde el 1.º carril; el multiplicador sube con cada paso (máx. ×1000) | 97 % |

La ventaja de la casa es lo que mantiene la economía de tu servidor: si subís mucho el RTP, el casino
**crea** dinero. Los números están en `lib/games.js` y los tests los verifican por simulación.

## Seguridad y contabilidad

- Login por código de un solo uso generado en el juego; sesión en cookie `HttpOnly` + `SameSite=Strict`.
- Los POST exigen `application/json` (anti-CSRF) y hay límites por IP en el login y por jugador.
- Cada movimiento de saldo se anota en `data/ledger.log` y las sesiones guardan solo el hash del token.
- Cargar/retirar usa un `txId` fijo por operación y se guarda como **pendiente** antes de llamar al plugin:
  si la conexión se corta, se reintenta sola con el mismo `txId` y el plugin nunca lo procesa dos veces.
- La mano de blackjack en curso se guarda en disco: si el jugador recarga o se reinicia el servidor, la retoma.
- Los datos viven en `data/` (`store.json`, `ledger.log`). **Hacé copias de esa carpeta.**

## Ponerlo en internet

- No expongas el puerto del plugin (8765): solo la web debe poder llegar a él.
- Poné la web detrás de HTTPS (Caddy o nginx) y activá `COOKIE_SECURE=1` y `TRUST_PROXY=1`.
- Ejemplo con Caddy: `casino.tudominio.com { reverse_proxy 127.0.0.1:3000 }`.
- Para dejarlo corriendo: `pm2 start server.js --name casino` o un servicio de systemd.

## Tests

```bash
npm test      # 24 pruebas: contabilidad, cajero, blackjack, anti-CSRF, ledger y RTP de cada juego
```

## Importante

Esto está pensado para la **moneda virtual del servidor**. No vendas esas monedas por dinero real ni
pagues premios reales: eso es juego de azar regulado y cambia por completo el marco legal, además de las
reglas de monetización de Mojang. Mantené visibles los límites de apuesta y el aviso de juego responsable.

## Tema visual
Toda la interfaz usa un estilo de bloques en píxeles con arte propio (sin texturas ni logos de terceros).
Los assets se regeneran con `node tools/pixelart.js` y la fuente con `python3 tools/makefont.py` (requiere fontTools).
La capa de estilo está en `public/css/theme.css`; los juegos no cambiaron de lógica.

## La Loba
Rummy argentino (Loba de menos) con 2 mazos ingleses + 4 comodines, 2 a 4 jugadores: vos contra 1 a 3 bots, límite de 50 o 100 puntos,
sin reenganche. Motor en `lib/loba.js` (tests en `test/loba.test.js`), interfaz en `public/js/games/loba.js`.
Apuesta contra bots: el pozo es `apuesta × jugadores` menos la comisión (5 %); la práctica (apuesta 0) no mueve dinero.
Si publicás detrás de nginx, para el tiempo real (SSE) usá `proxy_buffering off;` en `/api/stream`.

## Privacidad
- Las cabezas de los jugadores las descarga el servidor (`lib/avatar.js`) y se sirven desde `/api/avatar/…`; el navegador no contacta sitios de terceros (la política de seguridad ya no permite imágenes externas). Si el servidor no puede descargarlas, se muestra una cabeza genérica.
- La IP de cada ingreso se guarda (últimas 10 por jugador y un registro de los últimos 500 ingresos) y solo la ve el administrador en `/admin.html`. Nunca se envía a otros jugadores. La web avisa de esto en el pie de página.
- En servidores no premium el UUID sale del nombre: usá un plugin de login (AuthMe) para que nadie pueda linkear una cuenta ajena.

## Panel de administración
`https://TU-DOMINIO/admin.html` (no está enlazado en el menú). Se activa con dos variables de entorno: **`ADMIN_EMAIL`** (tu correo) y **`ADMIN_PASSWORD`** (mínimo 12 caracteres, larga y única; por ejemplo `openssl rand -hex 16`).
Sin `ADMIN_PASSWORD` el panel está desactivado. Se entra con una ventana de «Iniciar sesión» (correo y contraseña; máximo 5 intentos por minuto) y
solo debe usarse con HTTPS. El acceso es independiente de las cuentas de Minecraft a propósito: en servidores no premium cualquiera podría usar tu nombre.
(`ADMIN_KEY` sigue funcionando como nombre antiguo de `ADMIN_PASSWORD`.)
Muestra: jugadores con nombre, UUID, IP usadas, último ingreso y saldo; ingresos recientes (fecha, nombre, IP); jugadas recientes; y por juego
rondas, apostado, pagado y resultado de la casa, con el neto de cada jugador (positivo: ganó; negativo: perdió). Solo cuentan rondas con apuesta.
Con `TRUST_PROXY=1` la IP sale de `X-Forwarded-For`; si ves la misma IP para todos, revisá esa variable (el panel muestra también la IP de conexión cuando difiere).

### Avisos en pantalla (panel de administración)
Mientras el panel está abierto aparecen ventanitas que desaparecen solas cuando alguien ingresa (nombre e IP), gana o pierde más de un monto que elegís
(por defecto 5.000; mínimo 100) o falla la conexión con el plugin de Minecraft (una alerta por minuto y por motivo). Se configuran en «Avisos en pantalla»
y se guardan en tu navegador; hay un interruptor de sonido. Los eventos se guardan en memoria (se pierden al reiniciar la app).

## Aviso legal
La portada, el pie de página, el cajero y la ventana de ingreso aclaran que las fichas son moneda virtual sin valor real, que no se compran con dinero ni se canjean,
y el ingreso exige marcar que se entiende. La página completa de términos está en `public/legal.html` (editala con tus datos de contacto si querés).

### Tiempo real y hostings con proxy
El Truco usa SSE (`/api/stream`) para las novedades. Si el hosting o un proxy retiene esa conexión, el cliente consulta `/api/table` cada 1,5 s mientras hay una búsqueda
de partida o una mesa activa, así que todo funciona igual (con hasta ~1,5 s de retraso) sin recargar la página.
