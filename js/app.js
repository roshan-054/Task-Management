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
  pause: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', s),
  play: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>', s),
  circle: (s) => I('<circle cx="12" cy="12" r="9"/>', s),
  arrow: (s) => I('<path d="M7 17L17 7M9 7h8v8"/>', s),
  info: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', s),
  user: (s) => I('<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5"/><circle cx="12" cy="12" r="10"/>', s),
};
const statusIcon = { not_started: icon.circle, in_progress: icon.play, on_hold: icon.pause, completed: icon.check };

// =====================================================================
//  State
// =====================================================================
const state = {
  me: null, profiles: [], departments: [], teams: [], tasks: [], notifications: [], invitations: [],
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
      <div class="auth-logo">${I('<path d="M6 12.5l4 4L18 8"/>', 30)}</div>
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
        ? 'This email has not been invited. Ask your admin or manager to add you first.' : ex.message;
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
  const [profiles, departments, teams, tasks, notifications] = await Promise.all([
    store.listProfiles(), store.listDepartments(), store.listTeams(), store.listTasks(), store.listNotifications(),
  ]);
  Object.assign(state, { profiles, departments, teams, tasks, notifications });
  state.me = byId(profiles, state.me.id) || state.me;
}
let refreshTimer;
function scheduleRefresh(what = 'tasks') {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      if (what === 'directory') await loadAll();
      else { state.tasks = await store.listTasks(); }
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
    const tone = n.type === 'completed' ? 'green' : n.type === 'on_hold' ? 'orange' : 'blue';
    const title = n.type === 'completed' ? 'Task completed' : n.type === 'on_hold' ? 'Task on hold' : 'New task for you';
    toast(title, n.message, tone, n.type === 'completed' ? icon.check : n.type === 'on_hold' ? icon.pause : icon.plus);
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
  ];
  if (isManager()) items.push({ hash: '#/assigned', label: 'Assigned by Me', ic: icon.send, count: () => assignedByMe().filter((t) => t.status !== 'completed').length });
  if (isAdmin()) items.push({ hash: '#/all', label: 'All Tasks', ic: icon.stack });
  items.push({ section: 'Performance' });
  items.push({ hash: '#/kpi', label: 'My Performance', ic: icon.chart });
  if (isManager()) items.push({ hash: '#/team-kpi', label: isAdmin() ? 'Company KPIs' : 'Department KPIs', ic: icon.grid });
  if (isManager()) { items.push({ section: 'Organisation' }); items.push({ hash: '#/people', label: 'People & Teams', ic: icon.team }); }
  return items;
}
const myTasks = () => state.tasks.filter((t) => t.assigned_to === state.me.id);
const assignedByMe = () => state.tasks.filter((t) => t.created_by === state.me.id && t.assigned_to !== state.me.id);

