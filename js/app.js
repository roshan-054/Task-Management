import { chime, isMuted, setMuted } from './sound.js';
import { createDataStore } from './data/index.js';
import { CONFIG } from './config.js';
import { computeKpi, formatHours } from './kpi.js';

// =====================================================================
//  Constants & helpers
// =====================================================================
const STATUSES = [
  { id: 'not_started', label: 'Not started', tone: 'gray' },
  { id: 'in_progress', label: 'In progress', tone: 'blue' },
  { id: 'on_hold', label: 'On hold', tone: 'orange' },
  { id: 'completed', label: 'Completed', tone: 'green' },
];
const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', tone: 'red', color: 'var(--red)' },
  { id: 'high', label: 'High', tone: 'orange', color: 'var(--orange)' },
  { id: 'medium', label: 'Medium', tone: 'blue', color: 'var(--accent)' },
  { id: 'low', label: 'Low', tone: 'gray', color: 'var(--gray)' },
];
const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
const prioOf = (id) => PRIORITIES.find((p) => p.id === id) || PRIORITIES[2];
const prioRank = { urgent: 0, high: 1, medium: 2, low: 3 };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => {
  try { const x = new URL(String(u).trim()); return ['http:', 'https:', 'mailto:'].includes(x.protocol) ? x.href : null; } catch { return null; }
};
const normalizeUrl = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^[a-z]+:/i.test(s) ? s : 'https://' + s;
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const todayISO = () => new Date().toISOString().slice(0, 10);
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const AV_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#5856d6', '#a2845e'];
const avColor = (id) => AV_COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const avatar = (p, size = '') => `<div class="avatar ${size}" style="background:${avColor(p?.id || '')}" title="${esc(p?.full_name)}">${esc(initials(p?.full_name))}</div>`;
const fmtDate = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(d).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '';
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
};
const fmtTime = (hhmm) => hhmm ? new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
// The moment a task is due: its date at its time (9:00 when no time is set).
const dueMoment = (date, time) => date ? new Date(`${date}T${time || '09:00'}:00`) : null;
const fmtDue = (t) => t.due_date ? fmtDate(t.due_date) + (t.due_time ? ', ' + fmtTime(t.due_time) : '') : '';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', member: 'Team member' };
const roleLabel = (r) => ROLE_LABELS[r] || r;
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

// Icons: simple line drawings, 18px
const I = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icon = {
  check: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>', s),
  send: (s) => I('<path d="M4 12l16-8-6 17-3-7-7-2z"/>', s),
  stack: (s) => I('<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/>', s),
  chart: (s) => I('<path d="M5 20V10M12 20V4M19 20v-7"/>', s),
  team: (s) => I('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.3c2.3.2 3.9 1.8 4.5 4.2"/>', s),
  people: (s) => I('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>', s),
  list: (s) => I('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>', s),
  note: (s) => I('<path d="M6 3.5h9l4 4v13H6z"/><path d="M14.5 3.5v4.5H19M9 12h7M9 15.5h7"/>', s),
  pin: (s) => I('<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3z"/><path d="M12 13.5V20"/>', s),
  grip: (s) => I('<circle cx="9" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/>', s),
  tag: (s) => I('<path d="M3.5 12.5V4.5a1 1 0 011-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.6"/>', s),
  sound: (s) => I('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>', s),
  muted: (s) => I('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>', s),
  bell: (s) => I('<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2.2 2.2 0 004 0"/>', s),
  plus: (s) => I('<path d="M12 5v14M5 12h14"/>', s),
  search: (s) => I('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>', s),
  link: (s) => I('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', s),
  lock: (s) => I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', s),
  cal: (s) => I('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>', s),
  x: (s) => I('<path d="M6 6l12 12M18 6L6 18"/>', s),
  trash: (s) => I('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>', s),
  out: (s) => I('<path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 16l-4-4 4-4M6 12h10"/>', s),
  moon: (s) => I('<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>', s),
  sun: (s) => I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', s),
  grid: (s) => I('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>', s),
  board: (s) => I('<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="16.5" y="4" width="4" height="7" rx="1.5"/>', s),
  at: (s) => I('<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.4a2.6 2.6 0 005.2 0V12a8.8 8.8 0 10-3.5 7"/>', s),
  alert: (s) => I('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', s),
  chat: (s) => I('<path d="M5 18.5V6.5A2.5 2.5 0 017.5 4h9A2.5 2.5 0 0119 6.5v7a2.5 2.5 0 01-2.5 2.5H9z"/>', s),
  pencil: (s) => I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>', s),
  pause: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', s),
  play: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>', s),
  circle: (s) => I('<circle cx="12" cy="12" r="9"/>', s),
  arrow: (s) => I('<path d="M7 17L17 7M9 7h8v8"/>', s),
  info: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', s),
  user: (s) => I('<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5"/><circle cx="12" cy="12" r="10"/>', s),
};
const NOTE_STYLE = {
  completed: ['green', 'Task completed', 'check'], on_hold: ['orange', 'Task on hold', 'pause'], assigned: ['blue', 'New task for you', 'plus'],
  in_progress: ['blue', 'Task in progress', 'play'], not_started: ['gray', 'Task moved back', 'circle'],
  tagged: ['purple', 'You were tagged', 'at'], reminder: ['orange', 'Reminder', 'bell'], blocked: ['red', 'Task blocked', 'alert'], remark: ['blue', 'New remark', 'chat'], resolved: ['green', 'Blocker resolved', 'check'],
};
const noteStyle = (type) => { const [tone, title, ic] = NOTE_STYLE[type] || NOTE_STYLE.assigned; return { tone, title, ic: icon[ic] }; };
const statusIcon = { not_started: icon.circle, in_progress: icon.play, on_hold: icon.pause, completed: icon.check };

// =====================================================================
//  State
// =====================================================================
const state = {
  me: null, profiles: [], departments: [], teams: [], tasks: [], notifications: [], invitations: [], remarks: [], platforms: [], reminders: [], remindersReady: false, todos: [], notes: [], personalError: '',
  filter: { status: 'active', priority: 'all', platform: 'all', sort: 'due', q: '' },
  kpiSort: { key: 'score', dir: -1 },
};
let store;
let unsubscribe = null;
const app = () => $('#app');

const byId = (list, id) => list.find((x) => x.id === id);
const person = (id) => byId(state.profiles, id) || { id, full_name: 'Unknown', email: '' };
const deptName = (id) => byId(state.departments, id)?.name || 'No department';
const teamName = (id) => byId(state.teams, id)?.name || 'No team';
// "Role · Team · Department", leaving out whatever is not set.
const orgLine = (p, ...lead) => [...lead, byId(state.teams, p.team_id)?.name, byId(state.departments, p.department_id)?.name].filter(Boolean).join(' · ');
const platformOf = (id) => (id ? byId(state.platforms, id) : null);
// Options for a department's platform picker: active ones, plus the task's current one even if removed.
const platformsFor = (deptId, keepId = null) => state.platforms
  .filter((p) => deptId && p.department_id === deptId && (!p.archived || p.id === keepId))
  .sort((a, b) => a.name.localeCompare(b.name));
const canManagePlatforms = (deptId) => isAdmin() || (state.me?.role === 'manager' && state.me.department_id === deptId);
const isManager = () => ['manager', 'admin'].includes(state.me?.role);
const isAdmin = () => state.me?.role === 'admin';
const canEditTask = (t) => t.created_by === state.me.id || isAdmin();

// =====================================================================
//  Toasts & dialogs
// =====================================================================
function toast(title, body = '', tone = 'blue', ic = icon.info) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="ic tone-${tone}">${ic(18)}</div><div><b>${esc(title)}</b>${body ? `<span class="muted small">${esc(body)}</span>` : ''}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}
const fail = (e) => toast('Something went wrong', e?.message || String(e), 'red', icon.info);

function openSheet(html, onMount) {
  closeSheet(true);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeSheet(); });
  document.body.appendChild(ov);
  $$('[data-close]', ov).forEach((b) => b.addEventListener('click', () => closeSheet()));
  onMount?.(ov);
  setTimeout(() => $('input:not([type=hidden]), textarea, select', ov)?.focus({ preventScroll: true }), 60);
  return ov;
}
function closeSheet(instant = false) {
  const ov = $('.overlay');
  if (!ov) return;
  if (instant) return ov.remove();
  ov.classList.add('closing');
  setTimeout(() => ov.remove(), 200);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); closePopover(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && state.me) { e.preventDefault(); $('#search')?.focus(); }
});
// A proper "Are you sure?" dialog. Resolves true when confirmed.
function confirmDialog({ title, body = '', confirm = 'Delete', tone = 'danger' } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'confirm-ov';
    ov.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">
      <div class="confirm-ic tone-${tone === 'danger' ? 'red' : 'blue'}">${tone === 'danger' ? icon.trash(22) : icon.info(22)}</div>
      <h3 id="cf-title">${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}
      <div class="confirm-actions"><button class="btn" data-no>Cancel</button><button class="btn ${tone === 'danger' ? 'danger solid' : 'primary'}" data-yes>${esc(confirm)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.classList.add('closing'); setTimeout(() => ov.remove(), 150); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); done(false); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(false); });
    $('[data-no]', ov).addEventListener('click', () => done(false));
    $('[data-yes]', ov).addEventListener('click', () => done(true));
    document.body.appendChild(ov);
    setTimeout(() => $('[data-yes]', ov).focus(), 30);
  });
}
const sheetHead = (title) => `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon.x()}</button></div>`;

