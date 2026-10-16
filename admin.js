// ===================== ORDER PULSE — ADMIN PANEL =====================

initTheme();
const root = $('#app');
let api, me;
let users = [], pending = [], shareRows = [], online = [], settings = null;
let view = 'dashboard';
let unsubs = [];
const seenPending = new Set();
let firstPendingLoad = true;
let titleBlink = null;
const pref = {
  get sound() { try { return localStorage.getItem('op_admin_sound') !== 'off'; } catch { return true; } },
  set sound(v) { try { localStorage.setItem('op_admin_sound', v ? 'on' : 'off'); } catch {} },
};

const VIEWS = [
  ['dashboard', '⚡', 'Live desk'],
  ['orders', '⇄', 'All orders'],
  ['shares', '▤', 'Shares (edit)'],
  ['users', '👥', 'Users'],
  ['online', '●', 'Online now'],
  ['ledger', '≡', 'Ledger'],
  ['reports', '📊', 'Daily reports'],
  ['audit', '🕘', 'Activity log'],
  ['settings', '⚙', 'Settings'],
];

// -------------------------------------------------------------------- boot
async function boot() {
  window.__opStarted = true;
  api = await getApi();
  api.auth.onChange(ev => { if (ev === 'SIGNED_OUT') renderLogin(); });
  const s = await api.auth.session();
  if (!s) return renderLogin();
  me = await api.me().catch(() => null);
  if (!me || me.role !== 'admin' || me.status !== 'approved') return renderNotAdmin();
  start();
}

