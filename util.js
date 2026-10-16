
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function num(v, dec = 0) {
  if (v === null || v === undefined || v === '' || isNaN(+v)) return '—';
  return dec ? nf2.format(+v) : nf0.format(+v);
}
function inr(v, dec) {
  if (v === null || v === undefined || v === '' || isNaN(+v)) return '—';
  const d = dec ?? (Math.round(+v) === +v ? 0 : 2);
  const s = num(Math.abs(+v), d);
  return (+v < 0 ? '−' : '') + CONFIG.CURRENCY + s;
}

const TZ = CONFIG.TIMEZONE;
function fmtDate(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric',
    ...(typeof d === 'string' && d.length === 10 ? {} : { timeZone: TZ }) });
}
function fmtShortDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}
function timeAgo(d) {
  if (!d) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(d)) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}

function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- toasts ----------
function toast(msg, kind = 'info', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast toast-' + kind;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- modal ----------
function openModal({ title = '', body = '', actions = [], dismissable = true, kind = '' }) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'modal';
  wrap.innerHTML = `
    <div class="modal ${kind ? 'modal-' + kind : ''}" role="dialog" aria-modal="true">
      ${title ? `<h3 class="modal-title">${title}</h3>` : ''}
      <div class="modal-body">${body}</div>
      <div class="modal-actions"></div>
    </div>`;
  const act = $('.modal-actions', wrap);
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || '');
    b.innerHTML = a.label;
    b.onclick = async () => { if (a.onClick) { const r = await a.onClick(b); if (r === false) return; } closeModal(); };
    act.appendChild(b);
  });
  if (!actions.length) act.remove();
  if (dismissable) wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  return wrap;
}
function closeModal() { const m = $('#modal'); if (m) m.remove(); }

// ---------- flash a changed value ----------
function flashEl(el, dir) {
  if (!el) return;
  el.classList.remove('flash-up', 'flash-down', 'flash');
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'flash-up' : dir < 0 ? 'flash-down' : 'flash');
}

// ---------- CSV ----------
function downloadCSV(filename, rows, columns) {
  const cols = columns || Object.keys(rows[0] || {}).map(k => ({ key: k, label: k }));
  const q = v => {
    const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(c => q(c.label)).join(',')]
    .concat(rows.map(r => cols.map(c => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- sound ----------
let audioCtx;
function beep(times = 2) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = i % 2 ? 1175 : 880;
      const t0 = audioCtx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.2);
    }
  } catch { /* sound not available */ }
}

// ---------- theme ----------
function initTheme() {
  let t = null;
  try { t = localStorage.getItem('op_theme'); } catch {}
  if (t) document.documentElement.dataset.theme = t;
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('op_theme', next); } catch {}
}

const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true" class="logo-mark">
  <rect width="32" height="32" rx="9" fill="var(--accent)"/>
  <path d="M4 17h6l2.6-6.5 4.4 13 3.2-9 1.8 2.5H28" fill="none" stroke="var(--accent-ink)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