function renderShell() {
  const me = state.me;
  const items = navItems();
  app().innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="mark">${I('<path d="M6 12.5l4 4L18 8"/>', 18)}</div>${esc(CONFIG.APP_NAME)}</div>
      ${items.map((it) => it.section ? `<div class="nav-label">${esc(it.section)}</div>`
        : `<button class="nav-item" data-nav="${it.hash}">${it.ic()}<span>${esc(it.label)}</span>${it.count ? `<span class="count" data-count="${it.hash}"></span>` : ''}</button>`).join('')}
      <div class="spacer"></div>
      ${store.mode === 'demo' ? `<div style="padding:0 10px 8px"><span class="demo-banner">Demo mode</span></div>` : ''}
      <div class="me-card" id="me-card">${avatar(me)}<div class="who"><b>${esc(me.full_name)}</b><span>${esc(me.role)} · ${esc(teamName(me.team_id))}</span></div></div>
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
      ${items.filter((it) => !it.section).slice(0, 5).map((it) => `<button data-nav="${it.hash}">${it.ic(22)}<span>${esc(it.label.replace('Assigned by Me', 'Assigned').replace('My Performance', 'KPI').replace('Department KPIs', 'Team KPI').replace('Company KPIs', 'Team KPI').replace('People & Teams', 'People'))}</span></button>`).join('')}
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
    if (!/^#\/(tasks|assigned|all)/.test(location.hash)) location.hash = '#/tasks'; else renderTaskView();
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
      const tone = n.type === 'completed' ? 'green' : n.type === 'on_hold' ? 'orange' : 'blue';
      const ic = n.type === 'completed' ? icon.check : n.type === 'on_hold' ? icon.pause : icon.plus;
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
  if (/^#\/(tasks|assigned|all)$/.test(h)) {
    if ((h === '#/assigned' && !isManager()) || (h === '#/all' && !isAdmin())) { location.hash = '#/tasks'; return; }
    renderTaskView();
  } else if (h === '#/kpi') renderKpi(state.me.id);
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
  return myTasks();
}

function renderTaskView() {
  const h = location.hash || '#/tasks';
  const titles = {
    '#/tasks': ['My Tasks', 'Everything assigned to you.'],
    '#/assigned': ['Assigned by Me', 'Tasks you gave to others. You will be notified the moment one is completed.'],
    '#/all': ['All Tasks', 'Every task in the organisation (admin view).'],
  };
  const f = state.filter;
  const base = viewTasks();
  const q = f.q.trim().toLowerCase();
  const searched = q ? base.filter((t) => [t.title, t.description, person(t.assigned_to).full_name, person(t.created_by).full_name]
    .some((s) => (s || '').toLowerCase().includes(q))) : base;
  const counts = { active: searched.filter((t) => t.status !== 'completed').length, all: searched.length };
  STATUSES.forEach((s) => { counts[s.id] = searched.filter((t) => t.status === s.id).length; });
  let list = searched.filter((t) => f.status === 'all' || (f.status === 'active' ? t.status !== 'completed' : t.status === f.status));
  if (f.priority !== 'all') list = list.filter((t) => t.priority === f.priority);
  list.sort((a, b) => {
    if (f.sort === 'priority') return prioRank[a.priority] - prioRank[b.priority] || (a.due_date || '9').localeCompare(b.due_date || '9');
    if (f.sort === 'recent') return b.created_at.localeCompare(a.created_at);
    return (a.due_date || '9999').localeCompare(b.due_date || '9999') || prioRank[a.priority] - prioRank[b.priority];
  });

  const segs = [['active', 'Active'], ...STATUSES.map((s) => [s.id, s.label]), ['all', 'All']];
  $('#view').innerHTML = `
  <section class="content">
    <div class="page-head"><div><h1>${titles[h][0]}</h1><p>${titles[h][1]}</p></div></div>
    <div class="toolbar">
      <div class="segmented" role="tablist">${segs.map(([id, label]) => `<button class="${f.status === id ? 'active' : ''}" data-status="${id}">${label}<span class="n">${counts[id]}</span></button>`).join('')}</div>
      <select class="select" id="f-prio" aria-label="Priority filter">
        <option value="all">All priorities</option>${PRIORITIES.map((p) => `<option value="${p.id}" ${f.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
      </select>
      <select class="select" id="f-sort" aria-label="Sort">
        <option value="due" ${f.sort === 'due' ? 'selected' : ''}>Sort by due date</option>
        <option value="priority" ${f.sort === 'priority' ? 'selected' : ''}>Sort by priority</option>
        <option value="recent" ${f.sort === 'recent' ? 'selected' : ''}>Newest first</option>
      </select>
    </div>
    <div class="task-list">
      ${list.length ? list.map((t, i) => taskCard(t, i)).join('') : emptyState(h)}
    </div>
  </section>`;

  $$('[data-status]').forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.status; renderTaskView(); }));
  $('#f-prio').addEventListener('change', (e) => { f.priority = e.target.value; renderTaskView(); });
  $('#f-sort').addEventListener('change', (e) => { f.sort = e.target.value; renderTaskView(); });
  $$('.task').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('select, a, button')) return;
    openTask(byId(state.tasks, el.dataset.id));
  }));
  $$('.status-select').forEach((sel) => sel.addEventListener('change', (e) => changeStatus(sel.dataset.id, e.target.value)));
  $('#empty-new')?.addEventListener('click', () => openTaskEditor());
}

function emptyState(h) {
  const msg = state.filter.q ? ['No matches', 'Try a different search.']
    : h === '#/assigned' ? ['Nothing assigned yet', 'Create a task and assign it to anyone in any team.']
    : ['You are all clear', 'New tasks assigned to you will appear here instantly.'];
  return `<div class="empty"><div class="art">${icon.check(30)}</div><h3>${msg[0]}</h3><p>${msg[1]}</p>
    <button class="btn primary" id="empty-new" style="margin-top:10px">${icon.plus(16)} New Task</button></div>`;
}

function statusSelect(t) {
  const s = statusOf(t.status);
  return `<select class="status-select tone-${s.tone}" data-id="${esc(t.id)}" aria-label="Work status">
    ${STATUSES.map((x) => `<option value="${x.id}" ${x.id === t.status ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`;
}

function taskCard(t, i = 0) {
  const p = prioOf(t.priority);
  const assignee = person(t.assigned_to);
  const creator = person(t.created_by);
  const overdue = t.status !== 'completed' && t.due_date && t.due_date < todayISO();
  const locked = !canEditTask(t);
  const mine = t.assigned_to === state.me.id;
  const who = mine
    ? (t.created_by === state.me.id ? '<span class="m">Personal task</span>' : `<span class="m">${avatar(creator, 'sm')} From ${esc(creator.full_name)}</span>`)
    : `<span class="m">${avatar(assignee, 'sm')} To ${esc(assignee.full_name)} · ${esc(teamName(assignee.team_id))}</span>`;
  const links = (t.links || []).map((l) => ({ ...l, href: safeUrl(l.url) })).filter((l) => l.href);
  return `
  <article class="task ${t.status === 'completed' ? 'done' : ''}" data-id="${esc(t.id)}" style="animation-delay:${Math.min(i, 12) * 25}ms" tabindex="0">
    <div class="prio-bar" style="background:${p.color}" title="${p.label} priority"></div>
    <div style="min-width:0">
      <h3 class="task-title">${esc(t.title)}</h3>
      ${t.description ? `<p class="task-desc">${esc(t.description)}</p>` : ''}
      <div class="meta">
        <span class="pill tone-${p.tone}">${p.label}</span>
        ${t.due_date ? `<span class="m ${overdue ? 'overdue' : ''}">${icon.cal(14)} ${overdue ? 'Overdue · ' : 'Due '}${esc(fmtDate(t.due_date))}</span>` : ''}
        ${who}
        ${locked ? `<span class="lock" title="Assigned by a manager. You can update the status only.">${icon.lock(13)} Status only</span>` : ''}
      </div>
      ${links.length ? `<div class="links">${links.map((l) => `<a class="link-chip" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${icon.link(14)}<span>${esc(l.label || new URL(l.href).hostname)}</span></a>`).join('')}</div>` : ''}
    </div>
    <div class="task-side">${mine || canEditTask(t) ? statusSelect(t) : `<span class="pill dot tone-${statusOf(t.status).tone}">${statusOf(t.status).label}</span>`}</div>
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
  if (/^#\/(tasks|assigned|all)/.test(location.hash)) renderTaskView();
  updateCounts();
}

// ---------- task detail ----------
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
      <div class="notice">${icon.lock(18)}<div>Assigned by <b>${esc(creator.full_name)}</b>. You can update the work status. Other details can only be changed by the person who assigned it.</div></div>
      ${t.description ? `<div style="white-space:pre-wrap">${esc(t.description)}</div>` : ''}
      <div class="detail-grid">
        <div class="detail"><div class="k">Priority</div><div class="v"><span class="pill tone-${p.tone}">${p.label}</span></div></div>
        <div class="detail"><div class="k">Due date</div><div class="v ${overdue ? 'overdue' : ''}" style="${overdue ? 'color:var(--red)' : ''}">${t.due_date ? esc(fmtDate(t.due_date)) : 'No due date'}</div></div>
        <div class="detail"><div class="k">Assigned by</div><div class="v">${avatar(creator, 'sm')} ${esc(creator.full_name)}</div></div>
        <div class="detail"><div class="k">Assigned to</div><div class="v">${avatar(assignee, 'sm')} ${esc(assignee.full_name)}</div></div>
      </div>
      ${links.length ? `<div><div class="field"><label>Related links</label></div><div class="links">${links.map((l) => `<a class="link-chip" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${icon.link(14)}<span>${esc(l.label || l.href)}</span>${icon.arrow(12)}</a>`).join('')}</div></div>` : ''}
      ${canStatus ? `<div class="field"><label>Work status</label>
        <div class="status-picker">${STATUSES.map((s) => `<button type="button" class="tone-${s.tone} ${s.id === t.status ? 'active' : ''}" data-set="${s.id}" style="background:${s.id === t.status ? '' : 'var(--surface)'}">${statusIcon[s.id](22)}${s.label}</button>`).join('')}</div></div>`
        : `<div class="detail"><div class="k">Status</div><div class="v"><span class="pill dot tone-${statusOf(t.status).tone}">${statusOf(t.status).label}</span></div></div>`}
      <div class="small muted">Created ${esc(timeAgo(t.created_at))}${t.completed_at ? ` · Completed ${esc(timeAgo(t.completed_at))}` : ''}</div>
    </div>`, (ov) => {
    $$('[data-set]', ov).forEach((b) => b.addEventListener('click', async () => {
      await changeStatus(t.id, b.dataset.set);
      closeSheet();
    }));
  });
}

function assigneeOptions(selected) {
  if (!isManager()) return `<option value="${esc(state.me.id)}">${esc(state.me.full_name)} (me)</option>`;
  const active = state.profiles.filter((p) => p.active);
  const groups = new Map();
  active.forEach((p) => {
    const key = `${deptName(p.department_id)} · ${p.team_id ? teamName(p.team_id) : 'No team'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const opt = (p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name)}${p.id === state.me.id ? ' (me)' : ''}${p.title ? ' — ' + esc(p.title) : ''}</option>`;
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, ps]) => `<optgroup label="${esc(k)}">${ps.map(opt).join('')}</optgroup>`).join('');
}

function linkRow(l = { label: '', url: '' }) {
  return `<div class="link-row"><input class="input" placeholder="Label (e.g. Brief)" data-l="label" value="${esc(l.label)}">
    <input class="input" placeholder="https://…" data-l="url" value="${esc(l.url)}" inputmode="url">
    <button type="button" class="icon-btn" data-rm aria-label="Remove link">${icon.x(16)}</button></div>`;
}

function openTaskEditor(t = null) {
  const editing = !!t;
  const data = t || { title: '', description: '', priority: 'medium', status: 'not_started', due_date: '', links: [], assigned_to: state.me.id };
  openSheet(`${sheetHead(editing ? 'Edit task' : 'New task')}
    <form id="task-form" novalidate><div class="sheet-body">
      <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" maxlength="200" placeholder="What needs to be done?" value="${esc(data.title)}" required></div>
      <div class="field"><label for="t-desc">Details</label><textarea class="textarea" id="t-desc" placeholder="Add context, steps or acceptance criteria">${esc(data.description)}</textarea></div>
      <div class="field"><label for="t-assignee">Assign to</label>
        <select class="select" id="t-assignee" ${isManager() ? '' : 'disabled'}>${assigneeOptions(data.assigned_to)}</select>
        ${isManager() ? '' : '<span class="small muted">Members can add tasks for themselves. Managers can assign to anyone.</span>'}</div>
      <div class="row">
        <div class="field"><label for="t-prio">Priority</label><select class="select" id="t-prio">${PRIORITIES.map((p) => `<option value="${p.id}" ${p.id === data.priority ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="field"><label for="t-due">Due date</label><input class="input" type="date" id="t-due" value="${esc(data.due_date || '')}"></div>
      </div>
      <div class="field"><label for="t-status">Work status</label><select class="select" id="t-status">${STATUSES.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div class="field"><label>Related links</label>
        <div id="links" style="display:grid;gap:8px">${(data.links || []).map(linkRow).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-link" style="justify-self:start">${icon.plus(14)} Add link</button></div>
      <div class="error" id="t-error"></div>
    </div>
    <div class="sheet-foot">
      ${editing ? `<button type="button" class="btn danger left" id="t-delete">${icon.trash(16)} Delete</button>` : ''}
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">${editing ? 'Save changes' : 'Create task'}</button>
    </div></form>`, (ov) => {
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
        assigned_to: $('#t-assignee', ov).value || state.me.id,
        priority: $('#t-prio', ov).value,
        due_date: $('#t-due', ov).value || null,
        status: $('#t-status', ov).value,
        links,
      };
      if (!payload.title) { err.textContent = 'Give the task a title.'; return; }
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

function kpiBody(k, p) {
  const segs = [
    ['Completed', k.completed, 'var(--green)'], ['In progress', k.in_progress, 'var(--accent)'],
    ['On hold', k.on_hold, 'var(--orange)'], ['Not started', k.not_started, 'var(--gray)'],
  ];
  const max = Math.max(1, ...k.weekly);
  const weekLabel = (i) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * (7 - i)); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  return `
    <div class="card"><div class="profile-hero">
      ${avatar(p, 'lg')}
      <div class="info"><h2>${esc(p.full_name)}</h2>
        <div class="muted">${esc(p.title || p.role)} · ${esc(teamName(p.team_id))} · ${esc(deptName(p.department_id))}</div>
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
  const title = isAdmin() ? 'Company KPIs' : 'Department KPIs';
  $('#view').innerHTML = `<section class="content"><div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Everyone, across all departments.' : `Everyone in ${esc(deptName(state.me.department_id))}.`}</p></div></div><div class="boot" style="min-height:200px"><div class="spinner"></div></div></section>`;
  try {
    const rows = (await store.kpiStats('department')).map(computeKpi).map((k) => ({ ...k, p: person(k.user_id) }));
    const s = state.kpiSort;
    const val = (r) => s.key === 'name' ? r.p.full_name : s.key === 'team' ? teamName(r.p.team_id) : (r[s.key] ?? -1);
    rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir; });
    const scored = rows.filter((r) => r.score !== null);
    const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const totalDone = sum('completed'), total = sum('total'), onTime = sum('completed_on_time');
    const th = (key, label) => `<th data-sort="${key}">${label}${s.key === key ? (s.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    $('#view .content').innerHTML = `
      <div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Everyone, across all departments.' : `Everyone in ${esc(deptName(state.me.department_id))}.`}</p></div></div>
      <div class="grid cols-4">
        <div class="card stat"><div class="label">Average score</div><div class="value">${avg ?? '—'}</div><div class="sub">${rows.length} people</div></div>
        <div class="card stat"><div class="label">Tasks completed</div><div class="value">${totalDone}</div><div class="sub">of ${total} assigned</div></div>
        <div class="card stat"><div class="label">On-time delivery</div><div class="value">${totalDone ? pct(onTime / totalDone) : '—'}</div><div class="sub">${onTime} on time</div></div>
        <div class="card stat"><div class="label">Overdue now</div><div class="value" style="${sum('overdue_open') ? 'color:var(--red)' : ''}">${sum('overdue_open')}</div><div class="sub">${sum('on_hold')} on hold</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h2>Team members</h2>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
          ${th('name', 'Member')}${th('team', 'Team')}${th('score', 'Score')}${th('completionRate', 'Completion')}${th('onTimeRate', 'On time')}${th('open', 'Open')}${th('overdue_open', 'Overdue')}
        </tr></thead><tbody>
        ${rows.map((r) => `<tr data-user="${esc(r.user_id)}">
          <td><div class="person">${avatar(r.p)}<div><b>${esc(r.p.full_name)}</b><span>${esc(r.p.title || r.p.role)}</span></div></div></td>
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
    $$('tr[data-user]').forEach((tr) => tr.addEventListener('click', () => { location.hash = '#/kpi/' + encodeURIComponent(tr.dataset.user); }));
  } catch (e) { fail(e); }
}

// =====================================================================
//  People & teams
// =====================================================================
async function renderPeople() {
  try { state.invitations = await store.listInvitations(); } catch (e) { state.invitations = []; }
  const visible = isAdmin() ? state.profiles : state.profiles.filter((p) => p.department_id === state.me.department_id);
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
            <div style="display:flex;align-items:center;gap:8px"><b style="flex:1">${esc(d.name)}</b>
              <button class="icon-btn" data-del-dept="${esc(d.id)}" aria-label="Delete department">${icon.trash(16)}</button></div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">
              ${state.teams.filter((t) => t.department_id === d.id).map((t) => `<span class="chip" style="cursor:default">${esc(t.name)}<button class="icon-btn" style="width:20px;height:20px" data-del-team="${esc(t.id)}" aria-label="Delete team">${icon.x(12)}</button></span>`).join('')}
            </div>
            <form class="team-form" data-dept="${esc(d.id)}" style="display:flex;gap:8px"><input class="input" placeholder="New team in ${esc(d.name)}" style="padding:8px 12px"><button class="btn sm">Add team</button></form>
          </div>`).join('')}
      </div>` : ''}
    </div>
    ${pending.length ? `<div class="card" style="margin-top:16px"><h2>Waiting to activate</h2>
      ${pending.map((i) => `<div class="list-row"><div class="avatar" style="background:var(--gray)">${esc(initials(i.full_name || i.email))}</div>
        <div class="grow"><b>${esc(i.full_name || i.email)}</b><span>${esc(i.email)} · ${esc(i.role)} · ${esc(teamName(i.team_id))}</span></div>
        <button class="btn sm" data-copy="${esc(i.email)}">Copy invite</button>
        <button class="icon-btn" data-del-inv="${esc(i.email)}" aria-label="Remove invitation">${icon.trash(16)}</button></div>`).join('')}
      <p class="small muted">Share the app link with them. They choose “Activate your account” and sign up with this email.</p></div>` : ''}
  </section>`;

  $('#invite-btn').addEventListener('click', openInvite);
  $$('[data-person]').forEach((r) => r.addEventListener('click', () => {
    const p = person(r.dataset.person);
    if (isAdmin()) openPersonEditor(p); else location.hash = '#/kpi/' + encodeURIComponent(p.id);
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
  const confirmDel = (b, fn) => b.addEventListener('click', async () => {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.style.color = 'var(--red)'; b.title = 'Click again to delete'; toast('Click again to delete', 'People in it will be left without a team.', 'orange'); return; }
    try { await fn(); await loadAll(); renderPeople(); } catch (ex) { fail(ex); }
  });
  $$('[data-del-dept]').forEach((b) => confirmDel(b, () => store.deleteDepartment(b.dataset.delDept)));
  $$('[data-del-team]').forEach((b) => confirmDel(b, () => store.deleteTeam(b.dataset.delTeam)));
}

function personRow(p, roleTone) {
  return `<div class="list-row click" data-person="${esc(p.id)}" style="${p.active ? '' : 'opacity:.5'}">${avatar(p)}
    <div class="grow"><b>${esc(p.full_name)}${p.id === state.me.id ? ' (you)' : ''}</b><span>${esc(p.title || p.email)}</span></div>
    ${p.active ? '' : '<span class="pill tone-gray">Inactive</span>'}
    <span class="pill tone-${roleTone[p.role]}" style="text-transform:capitalize">${esc(p.role)}</span></div>`;
}

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
          <option value="member">Member</option>${admin ? '<option value="manager">Manager</option><option value="admin">Admin</option>' : ''}</select></div>
        <div class="field"><label>Department</label><select class="select" id="i-dept" ${admin ? '' : 'disabled'}>${deptOptions(dept)}</select></div>
      </div>
      <div class="field"><label>Team</label><select class="select" id="i-team">${teamOptions(dept)}</select></div>
      <div class="error" id="i-error"></div>
    </div><div class="sheet-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Add person</button></div></form>`, (ov) => {
    $('#i-dept', ov).addEventListener('change', (e) => { $('#i-team', ov).innerHTML = teamOptions(e.target.value); });
    $('#inv-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#i-email', ov).value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#i-error', ov).textContent = 'Enter a valid email.'; return; }
      try {
        await store.createInvitation({
          email, full_name: $('#i-name', ov).value.trim(), title: $('#i-title', ov).value.trim(),
          role: $('#i-role', ov).value, department_id: $('#i-dept', ov).value || null, team_id: $('#i-team', ov).value || null,
        });
        closeSheet();
        toast('Person added', `${email} can now activate their account.`, 'green', icon.check);
        renderPeople();
      } catch (ex) { $('#i-error', ov).textContent = ex.message; }
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
        <div class="field"><label>Role</label><select class="select" id="p-role" ${p.id === state.me.id ? 'disabled' : ''}>${['member', 'manager', 'admin'].map((r) => `<option value="${r}" ${r === p.role ? 'selected' : ''} style="text-transform:capitalize">${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></div>
        <div class="field"><label>Department</label><select class="select" id="p-dept">${deptOptions(p.department_id)}</select></div>
      </div>
      <div class="field"><label>Team</label><select class="select" id="p-team">${teamOptions(p.department_id, p.team_id)}</select></div>
      <div class="small muted">${esc(p.email)}</div>
    </div><div class="sheet-foot">
      ${p.id !== state.me.id ? `<button type="button" class="btn ${p.active ? 'danger' : ''} left" id="p-active">${p.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
      <button type="button" class="btn" id="p-kpi">View KPIs</button>
      <button class="btn primary" type="submit">Save</button></div></form>`, (ov) => {
    $('#p-dept', ov).addEventListener('change', (e) => { $('#p-team', ov).innerHTML = teamOptions(e.target.value); });
    $('#p-kpi', ov).addEventListener('click', () => { closeSheet(); location.hash = '#/kpi/' + encodeURIComponent(p.id); });
    $('#p-active', ov)?.addEventListener('click', async () => {
      try { await store.updateProfile(p.id, { active: !p.active }); await loadAll(); closeSheet(); renderPeople(); } catch (ex) { fail(ex); }
    });
    $('#p-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = { full_name: $('#p-name', ov).value.trim(), title: $('#p-title', ov).value.trim(),
        department_id: $('#p-dept', ov).value || null, team_id: $('#p-team', ov).value || null };
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
        <div class="small muted" style="text-transform:capitalize">${esc(me.role)} · ${esc(teamName(me.team_id))} · ${esc(deptName(me.department_id))}</div></div></div>
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
