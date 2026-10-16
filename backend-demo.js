// DEMO backend: same functions as the live one, but data lives in this browser.
// Open the user app and admin panel in two tabs of the same browser to see
// live updates and online status working between them.
//   Demo admin:  admin@demo.com / admin123
//   Demo user:   user@demo.com  / user123

function createDemoBackend() {
const KEY = 'orderpulse_demo_db_v1';
const SESSION_KEY = 'orderpulse_demo_session';
const TAB = Math.random().toString(36).slice(2);

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now() + Math.random().toString(16).slice(2));
const now = () => new Date().toISOString();
const iso = d => d.toISOString().slice(0, 10);
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const err = code => { const e = new Error(code); e.code = code; return e; };

function profit(s) {
  return { ...s,
    profit_retail: +(s.gmp * s.lot_size * s.retail_lots).toFixed(2),
    profit_hni: +(s.gmp * s.lot_size * s.hni_lots).toFixed(2) };
}

function seed() {
  const adminId = uid(), userId = uid();
  const t = now();
  return {
    seq: { shares: 3, orders: 0, ledger: 0, audit: 0 },
    users: [
      { id: adminId, email: 'admin@demo.com', password: 'admin123', full_name: 'Demo Admin', role: 'admin', status: 'approved', created_at: t, approved_at: t, last_seen: null },
      { id: userId, email: 'user@demo.com', password: 'user123', full_name: 'Demo User', role: 'user', status: 'approved', created_at: t, approved_at: t, last_seen: null },
    ],
    settings: { id: 1, order_timeout_seconds: 120, trading_enabled: true, announcement: '', updated_at: t },
    shares: [
      { id: 1, name: 'Sample: Aarav Infra Ltd', status: 'open', open_date: addDays(0), close_date: addDays(2), price: 126, issue_size_cr: 1200, gmp: 45, buy_price: 47, sell_price: 43, lot_size: 119, retail_lots: 1, hni_lots: 14, allotment_date: addDays(3), listing_date: addDays(5), trading_enabled: true, visible: true, sort_order: 1, notes: '', created_at: t, updated_at: t },
      { id: 2, name: 'Sample: Nilgiri Foods Ltd', status: 'upcoming', open_date: addDays(3), close_date: addDays(5), price: 310, issue_size_cr: 540, gmp: 22, buy_price: 24, sell_price: 20, lot_size: 48, retail_lots: 1, hni_lots: 14, allotment_date: addDays(6), listing_date: addDays(8), trading_enabled: true, visible: true, sort_order: 2, notes: '', created_at: t, updated_at: t },
      { id: 3, name: 'Sample: Vayu Green Energy', status: 'closed', open_date: addDays(-3), close_date: addDays(-1), price: 92, issue_size_cr: 2350, gmp: 18, buy_price: 19, sell_price: 16, lot_size: 160, retail_lots: 1, hni_lots: 13, allotment_date: addDays(1), listing_date: addDays(3), trading_enabled: true, visible: true, sort_order: 3, notes: '', created_at: t, updated_at: t },
    ],
    orders: [], ledger: [], audit: [], reports: [],
  };
}

let db = null;
function load() {
  try { db = JSON.parse(ls.get(KEY)); } catch { db = null; }
  if (!db || !db.users) { db = seed(); ls.set(KEY, JSON.stringify(db)); }
  return db;
}
load();

const bc = 'BroadcastChannel' in window ? new BroadcastChannel('orderpulse-demo') : null;
const subs = new Set();
function emit(table) { subs.forEach(s => { if (s.table === table) s.cb({ table }); }); }
function save(...tables) {
  ls.set(KEY, JSON.stringify(db));
  tables.forEach(t => { emit(t); bc && bc.postMessage({ type: 'change', table: t }); });
}
if (bc) bc.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'change') { load(); emit(m.table); }
  else if (m.type === 'auth') { authCbs.forEach(f => f('CHANGE')); }
  else presenceMsg(m);
};
window.addEventListener('storage', e => { if (e.key === KEY) load(); });