// =====================================================================
//  Theme
// =====================================================================
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem('taskflow-theme', t) : localStorage.removeItem('taskflow-theme'); } catch {}
}
try { const t = localStorage.getItem('taskflow-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
const isDark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

// =====================================================================
//  Auth screens
// =====================================================================
function renderAuth(mode = 'signin') {
  const demo = store.mode === 'demo';
  const titles = {
    signin: ['Welcome back', 'Sign in to see your tasks.'],
    activate: ['Activate your account', 'Use the email your manager or admin added.'],
    reset: ['Reset password', 'We will email you a link to set a new password.'],
  };
  app().innerHTML = `
  <main class="auth">
    <div class="auth-card">
      <img class="auth-logo" src="icons/icon.svg" alt="" width="64" height="64">
      <h1>${titles[mode][0]}</h1>
      <p class="lead">${titles[mode][1]}</p>
      <form class="stack" id="auth-form" novalidate>
        ${mode === 'activate' ? `<div class="field"><label for="f-name">Full name</label><input class="input" id="f-name" autocomplete="name" placeholder="Your name"></div>` : ''}
        <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" type="email" autocomplete="email" placeholder="name@company.com" required></div>
        ${mode !== 'reset' ? `<div class="field"><label for="f-pass">Password</label><input class="input" id="f-pass" type="password" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" placeholder="${mode === 'signin' ? 'Password' : 'At least 6 characters'}" required></div>` : ''}
        <div class="error" id="auth-error"></div>
        <button class="btn primary block" type="submit">${mode === 'signin' ? 'Sign in' : mode === 'activate' ? 'Create account' : 'Send reset link'}</button>
      </form>
      <div class="switch">
        ${mode === 'signin' ? `New here? <a href="#" data-mode="activate">Activate your account</a><br><a href="#" data-mode="reset" class="small">Forgot password?</a>`
          : `<a href="#" data-mode="signin">Back to sign in</a>`}
      </div>
      ${demo && mode === 'signin' ? `
      <div class="demo-box">
        <div class="small muted" style="text-align:center">Demo mode: data stays in this browser. Pick an account (password <b>demo123</b>).</div>
        <div class="chips">${store.demoAccounts.map((a) => `<button class="chip" data-demo="${esc(a.email)}">${esc(a.label)}</button>`).join('')}</div>
      </div>` : ''}
    </div>
  </main>`;

  $$('[data-mode]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); renderAuth(a.dataset.mode); }));
  $$('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
    try { await store.signIn(b.dataset.demo, 'demo123'); await boot(); } catch (e) { $('#auth-error').textContent = e.message; }
  }));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    const err = $('#auth-error');
    const email = $('#f-email').value.trim();
    const pass = $('#f-pass')?.value || '';
    err.textContent = '';
    if (!email) { err.textContent = 'Enter your email.'; return; }
    btn.disabled = true;
    try {
      if (mode === 'signin') { await store.signIn(email, pass); await boot(); }
      else if (mode === 'activate') {
        if (pass.length < 6) throw new Error('Password should be at least 6 characters.');
        const r = await store.activate(email, pass, $('#f-name').value.trim());
        if (r.needsConfirmation) {
          renderAuth('signin');
          toast('Check your inbox', 'Confirm your email, then sign in.', 'green', icon.check);
        } else await boot();
      } else {
        await store.resetPassword(email);
        toast('Reset link sent', 'Check your inbox.', 'green', icon.check);
        renderAuth('signin');
      }
    } catch (ex) {
      err.textContent = /Database error saving new user/i.test(ex.message)
        ? 'This email has not been invited. Ask your admin or manager to add you first.' : friendlyAuthError(ex);
    } finally { btn.disabled = false; }
  });
}

function renderSetPassword() {
  openSheet(`${sheetHead('Set a new password')}
    <form id="pw-form"><div class="sheet-body">
      <div class="field"><label>New password</label><input class="input" id="pw" type="password" autocomplete="new-password" minlength="6" required></div>
    </div><div class="sheet-foot"><button class="btn primary" type="submit">Save password</button></div></form>`, (ov) => {
    $('#pw-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await store.updatePassword($('#pw', ov).value); closeSheet(); toast('Password updated', '', 'green', icon.check); } catch (ex) { fail(ex); }
    });
  });
}

// =====================================================================
//  Data loading
// =====================================================================
async function loadAll() {
  const [profiles, departments, teams, tasks, notifications, remarks, platforms] = await Promise.all([
    store.listProfiles(), store.listDepartments(), store.listTeams(), store.listTasks(), store.listNotifications(),
    store.listRemarks().catch(() => []), store.listPlatforms().catch(() => []),
  ]);
  Object.assign(state, { profiles, departments, teams, tasks, notifications, remarks, platforms });
  try { state.todos = await store.listTodos(); state.personalError = ''; } catch (e) { state.todos = []; state.personalError = e.message; }
  await loadReminders();
  state.me = byId(profiles, state.me.id) || state.me;
}
let refreshTimer;
function scheduleRefresh(what = 'tasks') {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      if (what === 'directory') await loadAll();
      else { [state.tasks, state.remarks, state.reminders] = await Promise.all([store.listTasks(), store.listRemarks().catch(() => state.remarks), store.listReminders().catch(() => state.reminders)]); }
      if (!$('.overlay')) route(); else updateCounts();
    } catch (e) { console.warn(e); }
  }, 250);
}

async function boot() {
  try {
    const id = await store.getSessionUserId();
    if (!id) return renderAuth();
    const me = await store.getProfile(id);
    if (!me) { await store.signOut(); renderAuth(); return toast('No profile found', 'Ask your admin to add you.', 'red'); }
    if (!me.active) { await store.signOut(); renderAuth(); return toast('Account deactivated', 'Contact your admin.', 'red'); }
    state.me = me;
    await loadAll();
    renderShell();
    unsubscribe?.();
    unsubscribe = store.subscribe(me.id, onRealtime);
    startReminderLoop();
    if (!location.hash || location.hash === '#') location.hash = '#/tasks'; else route();
  } catch (e) {
    console.error(e);
    renderAuth();
    fail(e);
  }
}

function onRealtime(msg) {
  if (msg.kind === 'notification') {
    const n = msg.record;
    if (state.notifications.some((x) => x.id === n.id)) return;
    state.notifications.unshift(n);
    const { tone, title, ic } = noteStyle(n.type);
    toast(title, n.message, tone, ic);
    chime(tone);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body: n.message, tag: n.id }); } catch {}
    }
    updateCounts();
    scheduleRefresh('tasks');
  } else if (msg.kind === 'directory') scheduleRefresh('directory');
  else scheduleRefresh('tasks');
}

// =====================================================================
//  Shell
// =====================================================================
function navItems() {
  const items = [
    { hash: '#/tasks', label: 'My Tasks', ic: icon.check, count: () => myTasks().filter((t) => t.status !== 'completed').length },
    { hash: '#/waiting', label: 'Waiting on Me', ic: icon.at, count: () => waitingOnMe().length },
  ];
  const personal = [{ section: 'Personal' },
    { hash: '#/todo', label: 'To-do', ic: icon.list, count: () => state.todos.filter((t) => !t.done).length },
    { hash: '#/notes', label: 'Notes', ic: icon.note }];
  if (isManager()) items.push({ hash: '#/assigned', label: 'Assigned by Me', ic: icon.send, count: () => assignedByMe().filter((t) => t.status !== 'completed').length });
  if (isAdmin()) items.push({ hash: '#/all', label: 'All Tasks', ic: icon.stack });
  items.push(...personal);
  items.push({ section: 'Performance' });
  if (isManager()) items.push({ hash: '#/team-kpi', label: 'Team Performance', ic: icon.chart });
  else items.push({ hash: '#/kpi', label: 'My Performance', ic: icon.chart });
  if (isManager()) { items.push({ section: 'Organisation' }); items.push({ hash: '#/people', label: 'People & Teams', ic: icon.team }); items.push({ hash: '#/platforms', label: 'Platforms', ic: icon.tag }); }
  return items;
}
const remarksFor = (taskId) => state.remarks.filter((r) => r.task_id === taskId);
const openBlockers = (taskId) => state.remarks.filter((r) => r.task_id === taskId && r.kind === 'blocker' && !r.resolved_at);
const waitingOnMe = () => state.tasks.filter((t) => t.status !== 'completed' && openBlockers(t.id).some((r) => r.tagged.includes(state.me.id)));
const myTasks = () => state.tasks.filter((t) => t.assigned_to === state.me.id);
const assignedByMe = () => state.tasks.filter((t) => t.created_by === state.me.id && t.assigned_to !== state.me.id);

function renderShell() {
  const me = state.me;
  const items = navItems();
  app().innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><img class="mark" src="icons/icon.svg" alt="" width="30" height="30">${esc(CONFIG.APP_NAME)}</div>
      ${items.map((it) => it.section ? `<div class="nav-label">${esc(it.section)}</div>`
        : `<button class="nav-item" data-nav="${it.hash}">${it.ic()}<span>${esc(it.label)}</span>${it.count ? `<span class="count" data-count="${it.hash}"></span>` : ''}</button>`).join('')}
      <div class="spacer"></div>
      ${store.mode === 'demo' ? `<div style="padding:0 10px 8px"><span class="demo-banner">Demo mode</span></div>` : ''}
      <div class="me-row">
        <div class="me-card" id="me-card" title="Your profile">${avatar(me)}<div class="who"><b>${esc(me.full_name)}</b><span>${esc([roleLabel(me.role), byId(state.teams, me.team_id)?.name].filter(Boolean).join(' · '))}</span></div></div>
        <button class="icon-btn logout-btn" id="logout-btn" aria-label="Log out" title="Log out">${icon.out(18)}</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="search">${icon.search(16)}<input id="search" placeholder="Search tasks" value="${esc(state.filter.q)}" aria-label="Search tasks"></div>
        <div class="grow"></div>
        <button class="icon-btn logout-btn only-sm" id="logout-top" aria-label="Log out" title="Log out">${icon.out(18)}</button>
        <button class="icon-btn" id="theme-btn" aria-label="Toggle theme">${isDark() ? icon.sun() : icon.moon()}</button>
        <button class="icon-btn" id="sound-btn" aria-pressed="${!isMuted()}" aria-label="${isMuted() ? 'Turn notification sound on' : 'Mute notification sound'}" title="${isMuted() ? 'Sound off' : 'Sound on'}">${isMuted() ? icon.muted() : icon.sound()}</button>
        <button class="icon-btn" id="bell" aria-label="Notifications">${icon.bell()}<span class="badge hidden" id="bell-badge"></span></button>
        <button class="btn primary" id="new-task">${icon.plus(16)}<span class="hide-sm">New Task</span></button>
      </header>
      <div id="view"></div>
    </div>
    <nav class="mobile-tabs">
      ${items.filter((it) => !it.section).slice(0, 5).map((it) => `<button data-nav="${it.hash}">${it.ic(22)}<span>${esc(it.label.replace('Assigned by Me', 'Assigned').replace('My Performance', 'KPI').replace('Team Performance', 'KPI').replace('People & Teams', 'People').replace('Waiting on Me', 'Waiting'))}</span></button>`).join('')}
    </nav>
  </div>`;

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.nav; }));
  $('#new-task').addEventListener('click', () => openTaskEditor());
  $('#bell').addEventListener('click', (e) => { e.stopPropagation(); togglePopover(); });
  $('#sound-btn').addEventListener('click', (e) => {
    const b = e.currentTarget; const muted = !isMuted(); setMuted(muted);
    b.innerHTML = muted ? icon.muted() : icon.sound();
    b.setAttribute('aria-pressed', String(!muted)); b.title = muted ? 'Sound off' : 'Sound on';
    b.setAttribute('aria-label', muted ? 'Turn notification sound on' : 'Mute notification sound');
    if (!muted) chime('blue', { force: true });
    toast(muted ? 'Sounds muted' : 'Sounds on', muted ? 'Notifications will arrive silently.' : 'You will hear a chime for new notifications.', 'gray', muted ? icon.muted : icon.sound);
  });
  $('#me-card').addEventListener('click', openProfileSheet);
  ['#logout-btn', '#logout-top'].forEach((sel) => $(sel)?.addEventListener('click', signOut));
  $('#theme-btn').addEventListener('click', () => {
    applyTheme(isDark() ? 'light' : 'dark');
    $('#theme-btn').innerHTML = isDark() ? icon.sun() : icon.moon();
  });
  $('#search').addEventListener('input', (e) => {
    state.filter.q = e.target.value;
    if (!/^#\/(tasks|assigned|all|waiting)/.test(location.hash)) location.hash = '#/tasks'; else renderTaskView();
  });
  updateCounts();
}

function updateCounts() {
  navItems().forEach((it) => {
    const el = $(`[data-count="${it.hash}"]`);
    if (el && it.count) { const n = it.count(); el.textContent = n || ''; }
  });
  const unread = state.notifications.filter((n) => !n.read).length;
  const b = $('#bell-badge');
  if (b) { b.textContent = unread > 9 ? '9+' : unread; b.classList.toggle('hidden', !unread); }
  if ($('.popover')) renderPopover();
}

// ---------- notifications popover ----------
function closePopover() { $('.popover')?.remove(); }
function togglePopover() {
  if ($('.popover')) return closePopover();
  const el = document.createElement('div');
  el.className = 'popover';
  document.body.appendChild(el);
  renderPopover();
  const unreadIds = state.notifications.filter((n) => !n.read).map((n) => n.id);
  if (unreadIds.length) setTimeout(async () => {
    try {
      await store.markNotificationsRead(unreadIds);
      state.notifications.forEach((n) => { if (unreadIds.includes(n.id)) n.read = true; });
      const b = $('#bell-badge'); if (b) b.classList.add('hidden');
    } catch (e) { console.warn(e); }
  }, 1200);
}
document.addEventListener('click', (e) => { if ($('.popover') && !e.target.closest('.popover') && !e.target.closest('#bell')) closePopover(); });
function renderPopover() {
  const el = $('.popover'); if (!el) return;
  const ns = state.notifications;
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  el.innerHTML = `
    <div class="popover-head"><h3>Notifications</h3>${canAsk ? `<button class="btn ghost sm" id="desk">Enable desktop alerts</button>` : ''}</div>
    ${ns.length ? ns.map((n) => {
      const { tone, ic } = noteStyle(n.type);
      return `<div class="notif ${n.read ? '' : 'unread'}" data-task="${esc(n.task_id)}"><div class="ic tone-${tone}">${ic(16)}</div><div style="flex:1"><p>${esc(n.message)}</p><time>${esc(timeAgo(n.created_at))}</time></div></div>`;
    }).join('') : `<div class="empty" style="padding:32px 16px"><div class="art">${icon.bell(28)}</div>You're all caught up.</div>`}`;
  $('#desk', el)?.addEventListener('click', async () => { await Notification.requestPermission(); renderPopover(); });
  $$('.notif', el).forEach((n) => n.addEventListener('click', () => {
    const t = byId(state.tasks, n.dataset.task);
    closePopover();
    if (t) openTask(t); else toast('Task no longer available');
  }));
}

// =====================================================================
//  Router
// =====================================================================
function route() {
  if (!state.me) return;
  const h = location.hash || '#/tasks';
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', h === b.dataset.nav || (h.startsWith('#/kpi/') && b.dataset.nav === '#/team-kpi')));
  closePopover();
  if (/^#\/(tasks|assigned|all|waiting)$/.test(h)) {
    if ((h === '#/assigned' && !isManager()) || (h === '#/all' && !isAdmin())) { location.hash = '#/tasks'; return; }
    renderTaskView();
  } else if (h === '#/kpi') { if (isManager()) { location.hash = '#/team-kpi'; return; } renderKpi(state.me.id); }
  else if (h.startsWith('#/kpi/')) renderKpi(decodeURIComponent(h.slice(6)));
  else if (h === '#/team-kpi' && isManager()) renderTeamKpi();
  else if (h === '#/todo') renderTodos();
  else if (h === '#/notes') renderNotes();
  else if (h === '#/people' && isManager()) renderPeople();
  else if (h === '#/platforms' && isManager()) renderPlatforms();
  else location.hash = '#/tasks';
  updateCounts();
}
window.addEventListener('hashchange', route);

// =====================================================================
//  Task views
// =====================================================================
function viewTasks() {
  const h = location.hash;
  if (h === '#/assigned') return assignedByMe();
  if (h === '#/all') return state.tasks;
  if (h === '#/waiting') return waitingOnMe();
  return myTasks();
}

function getViewMode() { const def = matchMedia('(max-width: 860px)').matches ? 'cards' : 'board'; try { return localStorage.getItem('taskflow-view') || def; } catch { return def; } }
function setViewMode(v) { try { localStorage.setItem('taskflow-view', v); } catch {} }
const canChangeStatus = (t) => t.assigned_to === state.me.id || canEditTask(t);

