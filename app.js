// ===================== ORDER PULSE — USER APP =====================

initTheme();
const root = $('#app');
let api;
let me = null;               // my profile
let sessionKey = null;       // id+status the session listeners were set up for
let settings = null;
let pageUnsubs = [];         // listeners for the current page
let sessionUnsubs = [];      // listeners for the logged-in session
let onSettingsChange = null; // page hook
let activeOrder = null;      // offer waiting for admin
let waitTimer = null, pollTimer = null;
let recovery = false;
let deferredInstall = null;
const filterState = { q: '', status: 'all' };
const prevShares = new Map();
const lastQty = {};

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

const ICON = {
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
};

const clearPage = () => { pageUnsubs.forEach(f => { try { f(); } catch {} }); pageUnsubs = []; onSettingsChange = null; };
const clearSession = () => { sessionUnsubs.forEach(f => { try { f(); } catch {} }); sessionUnsubs = []; clearPage(); };

// --------------------------------------------------------------- boot
async function boot() {
  window.__opStarted = true;
  try { api = await getApi(); }
  catch (e) {
    root.innerHTML = `<div class="state-card card"><h2>Could not start</h2><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  api.auth.onChange(ev => {
    if (ev === 'PASSWORD_RECOVERY') { recovery = true; renderResetPassword(); }
    else if (ev === 'SIGNED_OUT') { me = null; sessionKey = null; route(); }
  });
  window.addEventListener('hashchange', () => route());
  setInterval(() => { if (me) api.heartbeat(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeOrder) checkOrder();
  });
  await route();
}

async function route() {
  if (recovery) return;
  const s = await api.auth.session();
  if (!s) { clearSession(); me = null; sessionKey = null; return renderAuth('login'); }
  if (!me || me.id !== s.user.id) {
    try { me = await api.me(); } catch (e) { me = null; }
  }
  if (!me) {
    root.innerHTML = `<div class="state-card card"><h2>${t('OP_UNKNOWN')}</h2><br><button class="btn btn-primary" id="lo">${t('logout')}</button></div>`;
    $('#lo').onclick = logout;
    return;
  }
  if (sessionKey !== me.id + ':' + me.status) await startSession();
  if (me.status === 'pending') return renderStatusPage('pending');
  if (me.status === 'blocked') return renderStatusPage('blocked');

  clearPage();
  const [, page, id] = (location.hash || '#/').split('/');
  if (page === 'trade' && id) return renderTrade(+id);
  if (page === 'txns') return renderTxns();
  return renderShares();
}

async function startSession() {
  clearSession();
  sessionKey = me.id + ':' + me.status;
  sessionUnsubs.push(api.subscribe('profiles', debounce(async () => {
    const fresh = await api.me().catch(() => null);
    if (!fresh) return;
    const changed = fresh.status !== me.status || fresh.role !== me.role;
    me = fresh;
    if (changed) route();
  }, 200), `id=eq.${me.id}`));

  if (me.status === 'blocked') return;
  api.presence.join({ page: me.status === 'pending' ? 'Awaiting approval' : 'Share list', name: me.full_name || '', role: me.role });
  api.heartbeat();
  if (me.status !== 'approved') return;

  settings = await api.settings().catch(() => null);
  sessionUnsubs.push(api.subscribe('app_settings', async () => {
    settings = await api.settings().catch(() => settings);
    renderAnnounce();
    onSettingsChange && onSettingsChange();
  }));
  sessionUnsubs.push(api.subscribe('orders', () => checkOrder(), `user_id=eq.${me.id}`));
  try {
    const mine = await api.orders.mine();
    const p = mine.find(o => o.status === 'pending');
    if (p) watchOrder(p);
  } catch {}
}

async function logout() {
  clearSession(); stopWatching(); closeModal();
  me = null; sessionKey = null;
  await api.auth.signOut();
  location.hash = '#/';
  renderAuth('login');
}

// --------------------------------------------------------------- shell
function shell(active) {
  root.innerHTML = `
    ${DEMO ? `<div class="banner">${t('demo_banner')} &nbsp;<a href="admin.html" target="_blank">Admin panel ↗</a></div>` : ''}
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="#/shares">${LOGO_SVG}<span>Order Pulse</span></a>
      <nav class="nav">
        <a href="#/shares" class="${active === 'shares' ? 'active' : ''}">${t('shares')}</a>
        <a href="#/txns" class="${active === 'txns' ? 'active' : ''}">${t('my_txns')}</a>
        ${me.role === 'admin' ? `<a href="admin.html">${t('admin_panel')}</a>` : ''}
      </nav>
      <div class="top-actions">
        <span class="live-badge" id="live"><span class="dot"></span><span>${t('live')}</span></span>
        ${deferredInstall ? `<button class="btn btn-ghost btn-sm hide-sm" id="installBtn">${t('install_app')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="langBtn">${getLang() === 'en' ? 'हिंदी' : 'EN'}</button>
        <button class="btn btn-ghost icon-btn" id="themeBtn" title="Theme" aria-label="Theme">${ICON.theme}</button>
        <button class="btn btn-ghost icon-btn" id="logoutBtn" title="${t('logout')}" aria-label="${t('logout')}">${ICON.logout}</button>
      </div>
    </div></header>
    <main class="container" id="page"></main>`;
  $('#langBtn').onclick = () => { setLang(getLang() === 'en' ? 'hi' : 'en'); route(); };
  $('#themeBtn').onclick = toggleTheme;
  $('#logoutBtn').onclick = logout;
  const ib = $('#installBtn');
  if (ib) ib.onclick = async () => { deferredInstall.prompt(); deferredInstall = null; ib.remove(); };
  pageUnsubs.push(api.onStatus(st => {
    const el = $('#live'); if (!el) return;
    el.classList.toggle('down', st === 'down');
    el.lastElementChild.textContent = st === 'down' ? t('reconnecting') : t('live');
  }));
  return $('#page');
}

function renderAnnounce() {
  const el = $('#announce'); if (!el) return;
  const parts = [];
  if (settings && !settings.trading_enabled) parts.push(`<div class="announce" style="background:var(--warn-soft)"><b>⏸ ${t('trading_paused')}</b></div>`);
  if (settings?.announcement) parts.push(`<div class="announce">📢 ${esc(settings.announcement)}</div>`);
  el.innerHTML = parts.join('');
}

// --------------------------------------------------------------- auth pages
function langSwitch() {
  return `<div class="lang-switch" role="group" aria-label="${t('language')}">
    <button type="button" data-l="en" class="${getLang() === 'en' ? 'on' : ''}">English</button>
    <button type="button" data-l="hi" class="${getLang() === 'hi' ? 'on' : ''}">हिंदी</button></div>`;
}
function wireLang(rerender) {
  $$('.lang-switch button').forEach(b => b.onclick = () => { setLang(b.dataset.l); rerender(); });
}

function renderAuth(mode = 'login', prefill = '', msg = null) {
  clearSession();
  const title = { login: t('login_btn'), signup: t('signup_btn'), forgot: t('send_reset') }[mode];
  root.innerHTML = `
    ${DEMO ? `<div class="banner">${t('demo_banner')}</div>` : ''}
    <div class="auth-wrap"><div class="card auth-card">
      <div class="auth-brand">${LOGO_SVG}<h1>Order Pulse</h1><div class="muted small">${t('tagline')}</div></div>
      <div class="muted small" style="margin-bottom:6px;font-weight:600">${t('language')}</div>
      ${langSwitch()}
      ${mode !== 'forgot' ? `<div class="tabs" role="tablist">
        <button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">${t('login')}</button>
        <button type="button" data-m="signup" class="${mode === 'signup' ? 'on' : ''}">${t('signup')}</button></div>`
      : `<h3 style="margin:18px 0 12px">${t('forgot')}</h3>`}
      <div id="msg"></div>
      <form id="f" novalidate>
        ${mode === 'signup' ? `<label class="field"><span>${t('full_name')}</span><input class="input" name="name" autocomplete="name" maxlength="80"></label>` : ''}
        <label class="field"><span>${t('email')}</span><input class="input" name="email" type="email" autocomplete="email" required value="${esc(prefill)}"></label>
        ${mode !== 'forgot' ? `<label class="field"><span>${t('password')}</span><input class="input" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></label>` : ''}
        ${mode === 'signup' ? `<label class="field"><span>${t('confirm_password')}</span><input class="input" name="confirm" type="password" autocomplete="new-password" required></label>` : ''}
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="submit">${title}</button>
      </form>
      <div class="auth-foot">
        ${mode === 'login' ? `<button class="linkish" id="forgotBtn" type="button">${t('forgot')}</button>` : ''}
        ${mode === 'forgot' ? `<button class="linkish" id="backBtn" type="button">← ${t('login')}</button>` : ''}
      </div>
      ${DEMO ? `<div class="help" style="margin:16px 0 0">Demo logins — user: <code>user@demo.com</code> / <code>user123</code> · admin: <code>admin@demo.com</code> / <code>admin123</code></div>` : ''}
    </div></div>`;

  const f = $('#f');
  const showMsg = (kind, html) => { $('#msg').innerHTML = `<div class="form-msg ${kind}">${html}</div>`; };
  if (msg) showMsg(msg.kind, msg.html);
  wireLang(() => renderAuth(mode, f.email.value, msg));
  $$('.tabs button').forEach(b => b.onclick = () => renderAuth(b.dataset.m, f.email.value));
  $('#forgotBtn') && ($('#forgotBtn').onclick = () => renderAuth('forgot', f.email.value));
  $('#backBtn') && ($('#backBtn').onclick = () => renderAuth('login', f.email.value));
  (prefill ? (f.password || f.email) : f.email).focus();

  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = f.email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg('err', t('email_invalid'));
    const btn = $('#submit'); btn.disabled = true;
    try {
      if (mode === 'login') {
        const st = await api.auth.checkEmail(email);
        if (st === 'none') {
          showMsg('info', `${t('email_not_found')}<br><button type="button" class="btn btn-primary btn-sm" id="goReg">${t('register_now')}</button>`);
          $('#goReg').onclick = () => renderAuth('signup', email);
          return;
        }
        await api.auth.signIn(email, f.password.value);
        me = null; sessionKey = null;
        if (!location.hash || location.hash === '#/') location.hash = '#/shares';
        await route();
      } else if (mode === 'signup') {
        const pw = f.password.value;
        if (pw.length < 6) return showMsg('err', t('pw_short'));
        if (pw !== f.confirm.value) return showMsg('err', t('pw_mismatch'));
        const st = await api.auth.checkEmail(email);
        if (st !== 'none') {
          showMsg('info', `${t('OP_EMAIL_EXISTS')}<br><button type="button" class="btn btn-primary btn-sm" id="goLogin">${t('login')}</button>`);
          $('#goLogin').onclick = () => renderAuth('login', email);
          return;
        }
        const r = await api.auth.signUp(email, pw, f.name.value.trim());
        if (r.needsConfirm) return renderAuth('login', email, { kind: 'ok', html: t('signup_confirm_email') });
        me = null; sessionKey = null;
        toast(t('signup_done'), 'ok', 5000);
        await route();
      } else {
        await api.auth.resetPassword(email);
        showMsg('ok', t('reset_sent'));
      }
    } catch (err) {
      showMsg('err', esc(errMsg(err)));
    } finally { btn.disabled = false; }
  };
}

function renderResetPassword() {
  root.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    <div class="auth-brand">${LOGO_SVG}<h1>Order Pulse</h1></div>
    <div id="msg"></div>
    <form id="f"><label class="field"><span>${t('new_password')}</span><input class="input" name="pw" type="password" autocomplete="new-password" required></label>
    <button class="btn btn-primary btn-block btn-lg">${t('set_password')}</button></form></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const pw = e.target.pw.value;
    if (pw.length < 6) { $('#msg').innerHTML = `<div class="form-msg err">${t('pw_short')}</div>`; return; }
    try { await api.auth.updatePassword(pw); toast(t('password_updated'), 'ok'); recovery = false; history.replaceState(null, '', location.pathname + '#/shares'); route(); }
    catch (err) { $('#msg').innerHTML = `<div class="form-msg err">${esc(errMsg(err))}</div>`; }
  };
}