function audit(actor, action, entity, entity_id, details = {}) {
  const u = db.users.find(x => x.id === actor);
  db.audit.push({ id: ++db.seq.audit, ts: now(), actor, actor_email: u?.email || 'system', action, entity, entity_id: String(entity_id ?? ''), details });
}
function diff(a, b) {
  const d = {};
  for (const k of Object.keys(b)) if (!['updated_at', 'last_seen', 'profit_retail', 'profit_hni'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) d[k] = { from: a[k], to: b[k] };
  return d;
}

const authCbs = new Set();
const sessionUser = () => { load(); return db.users.find(u => u.id === ss.get(SESSION_KEY)) || null; };
const isAdmin = () => { const u = sessionUser(); return u && u.role === 'admin' && u.status === 'approved'; };
const needAdmin = () => { if (!isAdmin()) throw err('OP_NOT_ADMIN'); };

function expireStale() {
  const to = db.settings.order_timeout_seconds;
  if (!to) return 0;
  let n = 0;
  db.orders.forEach(o => {
    if (o.status === 'pending' && Date.now() - new Date(o.created_at) > to * 1000) { o.status = 'expired'; o.responded_at = now(); n++; }
  });
  if (n) save('orders');
  return n;
}

function ledgerView(rows) {
  const bal = {}, hold = {};
  return rows.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id))
    .map(l => {
      const u = db.users.find(x => x.id === l.user_id) || {};
      bal[l.user_id] = (bal[l.user_id] || 0) + l.amount_credit - l.amount_debit;
      const hk = l.user_id + '|' + l.share_name;
      hold[hk] = (hold[hk] || 0) + l.qty_credit - l.qty_debit;
      return { ...l, email: u.email, full_name: u.full_name, balance: +bal[l.user_id].toFixed(2), share_holding: hold[hk] };
    });
}

// ---------- presence over BroadcastChannel ----------
const peers = new Map(); // tab -> {meta, ts}
let myMeta = null;
const pCbs = new Set();
function presenceList() {
  const cutoff = Date.now() - 7000;
  for (const [k, v] of peers) if (v.ts < cutoff) peers.delete(k);
  const all = [...peers.values()].map(v => v.meta);
  if (myMeta) all.push(myMeta);
  const byUser = new Map();
  all.forEach(m => {
    const cur = byUser.get(m.user_id);
    if (!cur) byUser.set(m.user_id, { ...m, key: m.user_id, sessions: 1 });
    else { const latest = cur.at > m.at ? cur : m; byUser.set(m.user_id, { ...latest, key: m.user_id, sessions: cur.sessions + 1 }); }
  });
  return [...byUser.values()];
}
const firePresence = () => { const l = presenceList(); pCbs.forEach(f => f(l)); };
function presenceMsg(m) {
  if (m.type === 'hb') { peers.set(m.tab, { meta: m.meta, ts: Date.now() }); firePresence(); }
  else if (m.type === 'bye') { peers.delete(m.tab); firePresence(); }
  else if (m.type === 'hello' && myMeta) bc.postMessage({ type: 'hb', tab: TAB, meta: myMeta });
}
setInterval(() => { if (myMeta && bc) bc.postMessage({ type: 'hb', tab: TAB, meta: myMeta }); firePresence(); }, 2500);
window.addEventListener('beforeunload', () => { if (bc && myMeta) bc.postMessage({ type: 'bye', tab: TAB }); });

const delay = (ms = 60) => new Promise(r => setTimeout(r, ms));