function renderTaskView() {
  const h = location.hash || '#/tasks';
  const titles = {
    '#/tasks': ['My Tasks', 'Everything assigned to you.'],
    '#/assigned': ['Assigned by Me', 'Tasks you gave to others. You will be notified the moment one is completed.'],
    '#/all': ['All Tasks', 'Every task in the organisation (admin view).'],
    '#/waiting': ['Waiting on Me', 'Tasks where someone is blocked and tagged you. Reply or resolve the blocker to unblock them.'],
  };
  const f = state.filter;
  const mode = getViewMode();
  const base = viewTasks();
  const q = f.q.trim().toLowerCase();
  const searched = q ? base.filter((t) => [t.title, t.description, person(t.assigned_to).full_name, person(t.created_by).full_name, platformOf(t.platform_id)?.name]
    .some((s) => (s || '').toLowerCase().includes(q))) : base;
  // Platform filter: list platforms used by these tasks plus the active ones of my department.
  const platIds = new Set(base.map((t) => t.platform_id).filter(Boolean));
  state.platforms.forEach((pl) => { if (!pl.archived && pl.department_id === state.me.department_id) platIds.add(pl.id); });
  const platChoices = [...platIds].map(platformOf).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || deptName(a.department_id).localeCompare(deptName(b.department_id)));
  const multiDept = new Set(platChoices.map((pl) => pl.department_id)).size > 1;
  if (f.platform !== 'all' && f.platform !== 'none' && !platIds.has(f.platform)) f.platform = 'all';
  let pool = f.priority === 'all' ? searched : searched.filter((t) => t.priority === f.priority);
  if (f.platform === 'none') pool = pool.filter((t) => !t.platform_id);
  else if (f.platform !== 'all') pool = pool.filter((t) => t.platform_id === f.platform);
  const counts = { active: pool.filter((t) => t.status !== 'completed').length, all: pool.length };
  STATUSES.forEach((s) => { counts[s.id] = pool.filter((t) => t.status === s.id).length; });
  const sorter = (a, b) => {
    if (f.sort === 'priority') return prioRank[a.priority] - prioRank[b.priority] || (a.due_date || '9').localeCompare(b.due_date || '9');
    if (f.sort === 'recent') return b.created_at.localeCompare(a.created_at);
    return (a.due_date || '9999').localeCompare(b.due_date || '9999') || prioRank[a.priority] - prioRank[b.priority];
  };
  pool = [...pool].sort(sorter);
  const list = pool.filter((t) => f.status === 'all' || (f.status === 'active' ? t.status !== 'completed' : t.status === f.status));

  const segs = [['active', 'Active'], ...STATUSES.map((s) => [s.id, s.label]), ['all', 'All']];
  const board = `<div class="board">${STATUSES.map((s) => {
    const col = pool.filter((t) => t.status === s.id);
    return `<div class="column" data-col="${s.id}">
      <div class="col-head tone-${s.tone}">${statusIcon[s.id](16)}<span>${s.label}</span><b>${col.length}</b></div>
      <div class="col-body">${col.map((t, i) => taskCard(t, i)).join('') || `<div class="col-empty">Drop tasks here</div>`}</div>
    </div>`;
  }).join('')}</div>`;
  const cards = list.length ? `<div class="card-grid">${list.map((t, i) => taskCard(t, i)).join('')}</div>` : emptyState(h);

  $('#view').innerHTML = `
  <section class="content wide">
    <div class="page-head"><div><h1>${titles[h][0]}</h1><p>${titles[h][1]}</p></div>
      <div class="segmented view-toggle" aria-label="Layout">
        <button class="${mode === 'board' ? 'active' : ''}" data-mode="board">${icon.board(15)} Board</button>
        <button class="${mode === 'cards' ? 'active' : ''}" data-mode="cards">${icon.grid(15)} Cards</button>
      </div></div>
    <div class="toolbar">
      ${mode === 'cards' ? `<div class="segmented" role="tablist">${segs.map(([id, label]) => `<button class="${f.status === id ? 'active' : ''}" data-status="${id}">${label}<span class="n">${counts[id]}</span></button>`).join('')}</div>` : ''}
      <select class="select ${f.priority !== 'all' ? 'is-set' : ''}" id="f-prio" aria-label="Priority filter">
        <option value="all">All priorities</option>${PRIORITIES.map((p) => `<option value="${p.id}" ${f.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
      </select>
      ${platChoices.length ? `<select class="select ${f.platform !== 'all' ? 'is-set' : ''}" id="f-plat" aria-label="Platform filter">
        <option value="all">All platforms</option>
        ${platChoices.map((pl) => `<option value="${esc(pl.id)}" ${f.platform === pl.id ? 'selected' : ''}>${esc(pl.name)}${multiDept ? ` · ${esc(deptName(pl.department_id))}` : ''}${pl.archived ? ' (removed)' : ''}</option>`).join('')}
        <option value="none" ${f.platform === 'none' ? 'selected' : ''}>No platform</option>
      </select>` : ''}
      ${filtersActive() ? `<button class="btn ghost sm clear-filters" id="f-clear" type="button">${icon.x(14)} Clear filters</button>` : ''}
      <select class="select" id="f-sort" aria-label="Sort">
        <option value="due" ${f.sort === 'due' ? 'selected' : ''}>Sort by due date</option>
        <option value="priority" ${f.sort === 'priority' ? 'selected' : ''}>Sort by priority</option>
        <option value="recent" ${f.sort === 'recent' ? 'selected' : ''}>Newest first</option>
      </select>
      ${mode === 'board' ? `<span class="small muted hint">Drag a card to another column to change its status.</span>` : ''}
    </div>
    ${mode === 'board' ? (pool.length ? board : emptyState(h)) : cards}
  </section>`;

  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { setViewMode(b.dataset.mode); renderTaskView(); }));
  $$('[data-status]').forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.status; renderTaskView(); }));
  $('#f-prio').addEventListener('change', (e) => { f.priority = e.target.value; renderTaskView(); });
  $('#f-sort').addEventListener('change', (e) => { f.sort = e.target.value; renderTaskView(); });
  $('#f-plat')?.addEventListener('change', (e) => { f.platform = e.target.value; renderTaskView(); });
  $('#f-clear')?.addEventListener('click', clearFilters);
  $('#empty-clear')?.addEventListener('click', clearFilters);
  $$('.tcard').forEach((el) => {
    el.addEventListener('click', (e) => { if (!e.target.closest('select, a, button')) openTask(byId(state.tasks, el.dataset.id)); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) openTask(byId(state.tasks, el.dataset.id)); });
    if (el.draggable) {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); document.body.classList.add('is-dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); document.body.classList.remove('is-dragging'); });
    }
  });
  $$('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      const t = byId(state.tasks, id);
      if (!t) return;
      if (!canChangeStatus(t)) return toast('Not allowed', 'Only the assignee or the person who created this task can change its status.', 'orange', icon.lock);
      changeStatus(id, col.dataset.col);
    });
  });
  $$('.status-select').forEach((sel) => sel.addEventListener('change', (e) => changeStatus(sel.dataset.id, e.target.value)));
  $$('[data-card-del]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.cardDel;
      if (!await confirmDialog({ title: 'Delete this task?', body: `"${byId(state.tasks, id)?.title || ''}" and its remarks and history will be removed for everyone.` })) return;
      const card = b.closest('.tcard');
      card.classList.add('removing');
      try {
        await store.deleteTask(id);
        state.tasks = state.tasks.filter((x) => x.id !== id);
        state.remarks = state.remarks.filter((x) => x.task_id !== id);
        setTimeout(() => { renderTaskView(); updateCounts(); }, 220);
        toast('Task deleted', '', 'gray', icon.trash);
      } catch (ex) { card.classList.remove('removing'); fail(ex); }
    });
  });
  $('#empty-new')?.addEventListener('click', () => openTaskEditor());
}

// Anything narrowing the list (sorting doesn't count).
const filtersActive = () => { const f = state.filter; return f.priority !== 'all' || f.platform !== 'all' || f.q.trim() !== '' || f.status !== 'active'; };
function clearFilters() {
  Object.assign(state.filter, { priority: 'all', platform: 'all', q: '', status: 'active' });
  const s = $('#search'); if (s) s.value = '';
  renderTaskView();
}

function emptyState(h) {
  if (filtersActive()) return `<div class="empty"><div class="art">${icon.search(30)}</div><h3>No tasks match these filters</h3><p>Try another filter, or clear them to see everything.</p>
    <button class="btn primary" id="empty-clear" style="margin-top:10px">${icon.x(16)} Clear filters</button></div>`;
  const msg = state.filter.q ? ['No matches', 'Try a different search.']
    : h === '#/assigned' ? ['Nothing assigned yet', 'Create a task and assign it to anyone in any team.']
    : h === '#/waiting' ? ['Nobody is waiting on you', 'When someone tags you on a blocked task, it shows up here.']
    : ['You are all clear', 'New tasks assigned to you will appear here instantly.'];
  return `<div class="empty"><div class="art">${icon.check(30)}</div><h3>${msg[0]}</h3><p>${msg[1]}</p>
    <button class="btn primary" id="empty-new" style="margin-top:10px">${icon.plus(16)} New Task</button></div>`;
}

function statusSelect(t) {
  const s = statusOf(t.status);
  return `<select class="status-select tone-${s.tone}" data-id="${esc(t.id)}" aria-label="Work status">
    ${STATUSES.map((x) => `<option value="${x.id}" ${x.id === t.status ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`;
}

const REASONS = { issue: 'Issue', delay: 'Delay by someone', dependency: 'Depends on someone', other: 'Other' };
function blockerBanner(t) {
  const b = openBlockers(t.id);
  if (!b.length) return '';
  const last = b[b.length - 1];
  const names = [...new Set(b.flatMap((r) => r.tagged))].map((id) => id === state.me.id ? 'you' : person(id).full_name.split(' ')[0]);
  return `<div class="blocker-banner">${icon.alert(14)}<span><b>Blocked</b> · ${esc(REASONS[last.reason] || 'Other')}${names.length ? ` · waiting on ${esc(names.join(', '))}` : ''}</span></div>`;
}

// Due date indicator: a mini ring shows how much of the time between
// creation and the due date has passed; colour and label show the state.
function dueInfo(t) {
  if (!t.due_date) return null;
  const DAY = 86400e3;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const due = t.due_time ? dueMoment(t.due_date, t.due_time) : new Date(t.due_date + 'T23:59:59');
  const dueDay = startOfDay(t.due_date + 'T00:00:00');
  if (t.status === 'completed' && t.completed_at) {
    const diff = Math.round((dueDay - startOfDay(t.completed_at)) / DAY);
    return { state: diff >= 0 ? 'done' : 'late-done', pct: 1,
      label: diff > 0 ? `${diff}d early` : diff === 0 ? 'On the day' : `${-diff}d late`,
      tip: `Due ${fmtDate(t.due_date)} · completed ${fmtDateTime(t.completed_at)}` };
  }
  const days = Math.round((dueDay - startOfDay(new Date())) / DAY);
  const created = new Date(t.created_at).getTime();
  const pct = Math.min(1, Math.max(0.04, (Date.now() - created) / Math.max(DAY / 4, due - created)));
  let state, label;
  const at = t.due_time ? ' ' + fmtTime(t.due_time) : '';
  if (days < 0) { state = 'overdue'; label = `${-days}d overdue`; }
  else if (days === 0 && t.due_time && due < Date.now()) { state = 'overdue'; label = `Overdue since ${fmtTime(t.due_time)}`; }
  else if (days === 0) { state = 'today'; label = 'Due today' + at; }
  else if (days === 1 && at) { state = 'soon'; label = 'Tomorrow' + at; }
  else if (days === 1) { state = 'soon'; label = 'Due tomorrow'; }
  else if (days <= 3) { state = 'soon'; label = `${days} days left`; }
  else { state = 'ok'; label = `${days} days left`; }
  const hoursLeft = Math.max(0, Math.round((due - Date.now()) / 3600e3));
  return { state, pct: days < 0 ? 1 : pct, label,
    tip: `Due ${new Date(t.due_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${at ? ' at' + at : ''} · ${days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : `${hoursLeft} h left`} · ${Math.round(pct * 100)}% of the time used` };
}
function dueChip(t) {
  const d = dueInfo(t);
  if (!d) return '';
  const r = 7, c = 2 * Math.PI * r;
  return `<span class="due-chip due-${d.state}" data-tip="${esc(d.tip)}" tabindex="0" aria-label="${esc(d.label + '. ' + d.tip)}">
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="${r}" class="due-track"/>
      <circle cx="9" cy="9" r="${r}" class="due-prog" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - d.pct)}" transform="rotate(-90 9 9)"/></svg>
    <span>${esc(d.label)}</span></span>`;
}

function platformChip(t) {
  const pl = platformOf(t.platform_id);
  return pl ? `<span class="plat-chip" title="Platform: ${esc(pl.name)}${pl.archived ? ' (removed)' : ''}">${icon.tag(12)}${esc(pl.name)}</span>` : '';
}

function personChip(label, p) {
  return `<div class="who-block"><span class="k">${label}</span><span class="v">${avatar(p, 'sm')}<span>${p.id === state.me.id ? 'You' : esc(p.full_name)}</span></span></div>`;
}

function taskCard(t, i = 0) {
  const p = prioOf(t.priority);
  const assignee = person(t.assigned_to);
  const creator = person(t.created_by);
  const overdue = t.status !== 'completed' && t.due_date && t.due_date < todayISO();
  const locked = !canEditTask(t);
  const canStatus = canChangeStatus(t);
  const links = (t.links || []).map((l) => ({ ...l, href: safeUrl(l.url) })).filter((l) => l.href);
  return `
  <article class="tcard ${t.status === 'completed' ? 'done' : ''}" data-id="${esc(t.id)}" style="--prio:${p.color};animation-delay:${Math.min(i, 12) * 30}ms" tabindex="0" ${canStatus ? 'draggable="true"' : ''}>
    <div class="tcard-top">
      <span class="pill tone-${p.tone}">${p.label}</span>
      ${platformChip(t)}
      ${dueChip(t)}
      ${locked ? `<span class="lock" title="Assigned by someone else. You can update the status only.">${icon.lock(13)}</span>` : ''}
      ${canEditTask(t) ? `<button type="button" class="card-del" data-card-del="${esc(t.id)}" aria-label="Delete task" title="Delete task">${icon.trash(14)}</button>` : ''}
    </div>
    <h3 class="tcard-title">${esc(t.title)}</h3>
    ${t.description ? `<p class="task-desc">${esc(t.description)}</p>` : ''}
    ${links.length ? `<div class="links">${links.map((l) => `<a class="link-chip" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${icon.link(13)}<span>${esc(l.label || new URL(l.href).hostname)}</span></a>`).join('')}</div>` : ''}
    ${blockerBanner(t)}
    <div class="tcard-people">
      ${personChip('Assigned by', creator)}
      ${personChip('Assigned to', assignee)}
    </div>
    <div class="tcard-foot">
      ${canStatus ? statusSelect(t) : `<span class="pill dot tone-${statusOf(t.status).tone}">${statusOf(t.status).label}</span>`}
      ${nextReminder(t) ? `<span class="rem-count" title="Reminder ${esc(fmtDateTime(nextReminder(t).remind_at))}">${icon.bell(13)}</span>` : ''}
      ${remarksFor(t.id).length ? `<span class="remark-count" title="Remarks">${icon.chat(13)} ${remarksFor(t.id).length}</span>` : ''}
      ${t.completed_at ? `<span class="done-at" title="Completed ${esc(fmtDateTime(t.completed_at))}">${icon.check(14)} ${esc(fmtDateTime(t.completed_at))}</span>` : `<span class="small muted">Added ${esc(timeAgo(t.created_at))}</span>`}
    </div>
  </article>`;
}

async function changeStatus(id, status) {
  const t = byId(state.tasks, id);
  if (!t || t.status === status) return;
  const prev = t.status;
  t.status = status;
  try {
    const updated = await store.updateTask(id, { status });
    Object.assign(t, updated);
    if (status === 'completed') toast('Nice work', t.created_by !== state.me.id ? `${person(t.created_by).full_name} has been notified.` : 'Task completed.', 'green', icon.check);
  } catch (e) { t.status = prev; fail(e); }
  if (/^#\/(tasks|assigned|all|waiting)/.test(location.hash)) renderTaskView();
  updateCounts();
}

// ---------- remarks ----------
function managersOf(p) {
  if (p.manager_id) { const m = person(p.manager_id); return m.active === false ? [] : [m]; }
  return state.profiles.filter((m) => m.active && m.role === 'manager' && m.department_id && m.department_id === p.department_id && m.id !== p.id);
}
function renderRemarks(t, ov) {
  const el = $('[data-remarks]', ov);
  if (!el) return;
  const list = remarksFor(t.id);
  const canStatus = t.assigned_to === state.me.id || canEditTask(t);
  const tags = new Set();
  const people = state.profiles.filter((p) => p.active && p.id !== state.me.id);
  el.innerHTML = `
    <div class="remarks">
      <div class="field"><label>Remarks ${list.length ? `<span class="muted">· ${list.length}</span>` : ''}</label></div>
      <div class="remark-list">${list.length ? list.map((r) => remarkItem(r)).join('') : '<div class="small muted">No remarks yet.</div>'}</div>
      <div class="composer">
        <textarea class="textarea" data-r-body rows="2" maxlength="2000" placeholder="Add a remark, update or reason for delay…"></textarea>
        <div class="composer-row">
          <label class="toggle"><input type="checkbox" data-r-block> <span>${icon.alert(14)} Flag as blocked</span></label>
          <select class="select sm" data-r-reason disabled>${Object.entries(REASONS).map(([k, v]) => `<option value="${k}" ${k === 'dependency' ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="composer-row">
          <select class="select sm" data-r-tag><option value="">Tag a person…</option>${people.map((p) => `<option value="${esc(p.id)}">${esc([p.full_name, byId(state.teams, p.team_id)?.name].filter(Boolean).join(' · '))}</option>`).join('')}</select>
          <label class="toggle"><input type="checkbox" data-r-mgr checked> <span>Also tag their manager</span></label>
        </div>
        <div class="tag-chips" data-r-chips></div>
        ${canStatus && t.status !== 'on_hold' && t.status !== 'completed' ? `<label class="toggle hidden" data-r-hold-wrap><input type="checkbox" data-r-hold checked> <span>Set work status to On hold</span></label>` : ''}
        <div class="composer-row end"><button type="button" class="btn primary sm" data-r-post>${icon.chat(14)} Post remark</button></div>
      </div>
    </div>`;
  const chips = $('[data-r-chips]', el);
  const drawChips = () => {
    chips.innerHTML = [...tags].map((id) => `<span class="tag-chip">${avatar(person(id), 'sm')}${esc(person(id).full_name)}<button type="button" data-untag="${esc(id)}" aria-label="Remove">${icon.x(12)}</button></span>`).join('');
    $$('[data-untag]', chips).forEach((b) => b.addEventListener('click', () => { tags.delete(b.dataset.untag); drawChips(); }));
  };
  $('[data-r-tag]', el).addEventListener('change', (e) => {
    const id = e.target.value; if (!id) return;
    tags.add(id);
    if ($('[data-r-mgr]', el).checked) managersOf(person(id)).forEach((m) => { if (m.id !== state.me.id) tags.add(m.id); });
    e.target.value = ''; drawChips();
  });
  $('[data-r-block]', el).addEventListener('change', (e) => {
    $('[data-r-reason]', el).disabled = !e.target.checked;
    $('[data-r-hold-wrap]', el)?.classList.toggle('hidden', !e.target.checked);
  });
  $('[data-r-post]', el).addEventListener('click', async (e) => {
    const body = $('[data-r-body]', el).value.trim();
    if (!body) { $('[data-r-body]', el).focus(); return toast('Write a remark first', '', 'orange', icon.chat); }
    const blocker = $('[data-r-block]', el).checked;
    e.currentTarget.disabled = true;
    try {
      const r = await store.addRemark({ task_id: t.id, body, kind: blocker ? 'blocker' : 'note', reason: blocker ? $('[data-r-reason]', el).value : null, tagged: [...tags] });
      if (!state.remarks.some((x) => x.id === r.id)) state.remarks.push(r);
      if (blocker && $('[data-r-hold]', el)?.checked && !$('[data-r-hold-wrap]', el)?.classList.contains('hidden')) await changeStatus(t.id, 'on_hold');
      toast(blocker ? 'Blocker flagged' : 'Remark added', tags.size ? `${tags.size} ${tags.size === 1 ? 'person' : 'people'} notified.` : '', blocker ? 'red' : 'blue', blocker ? icon.alert : icon.chat);
      renderRemarks(byId(state.tasks, t.id) || t, ov);
      if (/^#\/(tasks|assigned|all|waiting)/.test(location.hash)) renderTaskView();
      updateCounts();
    } catch (ex) { fail(ex); e.currentTarget.disabled = false; }
  });
  $$('[data-resolve]', el).forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await store.resolveRemark(b.dataset.resolve, true);
      Object.assign(state.remarks.find((x) => x.id === r.id) || {}, r);
      toast('Blocker resolved', 'Everyone involved has been notified.', 'green', icon.check);
      renderRemarks(t, ov);
      if (/^#\/(tasks|assigned|all|waiting)/.test(location.hash)) renderTaskView();
      updateCounts();
    } catch (ex) { fail(ex); }
  }));
  $$('[data-del-remark]', el).forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.style.color = 'var(--red)'; b.title = 'Click again to delete'; return; }
    try { await store.deleteRemark(b.dataset.delRemark); state.remarks = state.remarks.filter((x) => x.id !== b.dataset.delRemark); renderRemarks(t, ov); renderTaskView(); } catch (ex) { fail(ex); }
  }));
}
function remarkItem(r) {
  const a = person(r.author_id);
  const blocker = r.kind === 'blocker';
  return `<div class="remark ${blocker ? 'is-blocker' : ''} ${r.resolved_at ? 'is-resolved' : ''}">
    ${avatar(a, 'sm')}
    <div class="remark-main">
      <div class="remark-head"><b>${esc(r.author_id === state.me.id ? 'You' : a.full_name)}</b>
        ${blocker ? `<span class="pill ${r.resolved_at ? 'tone-green' : 'tone-red'}">${r.resolved_at ? 'Resolved' : 'Blocked'} · ${esc(REASONS[r.reason] || 'Other')}</span>` : ''}
        <time>${esc(fmtDateTime(r.created_at))}</time>
        ${r.author_id === state.me.id || isAdmin() ? `<button type="button" class="icon-btn xs" data-del-remark="${esc(r.id)}" aria-label="Delete remark">${icon.trash(13)}</button>` : ''}
      </div>
      <div class="remark-body">${esc(r.body)}</div>
      ${r.tagged.length ? `<div class="tag-chips">${r.tagged.map((id) => `<span class="tag-chip static">@${esc(id === state.me.id ? 'you' : person(id).full_name)}</span>`).join('')}</div>` : ''}
      ${blocker && !r.resolved_at ? `<button type="button" class="btn sm" data-resolve="${esc(r.id)}">${icon.check(14)} Mark resolved</button>` : ''}
      ${r.resolved_at ? `<div class="small muted">Resolved by ${esc(person(r.resolved_by).full_name)} · ${esc(fmtDateTime(r.resolved_at))}</div>` : ''}
    </div>
  </div>`;
}

// ---------- task detail ----------
function timingBlock(t) {
  const row = (k, v) => `<div class="tl-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const dur = (a, b) => { const h = (new Date(b) - new Date(a)) / 3600e3; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`; };
  return `<div class="timing"><div class="field"><label>Timeline</label></div>
    ${row('Created', esc(fmtDateTime(t.created_at)))}
    ${t.started_at ? row('Started', esc(fmtDateTime(t.started_at))) : ''}
    ${t.completed_at ? row('Completed', `<b style="color:var(--green)">${esc(fmtDateTime(t.completed_at))}</b> · took ${dur(t.created_at, t.completed_at)}${t.due_date ? (t.completed_at.slice(0, 10) <= t.due_date ? ' · <span style="color:var(--green)">on time</span>' : ' · <span style="color:var(--red)">late</span>') : ''}`) : ''}
    <div class="history" data-history><span class="small muted">Loading status history…</span></div></div>`;
}
async function loadHistory(t, ov) {
  const el = $('[data-history]', ov);
  if (!el) return;
  try {
    const ev = await store.listTaskEvents(t.id);
    el.innerHTML = ev.length ? `<div class="small muted" style="margin:8px 0 4px">Status history</div>` + ev.map((e) => {
      const to = statusOf(e.to_status);
      return `<div class="hist-row"><span class="dot-s" style="background:var(--${to.tone === 'gray' ? 'gray' : to.tone === 'blue' ? 'accent' : to.tone})"></span>
        <span><b>${esc(to.label)}</b>${e.changed_by ? ` · ${esc(person(e.changed_by).full_name)}` : ''}</span><time>${esc(fmtDateTime(e.created_at))}</time></div>`;
    }).join('') : '';
  } catch { el.innerHTML = ''; }
}

function openTask(t) {
  if (!t) return;
  if (canEditTask(t)) return openTaskEditor(t);
  const p = prioOf(t.priority);
  const creator = person(t.created_by);
  const assignee = person(t.assigned_to);
  const canStatus = t.assigned_to === state.me.id;
  const links = (t.links || []).map((l) => ({ ...l, href: safeUrl(l.url) })).filter((l) => l.href);
  const overdue = t.status !== 'completed' && t.due_date && t.due_date < todayISO();
  openSheet(`${sheetHead(t.title)}
    <div class="sheet-body">
      ${canStatus ? `<div class="notice">${icon.lock(18)}<div>Assigned by <b>${esc(creator.full_name)}</b>. You can update the work status and add remarks. Other details can only be changed by the person who assigned it.</div></div>`
        : `<div class="notice">${icon.at(18)}<div>You were tagged on this task. Add a remark to reply, or resolve the blocker once it's sorted.</div></div>`}
      ${blockerBanner(t)}
      ${t.description ? `<div style="white-space:pre-wrap">${esc(t.description)}</div>` : ''}
      <div class="detail-grid">
        <div class="detail"><div class="k">Priority</div><div class="v"><span class="pill tone-${p.tone}">${p.label}</span></div></div>
        <div class="detail"><div class="k">Due date</div><div class="v ${overdue ? 'overdue' : ''}" style="${overdue ? 'color:var(--red)' : ''}">${t.due_date ? esc(fmtDue(t)) : 'No due date'}</div></div>
        ${t.platform_id ? `<div class="detail"><div class="k">Platform</div><div class="v">${platformChip(t)}</div></div>` : ''}
        <div class="detail"><div class="k">Assigned by</div><div class="v">${avatar(creator, 'sm')} ${esc(creator.full_name)}</div></div>
        <div class="detail"><div class="k">Assigned to</div><div class="v">${avatar(assignee, 'sm')} ${esc(assignee.full_name)}</div></div>
      </div>
      ${timingBlock(t)}
      ${t.status !== 'completed' ? '<div data-reminders></div>' : ''}
      <div data-remarks></div>
      ${links.length ? `<div><div class="field"><label>Related links</label></div><div class="links">${links.map((l) => `<a class="link-chip" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${icon.link(14)}<span>${esc(l.label || l.href)}</span>${icon.arrow(12)}</a>`).join('')}</div></div>` : ''}
      ${canStatus ? `<div class="field"><label>Work status</label>
        <div class="status-picker">${STATUSES.map((s) => `<button type="button" class="tone-${s.tone} ${s.id === t.status ? 'active' : ''}" data-set="${s.id}" style="background:${s.id === t.status ? '' : 'var(--surface)'}">${statusIcon[s.id](22)}${s.label}</button>`).join('')}</div></div>`
        : `<div class="detail"><div class="k">Status</div><div class="v"><span class="pill dot tone-${statusOf(t.status).tone}">${statusOf(t.status).label}</span></div></div>`}
    </div>`, (ov) => {
    loadHistory(t, ov);
    renderRemarks(t, ov);
    const rb = $('[data-reminders]', ov);
    if (rb) mountReminders(rb, { task: t, getDue: () => ({ date: t.due_date, time: t.due_time }), live: true });
    $$('[data-set]', ov).forEach((b) => b.addEventListener('click', async () => {
      await changeStatus(t.id, b.dataset.set);
      closeSheet();
    }));
  });
}

function assigneeOptions(selected) {
  if (!isManager()) return `<option value="${esc(state.me.id)}">${esc(state.me.full_name)} (me)</option>`;
  const me = state.me;
  const active = state.profiles.filter((p) => p.active && p.id !== me.id);
  const opt = (p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name)}${p.title ? ' — ' + esc(p.title) : ''}</option>`;
  const mine = active.filter((p) => p.manager_id === me.id);
  const dept = active.filter((p) => !mine.includes(p) && me.department_id && p.department_id === me.department_id);
  const rest = active.filter((p) => !mine.includes(p) && !dept.includes(p));
  const groups = new Map();
  rest.forEach((p) => {
    const key = p.department_id ? (p.team_id ? `${deptName(p.department_id)} · ${teamName(p.team_id)}` : deptName(p.department_id)) : 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const byName = (x, y) => x.full_name.localeCompare(y.full_name);
  return `<option value="" ${selected ? '' : 'selected'} disabled>Choose a person…</option>`
    + (mine.length ? `<optgroup label="Reports to you">${mine.sort(byName).map(opt).join('')}</optgroup>` : '')
    + (dept.length ? `<optgroup label="${esc(deptName(me.department_id))}">${dept.sort(byName).map(opt).join('')}</optgroup>` : '')
    + [...groups.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, ps]) => `<optgroup label="${esc(k)}">${ps.sort(byName).map(opt).join('')}</optgroup>`).join('')
    + `<optgroup label="Me"><option value="${esc(me.id)}" ${selected === me.id ? 'selected' : ''}>${esc(me.full_name)} (me, personal task)</option></optgroup>`;
}

function linkRow(l = { label: '', url: '' }) {
  return `<div class="link-row"><input class="input" placeholder="Label (e.g. Brief)" data-l="label" value="${esc(l.label)}">
    <input class="input" placeholder="https://…" data-l="url" value="${esc(l.url)}" inputmode="url">
    <button type="button" class="icon-btn" data-rm aria-label="Remove link">${icon.x(16)}</button></div>`;
}

function openTaskEditor(t = null) {
  const editing = !!t;
  const data = t || { title: '', description: '', priority: 'medium', status: 'not_started', due_date: '', links: [], platform_id: null, assigned_to: isManager() ? '' : state.me.id };
  openSheet(`${sheetHead(editing ? 'Edit task' : 'New task')}
    <form id="task-form" novalidate><div class="sheet-body">
      <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" maxlength="200" placeholder="What needs to be done?" value="${esc(data.title)}" required></div>
      <div class="field"><label for="t-desc">Details</label><textarea class="textarea" id="t-desc" placeholder="Add context, steps or acceptance criteria">${esc(data.description)}</textarea></div>
      <div class="field"><label for="t-assignee">Assign to</label>
        <select class="select" id="t-assignee" ${isManager() ? '' : 'disabled'}>${assigneeOptions(data.assigned_to)}</select>
        ${isManager() ? '' : '<span class="small muted">Team members can add tasks for themselves. Managers can assign to anyone.</span>'}</div>
      <div class="field" id="plat-field" hidden></div>
      <div class="row">
        <div class="field"><label for="t-prio">Priority</label><select class="select" id="t-prio">${PRIORITIES.map((p) => `<option value="${p.id}" ${p.id === data.priority ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="field"><label for="t-due">Due date</label><input class="input" type="date" id="t-due" value="${esc(data.due_date || '')}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="t-time">Time <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" type="time" id="t-time" value="${esc(data.due_time || '')}"></div>
        <div class="field"></div>
      </div>
      <div data-reminders></div>
      <div class="field"><label for="t-status">Work status</label><select class="select" id="t-status">${STATUSES.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div class="field"><label>Related links</label>
        <div id="links" style="display:grid;gap:8px">${(data.links || []).map(linkRow).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-link" style="justify-self:start">${icon.plus(14)} Add link</button></div>
      ${editing ? timingBlock(t) + '<div data-remarks></div>' : ''}
      <div class="error" id="t-error"></div>
    </div>
    <div class="sheet-foot">
      ${editing ? `<button type="button" class="btn danger left" id="t-delete">${icon.trash(16)} Delete</button>` : ''}
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">${editing ? 'Save changes' : 'Create task'}</button>
    </div></form>`, (ov) => {
    if (editing) { loadHistory(t, ov); renderRemarks(t, ov); }
    // Platform picker follows the assignee's department; hidden when that department has none.
    let chosenPlat = data.platform_id || '';
    const renderPlat = () => {
      const box = $('#plat-field', ov);
      const assignee = person($('#t-assignee', ov).value || data.assigned_to);
      const opts = platformsFor(assignee.department_id, data.platform_id);
      if (!opts.some((o) => o.id === chosenPlat)) chosenPlat = '';
      box.hidden = !opts.length;
      box.innerHTML = opts.length ? `<label>Platform</label>
        <div class="plat-pick" role="radiogroup" aria-label="Platform">
          ${opts.map((o) => `<button type="button" role="radio" aria-checked="${o.id === chosenPlat}" class="${o.id === chosenPlat ? 'on' : ''}" data-plat="${esc(o.id)}">${icon.tag(13)}${esc(o.name)}${o.archived ? ' (removed)' : ''}</button>`).join('')}
          <button type="button" role="radio" aria-checked="${!chosenPlat}" class="none ${chosenPlat ? '' : 'on'}" data-plat="">None</button>
        </div>` : '';
      $$('[data-plat]', box).forEach((b) => b.addEventListener('click', () => { chosenPlat = b.dataset.plat; renderPlat(); }));
    };
    renderPlat();
    const rem = mountReminders($('[data-reminders]', ov), {
      task: t, getDue: () => ({ date: $('#t-due', ov).value, time: $('#t-time', ov).value }),
      assigneeId: () => (isManager() ? $('#t-assignee', ov).value : state.me.id) || null,
    });
    $('#t-assignee', ov).addEventListener('change', () => { renderPlat(); rem.redraw(); });
    ['#t-due', '#t-time'].forEach((sel) => $(sel, ov).addEventListener('change', () => rem.redraw()));
    const linksEl = $('#links', ov);
    const bindRm = () => $$('[data-rm]', linksEl).forEach((b) => { b.onclick = () => b.closest('.link-row').remove(); });
    bindRm();
    $('#add-link', ov).addEventListener('click', () => { linksEl.insertAdjacentHTML('beforeend', linkRow()); bindRm(); $$('[data-l="label"]', linksEl).pop().focus(); });
    $('#t-delete', ov)?.addEventListener('click', async (e) => {
      if (!await confirmDialog({ title: 'Delete this task?', body: `"${t.title}" and its remarks and history will be removed for everyone.` })) return;
      try { await store.deleteTask(t.id); state.tasks = state.tasks.filter((x) => x.id !== t.id); closeSheet(); route(); toast('Task deleted'); } catch (ex) { fail(ex); }
    });
    $('#task-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#t-error', ov);
      const links = $$('.link-row', linksEl).map((r) => ({ label: $('[data-l=label]', r).value.trim(), url: normalizeUrl($('[data-l=url]', r).value) })).filter((l) => l.url);
      const bad = links.find((l) => !safeUrl(l.url));
      const payload = {
        title: $('#t-title', ov).value.trim(),
        description: $('#t-desc', ov).value.trim(),
        assigned_to: isManager() ? $('#t-assignee', ov).value : state.me.id,
        priority: $('#t-prio', ov).value,
        due_date: $('#t-due', ov).value || null,
        due_time: $('#t-due', ov).value ? ($('#t-time', ov).value || null) : null,
        status: $('#t-status', ov).value,
        links,
      };
      // Only send platform_id when platforms exist, so databases without migration 006 keep working.
      if (state.platforms.length || data.platform_id) payload.platform_id = chosenPlat || null;
      if (!state.remindersReady && !payload.due_time) delete payload.due_time;  // database not updated yet
      if (!payload.title) { err.textContent = 'Give the task a title.'; return; }
      if (!payload.assigned_to) { err.textContent = 'Choose who this task is for.'; $('#t-assignee', ov).focus(); return; }
      if (bad) { err.textContent = `"${bad.url}" is not a valid link.`; return; }
      const btn = $('button[type=submit]', ov); btn.disabled = true;
      try {
        if (editing) {
          const u = await store.updateTask(t.id, payload);
          Object.assign(byId(state.tasks, t.id), u);
          await rem.save(byId(state.tasks, t.id));
          toast('Task updated', '', 'blue', icon.check);
        } else {
          const n = await store.createTask(payload);
          if (!byId(state.tasks, n.id)) state.tasks.unshift(n);
          await rem.save(n);
          const a = person(n.assigned_to);
          toast('Task created', n.assigned_to === state.me.id ? 'Added to your list.' : `Assigned to ${a.full_name}.`, 'green', icon.check);
          if (n.assigned_to !== state.me.id && location.hash === '#/tasks') { location.hash = '#/assigned'; closeSheet(); return; }
        }
        closeSheet(); route();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
  });
}

// =====================================================================
//  KPI views
// =====================================================================
function ring(score, tone) {
  const r = 56, c = 2 * Math.PI * r;
  const val = score ?? 0;
  const color = { green: 'var(--green)', blue: 'var(--accent)', orange: 'var(--orange)', red: 'var(--red)', neutral: 'var(--gray)' }[tone];
  return `<div class="ring"><svg width="132" height="132" viewBox="0 0 132 132">
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
    <circle class="prog" cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - val / 100)}"/></svg>
    <div class="ring-label"><div><b>${score ?? '—'}</b><span>Score</span></div></div></div>`;
}
function animateRings(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => $$('circle.prog', root).forEach((c) => c.setAttribute('stroke-dashoffset', c.dataset.target))));
}

function kpiBody(k, p, hero = null) {
  const segs = [
    ['Completed', k.completed, 'var(--green)'], ['In progress', k.in_progress, 'var(--accent)'],
    ['On hold', k.on_hold, 'var(--orange)'], ['Not started', k.not_started, 'var(--gray)'],
  ];
  const max = Math.max(1, ...k.weekly);
  const weekLabel = (i) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * (7 - i)); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  return `
    <div class="card"><div class="profile-hero">
      ${hero ? `<div class="avatar lg team-av">${icon.team(34)}</div>` : avatar(p, 'lg')}
      <div class="info"><h2>${esc(hero ? hero.title : p.full_name)}</h2>
        <div class="muted">${hero ? esc(hero.sub) : esc(orgLine(p, p.title || roleLabel(p.role)))}</div>
        <div style="margin-top:10px"><span class="pill tone-${k.band.tone}">${esc(k.band.label)}</span></div>
      </div>
      ${ring(k.score, k.band.tone)}
    </div></div>
    <div class="grid cols-4" style="margin-top:16px">
      <div class="card stat"><div class="label">Completion rate</div><div class="value">${pct(k.completionRate)}</div><div class="sub">${k.completed} of ${k.total} tasks</div></div>
      <div class="card stat"><div class="label">On-time delivery</div><div class="value">${k.completed ? pct(k.onTimeRate) : '—'}</div><div class="sub">${k.completed_on_time} on time · ${k.completed_late} late</div></div>
      <div class="card stat"><div class="label">Avg. time to complete</div><div class="value">${esc(formatHours(k.avg_completion_hours))}</div><div class="sub">From assignment to done</div></div>
      <div class="card stat"><div class="label">Overdue now</div><div class="value" style="${k.overdue_open ? 'color:var(--red)' : ''}">${k.overdue_open}</div><div class="sub">${k.open} open task${k.open === 1 ? "" : "s"}</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h2>Work status</h2>
        <div class="stack-bar">${k.total ? segs.filter((s) => s[1]).map((s) => `<div style="width:${(s[1] / k.total) * 100}%;background:${s[2]}" title="${s[0]}: ${s[1]}"></div>`).join('') : ''}</div>
        <div class="legend">${segs.map((s) => `<span><i style="background:${s[2]}"></i>${s[0]} <b style="color:var(--text)">${s[1]}</b></span>`).join('')}</div>
        <div class="small muted" style="margin-top:14px">${k.high_priority_completed} high or urgent priority tasks completed.</div>
      </div>
      <div class="card"><h2>Completed per week</h2>
        <div class="bars">${k.weekly.map((v, i) => `<div class="b"><em>${v || ''}</em><div class="${v ? '' : 'zero'}" style="height:${(v / max) * 100}%"></div><span>${esc(weekLabel(i))}</span></div>`).join('')}</div>
      </div>
    </div>
    <p class="small muted" style="margin-top:14px">Score = 40% completion rate + 40% on-time delivery + 20% open tasks not overdue.</p>`;
}

// Per-platform performance table, from kpi_platforms() rows (one per person x platform).
function platformBreakdown(rows) {
  if (!rows.some((r) => r.platform_id)) return '';
  const by = new Map();
  rows.forEach((r) => {
    const k = r.platform_id || '';
    const a = by.get(k) || { total: 0, completed: 0, open: 0, overdue_open: 0, completed_on_time: 0, completed_late: 0 };
    Object.keys(a).forEach((f) => { a[f] += r[f] || 0; });
    by.set(k, a);
  });
  const list = [...by.entries()].map(([id, a]) => ({ id, pl: platformOf(id), ...a }))
    .sort((x, y) => (x.id ? 0 : 1) - (y.id ? 0 : 1) || y.total - x.total);
  const multiDept = new Set(list.filter((r) => r.pl).map((r) => r.pl.department_id)).size > 1;
  const max = Math.max(1, ...list.map((r) => r.total));
  return `<div class="card" style="margin-top:16px"><h2>By platform</h2>
    <div class="table-wrap"><table class="table plat-table"><thead><tr><th>Platform</th><th>Tasks</th><th>Completed</th><th>On time</th><th>Open</th><th>Overdue</th></tr></thead><tbody>
    ${list.map((r) => `<tr>
      <td>${r.pl ? `<span class="plat-chip">${icon.tag(12)}${esc(r.pl.name)}</span>${multiDept ? ` <span class="small muted">${esc(deptName(r.pl.department_id))}</span>` : ''}${r.pl.archived ? ' <span class="small muted">(removed)</span>' : ''}` : '<span class="muted">No platform</span>'}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="meter"><div style="width:${(r.total / max) * 100}%"></div></div>${r.total}</div></td>
      <td>${r.completed} <span class="small muted">${r.total ? pct(r.completed / r.total) : ''}</span></td>
      <td>${r.completed ? pct(r.completed_on_time / r.completed) : '—'}</td>
      <td>${r.open}</td>
      <td style="${r.overdue_open ? 'color:var(--red);font-weight:600' : ''}">${r.overdue_open}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}

async function renderKpi(userId) {
  const self = userId === state.me.id;
  $('#view').innerHTML = `<section class="content"><div class="page-head"><div><h1>${self ? 'My Performance' : 'Performance'}</h1><p>${self ? 'Your KPI profile, built from the tasks assigned to you.' : ''}</p></div></div><div class="boot" style="min-height:200px"><div class="spinner"></div></div></section>`;
  try {
    const [rows, platRows] = await Promise.all([store.kpiStats(self ? 'me' : 'user', self ? null : userId), store.kpiPlatforms(self ? 'me' : 'user', self ? null : userId).catch(() => [])]);
    if (!rows.length) { $('#view .content').innerHTML = `<div class="empty"><h3>Not available</h3><p>You can view KPIs for people in your department only.</p></div>`; return; }
    const k = computeKpi(rows[0]);
    const p = person(userId);
    $('#view .content').innerHTML = `
      <div class="page-head"><div>${self ? '' : `<button class="btn ghost" style="padding-left:0" onclick="location.hash='#/team-kpi'">‹ Back</button>`}<h1>${self ? 'My Performance' : esc(p.full_name)}</h1>
      <p>${self ? 'Your KPI profile, built from the tasks assigned to you.' : 'KPI profile'}</p></div></div>${kpiBody(k, p)}${platformBreakdown(platRows)}`;
    animateRings();
  } catch (e) { fail(e); }
}

async function renderTeamKpi() {
  const title = 'Team Performance';
  $('#view').innerHTML = `<section class="content"><div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Combined performance of everyone, across all departments.' : `Combined performance of everyone in ${esc(deptName(state.me.department_id))}.`}</p></div></div><div class="boot" style="min-height:200px"><div class="spinner"></div></div></section>`;
  try {
    const [rawRows, platRows] = await Promise.all([store.kpiStats('department'), store.kpiPlatforms('department').catch(() => [])]);
    const rows = rawRows.map(computeKpi).map((k) => ({ ...k, p: person(k.user_id) }));
    const s = state.kpiSort;
    const val = (r) => s.key === 'name' ? r.p.full_name : s.key === 'team' ? teamName(r.p.team_id) : (r[s.key] ?? -1);
    rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir; });
    const scored = rows.filter((r) => r.score !== null);
    const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    // Combined KPI for the whole team: add up everyone's counts.
    const agg = { total: 0, completed: 0, in_progress: 0, on_hold: 0, not_started: 0, overdue_open: 0, completed_on_time: 0, completed_late: 0, high_priority_completed: 0, weekly: Array(8).fill(0) };
    let hrs = 0;
    rows.forEach((r) => {
      Object.keys(agg).forEach((k) => { if (k !== 'weekly') agg[k] += r[k] || 0; });
      r.weekly.forEach((v, i) => { agg.weekly[i] += v; });
      if (r.avg_completion_hours !== null && r.avg_completion_hours !== undefined) hrs += Number(r.avg_completion_hours) * r.completed;
    });
    agg.avg_completion_hours = agg.completed ? hrs / agg.completed : null;
    const team = computeKpi(agg);
    const heroInfo = { title: isAdmin() ? 'Whole company' : deptName(state.me.department_id), sub: `Combined performance of ${rows.length} ${rows.length === 1 ? 'person' : 'people'} · average individual score ${avg ?? '—'}` };
    const th = (key, label) => `<th data-sort="${key}">${label}${s.key === key ? (s.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    $('#view .content').innerHTML = `
      <div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Combined performance of everyone, across all departments.' : `Combined performance of everyone in ${esc(deptName(state.me.department_id))}.`}</p></div></div>
      ${kpiBody(team, null, heroInfo)}
      ${platformBreakdown(platRows)}
      <div class="card" style="margin-top:16px"><h2>Team members</h2>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
          ${th('name', 'Member')}${th('team', 'Team')}${th('score', 'Score')}${th('completionRate', 'Completion')}${th('onTimeRate', 'On time')}${th('open', 'Open')}${th('overdue_open', 'Overdue')}
        </tr></thead><tbody>
        ${rows.map((r) => `<tr data-user="${esc(r.user_id)}">
          <td><div class="person">${avatar(r.p)}<div><b>${esc(r.p.full_name)}</b><span>${esc(r.p.title || roleLabel(r.p.role))}</span></div></div></td>
          <td>${r.p.team_id ? esc(teamName(r.p.team_id)) : '<span class="muted">—</span>'}${isAdmin() ? `<div class="small muted">${esc(deptName(r.p.department_id))}</div>` : ''}</td>
          <td>${r.score === null ? '<span class="muted">—</span>' : `<span class="pill tone-${r.band.tone}">${r.score}</span>`}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="meter"><div style="width:${r.completionRate * 100}%"></div></div>${pct(r.completionRate)}</div></td>
          <td>${r.completed ? pct(r.onTimeRate) : '—'}</td>
          <td>${r.open}</td>
          <td style="${r.overdue_open ? 'color:var(--red);font-weight:600' : ''}">${r.overdue_open}</td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No one in this department yet.</div>'}
      </div>`;
    $$('[data-sort]').forEach((h) => h.addEventListener('click', () => {
      const k = h.dataset.sort; s.dir = s.key === k ? -s.dir : (k === 'name' || k === 'team' ? 1 : -1); s.key = k; renderTeamKpi();
    }));
    animateRings();
    $$('tr[data-user]').forEach((tr) => tr.addEventListener('click', () => { location.hash = '#/kpi/' + encodeURIComponent(tr.dataset.user); }));
  } catch (e) { fail(e); }
}

// =====================================================================
//  People & teams
// =====================================================================
async function renderPeople() {
  try { state.invitations = await store.listInvitations(); } catch (e) { state.invitations = []; }
  const live = state.profiles.filter((p) => !p.deleted_at);
  const visible = isAdmin() ? live : live.filter((p) => p.department_id === state.me.department_id || p.manager_id === state.me.id);
  const depts = isAdmin() ? state.departments : state.departments.filter((d) => d.id === state.me.department_id);
  const pending = state.invitations.filter((i) => !i.accepted_at);
  const roleTone = { admin: 'purple', manager: 'blue', member: 'gray' };

  $('#view').innerHTML = `
  <section class="content">
    <div class="page-head"><div><h1>People & Teams</h1><p>${isAdmin() ? 'Add people, set roles and organise departments and teams.' : `Add members to ${esc(deptName(state.me.department_id))}.`}</p></div>
      <button class="btn primary" id="invite-btn">${icon.plus(16)} Add person</button></div>
    <div class="grid ${isAdmin() ? 'cols-2' : ''}" style="align-items:start">
      <div class="card"><h2>Directory</h2>
        ${depts.map((d) => {
          const inDept = visible.filter((p) => p.department_id === d.id);
          const teams = state.teams.filter((t) => t.department_id === d.id);
          const noTeam = inDept.filter((p) => !p.team_id || !teams.some((t) => t.id === p.team_id));
          return `<div class="group-title">${esc(d.name)}</div>
            ${teams.map((t) => {
              const ps = inDept.filter((p) => p.team_id === t.id);
              return `<div class="small muted" style="margin:10px 0 2px;font-weight:600">${esc(t.name)} · ${ps.length}</div>${ps.map((p) => personRow(p, roleTone)).join('') || '<div class="small muted" style="padding:6px 4px">No one yet</div>'}`;
            }).join('')}
            ${noTeam.length ? `<div class="small muted" style="margin:10px 0 2px;font-weight:600">No team</div>${noTeam.map((p) => personRow(p, roleTone)).join('')}` : ''}`;
        }).join('')}
        ${isAdmin() && visible.some((p) => !p.department_id) ? `<div class="group-title">No department</div>${visible.filter((p) => !p.department_id).map((p) => personRow(p, roleTone)).join('')}` : ''}
      </div>
      ${isAdmin() ? `<div class="card"><h2>Departments & teams</h2>
        <form id="dept-form" style="display:flex;gap:8px;margin-bottom:14px"><input class="input" id="dept-name" placeholder="New department"><button class="btn">Add</button></form>
        ${state.departments.map((d) => `
          <div style="padding:10px 0;border-top:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:8px" data-rename-box><b style="flex:1" data-name>${esc(d.name)}</b>
              <button class="icon-btn" data-edit-dept="${esc(d.id)}" data-current="${esc(d.name)}" aria-label="Rename department" title="Rename">${icon.pencil(16)}</button>
              <button class="icon-btn" data-del-dept="${esc(d.id)}" aria-label="Delete department">${icon.trash(16)}</button></div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">
              ${state.teams.filter((t) => t.department_id === d.id).map((t) => `<span class="chip" style="cursor:default" data-rename-box><span data-name>${esc(t.name)}</span><button class="icon-btn" style="width:20px;height:20px" data-edit-team="${esc(t.id)}" data-current="${esc(t.name)}" aria-label="Rename team" title="Rename">${icon.pencil(12)}</button><button class="icon-btn" style="width:20px;height:20px" data-del-team="${esc(t.id)}" aria-label="Delete team">${icon.x(12)}</button></span>`).join('')}
            </div>
            <form class="team-form" data-dept="${esc(d.id)}" style="display:flex;gap:8px"><input class="input" placeholder="New team in ${esc(d.name)}" style="padding:8px 12px"><button class="btn sm">Add team</button></form>
          </div>`).join('')}
      </div>` : ''}
    </div>
    ${pending.length ? `<div class="card" style="margin-top:16px"><h2>Waiting to activate</h2>
      ${pending.map((i) => `<div class="list-row"><div class="avatar" style="background:var(--gray)">${esc(initials(i.full_name || i.email))}</div>
        <div class="grow"><b>${esc(i.full_name || i.email)}</b><span>${esc([i.email, roleLabel(i.role), byId(state.teams, i.team_id)?.name].filter(Boolean).join(' · '))}</span></div>
        <button class="btn sm primary" data-activate="${esc(i.email)}">Activate now</button>
        <button class="btn sm" data-copy="${esc(i.email)}">Copy invite</button>
        <button class="icon-btn" data-del-inv="${esc(i.email)}" aria-label="Remove invitation">${icon.trash(16)}</button></div>`).join('')}
      <p class="small muted">Click <b>Activate now</b> to create their account with a password you choose, or share the app link so they activate it themselves.</p></div>` : ''}
  </section>`;

  $('#invite-btn').addEventListener('click', openInvite);
  $$('[data-person]').forEach((r) => r.addEventListener('click', () => {
    const p = person(r.dataset.person);
    if (isAdmin()) openPersonEditor(p); else location.hash = '#/kpi/' + encodeURIComponent(p.id);
  }));
  $$('[data-activate]').forEach((b) => b.addEventListener('click', () => {
    const inv = state.invitations.find((i) => i.email === b.dataset.activate);
    if (inv) openActivate(inv);
  }));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = `You've been added to ${CONFIG.APP_NAME}. Open ${location.origin + location.pathname}, choose "Activate your account" and sign up with ${b.dataset.copy}.`;
    try { await navigator.clipboard.writeText(text); toast('Invite message copied', 'Paste it into email or chat.', 'green', icon.check); } catch { prompt('Copy this message', text); }
  }));
  $$('[data-del-inv]').forEach((b) => b.addEventListener('click', async () => {
    try { await store.deleteInvitation(b.dataset.delInv); renderPeople(); } catch (e) { fail(e); }
  }));
  $('#dept-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const name = $('#dept-name').value.trim(); if (!name) return;
    try { await store.createDepartment(name); state.departments = await store.listDepartments(); renderPeople(); } catch (ex) { fail(ex); }
  });
  $$('.team-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const name = $('input', f).value.trim(); if (!name) return;
    try { await store.createTeam(name, f.dataset.dept); state.teams = await store.listTeams(); renderPeople(); } catch (ex) { fail(ex); }
  }));
  const inlineRename = (b, save) => b.addEventListener('click', () => {
    const box = b.closest('[data-rename-box]');
    const name = $('[data-name]', box);
    if ($('input', box)) return;
    const input = document.createElement('input');
    input.className = 'input rename-input'; input.value = b.dataset.current; input.setAttribute('aria-label', 'New name');
    name.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = async (ok) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (!ok || !v || v === b.dataset.current) { input.replaceWith(name); return; }
      try { await save(v); await loadAll(); renderPeople(); toast('Renamed', `Now called "${v}".`, 'green', icon.check); }
      catch (ex) { input.replaceWith(name); fail(new Error(/duplicate key/i.test(ex.message) ? 'That name is already used.' : ex.message)); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  });
  $$('[data-edit-dept]').forEach((b) => inlineRename(b, (v) => store.renameDepartment(b.dataset.editDept, v)));
  $$('[data-edit-team]').forEach((b) => inlineRename(b, (v) => store.renameTeam(b.dataset.editTeam, v)));
  const confirmDel = (b, fn) => b.addEventListener('click', async () => {
    const what = b.dataset.delDept ? `department "${deptName(b.dataset.delDept)}"` : `team "${teamName(b.dataset.delTeam)}"`;
    if (!await confirmDialog({ title: `Delete ${what}?`, body: 'People in it stay, but will no longer be in it.' })) return;
    try { await fn(); await loadAll(); renderPeople(); } catch (ex) { fail(ex); }
  });
  $$('[data-del-dept]').forEach((b) => confirmDel(b, () => store.deleteDepartment(b.dataset.delDept)));
  $$('[data-del-team]').forEach((b) => confirmDel(b, () => store.deleteTeam(b.dataset.delTeam)));
}

// =====================================================================
//  Platforms (per department; managers manage their own department's)
// =====================================================================
function renderPlatforms() {
  const depts = isAdmin() ? state.departments : state.departments.filter((d) => d.id === state.me.department_id);
  const usage = (id) => state.tasks.filter((t) => t.platform_id === id).length;
  $('#view').innerHTML = `
  <section class="content">
    <div class="page-head"><div><h1>Platforms</h1><p>${isAdmin() ? 'Each department has its own platform list. Managers can edit their own department\'s list.' : `The platform options people in ${esc(deptName(state.me.department_id))} can pick on a task.`}</p></div></div>
    ${depts.length ? `<div class="grid ${depts.length > 1 ? 'cols-2' : ''}" style="align-items:start">${depts.map((d) => {
      const active = state.platforms.filter((p) => p.department_id === d.id && !p.archived).sort((a, b) => a.name.localeCompare(b.name));
      const removed = state.platforms.filter((p) => p.department_id === d.id && p.archived).sort((a, b) => a.name.localeCompare(b.name));
      const can = canManagePlatforms(d.id);
      return `<div class="card plat-card" data-dept="${esc(d.id)}"><h2>${esc(d.name)}</h2>
        <div class="plat-list">${active.map((p) => `<div class="plat-row" data-rename-box>
            <span class="plat-chip">${icon.tag(12)}<span data-name>${esc(p.name)}</span></span>
            <span class="small muted">${usage(p.id) ? `${usage(p.id)} task${usage(p.id) === 1 ? '' : 's'}` : ''}</span>
            ${can ? `<button class="icon-btn" data-plat-rename="${esc(p.id)}" data-current="${esc(p.name)}" aria-label="Rename ${esc(p.name)}" title="Rename">${icon.pencil(15)}</button>
            <button class="icon-btn" data-plat-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" title="Remove">${icon.trash(15)}</button>` : ''}
          </div>`).join('') || `<div class="small muted" style="padding:6px 2px">No platforms yet. The platform field stays hidden on tasks for this department until you add one.</div>`}</div>
        ${can ? `<form class="plat-add" data-add-plat="${esc(d.id)}"><input class="input" maxlength="60" placeholder="Add a platform, e.g. Flipkart" aria-label="New platform for ${esc(d.name)}">
          <button class="btn primary sm" type="submit">${icon.plus(14)} Add</button></form>` : ''}
        ${removed.length ? `<div class="small muted" style="margin-top:14px;font-weight:600">Removed (still shown on older tasks)</div>
          ${removed.map((p) => `<div class="plat-row removed"><span class="plat-chip">${icon.tag(12)}${esc(p.name)}</span><span class="small muted">${usage(p.id) ? `${usage(p.id)} task${usage(p.id) === 1 ? '' : 's'}` : ''}</span>
            ${can ? `<button class="btn ghost sm" data-plat-restore="${esc(p.id)}">Restore</button>` : ''}</div>`).join('')}` : ''}
      </div>`;
    }).join('')}</div>` : `<div class="empty"><h3>No department</h3><p>Ask an admin to put you in a department to manage its platforms.</p></div>`}
  </section>`;

  const reload = async () => { state.platforms = await store.listPlatforms(); renderPlatforms(); };
  $$('[data-add-plat]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('input', f); const name = input.value.trim();
    if (!name) return input.focus();
    try { await store.createPlatform(f.dataset.addPlat, name); await reload(); toast('Platform added', `"${name}" is now an option on tasks.`, 'green', icon.tag); $(`[data-add-plat="${f.dataset.addPlat}"] input`)?.focus(); }
    catch (ex) { fail(ex); }
  }));
  $$('[data-plat-rename]').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('[data-rename-box]'); const name = $('[data-name]', box);
    if ($('input', box)) return;
    const input = document.createElement('input');
    input.className = 'input rename-input'; input.value = b.dataset.current; input.maxLength = 60; input.setAttribute('aria-label', 'New name');
    name.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = async (ok) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (!ok || !v || v === b.dataset.current) { input.replaceWith(name); return; }
      try { await store.renamePlatform(b.dataset.platRename, v); await reload(); toast('Renamed', `Now called "${v}".`, 'green', icon.check); }
      catch (ex) { input.replaceWith(name); fail(ex); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  }));
  $$('[data-plat-remove]').forEach((b) => b.addEventListener('click', async () => {
    const pl = byId(state.platforms, b.dataset.platRemove);
    if (!await confirmDialog({ title: `Remove "${pl?.name}"?`, body: 'It can no longer be picked. Tasks that already use it keep it, and you can restore it later.', confirm: 'Remove' })) return;
    try {
      const r = await store.removePlatform(b.dataset.platRemove); await reload();
      toast('Platform removed', r === 'archived' ? 'Older tasks keep it, but it can no longer be picked.' : '', 'gray', icon.trash);
    } catch (ex) { fail(ex); }
  }));
  $$('[data-plat-restore]').forEach((b) => b.addEventListener('click', async () => {
    try { await store.restorePlatform(b.dataset.platRestore); await reload(); toast('Platform restored', '', 'green', icon.check); } catch (ex) { fail(ex); }
  }));
}

