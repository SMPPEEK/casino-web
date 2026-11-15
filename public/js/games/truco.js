import { h, fmt } from '../ui.js';
import { spanishCard, cardBack } from '../cards.js';

const CALL = { truco: 'Truco', retruco: 'Retruco', vale4: 'Vale cuatro', envido: 'Envido', real: 'Real envido', falta: 'Falta envido' };
const REASON = { Mano: 'por las cartas', 'Truco no querido': 'truco no querido', 'Al mazo': 'se fue al mazo' };

/** Misma jerarquía que el servidor; solo sirve para ordenar la mano en pantalla. */
function power(c) {
  if (c.n === 1 && c.s === 'E') return 14;
  if (c.n === 1 && c.s === 'B') return 13;
  if (c.n === 7 && c.s === 'E') return 12;
  if (c.n === 7 && c.s === 'O') return 11;
  return { 3: 10, 2: 9, 1: 8, 12: 7, 11: 6, 10: 5, 7: 4, 6: 3, 5: 2, 4: 1 }[c.n];
}
const cardId = (c) => `${c.n}${c.s}`;

export default {
  id: 'truco',
  title: 'Truco',
  icon: 'icon-truco.svg',
  blurb: 'Truco argentino 1 contra 1 · contra el bot o un rival real',

  mount(root, ctx) {
    const T = ctx.table;
    const cfg = ctx.config;
    let setup = { mode: 'bot', stake: 0 };
    let busy = false;
    let lastLog = null;           // id del último mensaje ya mostrado
    let seenCards = new Set();    // cartas ya animadas
    let seenTable = null;
    let skew = 0;                 // diferencia de reloj con el servidor
    let timerEl = null;
    let ticker = null;
    let note = '';
    const bubbles = { you: null, opp: null };

    const say = async (fn) => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (e) { ctx.toast(ctx.errMsg(e), 'lose'); } finally { busy = false; }
    };
    const act = (action) => say(() => T.act(action));

    // ----------------------------------------------------------- configuración
    function renderSetup() {
      const rake = Math.round(cfg.table.rake * 100);
      const stakes = [0, ...cfg.table.stakes];
      const bal = ctx.balance();
      const info = h('p', { class: 'hint tr-pay' });
      const refreshInfo = () => {
        const st = setup.stake;
        if (st === 0) info.textContent = 'Partida de práctica: no se apuesta nada.';
        else if (setup.mode === 'bot') info.textContent = `Si ganás cobrás ${fmt(Math.floor(st * 2 * (1 - cfg.table.rake)))} fichas (×${(2 * (1 - cfg.table.rake)).toFixed(2).replace('.', ',')}). Si perdés, perdés ${fmt(st)}.`;
        else info.textContent = `Pozo de ${fmt(st * 2)}: el ganador cobra ${fmt(Math.floor(st * 2 * (1 - cfg.table.rake)))} (comisión de la casa ${rake} %).`;
      };
      const stakeBtns = stakes.map((st) => {
        const b = h('button', { type: 'button', class: 'chip-btn' + (setup.stake === st ? ' on' : ''), disabled: st > bal,
          onclick: () => { setup.stake = st; ctx.sfx.chip(); renderSetup(); } }, st === 0 ? 'Práctica' : fmt(st));
        return b;
      });
      const modeBtn = (mode, label) => h('button', { type: 'button', class: setup.mode === mode ? 'active' : '',
        onclick: () => { setup.mode = mode; ctx.sfx.click(); renderSetup(); } }, label);

      refreshInfo();
      root.replaceChildren(h('div', { class: 'tr-setup' },
        h('div', { class: 'panel tr-setup-main' },
          h('h2', {}, 'Truco argentino'),
          h('p', { class: 'hint' }, '1 contra 1 · baraja española de 40 cartas · se juega a 15 puntos · sin flor.'),
          note ? h('p', { class: 'form-error' }, note) : null,
          h('label', { class: 'field-label' }, 'Con quién jugás'),
          h('div', { class: 'seg' }, modeBtn('bot', 'Contra el bot'), modeBtn('match', 'Buscar rival')),
          h('label', { class: 'field-label' }, 'Apuesta'),
          h('div', { class: 'bet-quick tr-stakes' }, ...stakeBtns),
          info,
          h('button', { class: 'btn primary big', type: 'button', onclick: () => say(async () => {
            note = '';
            await T.join({ game: 'truco', mode: setup.mode, stake: setup.stake });
            ctx.sfx.click();
          }) }, setup.mode === 'bot' ? 'JUGAR' : 'BUSCAR RIVAL')),
        h('div', { class: 'panel tr-rules' },
          h('h3', {}, 'Cómo se juega'),
          h('ul', {},
            h('li', {}, 'Cada uno recibe 3 cartas; se juegan 3 bazas y gana la mano quien gane 2.'),
            h('li', {}, 'Antes de tirar tu primera carta podés cantar ', h('b', {}, 'envido'), ' (2 pts), ', h('b', {}, 'real envido'), ' (3) o ', h('b', {}, 'falta envido'), '. Los tantos son 20 + dos cartas del mismo palo.'),
            h('li', {}, h('b', {}, 'Truco'), ' (2 pts) → ', h('b', {}, 'retruco'), ' (3) → ', h('b', {}, 'vale cuatro'), ' (4). Si no te quieren, sumás el valor anterior.'),
            h('li', {}, 'El ', h('b', {}, 'envido está primero'), ': si te cantan truco podés responder con envido.'),
            h('li', {}, 'Mejor carta: ancho de espadas, ancho de bastos, 7 de espadas, 7 de oros, los 3, los 2…'),
            h('li', {}, 'Tenés 45 segundos por jugada; con 3 demoras seguidas perdés la partida.')))));
    }

    // ------------------------------------------------------------------ cola
    function renderQueue(v) {
      const t0 = v.since - (v.serverTime - Date.now());
      const secs = h('b', {}, '0:00');
      const botBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => say(async () => {
        await T.leave();
        await T.join({ game: 'truco', mode: 'bot', stake: v.stake });
      }) }, 'Jugar contra el bot');
      const tick = () => {
        const s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
        secs.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        botBtn.hidden = s < 15;
      };
      tick();
      clearInterval(ticker);
      ticker = setInterval(tick, 1000);
      root.replaceChildren(h('div', { class: 'panel tr-queue' },
        h('div', { class: 'tr-spinner', 'aria-hidden': 'true' }),
        h('h2', {}, 'Buscando rival…'),
        h('p', { class: 'hint' }, v.stake > 0 ? `Apuesta de ${fmt(v.stake)} fichas. Se cobra recién cuando empieza la partida.` : 'Partida de práctica.'),
        h('p', {}, 'Tiempo de espera: ', secs),
        h('div', { class: 'btn-row' },
          botBtn,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => say(() => T.leave()) }, 'Cancelar'))));
    }

    // ------------------------------------------------------------------ mesa
    function bubble(side, text) {
      if (bubbles[side]) bubbles[side].remove();
      const b = h('div', { class: 'tr-bubble ' + side }, text);
      bubbles[side] = b;
      const holder = root.querySelector('.tr-felt');
      if (holder) holder.append(b);
      setTimeout(() => { b.remove(); if (bubbles[side] === b) bubbles[side] = null; }, 2600);
    }

    function pendingText(st, names) {
      const who = (f) => (f === 'opp' ? names.opp : 'Vos');
      if (st.envido.pending) return `${who(st.envido.pending.from)}: ${st.envido.pending.chain.map((c) => CALL[c]).join(' + ')}`;
      if (st.truco.pending) return `${who(st.truco.pending.from)}: ${CALL[['', 'truco', 'retruco', 'vale4'][st.truco.pending.level]]}`;
      return '';
    }

    function scoreRow(label, pts, target, cls) {
      return h('div', { class: 'tr-score-row ' + cls },
        h('span', { class: 'tr-score-name' }, label),
        h('span', { class: 'tr-score-bar' }, ...Array.from({ length: target }, (_, i) => h('i', { class: i < pts ? 'on' : '' }))),
        h('b', {}, String(pts)));
    }

    function renderGame(v) {
      clearInterval(ticker);
      const st = v.state;
      const names = { you: v.players[v.seat].name, opp: v.players[1 - v.seat].name };
      const oppBot = v.players[1 - v.seat].bot;
      const A = st.actions || {};
      const myTurn = !!(A.play?.length || A.respond || A.ready);
      skew = (v.serverTime || Date.now()) - Date.now();

      // mensajes nuevos → globos y sonidos
      const fresh = st.log.filter((e) => lastLog === null || e.id > lastLog);
      lastLog = st.log.length ? st.log[st.log.length - 1].id : lastLog;
      const bubbleTexts = [];
      for (const e of fresh) {
        if (e.kind === 'call') bubbleTexts.push([e.seat === v.seat ? 'you' : 'opp', e.text.replace(/^[^:]+: /, '')]);
        if (e.kind === 'play') ctx.sfx.card();
        if (e.kind === 'call') ctx.sfx.click();
      }

      // mano del jugador
      const hand = st.hand.slice().sort((a, b) => power(b) - power(a));
      const handEls = hand.map((c) => {
        const can = A.play?.includes(cardId(c));
        const key = `${v.id}:${st.handNo}:h:${cardId(c)}`;
        const card = spanishCard(c, { size: 'lg' });
        if (!seenCards.has(key)) { card.classList.add('is-new'); seenCards.add(key); }
        return h('button', { type: 'button', class: 'tr-card' + (can ? ' can' : ''), disabled: !can, 'aria-label': `Jugar ${card.getAttribute('aria-label')}`,
          onclick: () => { ctx.sfx.card(); act({ type: 'play', card: cardId(c) }); } }, card);
      });

      // baza por baza
      const board = [0, 1, 2].map((t) => {
        const slot = st.table[t];
        const res = st.tricks[t];
        const mk = (c, who) => {
          if (!c) return h('div', { class: 'tr-empty' });
          const card = spanishCard(c, { size: 'md' });
          const key = `${v.id}:${st.handNo}:${t}:${who}`;
          if (!seenTable.has(key)) { card.classList.add('is-new'); seenTable.add(key); }
          if (res === who) card.classList.add('is-winning');
          return card;
        };
        return h('div', { class: 'tr-trick' + (t === st.tricks.length && st.phase === 'play' ? ' current' : '') },
          h('div', { class: 'tr-slot' }, mk(slot.opp, 'opp')),
          h('div', { class: 'tr-slot' }, mk(slot.you, 'you')),
          h('div', { class: 'tr-result ' + (res || '') }, res === 'you' ? 'Ganaste' : res === 'opp' ? 'Perdiste' : res === 'tie' ? 'Parda' : ' '));
      });

      // botones
      const actions = h('div', { class: 'tr-actions' });
      const btn = (label, fn, cls = 'btn') => h('button', { type: 'button', class: cls, onclick: fn }, label);
      if (st.phase === 'play') {
        if (A.respond) {
          actions.append(
            h('div', { class: 'tr-ask' }, pendingText(st, names)),
            h('div', { class: 'btn-row' },
              btn('Quiero', () => act({ type: 'respond', answer: 'quiero' }), 'btn primary'),
              btn('No quiero', () => act({ type: 'respond', answer: 'noquiero' }))),
            A.calls?.length ? h('div', { class: 'btn-row tr-raise' }, ...A.calls.map((c) => btn(CALL[c], () => act({ type: 'call', call: c })))) : null);
        } else if (A.play?.length) {
          const truco = A.calls.filter((c) => ['truco', 'retruco', 'vale4'].includes(c));
          const envido = A.calls.filter((c) => ['envido', 'real', 'falta'].includes(c));
          actions.append(h('div', { class: 'btn-row tr-calls' },
            ...envido.map((c) => btn(CALL[c], () => act({ type: 'call', call: c }))),
            ...truco.map((c) => btn(CALL[c], () => act({ type: 'call', call: c }), 'btn primary')),
            A.fold ? btn('Al mazo', () => { if (confirm('¿Irte al mazo? El rival suma los puntos de la mano.')) act({ type: 'fold' }); }, 'btn ghost') : null));
        } else {
          actions.append(h('div', { class: 'tr-ask muted' }, pendingText(st, names) ? `${pendingText(st, names)} · esperando respuesta…` : `Juega ${names.opp}…`));
        }
      }

      timerEl = h('span', { class: 'tr-timer' });
      const info = h('div', { class: 'tr-info' },
        h('span', {}, 'Tu tanto: ', h('b', {}, String(st.myTanto))),
        h('span', {}, 'La mano vale: ', h('b', {}, `${st.handPoints} ${st.handPoints === 1 ? 'punto' : 'puntos'}`)),
        h('span', {}, st.mano === v.seat ? 'Sos mano' : 'Es mano el rival'),
        timerEl);

      const stakeTxt = v.stake > 0 ? `Apuesta ${fmt(v.stake)}` : 'Práctica';
      const head = h('div', { class: 'tr-head' },
        h('div', { class: 'tr-player' },
          oppBot
            ? h('div', { class: 'tr-avatar bot', 'aria-hidden': 'true' }, '🤖')
            : h('img', { class: 'tr-avatar', alt: '', width: 40, height: 40, src: '/api/avatar/' + encodeURIComponent(names.opp) + '?s=40', onerror: (e) => { e.target.hidden = true; } }),
          h('div', {}, h('b', {}, names.opp), h('small', {}, oppBot ? 'Bot' : 'Jugador'))),
        h('div', { class: 'tr-scores' },
          scoreRow('Rival', st.scores[1 - v.seat], st.target, 'opp'),
          scoreRow('Vos', st.scores[v.seat], st.target, 'you')),
        h('div', { class: 'tr-meta' }, h('small', {}, `${stakeTxt} · mano ${st.handNo}`),
          v.status === 'playing' ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
            if (confirm(v.stake > 0 ? 'Si abandonás perdés la apuesta. ¿Abandonar?' : '¿Abandonar la partida?')) say(() => T.leave());
          } }, 'Abandonar') : null));

      const felt = h('div', { class: 'tr-felt table-felt' },
        h('div', { class: 'tr-opp' }, ...Array.from({ length: st.oppCount }, () => cardBack('spanish', { size: 'md' }))),
        h('div', { class: 'tr-board' }, ...board),
        h('div', { class: 'tr-me' }, ...handEls));

      root.replaceChildren(h('div', { class: 'tr-game' }, head, felt, actions, info,
        h('ul', { class: 'tr-log', 'aria-label': 'Registro' }, ...st.log.slice(-7).reverse().map((e) => h('li', { class: e.kind }, e.text)))));
      for (const [side, text] of bubbleTexts) bubble(side, text);

      // superposición de fin de mano / fin de partida
      if (v.status === 'over') root.querySelector('.tr-game').append(endOverlay(v, names));
      else if (st.phase === 'handOver') root.querySelector('.tr-game').append(handOverlay(v, names, A));

      const tick = () => {
        if (!timerEl.isConnected || !v.deadline || v.status !== 'playing') { timerEl.textContent = ''; return; }
        const s = Math.max(0, Math.ceil((v.deadline - (Date.now() + skew)) / 1000));
        timerEl.textContent = myTurn ? `Te quedan ${s} s` : '';
        timerEl.classList.toggle('urgent', myTurn && s <= 10);
      };
      tick();
      ticker = setInterval(tick, 500);
    }

    function handOverlay(v, names, A) {
      const sm = v.state.summary;
      const iWon = sm.winner === v.seat;
      const mine = sm.cards[v.seat];
      const theirs = sm.cards[1 - v.seat];
      const row = (label, cards) => h('div', { class: 'tr-reveal' }, h('small', {}, label), h('div', {}, ...cards.map((c) => spanishCard(c, { size: 'sm' }))));
      return h('div', { class: 'tr-overlay' }, h('div', { class: 'tr-modal' },
        h('h3', { class: iWon ? 'pos' : 'neg' }, iWon ? '¡Ganaste la mano!' : `${names.opp} ganó la mano`),
        h('p', {}, `${iWon ? '+' : ''}${sm.points} ${sm.points === 1 ? 'punto' : 'puntos'} · ${REASON[sm.reason] || sm.reason.toLowerCase()}`),
        row(names.opp, theirs), row('Vos', mine),
        h('p', { class: 'hint' }, `Marcador: ${names.you} ${v.state.scores[v.seat]} – ${v.state.scores[1 - v.seat]} ${names.opp}`),
        h('button', { class: 'btn primary wide', type: 'button', disabled: !A.ready, onclick: () => act({ type: 'ready' }) }, A.ready ? 'Siguiente mano' : 'Esperando al rival…')));
    }

    function endOverlay(v, names) {
      const r = v.result || {};
      const won = r.winnerSeat === v.seat;
      const pay = (r.payouts || [])[v.seat] || 0;
      let title; let text;
      if (r.aborted) { title = 'Mesa cancelada'; text = 'Hubo un problema y se devolvió tu apuesta.'; }
      else if (won) { title = '¡Ganaste la partida!'; text = v.stake > 0 ? `Cobrás ${fmt(pay)} fichas.` : 'Buena partida.'; }
      else {
        title = `${names.opp} ganó la partida`;
        text = r.reason === 'forfeit' && r.winnerSeat !== v.seat ? 'Abandonaste o te quedaste sin responder.' : (v.stake > 0 ? `Perdiste ${fmt(v.stake)} fichas.` : 'Revancha cuando quieras.');
      }
      if (!ctx.__ended || ctx.__ended !== v.id) { ctx.__ended = v.id; (won ? ctx.sfx.win(pay > 0) : ctx.sfx.lose()); }
      return h('div', { class: 'tr-overlay' }, h('div', { class: 'tr-modal' },
        h('h3', { class: won ? 'pos' : 'neg' }, title),
        h('p', {}, text),
        h('p', { class: 'hint' }, `Final: ${names.you} ${v.state.scores[v.seat]} – ${v.state.scores[1 - v.seat]} ${names.opp}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => say(() => T.leave()) }, 'Jugar de nuevo'),
          h('a', { class: 'btn', href: '#/' }, 'Ir al inicio'))));
    }

    // --------------------------------------------------------------- ruteo
    let lastId = null;
    function render(v) {
      clearInterval(ticker);
      if (!v) { lastLog = null; renderSetup(); return; }
      if (v.status === 'cancelled') {
        note = 'No se encontró rival a tiempo. Probá de nuevo o jugá contra el bot.';
        renderSetup();
        return;
      }
      if (v.game !== 'truco') {
        root.replaceChildren(h('div', { class: 'panel tr-queue' }, h('h2', {}, 'Tenés otra partida en curso'),
          h('p', { class: 'hint' }, 'Terminala antes de empezar una de Truco.'),
          h('a', { class: 'btn primary', href: '#/' + v.game }, 'Volver a la partida')));
        return;
      }
      if (v.status === 'queue') { renderQueue(v); return; }
      if (v.id !== lastId) { lastId = v.id; lastLog = v.state.log.length ? v.state.log[v.state.log.length - 1].id : null; seenCards = new Set(); seenTable = new Set(); }
      if (!seenTable) seenTable = new Set();
      renderGame(v);
    }

    const unsub = T.onUpdate(render);
    render(T.view);
    T.load().catch(() => {});
    return () => { unsub(); clearInterval(ticker); };
  },
};
