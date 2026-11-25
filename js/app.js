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
  tagged: ['purple', 'You were tagged', 'at'], blocked: ['red', 'Task blocked', 'alert'], remark: ['blue', 'New remark', 'chat'], resolved: ['green', 'Blocker resolved', 'check'],
};
const noteStyle = (type) => { const [tone, title, ic] = NOTE_STYLE[type] || NOTE_STYLE.assigned; return { tone, title, ic: icon[ic] }; };
const statusIcon = { not_started: icon.circle, in_progress: icon.play, on_hold: icon.pause, completed: icon.check };

// =====================================================================
//  State
// =====================================================================
const state = {
  me: null, profiles: [], departments: [], teams: [], tasks: [], notifications: [], invitations: [], remarks: [],
  filter: { status: 'active', priority: 'all', sort: 'due', q: '' },
  kpiSort: { key: 'score', dir: -1 },
};
let store;
let unsubscribe = null;
const app = () => $('#app');

const byId = (list, id) => list.find((x) => x.id === id);
const person = (id) => byId(state.profiles, id) || { id, full_name: 'Unknown', email: '' };
const deptName = (id) => byId(state.departments, id)?.name || 'No department';
const teamName = (id) => byId(state.teams, id)?.name || 'No team';
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
  const [profiles, departments, teams, tasks, notifications, remarks] = await Promise.all([
    store.listProfiles(), store.listDepartments(), store.listTeams(), store.listTasks(), store.listNotifications(),
    store.listRemarks().catch(() => []),
  ]);
  Object.assign(state, { profiles, departments, teams, tasks, notifications, remarks });
  state.me = byId(profiles, state.me.id) || state.me;
}
let refreshTimer;
function scheduleRefresh(what = 'tasks') {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      if (what === 'directory') await loadAll();
      else { [state.tasks, state.remarks] = await Promise.all([store.listTasks(), store.listRemarks().catch(() => state.remarks)]); }
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
  if (isManager()) items.push({ hash: '#/assigned', label: 'Assigned by Me', ic: icon.send, count: () => assignedByMe().filter((t) => t.status !== 'completed').length });
  if (isAdmin()) items.push({ hash: '#/all', label: 'All Tasks', ic: icon.stack });
  items.push({ section: 'Performance' });
  if (isManager()) items.push({ hash: '#/team-kpi', label: 'Team Performance', ic: icon.chart });
  else items.push({ hash: '#/kpi', label: 'My Performance', ic: icon.chart });
  if (isManager()) { items.push({ section: 'Organisation' }); items.push({ hash: '#/people', label: 'People & Teams', ic: icon.team }); }
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
      <div class="me-card" id="me-card">${avatar(me)}<div class="who"><b>${esc(me.full_name)}</b><span>${esc(roleLabel(me.role))} · ${esc(teamName(me.team_id))}</span></div></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="search">${icon.search(16)}<input id="search" placeholder="Search tasks" value="${esc(state.filter.q)}" aria-label="Search tasks"></div>
        <div class="grow"></div>
        <button class="icon-btn" id="theme-btn" aria-label="Toggle theme">${isDark() ? icon.sun() : icon.moon()}</button>
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
  $('#me-card').addEventListener('click', openProfileSheet);
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
  else if (h === '#/people' && isManager()) renderPeople();
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
  const searched = q ? base.filter((t) => [t.title, t.description, person(t.assigned_to).full_name, person(t.created_by).full_name]
    .some((s) => (s || '').toLowerCase().includes(q))) : base;
  let pool = f.priority === 'all' ? searched : searched.filter((t) => t.priority === f.priority);
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
      <select class="select" id="f-prio" aria-label="Priority filter">
        <option value="all">All priorities</option>${PRIORITIES.map((p) => `<option value="${p.id}" ${f.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
      </select>
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
  $('#empty-new')?.addEventListener('click', () => openTaskEditor());
}

function emptyState(h) {
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
  const due = new Date(t.due_date + 'T23:59:59');
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
  if (days < 0) { state = 'overdue'; label = `${-days}d overdue`; }
  else if (days === 0) { state = 'today'; label = 'Due today'; }
  else if (days === 1) { state = 'soon'; label = 'Due tomorrow'; }
  else if (days <= 3) { state = 'soon'; label = `${days} days left`; }
  else { state = 'ok'; label = `${days} days left`; }
  const hoursLeft = Math.max(0, Math.round((due - Date.now()) / 3600e3));
  return { state, pct: days < 0 ? 1 : pct, label,
    tip: `Due ${new Date(t.due_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : `${hoursLeft} h left`} · ${Math.round(pct * 100)}% of the time used` };
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
      ${dueChip(t)}
      ${locked ? `<span class="lock" title="Assigned by someone else. You can update the status only.">${icon.lock(13)}</span>` : ''}
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
          <select class="select sm" data-r-tag><option value="">Tag a person…</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(p.full_name)} · ${esc(teamName(p.team_id))}</option>`).join('')}</select>
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
        <div class="detail"><div class="k">Due date</div><div class="v ${overdue ? 'overdue' : ''}" style="${overdue ? 'color:var(--red)' : ''}">${t.due_date ? esc(fmtDate(t.due_date)) : 'No due date'}</div></div>
        <div class="detail"><div class="k">Assigned by</div><div class="v">${avatar(creator, 'sm')} ${esc(creator.full_name)}</div></div>
        <div class="detail"><div class="k">Assigned to</div><div class="v">${avatar(assignee, 'sm')} ${esc(assignee.full_name)}</div></div>
      </div>
      ${timingBlock(t)}
      <div data-remarks></div>
      ${links.length ? `<div><div class="field"><label>Related links</label></div><div class="links">${links.map((l) => `<a class="link-chip" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${icon.link(14)}<span>${esc(l.label || l.href)}</span>${icon.arrow(12)}</a>`).join('')}</div></div>` : ''}
      ${canStatus ? `<div class="field"><label>Work status</label>
        <div class="status-picker">${STATUSES.map((s) => `<button type="button" class="tone-${s.tone} ${s.id === t.status ? 'active' : ''}" data-set="${s.id}" style="background:${s.id === t.status ? '' : 'var(--surface)'}">${statusIcon[s.id](22)}${s.label}</button>`).join('')}</div></div>`
        : `<div class="detail"><div class="k">Status</div><div class="v"><span class="pill dot tone-${statusOf(t.status).tone}">${statusOf(t.status).label}</span></div></div>`}
    </div>`, (ov) => {
    loadHistory(t, ov);
    renderRemarks(t, ov);
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
  const data = t || { title: '', description: '', priority: 'medium', status: 'not_started', due_date: '', links: [], assigned_to: isManager() ? '' : state.me.id };
  openSheet(`${sheetHead(editing ? 'Edit task' : 'New task')}
    <form id="task-form" novalidate><div class="sheet-body">
      <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" maxlength="200" placeholder="What needs to be done?" value="${esc(data.title)}" required></div>
      <div class="field"><label for="t-desc">Details</label><textarea class="textarea" id="t-desc" placeholder="Add context, steps or acceptance criteria">${esc(data.description)}</textarea></div>
      <div class="field"><label for="t-assignee">Assign to</label>
        <select class="select" id="t-assignee" ${isManager() ? '' : 'disabled'}>${assigneeOptions(data.assigned_to)}</select>
        ${isManager() ? '' : '<span class="small muted">Team members can add tasks for themselves. Managers can assign to anyone.</span>'}</div>
      <div class="row">
        <div class="field"><label for="t-prio">Priority</label><select class="select" id="t-prio">${PRIORITIES.map((p) => `<option value="${p.id}" ${p.id === data.priority ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="field"><label for="t-due">Due date</label><input class="input" type="date" id="t-due" value="${esc(data.due_date || '')}"></div>
      </div>
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
    const linksEl = $('#links', ov);
    const bindRm = () => $$('[data-rm]', linksEl).forEach((b) => { b.onclick = () => b.closest('.link-row').remove(); });
    bindRm();
    $('#add-link', ov).addEventListener('click', () => { linksEl.insertAdjacentHTML('beforeend', linkRow()); bindRm(); $$('[data-l="label"]', linksEl).pop().focus(); });
    $('#t-delete', ov)?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.innerHTML = `${icon.trash(16)} Tap again to delete`; return; }
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
        status: $('#t-status', ov).value,
        links,
      };
      if (!payload.title) { err.textContent = 'Give the task a title.'; return; }
      if (!payload.assigned_to) { err.textContent = 'Choose who this task is for.'; $('#t-assignee', ov).focus(); return; }
      if (bad) { err.textContent = `"${bad.url}" is not a valid link.`; return; }
      const btn = $('button[type=submit]', ov); btn.disabled = true;
      try {
        if (editing) {
          const u = await store.updateTask(t.id, payload);
          Object.assign(byId(state.tasks, t.id), u);
          toast('Task updated', '', 'blue', icon.check);
        } else {
          const n = await store.createTask(payload);
          if (!byId(state.tasks, n.id)) state.tasks.unshift(n);
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
        <div class="muted">${hero ? esc(hero.sub) : `${esc(p.title || roleLabel(p.role))} · ${esc(teamName(p.team_id))} · ${esc(deptName(p.department_id))}`}</div>
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

async function renderKpi(userId) {
  const self = userId === state.me.id;
  $('#view').innerHTML = `<section class="content"><div class="page-head"><div><h1>${self ? 'My Performance' : 'Performance'}</h1><p>${self ? 'Your KPI profile, built from the tasks assigned to you.' : ''}</p></div></div><div class="boot" style="min-height:200px"><div class="spinner"></div></div></section>`;
  try {
    const rows = await store.kpiStats(self ? 'me' : 'user', self ? null : userId);
    if (!rows.length) { $('#view .content').innerHTML = `<div class="empty"><h3>Not available</h3><p>You can view KPIs for people in your department only.</p></div>`; return; }
    const k = computeKpi(rows[0]);
    const p = person(userId);
    $('#view .content').innerHTML = `
      <div class="page-head"><div>${self ? '' : `<button class="btn ghost" style="padding-left:0" onclick="location.hash='#/team-kpi'">‹ Back</button>`}<h1>${self ? 'My Performance' : esc(p.full_name)}</h1>
      <p>${self ? 'Your KPI profile, built from the tasks assigned to you.' : 'KPI profile'}</p></div></div>${kpiBody(k, p)}`;
    animateRings();
  } catch (e) { fail(e); }
}

async function renderTeamKpi() {
  const title = 'Team Performance';
  $('#view').innerHTML = `<section class="content"><div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Combined performance of everyone, across all departments.' : `Combined performance of everyone in ${esc(deptName(state.me.department_id))}.`}</p></div></div><div class="boot" style="min-height:200px"><div class="spinner"></div></div></section>`;
  try {
    const rows = (await store.kpiStats('department')).map(computeKpi).map((k) => ({ ...k, p: person(k.user_id) }));
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
      <div class="card" style="margin-top:16px"><h2>Team members</h2>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
          ${th('name', 'Member')}${th('team', 'Team')}${th('score', 'Score')}${th('completionRate', 'Completion')}${th('onTimeRate', 'On time')}${th('open', 'Open')}${th('overdue_open', 'Overdue')}
        </tr></thead><tbody>
        ${rows.map((r) => `<tr data-user="${esc(r.user_id)}">
          <td><div class="person">${avatar(r.p)}<div><b>${esc(r.p.full_name)}</b><span>${esc(r.p.title || roleLabel(r.p.role))}</span></div></div></td>
          <td>${esc(teamName(r.p.team_id))}${isAdmin() ? `<div class="small muted">${esc(deptName(r.p.department_id))}</div>` : ''}</td>
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
  const visible = isAdmin() ? state.profiles : state.profiles.filter((p) => p.department_id === state.me.department_id || p.manager_id === state.me.id);
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
        <div class="grow"><b>${esc(i.full_name || i.email)}</b><span>${esc(i.email)} · ${esc(roleLabel(i.role))} · ${esc(teamName(i.team_id))}</span></div>
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
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.style.color = 'var(--red)'; b.title = 'Click again to delete'; toast('Click again to delete', 'People in it will be left without a team.', 'orange'); return; }
    try { await fn(); await loadAll(); renderPeople(); } catch (ex) { fail(ex); }
  });
  $$('[data-del-dept]').forEach((b) => confirmDel(b, () => store.deleteDepartment(b.dataset.delDept)));
  $$('[data-del-team]').forEach((b) => confirmDel(b, () => store.deleteTeam(b.dataset.delTeam)));
}

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

function openProfileSheet() {
  const me = state.me;
  openSheet(`${sheetHead('Your profile')}
    <form id="me-form"><div class="sheet-body">
      <div style="display:flex;gap:14px;align-items:center">${avatar(me, 'lg')}<div><b style="font-size:18px">${esc(me.full_name)}</b><div class="muted small">${esc(me.email)}</div>
        <div class="small muted">${esc(roleLabel(me.role))} · ${esc(teamName(me.team_id))} · ${esc(deptName(me.department_id))}</div></div></div>
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