// =====================================================================
//  Personal to-do list (private to each person)
// =====================================================================
const personalBlocked = () => state.personalError
  ? `<div class="notice">${icon.info(18)}<div>${esc(state.personalError)}</div></div>` : '';

async function renderTodos() {
  try { state.todos = await store.listTodos(); state.personalError = ''; } catch (e) { state.personalError = e.message; }
  const open = state.todos.filter((t) => !t.done).sort((a, b) => a.position - b.position);
  const done = state.todos.filter((t) => t.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  const item = (t) => `<li class="todo ${t.done ? 'is-done' : ''}" data-todo="${esc(t.id)}" ${t.done ? '' : 'draggable="true"'}>
      ${t.done ? '' : `<span class="grip" aria-hidden="true">${icon.grip(16)}</span>`}
      <button class="todo-check" data-toggle aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}" aria-pressed="${t.done}">${icon.check(14)}</button>
      <span class="todo-title" data-edit tabindex="0" title="Double-click to edit">${esc(t.title)}</span>
      ${t.done && t.done_at ? `<span class="small muted">${esc(timeAgo(t.done_at))}</span>` : ''}
      <button class="icon-btn todo-del" data-del aria-label="Delete">${icon.x(15)}</button>
    </li>`;
  const doneOpen = (() => { try { return localStorage.getItem('taskflow-todo-done') !== 'closed'; } catch { return true; } })();
  $('#view').innerHTML = `
  <section class="content narrow">
    <div class="page-head"><div><h1>To-do</h1><p>Your private checklist for quick work. Only you can see it.</p></div></div>
    ${personalBlocked()}
    <form class="todo-add card" id="todo-add">
      <span class="todo-plus">${icon.plus(18)}</span>
      <input class="todo-input" id="todo-input" maxlength="300" placeholder="Add a to-do and press Enter" autocomplete="off" aria-label="New to-do" ${state.personalError ? 'disabled' : ''}>
    </form>
    <div class="card todo-card">
      ${open.length ? `<ul class="todo-list" id="todo-open">${open.map(item).join('')}</ul>`
        : `<div class="todo-empty">${icon.check(28)}<b>All clear</b><span>Nothing on your list. Add something above.</span></div>`}
    </div>
    ${done.length ? `<details class="todo-done" ${doneOpen ? 'open' : ''}><summary><span>Completed · ${done.length}</span>
        <button class="btn ghost sm" id="todo-clear" type="button">Clear completed</button></summary>
      <ul class="todo-list">${done.map(item).join('')}</ul></details>` : ''}
    <p class="small muted" style="margin-top:12px">Tip: drag to reorder, double-click to edit.</p>
  </section>`;

  const input = $('#todo-input');
  if (!state.personalError) input.focus();
  $('#todo-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim(); if (!title) return;
    const top = open.length ? Math.min(...open.map((t) => t.position)) - 1 : Date.now() / 1000;
    input.value = '';
    try { const t = await store.addTodo(title, top); state.todos.push(t); renderTodos(); updateCounts(); } catch (ex) { input.value = title; fail(ex); }
  });
  $('.todo-done')?.addEventListener('toggle', (e) => { try { localStorage.setItem('taskflow-todo-done', e.target.open ? 'open' : 'closed'); } catch {} });
  $('#todo-clear')?.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    try { await store.clearDoneTodos(); state.todos = state.todos.filter((t) => !t.done); renderTodos(); toast('Completed to-dos cleared', '', 'gray', icon.trash); } catch (ex) { fail(ex); }
  });
  $$('[data-todo]').forEach((li) => {
    const id = li.dataset.todo; const t = byId(state.todos, id);
    $('[data-toggle]', li).addEventListener('click', async () => {
      li.classList.add('ticking');
      try {
        Object.assign(t, await store.updateTodo(id, { done: !t.done }));
        if (t.done) chime('green', { force: false });
        setTimeout(() => { renderTodos(); updateCounts(); }, t.done ? 260 : 0);
      } catch (ex) { li.classList.remove('ticking'); fail(ex); }
    });
    $('[data-del]', li).addEventListener('click', async () => {
      li.classList.add('removing');
      try { await store.deleteTodo(id); state.todos = state.todos.filter((x) => x.id !== id); setTimeout(() => { renderTodos(); updateCounts(); }, 180); } catch (ex) { li.classList.remove('removing'); fail(ex); }
    });
    const title = $('[data-edit]', li);
    const startEdit = () => {
      if ($('input', li)) return;
      const ed = document.createElement('input');
      ed.className = 'input todo-edit'; ed.value = t.title; ed.maxLength = 300; ed.setAttribute('aria-label', 'Edit to-do');
      title.replaceWith(ed); ed.focus(); ed.select();
      let fin = false;
      const finish = async (ok) => {
        if (fin) return; fin = true;
        const v = ed.value.trim();
        if (!ok || !v || v === t.title) { ed.replaceWith(title); return; }
        try { Object.assign(t, await store.updateTodo(id, { title: v })); title.textContent = v; } catch (ex) { fail(ex); }
        ed.replaceWith(title);
      };
      ed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
      ed.addEventListener('blur', () => finish(true));
    };
    title.addEventListener('dblclick', startEdit);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') startEdit(); });
  });
  // Drag to reorder (open items only). The new position sits between its neighbours.
  const list = $('#todo-open');
  if (list) {
    let dragging = null;
    list.addEventListener('dragstart', (e) => { dragging = e.target.closest('[data-todo]'); if (!dragging) return; dragging.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging.dataset.todo); });
    list.addEventListener('dragover', (e) => {
      if (!dragging) return; e.preventDefault();
      const after = [...list.querySelectorAll('[data-todo]:not(.dragging)')].find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
      if (after) list.insertBefore(dragging, after); else list.appendChild(dragging);
    });
    list.addEventListener('dragend', async () => {
      if (!dragging) return;
      const el = dragging; dragging = null; el.classList.remove('dragging');
      const ids = [...list.querySelectorAll('[data-todo]')].map((x) => x.dataset.todo);
      const i = ids.indexOf(el.dataset.todo);
      const pos = (k) => byId(state.todos, ids[k])?.position;
      const prev = i > 0 ? pos(i - 1) : null, next = i < ids.length - 1 ? pos(i + 1) : null;
      const np = prev === null ? next - 1 : next === null ? prev + 1 : (prev + next) / 2;
      const t = byId(state.todos, el.dataset.todo);
      if (t.position === np) return;
      try { Object.assign(t, await store.updateTodo(t.id, { position: np })); } catch (ex) { fail(ex); renderTodos(); }
    });
  }
}

