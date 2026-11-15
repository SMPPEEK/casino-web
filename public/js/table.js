// Cliente de mesas (Truco, La Loba): una sola mesa por jugador; las novedades llegan por SSE (/api/stream)
// y también como respuesta de cada acción. Cada vista trae `rev`: si llega una más vieja que la actual, se descarta.
export function createTable(api, onBalance) {
  let view = null;
  let es = null;
  let poll = null;
  let polling = false;
  const subs = new Set();

  const emit = () => { for (const fn of [...subs]) { try { fn(view); } catch (e) { console.error(e); } } };

  function set(v) {
    if (v && view && v.id === view.id && v.rev !== undefined && view.rev !== undefined && v.rev < view.rev) return;
    // Misma versión y mismo saldo: no se vuelve a dibujar (así las consultas periódicas no pisan un clic a medias).
    if (v && view && v.id === view.id && v.rev !== undefined && v.rev === view.rev && v.status === view.status && v.balance === view.balance) { view = v; return; }
    view = v;
    if (v && typeof v.balance === 'number') onBalance(v.balance);
    emit();
  }

  // Respaldo cuando el tiempo real (SSE) no llega, por ejemplo si el hosting o un proxy retiene la conexión:
  // mientras haya una búsqueda de partida o una mesa activa se consulta el estado cada pocos segundos.
  const active = () => view && (view.status === 'queue' || view.status === 'playing');
  async function tick() {
    if (polling || !active()) return;
    polling = true;
    try { set((await api('/table?t=' + Date.now())).table); } catch { /* reintenta en el próximo ciclo */ } finally { polling = false; }
  }
  function startPolling() {
    if (poll) return;
    poll = setInterval(tick, 1500);
    document.addEventListener('visibilitychange', onVisible);
  }
  function onVisible() { if (!document.hidden) { api('/table?t=' + Date.now()).then((r) => set(r.table)).catch(() => {}); } }
  function stopPolling() { clearInterval(poll); poll = null; document.removeEventListener('visibilitychange', onVisible); }

  return {
    get view() { return view; },
    onUpdate(fn) { subs.add(fn); return () => subs.delete(fn); },
    connect() {
      if (es) return;
      es = new EventSource('/api/stream');
      es.addEventListener('table', (e) => { try { set(JSON.parse(e.data)); } catch { /* evento dañado */ } });
      startPolling();
    },
    disconnect() { if (es) { es.close(); es = null; } stopPolling(); view = null; emit(); },
    async load() { set((await api('/table')).table); return view; },
    async join(opts) { set((await api('/table/join', opts)).table); return view; },
    async act(action) { set((await api('/table/act', { action })).table); return view; },
    async leave() { set((await api('/table/leave', {})).table); return view; },
  };
}
