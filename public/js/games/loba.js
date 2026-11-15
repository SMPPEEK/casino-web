import { h, fmt } from '../ui.js';
import { englishCard, cardBack } from '../cards.js';

const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
const RANK_ORDER = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };
const bySuit = (a, b) => (a.r === 'JOKER') - (b.r === 'JOKER') || SUIT_ORDER[a.s] - SUIT_ORDER[b.s] || RANK_ORDER[a.r] - RANK_ORDER[b.r];
const byRank = (a, b) => (a.r === 'JOKER') - (b.r === 'JOKER') || RANK_ORDER[a.r] - RANK_ORDER[b.r] || SUIT_ORDER[a.s] - SUIT_ORDER[b.s];
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };

export default {
  id: 'loba',
  title: 'La Loba',
  icon: 'icon-loba.svg',
  blurb: 'Rummy argentino con naipes ingleses · 2 a 4 jugadores, contra bots',

  mount(root, ctx) {
    const T = ctx.table;
    const cfg = ctx.config;
    let setup = { bots: 2, limit: 100, stake: 0 };
    let busy = false;
    let sel = new Set();
    let sortMode = 'suit';
    let seen = new Set();
    let lastId = null;
    let skew = 0;
    let ticker = null;
    let note = '';

    const say = async (fn) => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (e) { ctx.toast(ctx.errMsg(e), 'lose'); } finally { busy = false; }
    };
    const act = (action) => say(async () => { await T.act(action); ctx.sfx.card(); });

    // ----------------------------------------------------------- configuración
    function renderSetup() {
      const stakes = [0, ...cfg.table.stakes];
      const bal = ctx.balance();
      const seats = setup.bots + 1;
      const pay = setup.stake > 0 ? Math.floor(setup.stake * seats * (1 - cfg.table.rake)) : 0;
      const seg = (opts, cur, set) => h('div', { class: 'seg' }, ...opts.map(([val, label]) =>
        h('button', { type: 'button', class: cur === val ? 'active' : '', onclick: () => { set(val); ctx.sfx.click(); renderSetup(); } }, label)));
      root.replaceChildren(h('div', { class: 'tr-setup' },
        h('div', { class: 'panel tr-setup-main' },
          h('h2', {}, 'La Loba'),
          h('p', { class: 'hint' }, '2 mazos ingleses + 4 comodines · 9 cartas cada uno · gana la partida el último que no pasa el límite.'),
          note ? h('p', { class: 'form-error' }, note) : null,
          h('label', { class: 'field-label' }, 'Rivales (bots)'),
          seg([[1, '1'], [2, '2'], [3, '3']], setup.bots, (v) => { setup.bots = v; }),
          h('label', { class: 'field-label' }, 'Límite de puntos'),
          seg([[50, '50 · corta'], [100, '100 · larga']], setup.limit, (v) => { setup.limit = v; }),
          h('label', { class: 'field-label' }, 'Apuesta'),
          h('div', { class: 'bet-quick tr-stakes' }, ...stakes.map((st) => h('button', {
            type: 'button', class: 'chip-btn' + (setup.stake === st ? ' on' : ''), disabled: st > bal,
            onclick: () => { setup.stake = st; ctx.sfx.chip(); renderSetup(); },
          }, st === 0 ? 'Práctica' : fmt(st)))),
          h('p', { class: 'hint' }, setup.stake === 0 ? 'Partida de práctica: no se apuesta nada.'
            : `Si ganás cobrás ${fmt(pay)} fichas (pozo de ${fmt(setup.stake * seats)} menos comisión de ${Math.round(cfg.table.rake * 100)} %). Si perdés, perdés ${fmt(setup.stake)}.`),
          h('button', { class: 'btn primary big', type: 'button', onclick: () => say(async () => {
            note = '';
            await T.join({ game: 'loba', mode: 'bot', bots: setup.bots, limit: setup.limit, stake: setup.stake });
          }) }, 'Jugar')),
        h('div', { class: 'panel tr-rules' },
          h('h3', {}, 'Cómo se juega'),
          h('ul', {},
            h('li', {}, 'En tu turno robás del mazo, o del pozo si podés usar esa carta enseguida; después bajás y descartás.'),
            h('li', {}, h('b', {}, 'Pierna'), ': 3 a 6 cartas del mismo número en 3 palos distintos.'),
            h('li', {}, h('b', {}, 'Escalera'), ': 3 o más seguidas del mismo palo. El as va al principio o al final, no los dos. Máximo un comodín.'),
            h('li', {}, 'Con una combinación tuya bajada podés agregar cartas a cualquier combinación de la mesa.'),
            h('li', {}, 'La ronda termina cuando alguien se queda sin cartas. Si baja todo de una vez: −10.'),
            h('li', {}, 'Los demás suman: 2–9 su valor; 10, J, Q, K, A y comodín = 10. Pasar el límite te elimina.'),
            h('li', {}, 'Tenés 90 segundos por turno; con 3 demoras seguidas perdés la partida.')))));
    }

    // ------------------------------------------------------------------ mesa
    const mini = (c, size = 'sm', extra = {}) => {
      const el = englishCard(c, { size, ...extra });
      if (c.as) el.append(h('span', { class: 'lb-as' }, c.as));
      return el;
    };

    function playersBar(v, st) {
      return h('div', { class: 'lb-players' }, ...v.players.map((p, i) => {
        const out = st.eliminated[i];
        const turn = st.phase !== 'roundOver' && st.phase !== 'over' && st.turn === i && !out;
        return h('div', { class: 'lb-player' + (i === v.seat ? ' me' : '') + (turn ? ' turn' : '') + (out ? ' out' : '') },
          h('b', {}, i === v.seat ? 'Vos' : p.name), h('small', {}, p.bot ? 'Bot' : 'Jugador'),
          h('span', { class: 'lb-pts' }, `${st.scores[i]} / ${st.limit}`),
          h('span', { class: 'lb-cnt' }, out ? 'Eliminado' : `${st.handCounts[i]} cartas`));
      }));
    }

    function meldEl(m, st, canAddNow) {
      const title = m.type === 'pierna' ? `Pierna de ${m.rank}` : `Escalera de ${SYM[m.suit]}`;
      const owner = st.names[m.owner];
      return h('button', { type: 'button', class: 'lb-meld' + (canAddNow ? ' can' : ''), disabled: !canAddNow,
        'aria-label': `${title} de ${owner}`, onclick: () => {
          const [id] = [...sel];
          sel = new Set();
          act({ type: 'add', meld: m.id, card: id });
        } },
      h('small', {}, `${title} · ${owner === st.names[st.you] ? 'tuya' : owner}`),
      h('div', { class: 'lb-meld-cards' }, ...m.cards.map((c) => mini(c, 'sm'))));
    }

    function renderGame(v) {
      const st = v.state;
      const me = v.seat;
      skew = (v.serverTime || Date.now()) - Date.now();
      const myTurn = st.turn === me && (st.phase === 'draw' || st.phase === 'play') && v.status === 'playing';
      const hand = st.hand.slice().sort(sortMode === 'suit' ? bySuit : byRank);
      sel = new Set([...sel].filter((id) => hand.some((c) => c.id === id)));
      const picked = hand.filter((c) => sel.has(c.id));

      const toggle = (c) => {
        if (!myTurn || st.phase !== 'play') return;
        if (sel.has(c.id)) sel.delete(c.id); else sel.add(c.id);
        ctx.sfx.click();
        renderGame(T.view && T.view.id === v.id ? T.view : v);
      };
      const handEls = hand.map((c) => {
        const key = `${v.id}:${st.round}:${c.id}`;
        const isNew = !seen.has(key);
        seen.add(key);
        const el = englishCard(c, { size: 'md', selected: sel.has(c.id) });
        const b = h('button', { type: 'button', class: 'lb-card' + (isNew ? ' is-new' : '') + (st.forced === c.id ? ' forced' : ''),
          'data-id': c.id, 'aria-pressed': String(sel.has(c.id)), 'aria-label': el.getAttribute('aria-label'), onclick: () => toggle(c) }, el);
        return b;
      });

      const draw = (from) => act({ type: 'draw', from });
      const canDrawStock = myTurn && st.phase === 'draw';
      const stock = h('button', { type: 'button', class: 'lb-pile', disabled: !canDrawStock, onclick: () => draw('stock'), 'aria-label': 'Robar del mazo' },
        cardBack('english', { size: 'md' }), h('small', {}, `Mazo · ${st.stockCount}`));
      const top = st.discardTop;
      const discardPile = h('button', { type: 'button', class: 'lb-pile' + (canDrawStock && st.canTakeDiscard ? ' can' : ''),
        disabled: !(canDrawStock && st.canTakeDiscard), onclick: () => draw('discard'), 'aria-label': 'Tomar del pozo' },
      top ? englishCard(top, { size: 'md' }) : h('div', { class: 'tr-empty' }),
      h('small', {}, canDrawStock && st.canTakeDiscard ? 'Pozo · podés usarla' : 'Pozo'));

      const addMode = myTurn && st.phase === 'play' && picked.length === 1 && st.meldedThisRound[me];
      const melds = st.melds.length
        ? st.melds.map((m) => meldEl(m, st, addMode))
        : [h('p', { class: 'hint lb-empty' }, 'Todavía no hay nada bajado.')];

      let msg;
      if (st.phase === 'draw') msg = myTurn ? 'Tu turno: robá del mazo o tomá el pozo.' : `Juega ${st.names[st.turn]}…`;
      else if (myTurn) {
        msg = st.forced ? 'Tomaste del pozo: tenés que bajar o agregar esa carta (resaltada en rojo). No se puede descartar.'
          : picked.length >= 3 ? 'Bajá la selección o elegí otras cartas.'
            : picked.length === 1 ? (st.meldedThisRound[me] ? 'Descartá esta carta o tocá una combinación para agregarla.' : 'Descartá esta carta, o elegí 3 o más para bajar.')
              : 'Elegí cartas para bajar, o una para descartar.';
      } else msg = `Juega ${st.names[st.turn]}…`;

      const timerEl = h('span', { class: 'tr-timer' });
      const btn = (label, fn, enabled, cls = 'btn') => h('button', { type: 'button', class: cls, disabled: !enabled, onclick: fn }, label);
      const doDiscard = () => {
        if (st.forced) { ctx.toast('Tomaste esa carta del pozo: tenés que bajarla en una combinación o agregarla a una de la mesa. No se puede descartar.', 'lose'); return; }
        if (picked.length !== 1) { ctx.toast('Tocá una sola carta de tu mano y después Descartar.', 'lose'); return; }
        const [id] = [...sel]; sel = new Set(); act({ type: 'discard', card: id });
      };
      const actions = h('div', { class: 'tr-actions' },
        h('div', { class: 'tr-ask' + (myTurn ? '' : ' muted') }, msg),
        h('div', { class: 'btn-row' },
          btn(`Bajar${picked.length >= 3 ? ` (${picked.length})` : ''}`, () => { const ids = [...sel]; sel = new Set(); act({ type: 'meld', cards: ids }); },
            myTurn && st.phase === 'play' && picked.length >= 3, 'btn primary'),
          btn('Descartar', doDiscard, myTurn && st.phase === 'play'),
          btn(sortMode === 'suit' ? 'Ordenar: palo' : 'Ordenar: número', () => { sortMode = sortMode === 'suit' ? 'rank' : 'suit'; renderGame(T.view && T.view.id === v.id ? T.view : v); }, true, 'btn ghost')));

      const head = h('div', { class: 'tr-head' },
        playersBar(v, st),
        h('div', { class: 'tr-meta' }, h('small', {}, `${v.stake > 0 ? `Apuesta ${fmt(v.stake)}` : 'Práctica'} · ronda ${st.round}`), timerEl,
          v.status === 'playing' ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
            if (confirm(v.stake > 0 ? 'Si abandonás perdés la apuesta. ¿Abandonar?' : '¿Abandonar la partida?')) say(() => T.leave());
          } }, 'Abandonar') : null));

      const opp = h('div', { class: 'lb-opps' }, ...v.players.map((p, i) => (i === me ? null : h('div', { class: 'lb-opp' + (st.eliminated[i] ? ' out' : '') },
        h('small', {}, p.name), h('div', { class: 'lb-fan' }, ...Array.from({ length: Math.min(st.handCounts[i], 9) }, () => cardBack('english', { size: 'sm' })))))));

      const felt = h('div', { class: 'tr-felt table-felt lb-felt' }, opp,
        h('div', { class: 'lb-center' }, stock, discardPile), h('div', { class: 'lb-melds' }, ...melds),
        h('div', { class: 'lb-hand' }, ...handEls));

      const log = h('ul', { class: 'tr-log', 'aria-label': 'Registro' }, ...st.log.slice(-7).reverse().map((e) => h('li', { class: e.kind }, e.text)));
      const game = h('div', { class: 'tr-game lb-game' }, head, felt, actions, log);
      root.replaceChildren(game);
      if (v.status === 'over') game.append(endOverlay(v, st));
      else if (st.phase === 'roundOver') game.append(roundOverlay(v, st));

      const tick = () => {
        if (!timerEl.isConnected || !v.deadline || v.status !== 'playing') { timerEl.textContent = ''; return; }
        const s = Math.max(0, Math.ceil((v.deadline - (Date.now() + skew)) / 1000));
        const mine = st.phase === 'roundOver' ? !st.ready[me] : myTurn;
        timerEl.textContent = mine ? `Te quedan ${s} s` : '';
        timerEl.classList.toggle('low', mine && s <= 10);
      };
      tick();
      ticker = setInterval(tick, 500);
    }

    function roundOverlay(v, st) {
      const sm = st.summary;
      const rows = st.names.map((n, i) => h('tr', { class: i === sm.outOf ? 'win' : '' },
        h('td', {}, i === v.seat ? 'Vos' : n),
        h('td', { class: 'lb-hand-left' }, st.eliminated[i] && !sm.hands[i].length ? '—' : (sm.hands[i].length ? h('span', { class: 'lb-mini-hand' }, ...sm.hands[i].map((c) => englishCard(c, { size: 'sm' }))) : 'Sin cartas')),
        h('td', { class: sm.points[i] < 0 ? 'pos' : '' }, sm.points[i] > 0 ? `+${sm.points[i]}` : String(sm.points[i])),
        h('td', {}, h('b', {}, `${sm.totals[i]}${st.eliminated[i] ? ' ✕' : ''}`))));
      const title = sm.outOf === null ? 'Se acabó el mazo' : sm.outOf === v.seat ? '¡Cortaste!' : `${st.names[sm.outOf]} cortó`;
      const waiting = st.ready[v.seat];
      return h('div', { class: 'tr-overlay' }, h('div', { class: 'tr-modal lb-modal' },
        h('h3', { class: sm.outOf === v.seat ? 'pos' : '' }, title),
        sm.bonus ? h('p', { class: 'hint' }, 'Bajó todo de una vez: −10.') : null,
        h('table', { class: 'lb-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Jugador'), h('th', {}, 'Le quedó'), h('th', {}, 'Ronda'), h('th', {}, `Total / ${st.limit}`))), h('tbody', {}, ...rows)),
        h('button', { class: 'btn primary wide', type: 'button', disabled: waiting || st.eliminated[v.seat], onclick: () => act({ type: 'ready' }) }, waiting ? 'Esperando…' : 'Siguiente ronda')));
    }

    function endOverlay(v, st) {
      const r = v.result || {};
      const won = r.winnerSeat === v.seat;
      const pay = (r.payouts || [])[v.seat] || 0;
      let title; let text;
      if (r.aborted) { title = 'Mesa cancelada'; text = 'Hubo un problema y se devolvió tu apuesta.'; }
      else if (won) { title = '¡Ganaste la partida!'; text = v.stake > 0 ? `Cobrás ${fmt(pay)} fichas.` : 'Buena partida.'; }
      else { title = `${st.names[r.winnerSeat ?? st.winner] || 'Un rival'} ganó la partida`; text = v.stake > 0 ? `Perdiste ${fmt(v.stake)} fichas.` : 'Revancha cuando quieras.'; }
      if (ctx.__ended !== v.id) { ctx.__ended = v.id; (won ? ctx.sfx.win(pay > 0) : ctx.sfx.lose()); }
      return h('div', { class: 'tr-overlay' }, h('div', { class: 'tr-modal' },
        h('h3', { class: won ? 'pos' : 'neg' }, title), h('p', {}, text),
        h('p', { class: 'hint' }, st.names.map((n, i) => `${i === v.seat ? 'Vos' : n}: ${st.scores[i]}`).join(' · ')),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => say(() => T.leave()) }, 'Jugar de nuevo'),
          h('a', { class: 'btn', href: '#/' }, 'Ir al inicio'))));
    }

    // --------------------------------------------------------------- ruteo
    function render(v) {
      clearInterval(ticker);
      if (!v) { renderSetup(); return; }
      if (v.status === 'cancelled') { note = 'La mesa se canceló.'; renderSetup(); return; }
      if (v.game !== 'loba') {
        root.replaceChildren(h('div', { class: 'panel tr-queue' }, h('h2', {}, 'Tenés otra partida en curso'),
          h('p', { class: 'hint' }, 'Terminala antes de empezar La Loba.'),
          h('a', { class: 'btn primary', href: '#/' + v.game }, 'Volver a la partida')));
        return;
      }
      if (v.id !== lastId) { lastId = v.id; seen = new Set(); sel = new Set(); }
      renderGame(v);
    }

    const unsub = T.onUpdate(render);
    render(T.view);
    T.load().catch(() => {});
    return () => { unsub(); clearInterval(ticker); };
  },
};