// =====================================================================
//  Personal notes (private to each person), with autosave
// =====================================================================
let noteSel = null;
async function renderNotes() {
  try { state.notes = await store.listNotes(); state.personalError = ''; } catch (e) { state.notes = []; state.personalError = e.message; }
  if (noteSel && !byId(state.notes, noteSel)) noteSel = null;
  if (!noteSel && state.notes.length && !matchMedia('(max-width: 860px)').matches) noteSel = sortedNotes()[0].id;
  drawNotes();
}
const sortedNotes = () => [...state.notes].sort((a, b) => (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at));
const noteTitle = (n) => n.title.trim() || n.body.trim().split('\n')[0].slice(0, 60) || 'Untitled note';

function drawNotes(q = $('#note-search')?.value || '') {
  const ql = q.trim().toLowerCase();
  const list = sortedNotes().filter((n) => !ql || (n.title + ' ' + n.body).toLowerCase().includes(ql));
  const cur = noteSel ? byId(state.notes, noteSel) : null;
  $('#view').innerHTML = `
  <section class="content wide">
    <div class="page-head"><div><h1>Notes</h1><p>Private notes that save as you type. Only you can see them.</p></div>
      <button class="btn primary" id="note-new" ${state.personalError ? 'disabled' : ''}>${icon.plus(16)} New note</button></div>
    ${personalBlocked()}
    <div class="notes ${cur ? 'editing' : ''}">
      <aside class="card notes-list">
        <div class="search note-search">${icon.search(15)}<input id="note-search" placeholder="Search notes" value="${esc(q)}" aria-label="Search notes"></div>
        <div class="note-items">${list.map((n) => `<button class="note-item ${n.id === noteSel ? 'active' : ''}" data-note="${esc(n.id)}">
            <b>${n.pinned ? `<span class="note-pin">${icon.pin(12)}</span>` : ''}${esc(noteTitle(n))}</b>
            <span>${esc(timeAgo(n.updated_at))}${n.body.trim() ? ' · ' + esc(n.body.trim().replace(/\s+/g, ' ').slice(0, 70)) : ''}</span>
          </button>`).join('') || `<div class="small muted" style="padding:14px 6px">${ql ? 'No notes match.' : 'No notes yet. Press New note to start.'}</div>`}</div>
      </aside>
      <div class="card note-editor">
        ${cur ? `<div class="note-bar">
            <button class="btn ghost sm only-sm" id="note-back">‹ Notes</button>
            <span class="small muted" id="note-status">Saved</span>
            <div class="grow"></div>
            <button class="icon-btn ${cur.pinned ? 'on' : ''}" id="note-pin" aria-pressed="${cur.pinned}" aria-label="${cur.pinned ? 'Unpin' : 'Pin to top'}" title="${cur.pinned ? 'Unpin' : 'Pin to top'}">${icon.pin(17)}</button>
            <button class="icon-btn" id="note-del" aria-label="Delete note" title="Delete note">${icon.trash(17)}</button>
          </div>
          <input class="note-title" id="note-title" maxlength="200" placeholder="Title" value="${esc(cur.title)}" aria-label="Note title">
          <textarea class="note-body" id="note-body" placeholder="Start writing…" aria-label="Note">${esc(cur.body)}</textarea>`
        : `<div class="todo-empty">${icon.note(30)}<b>No note selected</b><span>Pick a note on the left or create a new one.</span></div>`}
      </div>
    </div>
  </section>`;

  const search = $('#note-search');
  search.addEventListener('input', () => { const pos = search.selectionStart; drawNotes(search.value); const s2 = $('#note-search'); s2.focus(); s2.setSelectionRange(pos, pos); });
  $('#note-new').addEventListener('click', async () => {
    try { const n = await store.addNote(); state.notes.push(n); noteSel = n.id; drawNotes(''); $('#note-title')?.focus(); } catch (ex) { fail(ex); }
  });
  $$('[data-note]').forEach((b) => b.addEventListener('click', async () => { await flushNote(); noteSel = b.dataset.note; drawNotes(search.value); }));
  if (!cur) return;
  const status = $('#note-status');
  const save = async () => {
    const patch = { title: $('#note-title').value, body: $('#note-body').value };
    if (patch.title === cur.title && patch.body === cur.body) { status.textContent = 'Saved'; return; }
    status.textContent = 'Saving…';
    try { Object.assign(cur, await store.updateNote(cur.id, patch)); status.textContent = 'Saved'; }
    catch (ex) { status.textContent = 'Not saved'; fail(ex); }
  };
  let timer = null;
  const queue = () => { status.textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(save, 600); };
  flushNote = async () => { if (timer) { clearTimeout(timer); timer = null; await save(); } };
  ['#note-title', '#note-body'].forEach((sel) => { $(sel).addEventListener('input', queue); $(sel).addEventListener('blur', () => flushNote()); });
  $('#note-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#note-body').focus(); } });
  $('#note-back')?.addEventListener('click', async () => { await flushNote(); noteSel = null; drawNotes(search.value); });
  $('#note-pin').addEventListener('click', async () => {
    await flushNote();
    try { Object.assign(cur, await store.updateNote(cur.id, { pinned: !cur.pinned })); drawNotes(search.value); } catch (ex) { fail(ex); }
  });
  $('#note-del').addEventListener('click', async (e) => {
    if (!await confirmDialog({ title: 'Delete this note?', body: `"${noteTitle(cur)}" will be deleted for good.` })) return;
    clearTimeout(timer); timer = null;
    try { await store.deleteNote(cur.id); state.notes = state.notes.filter((n) => n.id !== cur.id); noteSel = null; flushNote = async () => {}; drawNotes(search.value); toast('Note deleted', '', 'gray', icon.trash); } catch (ex) { fail(ex); }
  });
}
let flushNote = async () => {};
window.addEventListener('hashchange', () => { flushNote(); });
window.addEventListener('beforeunload', () => { flushNote(); });

