// Live backend: Supabase (free tier) — database, login, realtime, presence.

function normErr(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  const err = new Error(m);
  const op = m.match(/OP_[A-Z_]+/);
  if (op) err.code = op[0];
  else if (/invalid login credentials/i.test(m)) err.code = 'OP_BAD_LOGIN';
  else if (/already registered|already been registered/i.test(m)) err.code = 'OP_EMAIL_EXISTS';
  else if (/email not confirmed/i.test(m)) err.code = 'OP_EMAIL_NOT_CONFIRMED';
  else if (/rate limit|too many/i.test(m)) err.code = 'OP_RATE_LIMIT';
  else if (/failed to fetch|network/i.test(m)) err.code = 'OP_NETWORK';
  return err;
}
const unwrap = ({ data, error }) => { if (error) throw normErr(error); return data; };

function createSupabaseBackend(cfg) {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Could not load the Supabase library. Check your internet connection and reload.');
  }
  // accept the URL even if it was pasted with /rest/v1/ or a trailing slash
  const baseUrl = String(cfg.SUPABASE_URL).trim().replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
  const sb = window.supabase.createClient(baseUrl, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  // connection status for the LIVE badge
  const statusCbs = new Set();
  let lastStatus = 'connecting';
  const setStatus = s => { lastStatus = s; statusCbs.forEach(f => f(s)); };

  // presence
  let pCh = null, pMeta = null;
  const pCbs = new Set();

  const api = {
    demo: false,
    raw: sb,

    auth: {
      async session() {
        const { data } = await sb.auth.getSession();
        const s = data.session;
        return s ? { user: { id: s.user.id, email: s.user.email } } : null;
      },
      async checkEmail(email) { return unwrap(await sb.rpc('check_email', { p_email: email })); },
      async signIn(email, password) { unwrap(await sb.auth.signInWithPassword({ email, password })); },
      async signUp(email, password, name) {
        const d = unwrap(await sb.auth.signUp({
          email, password,
          options: { data: { full_name: name || '' }, emailRedirectTo: location.origin + location.pathname },
        }));
        // Supabase returns a user with no identities when the email already exists
        if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) {
          const e = new Error('exists'); e.code = 'OP_EMAIL_EXISTS'; throw e;
        }
        return { needsConfirm: !d.session };
      },
      async signOut() { await api.presence.leave(); await sb.auth.signOut(); },
      async resetPassword(email) {
        unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      },
      async updatePassword(pw) { unwrap(await sb.auth.updateUser({ password: pw })); },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((ev) => cb(ev));
        return () => data.subscription.unsubscribe();
      },
    },

    async me() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      return unwrap(await sb.from('profiles').select('*').eq('id', data.session.user.id).maybeSingle());
    },
    async settings() {
      return unwrap(await sb.from('app_settings').select('*').eq('id', 1).maybeSingle());
    },

    shares: {
      async list() {
        return unwrap(await sb.from('shares').select('*').eq('visible', true)
          .order('sort_order', { ascending: true }).order('open_date', { ascending: false, nullsFirst: false }));
      },
      async get(id) { return unwrap(await sb.from('shares').select('*').eq('id', id).maybeSingle()); },
    },

    orders: {
      async place(shareId, side, qty, expectedPrice) {
        return unwrap(await sb.rpc('place_order', {
          p_share_id: shareId, p_side: side, p_qty: qty, p_expected_price: expectedPrice ?? null }));
      },
      async cancel(id) { return unwrap(await sb.rpc('cancel_my_order', { p_order_id: id })); },
      async mine() {
        return unwrap(await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(1000));
      },
      async get(id) { return unwrap(await sb.from('orders').select('*').eq('id', id).maybeSingle()); },
    },

    ledger: {
      async mine() {
        const { data } = await sb.auth.getSession();
        return unwrap(await sb.from('ledger_view').select('*').eq('user_id', data.session.user.id)
          .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(5000));
      },
    },

    // Listen for any change in a table. cb() is called; the page then refreshes its data.
    subscribe(table, cb, filter) {
      const ch = sb.channel('rt-' + table + '-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
            payload => cb(payload))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') setStatus('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setStatus('down');
        });
      return () => sb.removeChannel(ch);
    },
    onStatus(cb) { statusCbs.add(cb); cb(lastStatus); return () => statusCbs.delete(cb); },

    presence: {
      async join(meta) {
        const s = await api.auth.session();
        if (!s) return;
        pMeta = { ...(pMeta || {}), ...meta, user_id: s.user.id, email: s.user.email,
                  since: pMeta?.since || new Date().toISOString(), at: new Date().toISOString() };
        if (pCh) { await pCh.track(pMeta); return; }
        pCh = sb.channel('op-presence', { config: { presence: { key: s.user.id } } });
        pCh.on('presence', { event: 'sync' }, () => {
          const st = pCh.presenceState();
          const list = Object.entries(st).map(([key, arr]) => {
            const latest = arr.slice().sort((a, b) => (a.at > b.at ? -1 : 1))[0];
            return { ...latest, key, sessions: arr.length };
          });
          pCbs.forEach(f => f(list));
        });
        pCh.subscribe(async st => { if (st === 'SUBSCRIBED') await pCh.track(pMeta); });
      },
      async update(meta) { if (pCh) { pMeta = { ...pMeta, ...meta, at: new Date().toISOString() }; await pCh.track(pMeta); } },
      onSync(cb) { pCbs.add(cb); return () => pCbs.delete(cb); },
      async leave() {
        if (pCh) { try { await pCh.untrack(); } catch {} await sb.removeChannel(pCh); pCh = null; pMeta = null; }
      },
    },

    async heartbeat() { try { await sb.rpc('heartbeat'); } catch {} },
    async expireStale() { try { await sb.rpc('expire_stale_orders'); } catch {} },

    // ---------------- admin ----------------
    admin: {
      async users() { return unwrap(await sb.from('profiles').select('*').order('created_at', { ascending: false })); },
      async setUserStatus(id, status) { return unwrap(await sb.rpc('admin_set_user_status', { p_user: id, p_status: status })); },
      async orders({ userId, status, from, to, limit = 2000 } = {}) {
        let q = sb.from('orders').select('*, profile:profiles!orders_user_id_fkey(email, full_name)')
          .order('created_at', { ascending: false }).limit(limit);
        if (userId) q = q.eq('user_id', userId);
        if (status) q = q.eq('status', status);
        if (from) q = q.gte('created_at', from);
        if (to) q = q.lt('created_at', to);
        return unwrap(await q);
      },
      async respond(orderId, action, newPrice, note) {
        return unwrap(await sb.rpc('respond_order', {
          p_order_id: orderId, p_action: action, p_new_price: newPrice ?? null, p_note: note || null }));
      },
      async shares() {
        return unwrap(await sb.from('shares').select('*').order('sort_order').order('id'));
      },
      async saveShare(s) {
        const row = { ...s };
        ['profit_retail', 'profit_hni', 'created_at', 'updated_at', '_dirty'].forEach(k => delete row[k]);
        if (row.id) {
          const id = row.id; delete row.id;
          return unwrap(await sb.from('shares').update(row).eq('id', id).select().single());
        }
        delete row.id;
        return unwrap(await sb.from('shares').insert(row).select().single());
      },
      async deleteShare(id) { unwrap(await sb.from('shares').delete().eq('id', id)); },
      async ledger(userId) {
        let q = sb.from('ledger_view').select('*').order('created_at', { ascending: true }).order('id').limit(10000);
        if (userId) q = q.eq('user_id', userId);
        return unwrap(await q);
      },
      async audit(limit = 500) { return unwrap(await sb.from('audit_log').select('*').order('id', { ascending: false }).limit(limit)); },
      async reports() { return unwrap(await sb.from('daily_reports').select('*').order('report_date', { ascending: false }).limit(366)); },
      async generateReport(date) { return unwrap(await sb.rpc('generate_daily_report', { p_date: date })); },
      async saveSettings(s) {
        const row = { ...s }; delete row.id; delete row.updated_at;
        return unwrap(await sb.from('app_settings').update(row).eq('id', 1).select().single());
      },
    },
  };

  // keep realtime authorised with the latest login token
  sb.auth.onAuthStateChange((_ev, session) => { if (session) sb.realtime.setAuth(session.access_token); });

  return api;
}
