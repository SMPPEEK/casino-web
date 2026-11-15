import { h, betControl, fmt, sleep } from '../ui.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };

function cardEl(c, fresh) {
  if (!c) return h('div', { class: 'card back' + (fresh ? ' new' : ''), 'data-sig': 'back' });
  const red = c.s === 'H' || c.s === 'D';
  return h('div', { class: 'card ' + (red ? 'red' : 'black') + (fresh ? ' new' : ''), 'data-sig': c.r + c.s },
    h('span', { class: 'r' }, c.r), h('span', { class: 's' }, SUIT[c.s]));
}

/** Actualiza una mano solo donde cambió, para que únicamente las cartas nuevas se animen. */
function renderHand(box, cards, sfx) {
  cards.forEach((c, i) => {
    const sig = c ? c.r + c.s : 'back';
    const cur = box.children[i];
    if (!cur) { box.append(cardEl(c, true)); sfx.card(); }
    else if (cur.dataset.sig !== sig) { cur.replaceWith(cardEl(c, true)); sfx.card(); }
  });
  while (box.children.length > cards.length) box.lastChild.remove();
}

export default {
  id: 'blackjack',
  title: 'Blackjack',
  icon: 'icon-cards.svg',
  blurb: 'Blackjack paga 3:2 · el crupier planta en 17',

  mount(root, ctx) {
    let alive = true;
    let busy = false;

    const dealerBox = h('div', { class: 'hand' });
    const playerBox = h('div', { class: 'hand' });
    const dealerTotal = h('span', { class: 'total' });
    const playerTotal = h('span', { class: 'total' });
    const msg = h('div', { class: 'bj-msg' }, 'Hacé tu apuesta y repartí.');

    const bet = betControl(ctx.balance, ctx.config.maxBet, 10);
    const dealBtn = h('button', { class: 'btn primary big', type: 'button' }, 'REPARTIR');
    const hitBtn = h('button', { class: 'btn', type: 'button' }, 'Pedir');
    const standBtn = h('button', { class: 'btn', type: 'button' }, 'Plantarse');
    const dblBtn = h('button', { class: 'btn', type: 'button' }, 'Doblar');
    const betLabel = h('div', { class: 'total-line' });
    const actions = h('div', { class: 'btn-row three' }, hitBtn, standBtn, dblBtn);

    function setMode(active, view) {
      bet.el.hidden = active;
      dealBtn.hidden = active;
      actions.hidden = !active;
      betLabel.hidden = !active;
      if (active) betLabel.replaceChildren('En juego: ', h('b', {}, fmt(view.bet)));
    }

    function draw(view) {
      renderHand(dealerBox, view.dealer, ctx.sfx);
      renderHand(playerBox, view.player, ctx.sfx);
      dealerTotal.textContent = view.done ? view.dealerTotal : view.dealerTotal + ' + ?';
      playerTotal.textContent = view.playerTotal;
      dblBtn.disabled = !view.canDouble;
    }

    function outcomeText(view) {
      const net = view.payout - view.bet;
      switch (view.outcome) {
        case 'blackjack': return ['win', `¡Blackjack! Cobrás ${fmt(view.payout)} (+${fmt(net)})`];
        case 'win': return ['win', `¡Ganaste! Cobrás ${fmt(view.payout)} (+${fmt(net)})`];
        case 'push': return ['', 'Empate: te devuelven la apuesta.'];
        default: return ['lose', view.playerTotal > 21 ? `Te pasaste con ${view.playerTotal}. Perdiste.` : 'Perdió tu mano.'];
      }
    }

    async function finishHand(res) {
      const [cls, text] = outcomeText(res.hand);
      msg.className = 'bj-msg ' + cls;
      msg.textContent = text;
      if (cls === 'win') ctx.sfx.win(res.hand.outcome === 'blackjack'); else if (cls === 'lose') ctx.sfx.lose();
      ctx.setBalance(res.balance);
      setMode(false);
    }

    async function act(path, body) {
      if (busy) return;
      busy = true;
      [dealBtn, hitBtn, standBtn, dblBtn].forEach((b) => { b.disabled = true; });
      try {
        const res = await ctx.api('/games/blackjack/' + path, body);
        const view = res.hand;
        if (path === 'deal') {
          dealerBox.replaceChildren();
          playerBox.replaceChildren();
          msg.className = 'bj-msg';
          msg.textContent = '';
        }
        // si la mano terminó en este paso, el saldo ya incluye el premio: se muestra después
        ctx.setBalance(view.done ? res.balance - res.payout : res.balance);
        draw(view);
        if (view.done) {
          await sleep(650);
          if (alive) await finishHand(res);
        } else {
          setMode(true, view);
        }
      } catch (e) {
        msg.className = 'bj-msg lose';
        msg.textContent = ctx.errMsg(e);
        if (e.code === 'no_active_hand') setMode(false);
      } finally {
        busy = false;
        if (alive) { dealBtn.disabled = false; hitBtn.disabled = false; standBtn.disabled = false; }
      }
    }

    dealBtn.addEventListener('click', () => { ctx.sfx.click(); act('deal', { bet: bet.get() }); });
    hitBtn.addEventListener('click', () => act('hit', {}));
    standBtn.addEventListener('click', () => act('stand', {}));
    dblBtn.addEventListener('click', () => act('double', {}));

    root.append(
      h('div', { class: 'game-main' },
        h('div', { class: 'felt' },
          h('div', { class: 'bj-row' }, h('div', { class: 'bj-label' }, 'Crupier ', dealerTotal), dealerBox),
          msg,
          h('div', { class: 'bj-row' }, h('div', { class: 'bj-label' }, 'Vos ', playerTotal), playerBox))),
      h('aside', { class: 'game-side panel' }, bet.el, betLabel, dealBtn, actions,
        h('p', { class: 'hint' }, 'Sin split ni seguro. Podés doblar con tus dos primeras cartas.')));

    // retomar una mano que quedó a medias (por ejemplo al recargar la página)
    const open = ctx.state.me.hand;
    if (open) {
      draw(open);
      setMode(true, open);
      msg.textContent = 'Retomaste tu mano en juego.';
    } else {
      setMode(false);
    }

    return () => { alive = false; };
  },
};