function renderStatusPage(kind) {
  clearPage();
  root.innerHTML = `
    ${DEMO ? `<div class="banner">${t('demo_banner')}</div>` : ''}
    <div class="auth-wrap"><div class="card state-card" style="margin:0">
      <div class="big-icon" style="${kind === 'blocked' ? 'background:var(--sell-soft);color:var(--sell)' : ''}">${kind === 'pending' ? '⏳' : '⛔'}</div>
      <h2>${t(kind + '_title')}</h2>
      <p class="muted">${t(kind + '_body')}</p>
      <p class="mono small">${esc(me.email)}</p>
      ${kind === 'pending' ? '<span class="live-badge"><span class="dot"></span><span>' + t('live') + '</span></span><br><br>' : ''}
      ${langSwitch()}<br>
      <button class="btn" id="lo">${t('logout')}</button>
    </div></div>`;
  wireLang(() => renderStatusPage(kind));
  $('#lo').onclick = logout;
}

// --------------------------------------------------------------- page 2: share list
const STATUSES = ['all', 'open', 'upcoming', 'closed', 'allotted', 'listed'];
const WATCH_FIELDS = ['gmp', 'price', 'profit_retail', 'profit_hni', 'lot_size'];

async function renderShares() {
  const page = shell('shares');
  page.innerHTML = `
    <div id="announce"></div>
    <div class="page-head"><div><h1>${t('shares')}</h1><div class="muted small">${t('tagline')}</div></div></div>
    <div class="filters">
      <input class="input search" id="q" type="search" placeholder="${t('search')}" value="${esc(filterState.q)}">
      ${STATUSES.map(s => `<button class="chip ${filterState.status === s ? 'on' : ''}" data-st="${s}">${s === 'all' ? t('all') : t('st_' + s)}</button>`).join('')}
    </div>
    <div class="card"><div class="table-wrap" id="list"><div class="empty"><div class="spinner"></div></div></div></div>`;
  renderAnnounce();
  api.presence.update({ page: 'Share list', share: null });

  let shares = [];
  const draw = () => {
    const q = filterState.q.trim().toLowerCase();
    const rows = shares.filter(s => (filterState.status === 'all' || s.status === filterState.status) &&
                                    (!q || s.name.toLowerCase().includes(q)));
    const list = $('#list'); if (!list) return;
    if (!rows.length) { list.innerHTML = `<div class="empty">${t('no_shares')}</div>`; return; }
    list.innerHTML = `<table class="tbl stack">
      <thead><tr>
        <th>${t('col_share')}</th><th>${t('col_date')}</th><th class="num">${t('col_price')}</th>
        <th class="num">${t('col_issue')}</th><th class="num">${t('col_gmp')}</th><th>${t('col_allot')}</th>
        <th>${t('col_listing')}</th><th class="num">${t('col_lot')}</th>
        <th class="num">${t('col_profit_retail')}</th><th class="num">${t('col_profit_hni')}</th><th></th>
      </tr></thead>
      <tbody>${rows.map(s => {
        const pct = s.price > 0 ? (s.gmp / s.price * 100) : null;
        const canTrade = s.trading_enabled && settings?.trading_enabled !== false;
        return `<tr>
          <td class="full" data-label="${t('col_share')}"><div class="share-name">${esc(s.name)}</div><span class="status ${esc(s.status)}">${t('st_' + s.status)}</span></td>
          <td data-label="${t('col_date')}">${fmtShortDate(s.open_date)}${s.close_date ? ' – ' + fmtShortDate(s.close_date) : ''}</td>
          <td class="num mono" data-label="${t('col_price')}" data-cell="${s.id}-price">${inr(s.price)}</td>
          <td class="num mono" data-label="${t('col_issue')}">${s.issue_size_cr != null ? inr(s.issue_size_cr) + ' ' + t('cr') : '—'}</td>
          <td class="num mono" data-label="${t('col_gmp')}" data-cell="${s.id}-gmp"><span class="gmp-val ${s.gmp < 0 ? 'neg' : ''}">${inr(s.gmp)}</span>${pct !== null ? ` <span class="muted small">(${pct.toFixed(1)}%)</span>` : ''}</td>
          <td data-label="${t('col_allot')}">${fmtShortDate(s.allotment_date)}</td>
          <td data-label="${t('col_listing')}">${fmtShortDate(s.listing_date)}</td>
          <td class="num mono" data-label="${t('col_lot')}" data-cell="${s.id}-lot_size">${num(s.lot_size)}</td>
          <td class="num mono" data-label="${t('col_profit_retail')}" data-cell="${s.id}-profit_retail">${inr(s.profit_retail)}${s.retail_lots > 1 ? `<div class="muted small">${s.retail_lots} ${t('lots')}</div>` : ''}</td>
          <td class="num mono" data-label="${t('col_profit_hni')}" data-cell="${s.id}-profit_hni">${inr(s.profit_hni)}<div class="muted small">${s.hni_lots} ${t('lots')}</div></td>
          <td class="action full right">${canTrade
            ? `<a class="btn btn-primary btn-sm" href="#/trade/${s.id}">${t('trade')} →</a>`
            : `<button class="btn btn-sm" disabled>${t('trading_closed')}</button>`}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
    // flash what changed since last time
    rows.forEach(s => {
      const prev = prevShares.get(s.id);
      if (prev) WATCH_FIELDS.forEach(f => {
        if (prev[f] !== s[f]) flashEl($(`[data-cell="${s.id}-${f}"]`), (+s[f]) - (+prev[f]));
      });
    });
    shares.forEach(s => prevShares.set(s.id, { ...s }));
  };
  const load = async () => {
    try { shares = await api.shares.list(); draw(); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  $('#q').oninput = debounce(e => { filterState.q = e.target.value; draw(); }, 120);
  $$('.chip[data-st]').forEach(c => c.onclick = () => {
    filterState.status = c.dataset.st;
    $$('.chip[data-st]').forEach(x => x.classList.toggle('on', x === c)); draw();
  });
  onSettingsChange = draw;
  await load();
  pageUnsubs.push(api.subscribe('shares', debounce(load, 120)));
}

// --------------------------------------------------------------- page 3: trade
async function renderTrade(id) {
  const page = shell('shares');
  page.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
  let share = await api.shares.get(id).catch(() => null);
  if (!share || !share.visible) { toast(t('OP_SHARE_NOT_FOUND'), 'err'); location.hash = '#/shares'; return; }
  api.presence.update({ page: 'Trade', share: share.name });

  page.innerHTML = `
    <div class="trade">
      <div id="announce"></div>
      <a href="#/shares" class="btn btn-ghost btn-sm">← ${t('back')}</a>
      <div class="card" style="margin-top:10px">
        <div class="trade-head">
          <span class="status" id="tStatus"></span>
          <h1 id="tName"></h1>
          <div class="gmp-box">
            <div><div class="muted small" style="font-weight:700">${t('gmp_live')}</div><div class="gmp-big blink" id="tGmp"></div></div>
            <div class="meta-pills" id="tPills"></div>
          </div>
        </div>
        <div class="trade-body">
          <label class="field" style="margin-bottom:10px"><span>${t('qty')} · ${t('qty_hint')}</span>
            <input class="input qty-input" id="qty" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="${t('qty')}"></label>
          <div class="qty-quick">
            <button class="btn btn-sm" data-q="add">${t('add_lot')}</button>
            <button class="btn btn-sm" data-q="retail">${t('retail_lot')}</button>
            <button class="btn btn-sm" data-q="hni">${t('hni_lot')}</button>
          </div>
          <div class="qty-hint" id="qtyHint"></div>

          <div class="side-row buy">
            <div><div class="side-label">${t('buy_price')}</div>
              <div class="side-price blink" id="bPrice"></div><div class="side-value" id="bVal"></div></div>
            <button class="btn btn-buy btn-lg" id="buyBtn">${t('buy')}</button>
          </div>
          <div class="side-row sell">
            <div><div class="side-label">${t('sell_price')}</div>
              <div class="side-price blink" id="sPrice"></div><div class="side-value" id="sVal"></div></div>
            <button class="btn btn-sell btn-lg" id="sellBtn">${t('sell')}</button>
          </div>
          <p class="disclaimer">${t('prices_live')}</p>
        </div>
      </div>
    </div>`;
  renderAnnounce();

  const qtyEl = $('#qty');
  qtyEl.value = lastQty[id] || share.lot_size;

  const getQty = () => parseInt(qtyEl.value, 10) || 0;
  const paint = (prev) => {
    $('#tName').textContent = share.name;
    const st = $('#tStatus'); st.className = 'status ' + share.status; st.textContent = t('st_' + share.status);
    $('#tGmp').textContent = inr(share.gmp);
    $('#tGmp').classList.toggle('neg', share.gmp < 0);
    $('#tPills').innerHTML = `
      <span class="pill">${t('issue_price')} <b>${inr(share.price)}</b></span>
      <span class="pill">${t('lot_size')} <b>${num(share.lot_size)}</b></span>
      <span class="pill">${t('col_listing')} <b>${fmtShortDate(share.listing_date)}</b></span>`;
    $('#bPrice').textContent = share.buy_price != null ? inr(share.buy_price, 2) : '—';
    $('#sPrice').textContent = share.sell_price != null ? inr(share.sell_price, 2) : '—';
    paintQty();
    if (prev) {
      if (prev.gmp !== share.gmp) flashEl($('#tGmp').parentElement, share.gmp - prev.gmp);
      if (prev.buy_price !== share.buy_price) flashEl($('#bPrice').closest('.side-row'), share.buy_price - prev.buy_price);
      if (prev.sell_price !== share.sell_price) flashEl($('#sPrice').closest('.side-row'), share.sell_price - prev.sell_price);
    }
    const open = share.trading_enabled && share.visible && settings?.trading_enabled !== false;
    $('#buyBtn').disabled = !open || !(share.buy_price > 0);
    $('#sellBtn').disabled = !open || !(share.sell_price > 0);
  };
  const paintQty = () => {
    const q = getQty();
    lastQty[id] = q || '';
    const lots = q / share.lot_size;
    $('#qtyHint').textContent = q ? `= ${Number.isInteger(lots) ? lots : lots.toFixed(2)} ${lots === 1 ? t('lot') : t('lots')}` : '';
    $('#bVal').textContent = q && share.buy_price ? `${t('value')} ${inr(q * share.buy_price, 2)}` : '';
    $('#sVal').textContent = q && share.sell_price ? `${t('value')} ${inr(q * share.sell_price, 2)}` : '';
  };
  qtyEl.addEventListener('input', () => {
    const clean = qtyEl.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
    if (clean !== qtyEl.value) qtyEl.value = clean;
    paintQty();
  });
  $$('[data-q]').forEach(b => b.onclick = () => {
    const k = b.dataset.q;
    qtyEl.value = k === 'add' ? getQty() + share.lot_size
      : k === 'retail' ? share.lot_size * share.retail_lots : share.lot_size * share.hni_lots;
    paintQty();
  });
  $('#buyBtn').onclick = () => placeFlow('buy');
  $('#sellBtn').onclick = () => placeFlow('sell');

  async function placeFlow(side) {
    const q = getQty();
    if (!(q > 0)) { toast(t('enter_qty'), 'err'); qtyEl.focus(); return; }
    const price = side === 'buy' ? share.buy_price : share.sell_price;
    openModal({
      title: t('confirm_title'),
      body: `<p>${t('confirm_body', { side: `<b style="color:var(--${side})">${t(side)}</b>`, qty: num(q),
              share: `<b>${esc(share.name)}</b>`, price: inr(price, 2), value: inr(q * price, 2) })}</p>`,
      actions: [
        { label: t('cancel') },
        { label: t('confirm_yes'), cls: side === 'buy' ? 'btn-buy' : 'btn-sell', onClick: async (b) => {
            b.disabled = true;
            try { const o = await api.orders.place(share.id, side, q, price); watchOrder(o); return false; }
            catch (e) {
              toast(errMsg(e), 'err', 5000);
              if (e.code === 'OP_ORDER_PENDING') checkPendingResume();
              if (e.code === 'OP_PRICE_CHANGED') refresh();
            }
          } },
      ],
    });
  }

  const refresh = async () => {
    const prev = share;
    const fresh = await api.shares.get(id).catch(() => null);
    if (!fresh || !fresh.visible) { if ($('#tName')) { toast(t('OP_SHARE_NOT_FOUND'), 'err'); location.hash = '#/shares'; } return; }
    share = fresh;
    if ($('#tName')) paint(prev);
  };
  onSettingsChange = () => $('#tName') && paint();
  paint();
  qtyEl.focus();
  pageUnsubs.push(api.subscribe('shares', debounce(refresh, 80), `id=eq.${id}`));
}

async function checkPendingResume() {
  try { const p = (await api.orders.mine()).find(o => o.status === 'pending'); if (p) watchOrder(p); } catch {}
}

// --------------------------------------------------------------- waiting for admin
function stopWatching() { clearInterval(waitTimer); clearInterval(pollTimer); waitTimer = pollTimer = null; activeOrder = null; }

function watchOrder(o) {
  stopWatching();
  activeOrder = o;
  api.presence.update({ page: 'Waiting for confirmation', share: o.share_name });
  const timeout = settings?.order_timeout_seconds || 0;
  const created = new Date(o.created_at).getTime();
  openModal({
    title: t('waiting_title'), dismissable: false,
    body: `<div class="spinner"></div>
      <p class="center">${t('waiting_body')}</p>
      <p class="center" style="margin:0"><span class="order-side ${o.side}">${t(o.side)}</span>
        <b>${num(o.qty)}</b> × ${esc(o.share_name)} @ <b class="mono">${inr(o.price, 2)}</b></p>
      <div class="countdown" id="cd"></div>`,
    actions: [{ label: t('withdraw'), cls: 'btn-ghost', onClick: async (b) => {
      b.disabled = true;
      try { await api.orders.cancel(o.id); } catch (e) { toast(errMsg(e), 'err'); }
      await checkOrder(); return false;
    } }],
  });
  const tick = () => {
    const cd = $('#cd'); if (!cd) return;
    if (!timeout) { cd.textContent = ''; return; }
    const left = Math.max(0, Math.ceil(timeout - (Date.now() - created) / 1000));
    cd.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    if (left <= 0) api.expireStale().then(checkOrder);
  };
  tick();
  waitTimer = setInterval(tick, 1000);
  pollTimer = setInterval(checkOrder, 8000); // safety net if a live update is missed
}

async function checkOrder() {
  if (!activeOrder) return;
  const o = await api.orders.get(activeOrder.id).catch(() => null);
  if (!o || o.status === 'pending' || !activeOrder || o.id !== activeOrder.id) return;
  stopWatching();
  finishOrder(o);
}

function finishOrder(o) {
  const vars = {
    side: t(o.side), side_lc: getLang() === 'en' ? t(o.side + '_price').toLowerCase() : t(o.side + '_price'),
    qty: num(o.qty), share: `<b>${esc(o.share_name)}</b>`,
    price: inr(o.status === 'countered' ? o.counter_price : o.price, 2), value: inr(o.qty * o.price, 2),
  };
  const note = o.admin_note ? `<p class="small"><b>${t('note_from_admin')}:</b> ${esc(o.admin_note)}</p>` : '';
  api.presence.update({ page: 'Trade', share: o.share_name });
  if (o.status === 'accepted') {
    openModal({ kind: 'ok', title: t('accepted_title'),
      body: `<div class="result-icon ok">✓</div><p class="center">${t('accepted_body', vars)}</p>${note}<p class="center muted small mono">${fmtDateTime(o.responded_at)}</p>`,
      actions: [{ label: t('view_txns'), onClick: () => { location.hash = '#/txns'; } }, { label: t('ok'), cls: 'btn-primary' }] });
  } else if (o.status === 'countered') {
    if (location.hash !== '#/trade/' + o.share_id && o.share_id) location.hash = '#/trade/' + o.share_id;
    openModal({ kind: 'warn', title: t('countered_title'),
      body: `<div class="result-icon warn">↻</div><p class="center">${t('countered_body', vars)}</p>${note}`,
      actions: [{ label: t('revise'), cls: 'btn-primary' }] });
  } else if (o.status === 'rejected') {
    location.hash = '#/shares';
    openModal({ kind: 'bad', title: t('rejected_title'),
      body: `<div class="result-icon bad">✕</div><p class="center">${t('rejected_body')}</p>${note}`,
      actions: [{ label: t('ok'), cls: 'btn-primary' }] });
  } else if (o.status === 'expired') {
    openModal({ kind: 'warn', title: t('expired_title'),
      body: `<div class="result-icon warn">⌛</div><p class="center">${t('expired_body')}</p>`,
      actions: [{ label: t('ok'), cls: 'btn-primary' }] });
  } else if (o.status === 'cancelled') {
    closeModal(); toast(t('cancelled'));
  }
}

// --------------------------------------------------------------- my transactions
let txnTab = 'ledger';
async function renderTxns() {
  const page = shell('txns');
  api.presence.update({ page: 'My transactions', share: null });
  page.innerHTML = `
    <div class="page-head"><div><h1>${t('my_txns')}</h1><div class="muted small mono">${esc(me.email)}</div></div>
      <div class="grow"></div><button class="btn btn-sm" id="csv">⬇ ${t('download_csv')}</button></div>
    <div class="stats" id="stats"></div>
    <div class="card"><div class="panel-head"><h2>${t('holdings')}</h2></div><div class="table-wrap" id="holdings"></div></div>
    <div class="sub-tabs"><button data-t="ledger">${t('ledger')}</button><button data-t="orders">${t('orders_tab')}</button></div>
    <div class="card"><div class="table-wrap" id="txList"><div class="empty"><div class="spinner"></div></div></div></div>`;

  let ledger = [], orders = [];
  const draw = () => {
    if (!$('#stats')) return;
    const credit = ledger.reduce((a, l) => a + +l.amount_credit, 0);
    const debit = ledger.reduce((a, l) => a + +l.amount_debit, 0);
    const bal = credit - debit;
    $('#stats').innerHTML = `
      <div class="card stat"><div class="k">${t('net_balance')}</div><div class="v ${bal >= 0 ? 'pos' : 'neg'}">${inr(bal, 2)}</div></div>
      <div class="card stat"><div class="k">${t('total_bought')}</div><div class="v">${inr(debit, 2)}</div></div>
      <div class="card stat"><div class="k">${t('total_sold')}</div><div class="v">${inr(credit, 2)}</div></div>
      <div class="card stat"><div class="k">${t('trades_count')}</div><div class="v">${num(ledger.length)}</div></div>`;

    const hold = new Map();
    ledger.forEach(l => {
      const h = hold.get(l.share_name) || { b: 0, s: 0, bv: 0, sv: 0 };
      h.b += +l.qty_credit; h.s += +l.qty_debit; h.bv += +l.amount_debit; h.sv += +l.amount_credit;
      hold.set(l.share_name, h);
    });
    $('#holdings').innerHTML = hold.size ? `<table class="tbl"><thead><tr>
        <th>${t('col_share')}</th><th class="num">${t('bought_qty')}</th><th class="num">${t('sold_qty')}</th>
        <th class="num">${t('net_qty')}</th><th class="num">${t('amt_dr')}</th><th class="num">${t('amt_cr')}</th></tr></thead><tbody>
        ${[...hold.entries()].map(([n, h]) => `<tr><td class="share-name">${esc(n)}</td><td class="num mono">${num(h.b)}</td>
          <td class="num mono">${num(h.s)}</td><td class="num mono"><b>${num(h.b - h.s)}</b></td>
          <td class="num mono dr">${inr(h.bv, 2)}</td><td class="num mono crd">${inr(h.sv, 2)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${t('no_txns')}</div>`;

    $$('.sub-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === txnTab));
    const box = $('#txList');
    if (txnTab === 'ledger') {
      box.innerHTML = ledger.length ? `<table class="tbl"><thead><tr>
          <th>${t('when')}</th><th>${t('particulars')}</th><th class="num">${t('qty_dr')}</th><th class="num">${t('qty_cr')}</th>
          <th class="num">${t('amt_dr')}</th><th class="num">${t('amt_cr')}</th><th class="num">${t('balance')}</th></tr></thead><tbody>
          ${ledger.slice().reverse().map(l => `<tr>
            <td class="small mono" style="white-space:nowrap">${fmtDateTime(l.created_at)}</td>
            <td>${l.side === 'buy' ? t('bought') : t('sold')} ${num(l.qty)} × <b>${esc(l.share_name)}</b> @ <span class="mono">${inr(l.price, 2)}</span></td>
            <td class="num mono dr">${+l.qty_debit ? num(l.qty_debit) : ''}</td>
            <td class="num mono crd">${+l.qty_credit ? num(l.qty_credit) : ''}</td>
            <td class="num mono dr">${+l.amount_debit ? inr(l.amount_debit, 2) : ''}</td>
            <td class="num mono crd">${+l.amount_credit ? inr(l.amount_credit, 2) : ''}</td>
            <td class="num mono"><b>${inr(l.balance, 2)}</b></td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">${t('no_txns')}</div>`;
    } else {
      box.innerHTML = orders.length ? `<table class="tbl"><thead><tr>
          <th>${t('when')}</th><th>${t('col_share')}</th><th>${t('side')}</th><th class="num">${t('qty')}</th>
          <th class="num">${t('price')}</th><th>${t('status')}</th></tr></thead><tbody>
          ${orders.map(o => `<tr>
            <td class="small mono" style="white-space:nowrap">${fmtDateTime(o.created_at)}</td>
            <td class="share-name">${esc(o.share_name)}</td>
            <td><span class="order-side ${o.side}">${t(o.side)}</span></td>
            <td class="num mono">${num(o.qty)}</td>
            <td class="num mono">${inr(o.price, 2)}${o.counter_price ? `<div class="small muted">→ ${inr(o.counter_price, 2)}</div>` : ''}</td>
            <td><span class="status ${o.status}">${t('s_' + o.status)}</span></td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">${t('no_orders')}</div>`;
    }
  };
  const load = async () => {
    try { [ledger, orders] = await Promise.all([api.ledger.mine(), api.orders.mine()]); draw(); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  $$('.sub-tabs button').forEach(b => b.onclick = () => { txnTab = b.dataset.t; draw(); });
  $('#csv').onclick = () => downloadCSV(`orderpulse-ledger-${me.email}.csv`, ledger, [
    { label: 'Date & time (IST)', get: r => fmtDateTime(r.created_at) },
    { label: 'Share', key: 'share_name' }, { label: 'Side', key: 'side' }, { label: 'Qty', key: 'qty' },
    { label: 'Price', key: 'price' }, { label: 'Qty Debit', key: 'qty_debit' }, { label: 'Qty Credit', key: 'qty_credit' },
    { label: 'Amount Debit', key: 'amount_debit' }, { label: 'Amount Credit', key: 'amount_credit' },
    { label: 'Balance', key: 'balance' }, { label: 'Order #', key: 'order_id' },
  ]);
  await load();
  const re = debounce(load, 150);
  pageUnsubs.push(api.subscribe('ledger', re, `user_id=eq.${me.id}`));
  pageUnsubs.push(api.subscribe('orders', re, `user_id=eq.${me.id}`));
}

boot();