function __makeDemoApi() {
  const api = {
    demo: true,
    auth: {
      async session() { const u = sessionUser(); return u ? { user: { id: u.id, email: u.email } } : null; },
      async checkEmail(email) { await delay(); const u = db.users.find(x => x.email === email.trim().toLowerCase()); return u ? u.status : 'none'; },
      async signIn(email, password) {
        await delay(200); load();
        const u = db.users.find(x => x.email === email.trim().toLowerCase());
        if (!u || u.password !== password) throw err('OP_BAD_LOGIN');
        ss.set(SESSION_KEY, u.id); authCbs.forEach(f => f('SIGNED_IN'));
      },
      async signUp(email, password, name) {
        await delay(200); load();
        email = email.trim().toLowerCase();
        if (db.users.find(x => x.email === email)) throw err('OP_EMAIL_EXISTS');
        const u = { id: uid(), email, password, full_name: name || null, role: 'user', status: 'pending', created_at: now(), approved_at: null, last_seen: null };
        db.users.push(u); audit(u.id, 'signup', 'profiles', u.id); save('profiles');
        ss.set(SESSION_KEY, u.id); authCbs.forEach(f => f('SIGNED_IN'));
        return { needsConfirm: false };
      },
      async signOut() { await api.presence.leave(); ss.set(SESSION_KEY, null); authCbs.forEach(f => f('SIGNED_OUT')); },
      async resetPassword() { await delay(); },
      async updatePassword(pw) { const u = sessionUser(); if (u) { u.password = pw; save('profiles'); } },
      onChange(cb) { authCbs.add(cb); return () => authCbs.delete(cb); },
    },
    async me() { const u = sessionUser(); if (!u) return null; const { password, ...p } = u; return p; },
    async settings() { load(); return { ...db.settings }; },

    shares: {
      async list() {
        load(); const u = sessionUser();
        if (!u || u.status !== 'approved') return [];
        return db.shares.filter(s => s.visible).map(profit)
          .sort((a, b) => a.sort_order - b.sort_order || String(b.open_date).localeCompare(String(a.open_date)));
      },
      async get(id) { load(); const s = db.shares.find(x => x.id === +id); return s ? profit(s) : null; },
    },

    orders: {
      async place(shareId, side, qty, expectedPrice) {
        await delay(150); load();
        const u = sessionUser();
        if (!u) throw err('OP_NOT_SIGNED_IN');
        if (u.status !== 'approved') throw err('OP_NOT_APPROVED');
        if (!db.settings.trading_enabled) throw err('OP_TRADING_PAUSED');
        if (!(qty > 0)) throw err('OP_BAD_QTY');
        const s = db.shares.find(x => x.id === +shareId);
        if (!s || !s.visible) throw err('OP_SHARE_NOT_FOUND');
        if (!s.trading_enabled) throw err('OP_SHARE_CLOSED');
        const price = side === 'buy' ? s.buy_price : s.sell_price;
        if (!(price > 0)) throw err('OP_NO_PRICE');
        if (expectedPrice != null && +expectedPrice !== +price) throw err('OP_PRICE_CHANGED');
        expireStale();
        if (db.orders.some(o => o.user_id === u.id && o.status === 'pending')) throw err('OP_ORDER_PENDING');
        const o = { id: ++db.seq.orders, user_id: u.id, share_id: s.id, share_name: s.name, side, qty: +qty, price: +price, gmp: s.gmp,
                    status: 'pending', counter_price: null, admin_note: null, created_at: now(), responded_at: null, responded_by: null };
        db.orders.push(o);
        audit(u.id, 'order_placed', 'orders', o.id, { share: s.name, side, qty, price });
        save('orders');
        return { ...o };
      },
      async cancel(id) {
        load(); const u = sessionUser();
        const o = db.orders.find(x => x.id === +id && x.user_id === u?.id && x.status === 'pending');
        if (o) { o.status = 'cancelled'; o.responded_at = now(); audit(u.id, 'order_cancelled', 'orders', o.id); save('orders'); }
        return o ? { ...o } : null;
      },
      async mine() { load(); const u = sessionUser(); return db.orders.filter(o => o.user_id === u?.id).sort((a, b) => b.id - a.id); },
      async get(id) { load(); const u = sessionUser(); const o = db.orders.find(x => x.id === +id); return o && (o.user_id === u?.id || isAdmin()) ? { ...o } : null; },
    },

    ledger: { async mine() { load(); const u = sessionUser(); return ledgerView(db.ledger.filter(l => l.user_id === u?.id)); } },

    subscribe(table, cb) { const s = { table, cb }; subs.add(s); return () => subs.delete(s); },
    onStatus(cb) { cb('live'); return () => {}; },

    presence: {
      async join(meta) {
        const u = sessionUser(); if (!u) return;
        myMeta = { ...(myMeta || {}), ...meta, user_id: u.id, email: u.email, since: myMeta?.since || now(), at: now() };
        if (bc) { bc.postMessage({ type: 'hello', tab: TAB }); bc.postMessage({ type: 'hb', tab: TAB, meta: myMeta }); }
        firePresence();
      },
      async update(meta) { if (myMeta) { myMeta = { ...myMeta, ...meta, at: now() }; bc && bc.postMessage({ type: 'hb', tab: TAB, meta: myMeta }); firePresence(); } },
      onSync(cb) { pCbs.add(cb); cb(presenceList()); return () => pCbs.delete(cb); },
      async leave() { if (myMeta) { bc && bc.postMessage({ type: 'bye', tab: TAB }); myMeta = null; firePresence(); } },
    },

    async heartbeat() { const u = sessionUser(); if (u) { u.last_seen = now(); ls.set(KEY, JSON.stringify(db)); } },
    async expireStale() { load(); expireStale(); },

    admin: {
      async users() { needAdmin(); return db.users.map(({ password, ...p }) => p).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); },
      async setUserStatus(id, status) {
        needAdmin(); const me = sessionUser();
        if (id === me.id) throw err('OP_CANNOT_CHANGE_SELF');
        const u = db.users.find(x => x.id === id); if (!u) return null;
        const before = { ...u };
        u.status = status; if (status === 'approved') u.approved_at = now();
        audit(me.id, 'update', 'profiles', id, diff(before, u)); save('profiles');
        authCbs.forEach(f => f('CHANGE')); bc && bc.postMessage({ type: 'auth' });
        return u;
      },
      async orders({ userId, status, from, to } = {}) {
        needAdmin(); load();
        return db.orders.filter(o => (!userId || o.user_id === userId) && (!status || o.status === status) &&
            (!from || o.created_at >= from) && (!to || o.created_at < to))
          .map(o => { const u = db.users.find(x => x.id === o.user_id) || {}; return { ...o, profile: { email: u.email, full_name: u.full_name } }; })
          .sort((a, b) => b.id - a.id);
      },
      async respond(orderId, action, newPrice, note) {
        needAdmin(); load(); const me = sessionUser();
        const o = db.orders.find(x => x.id === +orderId);
        if (!o) throw err('OP_ORDER_NOT_FOUND');
        if (o.status !== 'pending') throw err('OP_ALREADY_HANDLED');
        const tables = ['orders'];
        if (action === 'accept') {
          Object.assign(o, { status: 'accepted', responded_at: now(), responded_by: me.id, admin_note: note || null });
          const amt = +(o.qty * o.price).toFixed(2);
          db.ledger.push({ id: ++db.seq.ledger, user_id: o.user_id, order_id: o.id, share_id: o.share_id, share_name: o.share_name, side: o.side,
            qty: o.qty, price: o.price, amount: amt,
            qty_debit: o.side === 'sell' ? o.qty : 0, qty_credit: o.side === 'buy' ? o.qty : 0,
            amount_debit: o.side === 'buy' ? amt : 0, amount_credit: o.side === 'sell' ? amt : 0, created_at: now() });
          tables.push('ledger');
        } else if (action === 'counter') {
          if (!(newPrice > 0)) throw err('OP_BAD_PRICE');
          const s = db.shares.find(x => x.id === o.share_id);
          if (s) { const before = { ...s }; s[o.side === 'buy' ? 'buy_price' : 'sell_price'] = +newPrice; s.updated_at = now(); audit(me.id, 'update', 'shares', s.id, diff(before, s)); tables.push('shares'); }
          Object.assign(o, { status: 'countered', counter_price: +newPrice, responded_at: now(), responded_by: me.id, admin_note: note || null });
        } else if (action === 'reject') {
          Object.assign(o, { status: 'rejected', responded_at: now(), responded_by: me.id, admin_note: note || null });
        } else throw err('OP_BAD_ACTION');
        audit(me.id, 'order_' + action, 'orders', o.id, { user_id: o.user_id, share: o.share_name, side: o.side, qty: o.qty, price: o.price, new_price: newPrice ?? null });
        save(...tables);
        return { ...o };
      },
      async shares() { needAdmin(); load(); return db.shares.map(profit).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id); },
      async saveShare(s) {
        needAdmin(); load(); const me = sessionUser();
        const row = { ...s }; ['profit_retail', 'profit_hni', '_dirty'].forEach(k => delete row[k]);
        if (row.id) {
          const cur = db.shares.find(x => x.id === row.id); const before = { ...cur };
          Object.assign(cur, row, { updated_at: now() });
          audit(me.id, 'update', 'shares', cur.id, diff(before, cur)); save('shares'); return profit(cur);
        }
        const n = { trading_enabled: true, visible: true, sort_order: 0, retail_lots: 1, hni_lots: 14, lot_size: 1, gmp: 0, status: 'open', ...row,
                    id: ++db.seq.shares, created_at: now(), updated_at: now() };
        db.shares.push(n); audit(me.id, 'insert', 'shares', n.id, { created: n }); save('shares'); return profit(n);
      },
      async deleteShare(id) {
        needAdmin(); const me = sessionUser();
        const s = db.shares.find(x => x.id === id);
        db.shares = db.shares.filter(x => x.id !== id);
        db.orders.forEach(o => { if (o.share_id === id) o.share_id = null; });
        audit(me.id, 'delete', 'shares', id, { deleted: s }); save('shares');
      },
      async ledger(userId) { needAdmin(); load(); return ledgerView(db.ledger.filter(l => !userId || l.user_id === userId)); },
      async audit(limit = 500) { needAdmin(); load(); return db.audit.slice().reverse().slice(0, limit); },
      async reports() { needAdmin(); load(); return db.reports.slice().sort((a, b) => (a.report_date < b.report_date ? 1 : -1)); },
      async generateReport(date) {
        needAdmin(); load();
        const from = new Date(date + 'T00:00:00+05:30').toISOString();
        const to = new Date(new Date(date + 'T00:00:00+05:30').getTime() + 864e5).toISOString();
        const inR = d => d && d >= from && d < to;
        const os = db.orders.filter(o => inR(o.created_at));
        const ls_ = db.ledger.filter(l => inR(l.created_at));
        const cnt = st => os.filter(o => o.status === st).length;
        const sum = (arr, k) => +arr.reduce((a, r) => a + (+r[k] || 0), 0).toFixed(2);
        const group = (keyFn, extra) => {
          const m = new Map();
          ls_.forEach(l => { const k = keyFn(l); (m.get(k) || m.set(k, []).get(k)).push(l); });
          return [...m.entries()].map(([k, arr]) => ({ ...extra(k, arr), trades: arr.length,
            buy_qty: sum(arr, 'qty_credit'), buy_value: sum(arr, 'amount_debit'), sell_qty: sum(arr, 'qty_debit'), sell_value: sum(arr, 'amount_credit') }));
        };
        const data = {
          orders: { total: os.length, accepted: cnt('accepted'), countered: cnt('countered'), rejected: cnt('rejected'), expired: cnt('expired'), cancelled: cnt('cancelled'), pending: cnt('pending') },
          trades: { count: ls_.length, buy_qty: sum(ls_, 'qty_credit'), buy_value: sum(ls_, 'amount_debit'), sell_qty: sum(ls_, 'qty_debit'), sell_value: sum(ls_, 'amount_credit') },
          by_share: group(l => l.share_name, k => ({ share_name: k })),
          by_user: group(l => l.user_id, k => { const u = db.users.find(x => x.id === k) || {}; return { email: u.email, name: u.full_name }; }),
          new_signups: db.users.filter(u => inR(u.created_at)).length,
          active_users: new Set(os.map(o => o.user_id)).size,
          seen_users: db.users.filter(u => inR(u.last_seen)).length,
          pending_approvals: db.users.filter(u => u.status === 'pending').length,
          total_users: db.users.length,
        };
        const r = { report_date: date, generated_at: now(), data };
        db.reports = db.reports.filter(x => x.report_date !== date).concat(r);
        save('daily_reports'); return r;
      },
      async saveSettings(s) {
        needAdmin(); const me = sessionUser(); const before = { ...db.settings };
        Object.assign(db.settings, s, { id: 1, updated_at: now() });
        audit(me.id, 'update', 'app_settings', 1, diff(before, db.settings)); save('app_settings'); return { ...db.settings };
      },
      async resetDemo() { db = seed(); save('shares', 'orders', 'ledger', 'profiles', 'app_settings', 'daily_reports'); },
    },
  };
  // demo auto-expiry (the real app uses a database scheduler)
  setInterval(() => { load(); expireStale(); }, 5000);
  return api;
}

  return __makeDemoApi();
}