// =====================================================================
//  Reminders
// =====================================================================
const REMIND_OFFSETS = [[0, 'At due time'], [15, '15 min before'], [60, '1 hour before'], [1440, '1 day before']];
async function loadReminders() {
  state.reminders = await store.listReminders().catch(() => []);
  // listReminders returns [] both when empty and before migration 009; tasks.due_time tells us which.
  state.remindersReady = store.mode === 'demo' || state.tasks.some((t) => 'due_time' in t) || state.reminders.length > 0;
}
const myReminders = (taskId, userId = state.me.id) => state.reminders.filter((r) => r.task_id === taskId && r.user_id === userId);
const nextReminder = (t) => myReminders(t.id).filter((r) => !r.sent_at && new Date(r.remind_at) > new Date()).sort((a, b) => a.remind_at.localeCompare(b.remind_at))[0];

// Current selection for a person on a task: offsets + custom times.
function reminderSelection(taskId, userId) {
  const rs = taskId ? myReminders(taskId, userId) : [];
  return { offsets: new Set(rs.filter((r) => r.offset_minutes != null).map((r) => r.offset_minutes)), customs: rs.filter((r) => r.offset_minutes == null).map((r) => r.remind_at) };
}
// Make the stored reminders for (task, person) match the selection.
async function syncReminders(task, userId, sel) {
  const due = dueMoment(task.due_date, task.due_time);
  const want = [];
  if (due) sel.offsets.forEach((m) => want.push({ offset_minutes: m, remind_at: new Date(due - m * 60e3).toISOString() }));
  sel.customs.forEach((iso) => want.push({ offset_minutes: null, remind_at: new Date(iso).toISOString() }));
  const have = myReminders(task.id, userId);
  const same = (r, w) => (w.offset_minutes == null ? r.offset_minutes == null && Math.abs(new Date(r.remind_at) - new Date(w.remind_at)) < 60e3 : r.offset_minutes === w.offset_minutes);
  for (const r of have) {
    const w = want.find((x) => same(r, x));
    if (!w) { await store.deleteReminder(r.id); state.reminders = state.reminders.filter((x) => x.id !== r.id); }
    else if (Math.abs(new Date(r.remind_at) - new Date(w.remind_at)) >= 60e3) Object.assign(r, await store.updateReminder(r.id, { remind_at: w.remind_at }));
  }
  for (const w of want) {
    if (have.some((r) => same(r, w))) continue;
    if (new Date(w.remind_at) < Date.now() - 60e3) continue;   // already in the past
    state.reminders.push(await store.addReminder({ task_id: task.id, user_id: userId, ...w }));
  }
}
const askDesktopAlerts = () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); };

