import { h, betControl, fmt, sleep } from '../ui.js';

const LEVELS = [
  ['easy', 'Fácil'], ['medium', 'Medio'], ['hard', 'Difícil'], ['extreme', 'Extremo'],
];
const xf = (m) => '×' + Number(m).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default {
  id: 'chicken',
  title: 'Chicken Road',
  icon: 'icon-chicken.svg',
  blurb: 'Cruzá la ruta · retirate cuando quieras',

  mount(root, ctx) {
    let alive = true;
    let busy = false;
    let level = 'medium';
    let round = null; // vista de la ronda en curso
    const cfg = ctx.config.chicken.levels;

    const bet = betControl(ctx.balance, ctx.config.maxBet, 10);
    const msg = h('div', { class: 'ck-msg' }, 'Elegí dificultad y apostá para empezar.');
    const road = h('div', { class: 'ck-road', role: 'img', 'aria-label': 'Ruta con carriles' });
    const info = h('div', { class: 'ck-info' });
    const lvlBtns = LEVELS.map(([id, label]) => h('button', { type: 'button', class: id === level ? 'active' : '', onclick: () => pick(id) }, label));
    const startBtn = h('button', { class: 'btn primary big', type: 'button' }, 'EMPEZAR');
    const stepBtn = h('button', { class: 'btn primary big', type: 'button' }, 'AVANZAR');
    const cashBtn = h('button', { class: 'btn big', type: 'button' }, 'COBRAR');
    const actions = h('div', { class: 'ck-actions' }, stepBtn, cashBtn);

    const chick = h('img', { class: 'ck-chick', src: '/assets/chick.svg', alt: 'Gallina', draggable: 'false' });
    let lanes = [];

    function pick(id) {
      if (round || busy) return;
      level = id;
      lvlBtns.forEach((b, i) => b.classList.toggle('active', LEVELS[i][0] === id));
      ctx.sfx.click();
      build();
    }

    function build() {
      const L = cfg[level];
      road.replaceChildren();
      const start = h('div', { class: 'ck-lane ck-start' }, h('span', { class: 'ck-mult' }, 'Salida'));
      lanes = L.mults.map((m, i) => h('div', { class: 'ck-lane', 'data-i': i + 1 }, h('span', { class: 'ck-mult' }, xf(m))));
      road.append(start, ...lanes);
      start.append(chick);
      chick.src = '/assets/chick.svg';
      info.textContent = `Probabilidad de pasar cada carril: ${String(L.chance).replace('.', ',')} % · ${L.lanes} carriles`;
      road.scrollLeft = 0;
    }

    function setMode() {
      const playing = !!round && !round.done;
      startBtn.hidden = playing;
      actions.hidden = !playing;
      bet.setDisabled(playing);
      lvlBtns.forEach((b) => { b.disabled = playing; });
      if (playing) {
        cashBtn.disabled = round.step < 1;
        cashBtn.textContent = round.step < 1 ? 'COBRAR' : `COBRAR ${fmt(round.cashValue)}`;
        stepBtn.textContent = round.next ? `AVANZAR (${xf(round.next)})` : 'AVANZAR';
      }
    }

    function place(v) {
      lanes.forEach((l, i) => {
        l.classList.toggle('passed', i + 1 <= v.step);
        l.classList.toggle('current', i + 1 === v.step);
      });
      const target = v.step === 0 ? road.querySelector('.ck-start') : lanes[v.step - 1];
      target.append(chick);
      const x = target.offsetLeft - road.clientWidth / 2 + target.offsetWidth / 2;
      road.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
    }

    async function call(path, body) {
      if (busy) return;
      busy = true;
      [startBtn, stepBtn, cashBtn].forEach((b) => { b.disabled = true; });
      try {
        const res = await ctx.api('/games/chicken/' + path, body);
        const v = res.round;
        if (path === 'start') { build(); msg.className = 'ck-msg'; msg.textContent = '¡Arranca! Tocá AVANZAR.'; }
        ctx.setBalance(v.done ? res.balance - res.payout : res.balance);
        if (path === 'step' && v.outcome === 'trap') {
          const lane = lanes[v.trapAt - 1];
          lane.classList.add('trap');
          lane.append(h('img', { class: 'ck-trap', src: '/assets/trap.svg', alt: 'Trampa', draggable: 'false' }));
          lane.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          chick.src = '/assets/chick-dead.svg';
          lane.append(chick);
          ctx.sfx.lose();
          msg.className = 'ck-msg lose';
          msg.textContent = `¡Trampa en el carril ${v.trapAt}! Perdiste ${fmt(v.bet)}.`;
        } else {
          place(v);
          if (path === 'step' && !v.done) ctx.sfx.click();
          if (v.done) {
            ctx.sfx.win(v.outcome === 'end');
            msg.className = 'ck-msg win';
            msg.textContent = (v.outcome === 'end' ? '¡Cruzaste toda la ruta! ' : '') + `Cobraste ${fmt(res.payout)} (${xf(v.mult)}).`;
          } else if (path === 'step') {
            msg.className = 'ck-msg';
            msg.textContent = `Carril ${v.step} superado · ${xf(v.mult)}`;
          }
        }
        round = v.done ? null : v;
        if (v.done) { await sleep(500); if (alive) ctx.setBalance(res.balance); }
      } catch (e) {
        msg.className = 'ck-msg lose';
        msg.textContent = ctx.errMsg(e);
        if (e.code === 'no_active_round') round = null;
      } finally {
        busy = false;
        [startBtn, stepBtn, cashBtn].forEach((b) => { b.disabled = false; });
        if (alive) setMode();
      }
    }

    startBtn.addEventListener('click', () => { ctx.sfx.click(); call('start', { bet: bet.get(), level }); });
    stepBtn.addEventListener('click', () => call('step', {}));
    cashBtn.addEventListener('click', () => call('cashout', {}));

    root.append(
      h('div', { class: 'game-main' }, h('div', { class: 'ck-stage' }, msg, road, info)),
      h('aside', { class: 'game-side panel' },
        h('label', { class: 'field-label' }, 'Dificultad'),
        h('div', { class: 'seg ck-seg' }, ...lvlBtns),
        bet.el, startBtn, actions,
        h('p', { class: 'hint' }, 'Cada carril superado sube el multiplicador. Si pisás una trampa perdés la apuesta; podés cobrar desde el primer carril.')));

    const open = ctx.state.me.chicken;
    if (open) {
      level = open.level;
      lvlBtns.forEach((b, i) => b.classList.toggle('active', LEVELS[i][0] === level));
      build();
      round = open;
      bet.set(open.bet);
      setTimeout(() => place(open), 0);
      msg.textContent = 'Retomaste tu ronda en juego.';
    } else build();
    setMode();

    return () => { alive = false; };
  },
};