function renderLogin(msg = '') {
  unsubs.forEach(f => f()); unsubs = [];
  root.innerHTML = `
    ${DEMO ? '<div class="banner">Demo mode — admin login: <b>admin@demo.com</b> / <b>admin123</b></div>' : ''}
    <div class="auth-wrap"><div class="card auth-card">
      <div class="auth-brand">${LOGO_SVG}<h1>Order Pulse</h1><div class="muted small">Administrator sign-in</div></div>
      <div id="msg">${msg ? `<div class="form-msg err">${esc(msg)}</div>` : ''}</div>
      <form id="f">
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary btn-block btn-lg" id="sb">Sign in</button>
      </form>
      <div class="auth-foot"><a href="index.html">Go to user app →</a></div>
    </div></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    $('#sb').disabled = true;
    try {
      await api.auth.signIn(e.target.email.value.trim().toLowerCase(), e.target.password.value);
      boot();
    } catch (err) { renderLogin(errMsg(err)); }
  };
}

function renderNotAdmin() {
  root.innerHTML = `<div class="auth-wrap"><div class="card state-card" style="margin:0">
    <div class="big-icon">🔒</div><h2>Administrators only</h2>
    <p class="muted">${esc(me?.email || '')} is not an administrator.</p>
    <div class="row" style="justify-content:center"><a class="btn" href="index.html">User app</a><button class="btn btn-primary" id="lo">Log out</button></div>
  </div></div>`;
  $('#lo').onclick = async () => { await api.auth.signOut(); renderLogin(); };
}

// -------------------------------------------------------------------- frame
function start() {
  root.innerHTML = `
    ${DEMO ? '<div class="banner">Demo mode — open the <a href="index.html" target="_blank">user app</a> in another tab (user@demo.com / user123) to see live updates.</div>' : ''}
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="#/dashboard">${LOGO_SVG}<span>Order Pulse</span><span class="status admin" style="margin-left:4px">Admin</span></a>
      <div class="top-actions">
        <span class="live-badge" id="live"><span class="dot"></span><span>LIVE</span></span>
        <button class="btn btn-ghost btn-sm" id="soundBtn" title="Sound alerts"></button>
        <button class="btn btn-ghost btn-sm" id="notifBtn" title="Desktop notifications">🔔 Alerts</button>
        <a class="btn btn-ghost btn-sm" href="index.html" target="_blank">User app ↗</a>
        <button class="btn btn-ghost icon-btn" id="themeBtn" title="Theme" aria-label="Theme"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>
        <button class="btn btn-ghost btn-sm" id="logoutBtn">Log out</button>
      </div>
    </div></header>
    <div class="admin-layout">
      <nav class="sidebar" id="side">
        ${VIEWS.map(([k, ic, label], i) => `${i === 5 ? '<div class="sep"></div>' : ''}
          <a href="#/${k}" data-v="${k}"><span style="width:18px;text-align:center">${ic}</span>${label}<span class="badge hidden" id="b-${k}"></span></a>`).join('')}
      </nav>
      <main class="admin-main" id="main"></main>
    </div>`;
  const paintSound = () => { $('#soundBtn').textContent = pref.sound ? '🔊 Sound' : '🔇 Muted'; };
  paintSound();
  $('#soundBtn').onclick = () => { pref.sound = !pref.sound; paintSound(); if (pref.sound) beep(1); };
  $('#notifBtn').onclick = async () => {
    if (!('Notification' in window)) return toast('This browser does not support notifications', 'err');
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Desktop alerts are on' : 'Alerts were not allowed', p === 'granted' ? 'ok' : 'err');
  };
  $('#themeBtn').onclick = toggleTheme;
  $('#logoutBtn').onclick = async () => { unsubs.forEach(f => f()); unsubs = []; await api.auth.signOut(); renderLogin(); };

  unsubs.push(api.onStatus(st => {
    const el = $('#live'); if (!el) return;
    el.classList.toggle('down', st === 'down');
    el.lastElementChild.textContent = st === 'down' ? 'RECONNECTING' : 'LIVE';
  }));

  api.presence.join({ page: 'Admin panel', role: 'admin', name: me.full_name || '' });
  unsubs.push(api.presence.onSync(list => { online = list; badges(); if (['dashboard', 'online', 'users'].includes(view)) refreshView('presence'); }));

  // live data
  unsubs.push(api.subscribe('orders', debounce(async () => { await loadPending(); refreshView('orders'); }, 120)));
  unsubs.push(api.subscribe('profiles', debounce(async () => { await loadUsers(); refreshView('profiles'); }, 300)));
  unsubs.push(api.subscribe('shares', debounce(async () => { await loadShares(); refreshView('shares'); }, 150)));
  unsubs.push(api.subscribe('ledger', debounce(() => refreshView('ledger'), 200)));
  unsubs.push(api.subscribe('app_settings', debounce(async () => { settings = await api.settings(); refreshView('settings'); }, 150)));
  unsubs.push(api.subscribe('daily_reports', debounce(() => refreshView('reports'), 200)));

  setInterval(() => api.expireStale(), 15000);
  setInterval(tickAges, 1000);
  setInterval(() => api.heartbeat(), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stopTitleBlink(); });

  window.addEventListener('hashchange', route);
  Promise.all([loadUsers(), loadPending(), loadShares(), api.settings().then(s => settings = s)]).then(route);
}

function route() {
  const v = (location.hash.split('/')[1] || 'dashboard');
  view = VIEWS.some(x => x[0] === v) ? v : 'dashboard';
  $$('#side a').forEach(a => a.classList.toggle('active', a.dataset.v === view));
  api.presence.update({ page: 'Admin: ' + VIEWS.find(x => x[0] === view)[2] });
  renderView();
}

function badges() {
  const set = (k, n, soft) => {
    const b = $('#b-' + k); if (!b) return;
    b.textContent = n; b.classList.toggle('hidden', !n); b.classList.toggle('soft', !!soft);
  };
  set('dashboard', pending.length);
  set('users', users.filter(u => u.status === 'pending').length);
  set('online', online.filter(o => o.user_id !== me.id).length, true);
}

async function loadUsers() { try { users = await api.admin.users(); badges(); } catch (e) { toast(errMsg(e), 'err'); } }
async function loadShares() {
  try {
    const fresh = await api.admin.shares();
    const dirty = new Map(shareRows.filter(r => r.dirty && r.data.id).map(r => [r.data.id, r]));
    const unsaved = shareRows.filter(r => !r.data.id);
    shareRows = unsaved.concat(fresh.map(s => dirty.get(s.id) || { data: s, dirty: false }));
  } catch (e) { toast(errMsg(e), 'err'); }
}
async function loadPending() {
  try {
    const list = await api.admin.orders({ status: 'pending', limit: 200 });
    pending = list.sort((a, b) => a.id - b.id);
    const fresh = pending.filter(o => !seenPending.has(o.id));
    fresh.forEach(o => seenPending.add(o.id));
    if (fresh.length && !firstPendingLoad) alertNewOrders(fresh);
    firstPendingLoad = false;
    badges();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function alertNewOrders(list) {
  if (pref.sound) beep(3);
  const o = list[list.length - 1];
  const msg = `${o.profile?.email || 'User'} wants to ${o.side.toUpperCase()} ${o.qty} × ${o.share_name} @ ${inr(o.price, 2)}`;
  toast('New offer: ' + msg, 'info', 6000);
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      const n = new Notification('Order Pulse — new offer', { body: msg, icon: 'icon-192.png', tag: 'op-order-' + o.id });
      n.onclick = () => { window.focus(); location.hash = '#/dashboard'; n.close(); };
    }
  } catch {}
  if (document.hidden && !titleBlink) {
    let on = false;
    titleBlink = setInterval(() => { document.title = (on = !on) ? `(${pending.length}) New offer!` : 'Order Pulse Admin'; }, 1000);
  }
}
function stopTitleBlink() { clearInterval(titleBlink); titleBlink = null; document.title = 'Order Pulse Admin'; }

function tickAges() {
  const to = settings?.order_timeout_seconds || 0;
  $$('.age[data-created]').forEach(el => {
    const s = Math.floor((Date.now() - new Date(el.dataset.created)) / 1000);
    el.textContent = to ? `${s}s · expires in ${Math.max(0, to - s)}s` : `${s}s ago`;
    el.classList.toggle('late', to && to - s < 20);
  });
}

function refreshView(source) {
  const map = {
    dashboard: ['orders', 'presence', 'profiles', 'shares', 'ledger'],
    orders: ['orders'], shares: ['shares'], users: ['profiles', 'presence'], online: ['presence', 'profiles'],
    ledger: ['ledger'], reports: ['reports'], settings: ['settings'], audit: [],
  };
  if (!(map[view] || []).includes(source)) return;
  if (view === 'dashboard') return source === 'presence' ? drawOnlinePanel() : renderDashboard(true);
  if (view === 'shares') return drawSharesGrid();
  renderView(true);
}

function renderView(soft) {
  const main = $('#main');
  const fn = { dashboard: renderDashboard, orders: renderOrders, shares: renderShares, users: renderUsers,
    online: renderOnline, ledger: renderLedger, reports: renderReports, audit: renderAudit, settings: renderSettings }[view];
  if (!soft) main.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  fn(soft);
}

const userLabel = (o) => o.profile?.email || users.find(u => u.id === o.user_id)?.email || o.user_id;
const nameOf = (id) => { const u = users.find(x => x.id === id); return u ? (u.full_name ? `${u.full_name} · ${u.email}` : u.email) : id; };
const istStart = (d) => new Date(d + 'T00:00:00+05:30').toISOString();
const istEnd = (d) => new Date(new Date(d + 'T00:00:00+05:30').getTime() + 864e5).toISOString();

// -------------------------------------------------------------------- dashboard
let todayStats = null;
async function renderDashboard(soft) {
  const main = $('#main');
  const today = todayIST();
  try {
    const todays = await api.admin.orders({ from: istStart(today), to: istEnd(today), limit: 5000 });
    const acc = todays.filter(o => o.status === 'accepted');
    todayStats = { total: todays.length, accepted: acc.length,
      buy: acc.filter(o => o.side === 'buy').reduce((a, o) => a + o.qty * o.price, 0),
      sell: acc.filter(o => o.side === 'sell').reduce((a, o) => a + o.qty * o.price, 0) };
  } catch {}
  // keep typed counter prices / notes across refreshes
  const keep = {};
  $$('.order-card').forEach(c => { keep[c.dataset.oid] = { p: $('[data-f=price]', c)?.value, n: $('[data-f=note]', c)?.value }; });

  if (!soft || !$('#pendingList')) {
    main.innerHTML = `
      <div class="page-head"><div><h1>Live desk</h1><div class="muted small">Offers appear here instantly. Respond with Accept, Counter or Reject.</div></div></div>
      <div class="stats" id="kpis"></div>
      <div class="grid-2">
        <div class="card"><div class="panel-head"><h2>Waiting for you</h2><span class="status pending" id="pendCount"></span></div><div id="pendingList"></div></div>
        <div>
          <div class="card"><div class="panel-head"><h2>Online now</h2><span class="live-badge"><span class="dot"></span><span id="onCount"></span></span></div><div id="onlinePanel"></div></div>
          <div class="card" style="margin-top:16px"><div class="panel-head"><h2>New sign-ups to approve</h2></div><div id="approvals"></div></div>
        </div>
      </div>`;
  }
  const kp = $('#kpis');
  const awaiting = users.filter(u => u.status === 'pending');
  kp.innerHTML = `
    <div class="card stat"><div class="k">Online now</div><div class="v">${online.filter(o => o.user_id !== me.id).length}</div></div>
    <div class="card stat"><div class="k">Offers waiting</div><div class="v ${pending.length ? 'neg' : ''}">${pending.length}</div></div>
    <div class="card stat"><div class="k">Awaiting approval</div><div class="v">${awaiting.length}</div></div>
    <div class="card stat"><div class="k">Accepted today</div><div class="v">${todayStats ? todayStats.accepted : '—'}<span class="muted small" style="font-size:13px"> / ${todayStats ? todayStats.total : '—'}</span></div></div>
    <div class="card stat"><div class="k">You sold today (user buys)</div><div class="v">${todayStats ? inr(todayStats.buy) : '—'}</div></div>
    <div class="card stat"><div class="k">You bought today (user sells)</div><div class="v">${todayStats ? inr(todayStats.sell) : '—'}</div></div>`;

  $('#pendCount').textContent = pending.length;
  const pl = $('#pendingList');
  pl.innerHTML = pending.length ? pending.map(o => {
    const sh = shareRows.find(r => r.data.id === o.share_id)?.data;
    const cur = sh ? (o.side === 'buy' ? sh.buy_price : sh.sell_price) : o.price;
    return `<div class="order-card new" data-oid="${o.id}">
      <div class="order-line">
        <span class="order-side ${o.side}">USER ${o.side === 'buy' ? 'BUYS' : 'SELLS'}</span>
        <b style="font-size:16px">${esc(o.share_name)}</b>
        <span class="grow"></span><span class="age" data-created="${o.created_at}"></span>
      </div>
      <div class="order-line">
        <span class="avatar">${esc((userLabel(o) || '?')[0])}</span>
        <div><div><b>${esc(o.profile?.full_name || '')}</b> <span class="mono small">${esc(userLabel(o))}</span></div>
        <div class="mono">${num(o.qty)} × ${inr(o.price, 2)} = <b>${inr(o.qty * o.price, 2)}</b> <span class="muted small">· GMP ${inr(o.gmp)} · order #${o.id}</span></div>
        <div class="muted small">${o.side === 'buy' ? 'If you accept, you SELL to this user.' : 'If you accept, you BUY from this user.'}</div></div>
      </div>
      <div class="order-actions">
        <button class="btn btn-ok btn-sm" data-act="accept">✓ Accept</button>
        <span class="row" style="gap:6px"><input class="input mono" data-f="price" type="number" step="0.05" min="0" value="${esc(keep[o.id]?.p ?? cur ?? '')}" title="New price for everyone">
        <button class="btn btn-warn btn-sm" data-act="counter">↻ Counter</button></span>
        <button class="btn btn-danger btn-sm" data-act="reject">✕ Reject</button>
        <input class="input" data-f="note" placeholder="Note to user (optional)" style="width:200px" value="${esc(keep[o.id]?.n ?? '')}">
      </div>
    </div>`;
  }).join('') : `<div class="empty">No offers waiting. New ones will pop up here with a sound.</div>`;
  $$('.order-card', pl).forEach(card => {
    $$('[data-act]', card).forEach(b => b.onclick = () => respond(card, b.dataset.act));
  });
  tickAges();
  drawOnlinePanel();

  $('#approvals').innerHTML = awaiting.length ? awaiting.map(u => `
    <div class="online-item"><span class="avatar">${esc(u.email[0])}</span>
      <div class="grow"><div><b>${esc(u.full_name || '')}</b> <span class="mono small">${esc(u.email)}</span></div><div class="muted small">Signed up ${timeAgo(u.created_at)}</div></div>
      <button class="btn btn-ok btn-sm" data-ap="${u.id}">Approve</button>
      <button class="btn btn-danger btn-sm" data-bl="${u.id}">Block</button></div>`).join('')
    : '<div class="empty">Nobody waiting.</div>';
  $$('[data-ap]').forEach(b => b.onclick = () => setStatus(b.dataset.ap, 'approved'));
  $$('[data-bl]').forEach(b => b.onclick = () => setStatus(b.dataset.bl, 'blocked'));
}

function drawOnlinePanel() {
  const box = $('#onlinePanel'); if (!box) return;
  const list = online.filter(o => o.user_id !== me.id);
  $('#onCount') && ($('#onCount').textContent = list.length + ' ONLINE');
  box.innerHTML = list.length ? list.map(onlineItem).join('') : '<div class="empty">No users online right now.</div>';
  const kp = $('#kpis .stat .v'); if (kp) kp.textContent = list.length;
}
function onlineItem(o) {
  const u = users.find(x => x.id === o.user_id);
  return `<div class="online-item"><span class="online-dot on"></span>
    <div class="grow"><div><b>${esc(u?.full_name || o.name || '')}</b> <span class="mono small">${esc(o.email)}</span>
      ${u?.status && u.status !== 'approved' ? `<span class="status ${u.status}">${u.status}</span>` : ''}</div>
    <div class="muted small">${esc(o.page || '')}${o.share ? ' · ' + esc(o.share) : ''}</div></div>
    <div class="muted small right">online ${timeAgo(o.since)}${o.sessions > 1 ? `<br>${o.sessions} devices` : ''}</div></div>`;
}

async function respond(card, action) {
  const id = +card.dataset.oid;
  const price = parseFloat($('[data-f=price]', card).value);
  const note = $('[data-f=note]', card).value.trim();
  if (action === 'counter' && !(price > 0)) return toast('Enter the new price for the counter offer', 'err');
  $$('button', card).forEach(b => b.disabled = true);
  try {
    await api.admin.respond(id, action, action === 'counter' ? price : null, note);
    toast({ accept: 'Accepted — saved to ledger', counter: `Counter sent — price is now ${inr(price, 2)} for everyone`, reject: 'Rejected' }[action], 'ok');
    card.style.opacity = .4;
  } catch (e) {
    toast(e.code === 'OP_ALREADY_HANDLED' ? 'This offer was already handled (or expired).' : errMsg(e), 'err');
    $$('button', card).forEach(b => b.disabled = false);
  }
  await loadPending();
  if (view === 'dashboard') renderDashboard(true);
}

async function setStatus(id, status) {
  try { await api.admin.setUserStatus(id, status); toast(`User ${status}`, 'ok'); await loadUsers(); refreshView('profiles'); }
  catch (e) { toast(e.code === 'OP_CANNOT_CHANGE_SELF' ? "You can't change your own access." : errMsg(e), 'err'); }
}

// -------------------------------------------------------------------- all orders
const ofilter = { user: '', status: '', from: '', to: '' };
async function renderOrders(soft) {
  const main = $('#main');
  if (!soft || !$('#oTable')) {
    main.innerHTML = `
      <div class="page-head"><div><h1>All orders</h1><div class="muted small">Every offer from every user, with timestamps. Sides are shown from the user's point of view.</div></div>
        <div class="grow"></div><button class="btn btn-sm" id="csv">⬇ CSV</button></div>
      <div class="filters">
        <select class="input" id="fu" style="max-width:260px"><option value="">All users</option>${users.map(u => `<option value="${u.id}">${esc(u.email)}</option>`).join('')}</select>
        <select class="input" id="fs" style="max-width:170px"><option value="">Any status</option>${['pending', 'accepted', 'countered', 'rejected', 'expired', 'cancelled'].map(s => `<option>${s}</option>`).join('')}</select>
        <input class="input" type="date" id="ff" style="max-width:170px" title="From (IST)"><input class="input" type="date" id="ft" style="max-width:170px" title="To (IST)">
      </div>
      <div class="card"><div class="table-wrap" id="oTable"></div></div>`;
    $('#fu').value = ofilter.user; $('#fs').value = ofilter.status; $('#ff').value = ofilter.from; $('#ft').value = ofilter.to;
    ['fu', 'fs', 'ff', 'ft'].forEach(id => $('#' + id).onchange = () => {
      ofilter.user = $('#fu').value; ofilter.status = $('#fs').value; ofilter.from = $('#ff').value; ofilter.to = $('#ft').value;
      renderOrders(true);
    });
  }
  let rows = [];
  try {
    rows = await api.admin.orders({ userId: ofilter.user || null, status: ofilter.status || null,
      from: ofilter.from ? istStart(ofilter.from) : null, to: ofilter.to ? istEnd(ofilter.to) : null });
  } catch (e) { toast(errMsg(e), 'err'); }
  $('#oTable').innerHTML = rows.length ? `<table class="tbl"><thead><tr>
      <th>#</th><th>Placed (IST)</th><th>User</th><th>Share</th><th>User side</th><th class="num">Qty</th><th class="num">Price</th>
      <th class="num">Value</th><th>Status</th><th>Responded</th><th>Note</th></tr></thead><tbody>
      ${rows.map(o => `<tr><td class="mono small">${o.id}</td><td class="mono small" style="white-space:nowrap">${fmtDateTime(o.created_at)}</td>
        <td class="small">${esc(userLabel(o))}</td><td class="share-name">${esc(o.share_name)}</td>
        <td><span class="order-side ${o.side}">${o.side.toUpperCase()}</span></td>
        <td class="num mono">${num(o.qty)}</td><td class="num mono">${inr(o.price, 2)}${o.counter_price ? `<div class="small muted">→ ${inr(o.counter_price, 2)}</div>` : ''}</td>
        <td class="num mono">${inr(o.qty * o.price, 2)}</td><td><span class="status ${o.status}">${o.status}</span></td>
        <td class="mono small" style="white-space:nowrap">${o.responded_at ? fmtDateTime(o.responded_at) : '—'}</td>
        <td class="small">${esc(o.admin_note || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No orders match.</div>';
  $('#csv').onclick = () => downloadCSV(`orderpulse-orders-${todayIST()}.csv`, rows, [
    { label: 'Order #', key: 'id' }, { label: 'Placed (IST)', get: r => fmtDateTime(r.created_at) },
    { label: 'User email', get: userLabel }, { label: 'Share', key: 'share_name' }, { label: 'User side', key: 'side' },
    { label: 'Qty', key: 'qty' }, { label: 'Price', key: 'price' }, { label: 'Value', get: r => (r.qty * r.price).toFixed(2) },
    { label: 'GMP at order', key: 'gmp' }, { label: 'Status', key: 'status' }, { label: 'Counter price', key: 'counter_price' },
    { label: 'Responded (IST)', get: r => r.responded_at ? fmtDateTime(r.responded_at) : '' }, { label: 'Note', key: 'admin_note' },
  ]);
}

// -------------------------------------------------------------------- shares editor
const SF = [
  { k: 'name', label: 'Share name', type: 'text', cls: 'w-name' },
  { k: 'status', label: 'Status', type: 'select', opts: ['upcoming', 'open', 'closed', 'allotted', 'listed'] },
  { k: 'open_date', label: 'Open date', type: 'date' },
  { k: 'close_date', label: 'Close date', type: 'date' },
  { k: 'price', label: 'Price ₹', type: 'number' },
  { k: 'issue_size_cr', label: 'Issue ₹Cr', type: 'number' },
  { k: 'gmp', label: 'GMP ₹', type: 'number' },
  { k: 'buy_price', label: 'User BUY ₹', type: 'number' },
  { k: 'sell_price', label: 'User SELL ₹', type: 'number' },
  { k: 'lot_size', label: 'Lot size', type: 'int' },
  { k: 'retail_lots', label: 'Retail lots', type: 'int' },
  { k: 'hni_lots', label: 'HNI lots', type: 'int' },
  { k: 'allotment_date', label: 'Allotment', type: 'date' },
  { k: 'listing_date', label: 'Listing', type: 'date' },
  { k: 'trading_enabled', label: 'Trade', type: 'bool' },
  { k: 'visible', label: 'Show', type: 'bool' },
  { k: 'sort_order', label: 'Order', type: 'int' },
];

function renderShares() {
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Shares</h1><div class="muted small">Edit any cell, then Save. Users see the change instantly.</div></div>
      <div class="grow"></div>
      <button class="btn btn-sm" id="addShare">＋ Add share</button>
      <button class="btn btn-primary btn-sm" id="saveAll">Save all changes</button></div>
    <div class="help">“User BUY ₹” is the price users pay when they buy (you sell). “User SELL ₹” is what users get when they sell (you buy).
      Expected profit is calculated automatically: GMP × lot size × lots. Turn off <b>Trade</b> to stop new offers on a share, or <b>Show</b> to hide it.
      You can also edit this same data in Supabase → Table Editor → <code>shares</code>.</div>
    <div class="card"><div class="table-wrap" id="sGrid"></div></div>`;
  $('#addShare').onclick = () => {
    shareRows.unshift({ data: { id: null, name: '', status: 'upcoming', gmp: 0, lot_size: 1, retail_lots: 1, hni_lots: 14, trading_enabled: true, visible: true, sort_order: 0 }, dirty: true });
    drawSharesGrid(); $('#sGrid input')?.focus();
  };
  $('#saveAll').onclick = async () => { for (let i = 0; i < shareRows.length; i++) if (shareRows[i].dirty) await saveRow(i, true); drawSharesGrid(); };
  drawSharesGrid();
}

function drawSharesGrid() {
  const grid = $('#sGrid'); if (!grid) return;
  const focused = document.activeElement?.dataset?.cell;
  grid.innerHTML = shareRows.length ? `<table class="tbl edit-grid"><thead><tr>
      ${SF.map(f => `<th class="${['number', 'int'].includes(f.type) ? 'num' : ''}">${f.label}</th>`).join('')}
      <th class="num">Profit Retail</th><th class="num">Profit HNI</th><th></th></tr></thead><tbody>
      ${shareRows.map((r, i) => `<tr class="${r.dirty ? 'dirty' : ''}" data-i="${i}">
        ${SF.map(f => `<td>${cellInput(f, r.data[f.k], i)}</td>`).join('')}
        <td class="ro" data-pr="${i}">${inr(calcProfit(r.data, 'retail'))}</td>
        <td class="ro" data-ph="${i}">${inr(calcProfit(r.data, 'hni'))}</td>
        <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" data-save="${i}" ${r.dirty ? '' : 'disabled'}>Save</button>
          ${r.data.id ? `<button class="btn btn-ghost btn-sm" data-del="${i}" title="Delete">🗑</button>` : `<button class="btn btn-ghost btn-sm" data-drop="${i}" title="Discard">✕</button>`}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">No shares yet. Click “Add share”.</div>';

  $$('[data-cell]', grid).forEach(inp => {
    const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      const [i, k] = inp.dataset.cell.split(':');
      const f = SF.find(x => x.k === k);
      const r = shareRows[+i];
      r.data[k] = f.type === 'bool' ? inp.checked : f.type === 'number' ? (inp.value === '' ? null : parseFloat(inp.value))
        : f.type === 'int' ? (inp.value === '' ? null : parseInt(inp.value, 10)) : f.type === 'date' ? (inp.value || null) : inp.value;
      r.dirty = true;
      const tr = inp.closest('tr'); tr.classList.add('dirty');
      $('[data-save]', tr).disabled = false;
      $(`[data-pr="${i}"]`).textContent = inr(calcProfit(r.data, 'retail'));
      $(`[data-ph="${i}"]`).textContent = inr(calcProfit(r.data, 'hni'));
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveRow(+inp.dataset.cell.split(':')[0]); });
  });
  $$('[data-save]', grid).forEach(b => b.onclick = () => saveRow(+b.dataset.save));
  $$('[data-drop]', grid).forEach(b => b.onclick = () => { shareRows.splice(+b.dataset.drop, 1); drawSharesGrid(); });
  $$('[data-del]', grid).forEach(b => b.onclick = () => {
    const r = shareRows[+b.dataset.del];
    openModal({ title: 'Delete share?', body: `<p>Delete <b>${esc(r.data.name)}</b>? Past orders and ledger entries keep the share name. To just hide it from users, untick <b>Show</b> instead.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Delete', cls: 'btn-sell', onClick: async () => {
        try { await api.admin.deleteShare(r.data.id); toast('Share deleted', 'ok'); await loadShares(); drawSharesGrid(); } catch (e) { toast(errMsg(e), 'err'); }
      } }] });
  });
  if (focused) { const el = $(`[data-cell="${focused}"]`, grid); el && el.focus(); }
}
function cellInput(f, v, i) {
  const a = `data-cell="${i}:${f.k}"`;
  if (f.type === 'bool') return `<input type="checkbox" ${a} ${v ? 'checked' : ''}>`;
  if (f.type === 'select') return `<select ${a}>${f.opts.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  if (f.type === 'date') return `<input type="date" class="w-date" ${a} value="${esc(v || '')}">`;
  if (f.type === 'number') return `<input type="number" step="0.01" ${a} value="${v ?? ''}">`;
  if (f.type === 'int') return `<input type="number" step="1" ${a} value="${v ?? ''}">`;
  return `<input type="text" class="${f.cls || ''}" ${a} value="${esc(v ?? '')}">`;
}
function calcProfit(d, kind) {
  const g = +d.gmp || 0, l = +d.lot_size || 0, n = kind === 'hni' ? (+d.hni_lots || 0) : (+d.retail_lots || 1);
  return g * l * n;
}
async function saveRow(i, quiet) {
  const r = shareRows[i]; if (!r) return;
  if (!r.data.name?.trim()) return toast('Share name is required', 'err');
  if (!(r.data.lot_size > 0)) return toast('Lot size must be more than 0', 'err');
  if (!(r.data.hni_lots > 0) || !(r.data.retail_lots > 0)) return toast('Lots must be more than 0', 'err');
  try {
    const saved = await api.admin.saveShare(r.data);
    shareRows[i] = { data: saved, dirty: false };
    if (!quiet) { toast(`Saved “${saved.name}” — live for users now`, 'ok'); drawSharesGrid(); }
  } catch (e) { toast(errMsg(e), 'err'); }
}

// -------------------------------------------------------------------- users
const ufilter = { status: 'all', q: '' };
function renderUsers(soft) {
  const main = $('#main');
  if (!soft || !$('#uTable')) {
    main.innerHTML = `
      <div class="page-head"><div><h1>Users</h1><div class="muted small">Approve or block access. Click a user to see their full history.</div></div>
        <div class="grow"></div><button class="btn btn-sm" id="csv">⬇ CSV</button></div>
      <div class="filters"><input class="input search" id="uq" placeholder="Search email or name" value="${esc(ufilter.q)}">
        ${['all', 'pending', 'approved', 'blocked'].map(s => `<button class="chip ${ufilter.status === s ? 'on' : ''}" data-us="${s}">${s}</button>`).join('')}</div>
      <div class="card"><div class="table-wrap" id="uTable"></div></div>`;
    $('#uq').oninput = debounce(e => { ufilter.q = e.target.value.toLowerCase(); drawUsers(); }, 120);
    $$('[data-us]').forEach(c => c.onclick = () => { ufilter.status = c.dataset.us; $$('[data-us]').forEach(x => x.classList.toggle('on', x === c)); drawUsers(); });
    $('#csv').onclick = () => downloadCSV('orderpulse-users.csv', users, [
      { label: 'Email', key: 'email' }, { label: 'Name', key: 'full_name' }, { label: 'Status', key: 'status' }, { label: 'Role', key: 'role' },
      { label: 'Joined (IST)', get: r => fmtDateTime(r.created_at) }, { label: 'Approved (IST)', get: r => r.approved_at ? fmtDateTime(r.approved_at) : '' },
      { label: 'Last seen (IST)', get: r => r.last_seen ? fmtDateTime(r.last_seen) : '' },
    ]);
  }
  drawUsers();
}
function drawUsers() {
  const box = $('#uTable'); if (!box) return;
  const on = new Map(online.map(o => [o.user_id, o]));
  const rows = users.filter(u => (ufilter.status === 'all' || u.status === ufilter.status) &&
    (!ufilter.q || (u.email + ' ' + (u.full_name || '')).toLowerCase().includes(ufilter.q)));
  box.innerHTML = rows.length ? `<table class="tbl"><thead><tr><th></th><th>User</th><th>Status</th><th>Role</th><th>Joined</th><th>Last seen</th><th>Access</th><th></th></tr></thead><tbody>
    ${rows.map(u => {
      const o = on.get(u.id);
      return `<tr><td><span class="online-dot ${o ? 'on' : ''}" title="${o ? 'Online' : 'Offline'}"></span></td>
        <td><b>${esc(u.full_name || '')}</b> <span class="mono small">${esc(u.email)}</span></td>
        <td><span class="status ${u.status}">${u.status}</span></td>
        <td>${u.role === 'admin' ? '<span class="status admin">admin</span>' : 'user'}</td>
        <td class="small mono">${fmtDate(u.created_at)}</td>
        <td class="small">${o ? `<b style="color:var(--buy)">Online</b> · ${esc(o.page || '')}${o.share ? ' · ' + esc(o.share) : ''}` : (u.last_seen ? timeAgo(u.last_seen) : '—')}</td>
        <td style="white-space:nowrap">${u.id === me.id ? '<span class="muted small">you</span>' : `
          ${u.status !== 'approved' ? `<button class="btn btn-ok btn-sm" data-ap="${u.id}">Allow</button>` : ''}
          ${u.status !== 'blocked' ? `<button class="btn btn-danger btn-sm" data-bl="${u.id}">Block</button>` : ''}`}</td>
        <td><button class="btn btn-sm" data-view="${u.id}">History →</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No users match.</div>';
  $$('[data-ap]', box).forEach(b => b.onclick = () => setStatus(b.dataset.ap, 'approved'));
  $$('[data-bl]', box).forEach(b => b.onclick = () => setStatus(b.dataset.bl, 'blocked'));
  $$('[data-view]', box).forEach(b => b.onclick = () => userHistory(b.dataset.view));
}

async function userHistory(id) {
  const u = users.find(x => x.id === id);
  const m = openModal({ title: `${esc(u?.full_name || '')} <span class="mono small muted">${esc(u?.email || '')}</span>`, body: '<div class="spinner"></div>', actions: [{ label: 'Close' }] });
  $('.modal', m).classList.add('modal-wide');
  const [ledger, orders] = await Promise.all([api.admin.ledger(id), api.admin.orders({ userId: id })]);
  const cr = ledger.reduce((a, l) => a + +l.amount_credit, 0), dr = ledger.reduce((a, l) => a + +l.amount_debit, 0);
  $('.modal-body', m).innerHTML = `
    <div class="stats">
      <div class="card stat"><div class="k">Net ₹ balance</div><div class="v ${cr - dr >= 0 ? 'pos' : 'neg'}">${inr(cr - dr, 2)}</div></div>
      <div class="card stat"><div class="k">User bought</div><div class="v">${inr(dr, 2)}</div></div>
      <div class="card stat"><div class="k">User sold</div><div class="v">${inr(cr, 2)}</div></div>
      <div class="card stat"><div class="k">Offers / accepted</div><div class="v">${orders.length} / ${ledger.length}</div></div></div>
    <div class="row"><h3>Ledger</h3><span class="grow"></span><button class="btn btn-sm" id="uCsv">⬇ Ledger CSV</button><button class="btn btn-sm" id="uoCsv">⬇ Orders CSV</button></div>
    <div class="table-wrap">${ledgerTable(ledger, false)}</div>
    <h3 style="margin-top:18px">All offers</h3>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Placed</th><th>Share</th><th>Side</th><th class="num">Qty</th><th class="num">Price</th><th>Status</th><th>Responded</th></tr></thead><tbody>
      ${orders.map(o => `<tr><td class="mono small">${fmtDateTime(o.created_at)}</td><td>${esc(o.share_name)}</td><td><span class="order-side ${o.side}">${o.side.toUpperCase()}</span></td>
        <td class="num mono">${num(o.qty)}</td><td class="num mono">${inr(o.price, 2)}</td><td><span class="status ${o.status}">${o.status}</span></td>
        <td class="mono small">${o.responded_at ? fmtDateTime(o.responded_at) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No offers</td></tr>'}
    </tbody></table></div>`;
  $('#uCsv').onclick = () => downloadCSV(`ledger-${u.email}.csv`, ledger, LEDGER_COLS);
  $('#uoCsv').onclick = () => downloadCSV(`orders-${u.email}.csv`, orders, [
    { label: 'Order #', key: 'id' }, { label: 'Placed (IST)', get: r => fmtDateTime(r.created_at) }, { label: 'Share', key: 'share_name' },
    { label: 'Side', key: 'side' }, { label: 'Qty', key: 'qty' }, { label: 'Price', key: 'price' }, { label: 'Status', key: 'status' },
    { label: 'Responded (IST)', get: r => r.responded_at ? fmtDateTime(r.responded_at) : '' }]);
}

// -------------------------------------------------------------------- online
function renderOnline() {
  const list = online.slice().sort((a, b) => (a.email > b.email ? 1 : -1));
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Online now</h1><div class="muted small">Updates live as people open and close the app. Shows the page each person is on.</div></div>
      <span class="grow"></span><span class="live-badge"><span class="dot"></span><span>${list.filter(o => o.user_id !== me.id).length} ONLINE</span></span></div>
    <div class="card">${list.length ? list.map(onlineItem).join('') : '<div class="empty">Nobody online.</div>'}</div>`;
}

// -------------------------------------------------------------------- ledger
const LEDGER_COLS = [
  { label: 'Date & time (IST)', get: r => fmtDateTime(r.created_at) }, { label: 'User email', key: 'email' },
  { label: 'Share', key: 'share_name' }, { label: 'User side', key: 'side' }, { label: 'Qty', key: 'qty' }, { label: 'Price', key: 'price' },
  { label: 'Qty Debit', key: 'qty_debit' }, { label: 'Qty Credit', key: 'qty_credit' },
  { label: 'Amount Debit', key: 'amount_debit' }, { label: 'Amount Credit', key: 'amount_credit' },
  { label: 'User balance', key: 'balance' }, { label: 'Order #', key: 'order_id' },
];
function ledgerTable(rows, withUser) {
  if (!rows.length) return '<div class="empty">No ledger entries yet.</div>';
  return `<table class="tbl"><thead><tr><th>Date & time</th>${withUser ? '<th>User</th>' : ''}<th>Particulars</th>
    <th class="num">Qty Dr</th><th class="num">Qty Cr</th><th class="num">₹ Debit</th><th class="num">₹ Credit</th><th class="num">Balance</th></tr></thead><tbody>
    ${rows.slice().reverse().map(l => `<tr><td class="mono small" style="white-space:nowrap">${fmtDateTime(l.created_at)}</td>
      ${withUser ? `<td class="small">${esc(l.email)}</td>` : ''}
      <td>${l.side === 'buy' ? 'Bought' : 'Sold'} ${num(l.qty)} × <b>${esc(l.share_name)}</b> @ <span class="mono">${inr(l.price, 2)}</span></td>
      <td class="num mono dr">${+l.qty_debit ? num(l.qty_debit) : ''}</td><td class="num mono crd">${+l.qty_credit ? num(l.qty_credit) : ''}</td>
      <td class="num mono dr">${+l.amount_debit ? inr(l.amount_debit, 2) : ''}</td><td class="num mono crd">${+l.amount_credit ? inr(l.amount_credit, 2) : ''}</td>
      <td class="num mono"><b>${inr(l.balance, 2)}</b></td></tr>`).join('')}</tbody></table>`;
}
let lfUser = '';
async function renderLedger() {
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Ledger</h1><div class="muted small">User buy → shares credited, ₹ debited. User sell → shares debited, ₹ credited. Balances are per user.</div></div>
      <div class="grow"></div><button class="btn btn-sm" id="csv">⬇ CSV</button></div>
    <div class="filters"><select class="input" id="lu" style="max-width:280px"><option value="">All users</option>${users.map(u => `<option value="${u.id}">${esc(u.email)}</option>`).join('')}</select></div>
    <div class="card"><div class="table-wrap" id="lTable"><div class="empty"><div class="spinner"></div></div></div></div>`;
  $('#lu').value = lfUser;
  $('#lu').onchange = () => { lfUser = $('#lu').value; renderLedger(); };
  let rows = [];
  try { rows = await api.admin.ledger(lfUser || null); } catch (e) { toast(errMsg(e), 'err'); }
  $('#lTable').innerHTML = ledgerTable(rows, true);
  $('#csv').onclick = () => downloadCSV(`orderpulse-ledger-${todayIST()}.csv`, rows, LEDGER_COLS);
}

// -------------------------------------------------------------------- reports
async function renderReports() {
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Daily reports</h1><div class="muted small">A summary is generated automatically every night at 00:05 IST. You can also build one now.</div></div>
      <div class="grow"></div><button class="btn btn-sm" id="genY">Build yesterday</button><button class="btn btn-primary btn-sm" id="genT">Build today so far</button></div>
    <div class="card"><div class="table-wrap" id="rTable"><div class="empty"><div class="spinner"></div></div></div></div>`;
  const yday = new Date(new Date(todayIST() + 'T12:00:00+05:30').getTime() - 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  $('#genT').onclick = () => gen(todayIST());
  $('#genY').onclick = () => gen(yday);
  async function gen(d) { try { const r = await api.admin.generateReport(d); toast('Report ready for ' + fmtDate(d), 'ok'); await draw(); showReport(r); } catch (e) { toast(errMsg(e), 'err'); } }
  let reps = [];
  async function draw() {
    try { reps = await api.admin.reports(); } catch (e) { toast(errMsg(e), 'err'); }
    $('#rTable').innerHTML = reps.length ? `<table class="tbl"><thead><tr><th>Date</th><th class="num">Offers</th><th class="num">Accepted</th><th class="num">Rejected</th>
      <th class="num">Users bought ₹</th><th class="num">Users sold ₹</th><th class="num">Active users</th><th class="num">New sign-ups</th><th>Built</th><th></th></tr></thead><tbody>
      ${reps.map((r, i) => { const d = r.data; return `<tr><td><b>${fmtDate(r.report_date)}</b></td><td class="num mono">${d.orders.total}</td>
        <td class="num mono">${d.orders.accepted}</td><td class="num mono">${d.orders.rejected}</td>
        <td class="num mono">${inr(d.trades.buy_value, 2)}</td><td class="num mono">${inr(d.trades.sell_value, 2)}</td>
        <td class="num mono">${d.active_users}</td><td class="num mono">${d.new_signups}</td>
        <td class="small muted">${fmtDateTime(r.generated_at)}</td><td><button class="btn btn-sm" data-r="${i}">Open</button></td></tr>`; }).join('')}
      </tbody></table>` : '<div class="empty">No reports yet. Click “Build today so far”.</div>';
    $$('[data-r]').forEach(b => b.onclick = () => showReport(reps[+b.dataset.r]));
    const allCsv = $('#allCsv');
    if (!allCsv && reps.length) {
      const btn = document.createElement('button'); btn.className = 'btn btn-sm'; btn.id = 'allCsv'; btn.textContent = '⬇ All days CSV';
      btn.onclick = () => downloadCSV('orderpulse-daily-reports.csv', reps, [
        { label: 'Date', key: 'report_date' }, { label: 'Offers', get: r => r.data.orders.total }, { label: 'Accepted', get: r => r.data.orders.accepted },
        { label: 'Countered', get: r => r.data.orders.countered }, { label: 'Rejected', get: r => r.data.orders.rejected }, { label: 'Expired', get: r => r.data.orders.expired },
        { label: 'Users bought qty', get: r => r.data.trades.buy_qty }, { label: 'Users bought ₹', get: r => r.data.trades.buy_value },
        { label: 'Users sold qty', get: r => r.data.trades.sell_qty }, { label: 'Users sold ₹', get: r => r.data.trades.sell_value },
        { label: 'Active users', get: r => r.data.active_users }, { label: 'New sign-ups', get: r => r.data.new_signups }]);
      $('#genY').before(btn);
    }
  }
  await draw();
}
function showReport(r) {
  const d = r.data;
  const m = openModal({ title: 'Report — ' + fmtDate(r.report_date), body: `
    <div class="stats">
      <div class="card stat"><div class="k">Offers</div><div class="v">${d.orders.total}</div></div>
      <div class="card stat"><div class="k">Accepted</div><div class="v pos">${d.orders.accepted}</div></div>
      <div class="card stat"><div class="k">Users bought</div><div class="v">${inr(d.trades.buy_value)}</div><div class="muted small mono">${num(d.trades.buy_qty)} shares</div></div>
      <div class="card stat"><div class="k">Users sold</div><div class="v">${inr(d.trades.sell_value)}</div><div class="muted small mono">${num(d.trades.sell_qty)} shares</div></div>
    </div>
    <p class="small muted">Countered ${d.orders.countered} · Rejected ${d.orders.rejected} · Expired ${d.orders.expired} · Withdrawn ${d.orders.cancelled} ·
      Active users ${d.active_users} · Users seen ${d.seen_users ?? '—'} · New sign-ups ${d.new_signups} · Awaiting approval ${d.pending_approvals} · Total users ${d.total_users}</p>
    <h3>By share</h3>${breakdown(d.by_share, 'share_name', 'Share')}
    <h3 style="margin-top:16px">By user</h3>${breakdown(d.by_user, 'email', 'User')}`,
    actions: [{ label: '⬇ CSV', onClick: () => { downloadCSV(`report-${r.report_date}.csv`,
      [...d.by_share.map(x => ({ type: 'share', name: x.share_name, ...x })), ...d.by_user.map(x => ({ type: 'user', name: x.email, ...x }))],
      [{ label: 'Type', key: 'type' }, { label: 'Name', key: 'name' }, { label: 'Trades', key: 'trades' }, { label: 'Buy qty', key: 'buy_qty' },
       { label: 'Buy ₹', key: 'buy_value' }, { label: 'Sell qty', key: 'sell_qty' }, { label: 'Sell ₹', key: 'sell_value' }]); return false; } },
      { label: 'Close', cls: 'btn-primary' }] });
  $('.modal', m).classList.add('modal-wide');
}
function breakdown(rows, key, label) {
  if (!rows?.length) return '<div class="empty">No trades.</div>';
  return `<div class="table-wrap"><table class="tbl"><thead><tr><th>${label}</th><th class="num">Trades</th><th class="num">Bought qty</th><th class="num">Bought ₹</th><th class="num">Sold qty</th><th class="num">Sold ₹</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${esc(x[key])}</td><td class="num mono">${x.trades}</td><td class="num mono">${num(x.buy_qty)}</td><td class="num mono">${inr(x.buy_value, 2)}</td>
      <td class="num mono">${num(x.sell_qty)}</td><td class="num mono">${inr(x.sell_value, 2)}</td></tr>`).join('')}</tbody></table></div>`;
}

// -------------------------------------------------------------------- audit
async function renderAudit() {
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Activity log</h1><div class="muted small">Every sign-up, offer, response, price edit and access change — including edits made in Supabase directly.</div></div>
      <div class="grow"></div><button class="btn btn-sm" id="re">↻ Refresh</button><button class="btn btn-sm" id="csv">⬇ CSV</button></div>
    <div class="filters"><input class="input search" id="aq" placeholder="Filter (email, action, share…)"></div>
    <div class="card"><div class="table-wrap" id="aTable"><div class="empty"><div class="spinner"></div></div></div></div>`;
  let rows = [];
  try { rows = await api.admin.audit(1000); } catch (e) { toast(errMsg(e), 'err'); }
  const draw = (q = '') => {
    const f = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    $('#aTable').innerHTML = f.length ? `<table class="tbl"><thead><tr><th>When (IST)</th><th>Who</th><th>Action</th><th>On</th><th>Details</th></tr></thead><tbody>
      ${f.map(r => `<tr><td class="mono small" style="white-space:nowrap">${fmtDateTime(r.ts)}</td><td class="small">${esc(r.actor_email || '—')}</td>
        <td><span class="status ${/reject|delete|block/.test(r.action + JSON.stringify(r.details)) ? 'rejected' : /accept|signup|insert/.test(r.action) ? 'accepted' : 'pending'}">${esc(r.action)}</span></td>
        <td class="small">${esc(r.entity || '')} ${r.entity_id ? '#' + esc(r.entity_id.slice(0, 8)) : ''}</td>
        <td><div class="json-mini">${esc(summarize(r.details))}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing logged yet.</div>';
  };
  draw();
  $('#aq').oninput = debounce(e => draw(e.target.value.toLowerCase()), 150);
  $('#re').onclick = () => renderAudit();
  $('#csv').onclick = () => downloadCSV(`orderpulse-activity-${todayIST()}.csv`, rows, [
    { label: 'When (IST)', get: r => fmtDateTime(r.ts) }, { label: 'Who', key: 'actor_email' }, { label: 'Action', key: 'action' },
    { label: 'Table', key: 'entity' }, { label: 'Record', key: 'entity_id' }, { label: 'Details', key: 'details' }]);
}
function summarize(d) {
  if (!d || !Object.keys(d).length) return '';
  if (d.created) return 'created: ' + (d.created.name || d.created.email || JSON.stringify(d.created).slice(0, 120));
  if (d.deleted) return 'deleted: ' + (d.deleted.name || d.deleted.email || '');
  const parts = Object.entries(d).map(([k, v]) => v && typeof v === 'object' && 'from' in v ? `${k}: ${v.from ?? '∅'} → ${v.to ?? '∅'}` : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return parts.join(' · ');
}

// -------------------------------------------------------------------- settings
function renderSettings(soft) {
  if (soft && $('#stForm') && document.activeElement?.closest('#stForm')) return;
  const s = settings || {};
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="grid-2">
      <div class="card card-pad"><form id="stForm">
        <h2 style="font-size:16px;margin-bottom:8px">Trading</h2>
        <div class="switch-row"><div><b>Trading open</b><div class="muted small">Turn off to pause all new offers instantly.</div></div>
          <input type="checkbox" name="trading_enabled" ${s.trading_enabled ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></div>
        <div class="switch-row"><div><b>Response time limit</b><div class="muted small">Seconds before an unanswered offer expires (0 = never).</div></div>
          <input class="input mono" type="number" name="order_timeout_seconds" min="0" step="10" value="${s.order_timeout_seconds ?? 120}" style="width:110px"></div>
        <label class="field" style="margin-top:14px"><span>Announcement shown to all users (leave empty for none)</span>
          <textarea class="input" name="announcement" rows="3" maxlength="400">${esc(s.announcement || '')}</textarea></label>
        <button class="btn btn-primary">Save settings</button>
      </form></div>
      <div>
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-bottom:8px">Telegram alerts <span class="status pending">coming later</span></h2>
          <p class="muted small">Reserved for the future: get new offers on your phone through a free Telegram bot. The fields are ready in the database (<code>admin_secrets</code> table); nothing is sent yet.</p>
          <label class="field"><span>Bot token</span><input class="input" disabled placeholder="Available in a future update"></label>
          <label class="field"><span>Chat ID</span><input class="input" disabled></label>
        </div>
        <div class="card card-pad" style="margin-top:16px">
          <h2 style="font-size:16px;margin-bottom:8px">Where to edit data directly</h2>
          <div class="help" style="margin:0">Supabase dashboard → <b>Table Editor</b>:<br>
            <code>shares</code> — the share list users see (edits go live instantly)<br>
            <code>profiles</code> — users, status (pending / approved / blocked), role<br>
            <code>orders</code> · <code>ledger</code> — trading history (best left read-only)<br>
            <code>app_settings</code> — the settings on this page<br>
            <code>audit_log</code> · <code>daily_reports</code> — logs and reports</div>
          ${DEMO ? '<button class="btn btn-danger btn-sm" id="resetDemo" style="margin-top:12px">Reset demo data</button>' : ''}
        </div>
      </div>
    </div>`;
  $('#stForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      settings = await api.admin.saveSettings({ trading_enabled: f.trading_enabled.checked,
        order_timeout_seconds: Math.max(0, parseInt(f.order_timeout_seconds.value, 10) || 0), announcement: f.announcement.value.trim() });
      toast('Settings saved — live for users', 'ok');
    } catch (err) { toast(errMsg(err), 'err'); }
  };
  const rd = $('#resetDemo');
  if (rd) rd.onclick = async () => { await api.admin.resetDemo(); toast('Demo data reset'); await api.auth.signOut(); renderLogin(); };
}

boot();