// The reminders field. getDue() gives { date, time } from the form or task;
// opts.assignee (id) shows "Also remind ..." for the task's creator.
function mountReminders(box, { task, getDue, live = false, assigneeId = null }) {
  const sel = reminderSelection(task?.id, state.me.id);
  const aId0 = task ? task.assigned_to : null;
  let alsoAssignee = !!(task && aId0 !== state.me.id && myReminders(task.id, aId0).some((r) => r.created_by === state.me.id));
  let adding = false;
  const draw = () => {
    if (!state.remindersReady) { box.innerHTML = ''; return; }
    const { date, time } = getDue();
    const due = dueMoment(date, time);
    const aId = typeof assigneeId === 'function' ? assigneeId() : assigneeId;
    box.innerHTML = `<div class="field rem-field"><label>${icon.bell(14)} Remind me</label>
      <div class="rem-chips">
        ${REMIND_OFFSETS.map(([m, l]) => {
          const at = due ? new Date(due - m * 60e3) : null;
          const past = at && at < Date.now();
          return `<button type="button" class="rem-chip ${sel.offsets.has(m) ? 'on' : ''}" data-off="${m}" ${!due || (past && !sel.offsets.has(m)) ? 'disabled' : ''} title="${at ? esc(fmtDateTime(at.toISOString())) : 'Set a due date first'}">${esc(l)}</button>`;
        }).join('')}
        ${sel.customs.map((iso, i) => `<span class="rem-chip on custom">${icon.bell(12)} ${esc(fmtDateTime(iso))}<button type="button" data-rm-custom="${i}" aria-label="Remove">${icon.x(12)}</button></span>`).join('')}
        ${adding ? `<span class="rem-add"><input type="datetime-local" class="input" id="rem-dt"><button type="button" class="btn sm primary" id="rem-dt-ok">Add</button></span>`
          : `<button type="button" class="rem-chip ghost" id="rem-custom">${icon.plus(12)} Pick date & time</button>`}
      </div>
      ${!due ? '<span class="small muted">Set a due date (and time) to use the quick options.</span>' : !time ? '<span class="small muted">No time set, so reminders count back from 9:00 AM on the due date.</span>' : ''}
      ${aId && aId !== state.me.id ? `<label class="check-row"><input type="checkbox" id="rem-assignee" ${alsoAssignee ? 'checked' : ''}> Also remind ${esc(person(aId).full_name)}</label>` : ''}
    </div>`;
    $$('[data-off]', box).forEach((b) => b.addEventListener('click', async () => {
      const m = Number(b.dataset.off);
      sel.offsets.has(m) ? sel.offsets.delete(m) : sel.offsets.add(m);
      askDesktopAlerts(); draw(); if (live) await save();
    }));
    $$('[data-rm-custom]', box).forEach((b) => b.addEventListener('click', async () => { sel.customs.splice(Number(b.dataset.rmCustom), 1); draw(); if (live) await save(); }));
    $('#rem-custom', box)?.addEventListener('click', () => { adding = true; draw(); const i = $('#rem-dt', box); if (due) i.value = new Date(due - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16); i.focus(); });
    $('#rem-dt-ok', box)?.addEventListener('click', async () => {
      const v = $('#rem-dt', box).value; if (!v) return;
      const d = new Date(v);
      if (d < Date.now()) return toast('Pick a time in the future', '', 'orange', icon.bell);
      sel.customs.push(d.toISOString()); adding = false; askDesktopAlerts(); draw(); if (live) await save();
    });
    $('#rem-assignee', box)?.addEventListener('change', (e) => { alsoAssignee = e.target.checked; });
  };
  const save = async (savedTask = task) => {
    if (!state.remindersReady || !savedTask) return;
    try {
      await syncReminders(savedTask, state.me.id, sel);
      const aId = savedTask.assigned_to;
      if (aId !== state.me.id && savedTask.created_by === state.me.id) {
        await syncReminders(savedTask, aId, alsoAssignee ? sel : { offsets: new Set(), customs: [] });
      }
      if (live) toast('Reminders saved', '', 'green', icon.bell);
    } catch (ex) { fail(ex); }
  };
  draw();
  return { redraw: draw, save };
}

let reminderTimer = null;
function startReminderLoop() {
  clearInterval(reminderTimer);
  const tick = () => { if (state.me) store.fireMyReminders().catch(() => {}); };
  tick();
  reminderTimer = setInterval(tick, 30e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) store.fireMyReminders().catch(() => {}); });

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('') + '!';
}

async function activateAccount(email, password, fullName) {
  const r = await store.activateMember(email, password, fullName);
  try { await navigator.clipboard.writeText(`${CONFIG.APP_NAME}: ${location.origin + location.pathname}\nEmail: ${email}\nTemporary password: ${password}\nPlease change your password after signing in (click your name, bottom left).`); } catch {}
  toast('Account activated', r.needsConfirmation
    ? 'Login details copied. They must click the confirmation email first.'
    : 'Login details copied to your clipboard. Share them privately.', 'green', icon.check);
  await loadAll();
}

function openActivate(inv) {
  const pw = genPassword();
  openSheet(`${sheetHead('Activate account')}
    <form id="act-form" novalidate><div class="sheet-body">
      <div class="notice">${icon.info(18)}<div>This creates the login for <b>${esc(inv.full_name || inv.email)}</b> (${esc(inv.email)}) right now. Share the password with them privately; they can change it after signing in.</div></div>
      <div class="field"><label>Temporary password</label>
        <div style="display:flex;gap:8px"><input class="input" id="act-pw" value="${esc(pw)}" autocomplete="off"><button type="button" class="btn" id="act-gen">New</button></div></div>
      <div class="error" id="act-error"></div>
    </div><div class="sheet-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Activate account</button></div></form>`, (ov) => {
    $('#act-gen', ov).addEventListener('click', () => { $('#act-pw', ov).value = genPassword(); });
    $('#act-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', ov); btn.disabled = true;
      try {
        const pass = $('#act-pw', ov).value;
        if (pass.length < 8) throw new Error('Use at least 8 characters.');
        await activateAccount(inv.email, pass, inv.full_name);
        closeSheet(); renderPeople();
      } catch (ex) { $('#act-error', ov).textContent = friendlyAuthError(ex); btn.disabled = false; }
    });
  });
}

function friendlyAuthError(ex) {
  const m = ex?.message || String(ex);
  if (/Database error saving new user/i.test(m)) return 'This email has not been invited, or the invitation was already used.';
  if (/rate limit/i.test(m)) return 'Supabase email limit reached. Try again in an hour, or turn off "Confirm email" in Supabase.';
  return m;
}

function personRow(p, roleTone) {
  return `<div class="list-row click" data-person="${esc(p.id)}" style="${p.active ? '' : 'opacity:.5'}">${avatar(p)}
    <div class="grow"><b>${esc(p.full_name)}${p.id === state.me.id ? ' (you)' : ''}</b><span>${esc(p.title || p.email)}${reportsTo(p) ? ` · reports to ${esc(p.manager_id === state.me.id ? 'you' : reportsTo(p).full_name)}` : ''}</span></div>
    ${p.active ? '' : '<span class="pill tone-gray">Inactive</span>'}
    <span class="pill tone-${roleTone[p.role]}">${esc(roleLabel(p.role))}</span></div>`;
}

function managerOptions(selected, excludeId = null) {
  const leads = state.profiles.filter((m) => m.active && ['manager', 'admin'].includes(m.role) && m.id !== excludeId);
  return `<option value="">Nobody</option>` + leads.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.full_name)}${m.id === state.me.id ? ' (me)' : ''} · ${esc(roleLabel(m.role))}</option>`).join('');
}
const reportsTo = (p) => p.manager_id ? person(p.manager_id) : null;

function teamOptions(deptId, selected) {
  return `<option value="">No team</option>` + state.teams.filter((t) => !deptId || t.department_id === deptId)
    .map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
function deptOptions(selected) {
  return `<option value="">No department</option>` + state.departments.map((d) => `<option value="${esc(d.id)}" ${d.id === selected ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
}

function openInvite() {
  const admin = isAdmin();
  const dept = admin ? (state.departments[0]?.id || '') : state.me.department_id;
  openSheet(`${sheetHead('Add a person')}
    <form id="inv-form" novalidate><div class="sheet-body">
      <div class="notice">${icon.info(18)}<div>They will activate their own account with this email and choose a password. Nobody else can sign up.</div></div>
      <div class="row">
        <div class="field"><label>Full name</label><input class="input" id="i-name" placeholder="Full name"></div>
        <div class="field"><label>Email</label><input class="input" id="i-email" type="email" placeholder="name@company.com"></div>
      </div>
      <div class="field"><label>Job title</label><input class="input" id="i-title" placeholder="e.g. Support Specialist"></div>
      <div class="row">
        <div class="field"><label>Role</label><select class="select" id="i-role" ${admin ? '' : 'disabled'}>
          <option value="member">Team member</option>${admin ? '<option value="manager">Manager</option><option value="admin">Admin</option>' : ''}</select></div>
        <div class="field"><label>Department</label><select class="select" id="i-dept" ${admin ? '' : 'disabled'}>${deptOptions(dept)}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Team</label><select class="select" id="i-team">${teamOptions(dept)}</select></div>
        <div class="field"><label>Reports to</label><select class="select" id="i-mgr">${managerOptions(state.me.id)}</select></div>
      </div>
      <label class="check-row"><input type="checkbox" id="i-now" checked> <span><b>Activate account now</b><br><span class="small muted">Create their login immediately with a temporary password (copied for you to share).</span></span></label>
      <div class="field" id="i-pw-wrap"><label>Temporary password</label><input class="input" id="i-pw" autocomplete="off"></div>
      <div class="error" id="i-error"></div>
    </div><div class="sheet-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Add person</button></div></form>`, (ov) => {
    $('#i-dept', ov).addEventListener('change', (e) => { $('#i-team', ov).innerHTML = teamOptions(e.target.value); });
    $('#i-pw', ov).value = genPassword();
    $('#i-now', ov).addEventListener('change', (e) => { $('#i-pw-wrap', ov).classList.toggle('hidden', !e.target.checked); });
    $('#inv-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#i-email', ov).value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#i-error', ov).textContent = 'Enter a valid email.'; return; }
      if ($('#i-now', ov).checked && $('#i-pw', ov).value.length < 8) { $('#i-error', ov).textContent = 'Use a temporary password of at least 8 characters.'; return; }
      try {
        await store.createInvitation({
          email, full_name: $('#i-name', ov).value.trim(), title: $('#i-title', ov).value.trim(),
          role: $('#i-role', ov).value, department_id: $('#i-dept', ov).value || null, team_id: $('#i-team', ov).value || null,
          manager_id: $('#i-mgr', ov).value || null,
        });
        if ($('#i-now', ov).checked) {
          const pass = $('#i-pw', ov).value;
          if (pass.length < 8) throw new Error('Use a temporary password of at least 8 characters.');
          try { await activateAccount(email, pass, $('#i-name', ov).value.trim()); }
          catch (ex2) { closeSheet(); renderPeople(); return toast('Added, but not activated yet', friendlyAuthError(ex2), 'orange'); }
        } else toast('Person added', `${email} can now activate their account.`, 'green', icon.check);
        closeSheet();
        renderPeople();
      } catch (ex) { $('#i-error', ov).textContent = friendlyAuthError(ex); }
    });
  });
}

function openPersonEditor(p) {
  openSheet(`${sheetHead(p.full_name)}
    <form id="p-form"><div class="sheet-body">
      <div class="row">
        <div class="field"><label>Full name</label><input class="input" id="p-name" value="${esc(p.full_name)}"></div>
        <div class="field"><label>Job title</label><input class="input" id="p-title" value="${esc(p.title)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Role</label><select class="select" id="p-role" ${p.id === state.me.id ? 'disabled' : ''}>${['member', 'manager', 'admin'].map((r) => `<option value="${r}" ${r === p.role ? 'selected' : ''} style="text-transform:capitalize">${roleLabel(r)}</option>`).join('')}</select></div>
        <div class="field"><label>Department</label><select class="select" id="p-dept">${deptOptions(p.department_id)}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Team</label><select class="select" id="p-team">${teamOptions(p.department_id, p.team_id)}</select></div>
        <div class="field"><label>Reports to</label><select class="select" id="p-mgr">${managerOptions(p.manager_id, p.id)}</select></div>
      </div>
      ${p.id === state.me.id ? '<div class="small muted">You can change your own department, team and manager here. Your role stays Admin so you cannot lock yourself out; admins already have every manager permission.</div>' : ''}
      <div class="pw-box">
        <div><b>Password</b><div class="small muted">Passwords are stored encrypted, so nobody (including admins) can see an existing one. You can set a new temporary password instead.</div></div>
        <button type="button" class="btn sm" id="p-reset">Reset password</button>
        <div class="pw-result hidden" id="p-pw-result"></div>
      </div>
      <div class="small muted">${esc(p.email)}</div>
    </div><div class="sheet-foot">
      ${p.id !== state.me.id ? `<button type="button" class="btn ${p.active ? 'danger' : ''} left" id="p-active">${p.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
      ${p.id !== state.me.id && isAdmin() ? `<button type="button" class="btn danger" id="p-delete">${icon.trash(16)} Delete user</button>` : ''}
      <button type="button" class="btn" id="p-kpi">View KPIs</button>
      <button class="btn primary" type="submit">Save</button></div></form>`, (ov) => {
    $('#p-dept', ov).addEventListener('change', (e) => { $('#p-team', ov).innerHTML = teamOptions(e.target.value); });
    $('#p-reset', ov).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Click again to set a new password'; return; }
      b.disabled = true;
      const pw = genPassword();
      try {
        await store.adminResetPassword(p.id, pw);
        const box = $('#p-pw-result', ov);
        box.classList.remove('hidden');
        box.innerHTML = `<div class="small muted">New temporary password for ${esc(p.full_name)} (shown once):</div>
          <div style="display:flex;gap:8px;align-items:center"><code class="pw-code">${esc(pw)}</code><button type="button" class="btn sm primary" id="p-pw-copy">Copy login details</button></div>`;
        $('#p-pw-copy', ov).addEventListener('click', async () => {
          const text = `${CONFIG.APP_NAME}: ${location.origin + location.pathname}\nEmail: ${p.email}\nTemporary password: ${pw}\nPlease change it after signing in (click your name, bottom left).`;
          try { await navigator.clipboard.writeText(text); toast('Copied', 'Share it with them privately.', 'green', icon.check); } catch { prompt('Copy this', text); }
        });
        b.textContent = 'Password reset';
      } catch (ex) { b.disabled = false; b.dataset.confirm = ''; b.textContent = 'Reset password'; fail(new Error(/admin_reset_password|function/i.test(ex.message) && !/Only an admin/.test(ex.message) ? 'Run supabase/migrations/004_people_admin.sql in Supabase first.' : ex.message)); }
    });
    $('#p-kpi', ov).addEventListener('click', () => { closeSheet(); location.hash = '#/kpi/' + encodeURIComponent(p.id); });
    $('#p-delete', ov)?.addEventListener('click', () => { closeSheet(true); openDeleteUser(p); });
    $('#p-active', ov)?.addEventListener('click', async () => {
      try { await store.updateProfile(p.id, { active: !p.active }); await loadAll(); closeSheet(); renderPeople(); } catch (ex) { fail(ex); }
    });
    $('#p-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = { full_name: $('#p-name', ov).value.trim(), title: $('#p-title', ov).value.trim(),
        department_id: $('#p-dept', ov).value || null, team_id: $('#p-team', ov).value || null, manager_id: $('#p-mgr', ov).value || null };
      if (p.id !== state.me.id) patch.role = $('#p-role', ov).value;
      try { await store.updateProfile(p.id, patch); await loadAll(); closeSheet(); renderPeople(); toast('Saved', '', 'green', icon.check); } catch (ex) { fail(ex); }
    });
  });
}

// Admin-only: delete someone for good. Their login is removed, their open
// tasks go to someone else (or are deleted), and finished work stays in the
// history under "Name (deleted)".
function openDeleteUser(p) {
  const open = state.tasks.filter((t) => t.assigned_to === p.id && t.status !== 'completed');
  const done = state.tasks.filter((t) => t.assigned_to === p.id && t.status === 'completed').length;
  const given = state.tasks.filter((t) => t.created_by === p.id && t.assigned_to !== p.id).length;
  const heirs = state.profiles.filter((x) => x.active && !x.deleted_at && x.id !== p.id).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const def = (p.manager_id && heirs.some((h) => h.id === p.manager_id)) ? p.manager_id : state.me.id;
  const confirmWord = (p.full_name || p.email).trim();
  openSheet(`${sheetHead('Delete ' + p.full_name)}
    <form id="del-form"><div class="sheet-body">
      <div class="notice danger-notice">${icon.alert(18)}<div><b>This cannot be undone.</b> ${esc(p.full_name)} will be signed out and can never log in again with ${esc(p.email)}. Their private to-dos and notes are deleted. Completed tasks, remarks and history stay, labelled "${esc(p.full_name)} (deleted)".</div></div>
      <div class="detail-grid">
        <div class="detail"><div class="k">Open tasks</div><div class="v">${open.length}</div></div>
        <div class="detail"><div class="k">Completed tasks</div><div class="v">${done}</div></div>
        <div class="detail"><div class="k">Tasks they assigned</div><div class="v">${given}</div></div>
      </div>
      ${open.length ? `<div class="field"><label for="del-heir">Their ${open.length} open task${open.length === 1 ? '' : 's'}</label>
        <select class="select" id="del-heir">
          ${heirs.map((h) => `<option value="${esc(h.id)}" ${h.id === def ? 'selected' : ''}>Give to ${esc(h.full_name)}${h.id === state.me.id ? ' (me)' : ''}${h.title ? ' — ' + esc(h.title) : ''}</option>`).join('')}
          <option value="">Delete their open tasks too</option>
        </select></div>` : ''}
      <div class="field"><label for="del-confirm">Type <b>${esc(confirmWord)}</b> to confirm</label>
        <input class="input" id="del-confirm" autocomplete="off" spellcheck="false" placeholder="${esc(confirmWord)}"></div>
      <div class="error" id="del-error"></div>
    </div><div class="sheet-foot">
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn danger solid" id="del-go" disabled>${icon.trash(16)} Delete user</button>
    </div></form>`, (ov) => {
    const go = $('#del-go', ov); const inp = $('#del-confirm', ov);
    const norm = (x) => x.trim().toLowerCase().replace(/\s+/g, ' ');
    inp.addEventListener('input', () => { go.disabled = norm(inp.value) !== norm(confirmWord); });
    inp.focus();
    $('#del-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      const heir = $('#del-heir', ov)?.value || null;
      go.disabled = true; go.textContent = 'Deleting…';
      try {
        const n = await store.adminDeleteUser(p.id, heir);
        await loadAll(); closeSheet(); renderPeople();
        toast('User deleted', n ? (heir ? `${n} open task${n === 1 ? '' : 's'} moved to ${person(heir).full_name}.` : `${n} open task${n === 1 ? '' : 's'} deleted.`) : `${p.full_name} can no longer sign in.`, 'gray', icon.trash);
      } catch (ex) { $('#del-error', ov).textContent = ex.message; go.disabled = false; go.innerHTML = `${icon.trash(16)} Delete user`; }
    });
  });
}

function openProfileSheet() {
  const me = state.me;
  openSheet(`${sheetHead('Your profile')}
    <form id="me-form"><div class="sheet-body">
      <div style="display:flex;gap:14px;align-items:center">${avatar(me, 'lg')}<div><b style="font-size:18px">${esc(me.full_name)}</b><div class="muted small">${esc(me.email)}</div>
        <div class="small muted">${esc(orgLine(me, roleLabel(me.role)))}</div></div></div>
      <div class="row">
        <div class="field"><label>Full name</label><input class="input" id="me-name" value="${esc(me.full_name)}"></div>
        <div class="field"><label>Job title</label><input class="input" id="me-title" value="${esc(me.title)}"></div>
      </div>
      <div class="field"><label>New password (optional)</label><input class="input" type="password" id="me-pass" autocomplete="new-password" placeholder="Leave blank to keep current"></div>
      ${store.mode === 'demo' ? `<button type="button" class="btn sm" id="reset-demo" style="justify-self:start">Reset demo data</button>` : ''}
    </div><div class="sheet-foot">
      <button type="button" class="btn danger left" id="sign-out">${icon.out(16)} Sign out</button>
      <button class="btn primary" type="submit">Save</button></div></form>`, (ov) => {
    $('#sign-out', ov).addEventListener('click', signOut);
    $('#reset-demo', ov)?.addEventListener('click', async () => { store.resetDemo(); await signOut(); toast('Demo data reset'); });
    $('#me-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await store.updateProfile(me.id, { full_name: $('#me-name', ov).value.trim() || me.full_name, title: $('#me-title', ov).value.trim() });
        const pw = $('#me-pass', ov).value;
        if (pw) { if (pw.length < 6) throw new Error('Password should be at least 6 characters.'); await store.updatePassword(pw); }
        await loadAll(); closeSheet(); renderShell(); route(); toast('Profile saved', '', 'green', icon.check);
      } catch (ex) { fail(ex); }
    });
  });
}

async function signOut() {
  closeSheet(true);
  unsubscribe?.(); unsubscribe = null;
  await store.signOut();
  state.me = null;
  history.replaceState(null, '', location.pathname);
  renderAuth();
}

// =====================================================================
//  Start
// =====================================================================
(async function start() {
  try {
    store = await createDataStore();
  } catch (e) {
    app().innerHTML = `<div class="auth"><div class="auth-card"><h1>Could not start</h1><p class="lead">${esc(e.message)}</p></div></div>`;
    return;
  }
  store.onAuthChange((event) => {
    if (event === 'PASSWORD_RECOVERY') renderSetPassword();
    if (event === 'SIGNED_OUT' && state.me) { state.me = null; renderAuth(); }
  });
  await boot();
})();
