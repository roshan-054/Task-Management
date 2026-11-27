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
const fmtDate = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '';
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
};
// Times are always shown in India time (IST), 12-hour, e.g. "27 Nov 2026, 5:00 PM".
const IST = 'Asia/Kolkata';
const fmtTime = (hhmm) => { if (!hhmm) return ''; const [h, m] = String(hhmm).split(':').map(Number); return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const istFmt = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
const istParts = (d) => Object.fromEntries(istFmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
// The IST wall-clock time as a local Date (for Excel cells).
const istWall = (iso) => { const p = istParts(iso); return new Date(+p.year, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(p.month.slice(0, 3)), +p.day, +p.hour % 24, +p.minute); };
// The moment a task is due: its date at its time (9:00 when no time is set).
const localToday = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
const localDay = (iso) => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
const dueMoment = (date, time) => date ? new Date(`${date}T${time || '09:00'}:00`) : null;
const fmtDue = (t) => t.due_date ? fmtDate(t.due_date) + (t.due_time ? ', ' + fmtTime(t.due_time) : '') : '';
const fmtDateTime = (iso) => { if (!iso) return ''; const p = istParts(iso); return `${p.day} ${p.month.slice(0, 3)} ${p.year}, ${fmtTime(`${+p.hour % 24}:${p.minute}`)}`; };
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
  clock: (s) => I('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>', s),
  undo: (s) => I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>', s),
  people: (s) => I('<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.8 14.6c2.3.2 3.9 1.6 4.7 4.4"/>', s),
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
  eye: (s) => I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', s),
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
  repeat: (s) => I('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 01-4 4H4"/>', s),
  dots: (s) => I('<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>', s),
  chev: (s) => I('<path d="M6 9l6 6 6-6"/>', s),
  report: (s) => I('<path d="M6 3.5h9l4 4v13H6z"/><path d="M9 17v-3M12 17v-6M15 17v-4"/>', s),
  copy: (s) => I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>', s),
  mail: (s) => I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>', s),
  download: (s) => I('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>', s),
  print: (s) => I('<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>', s),
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
function toast(title, body = '', tone = 'blue', ic = icon.info, { action = '', onAction = null } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="ic tone-${tone}">${ic(18)}</div><div style="flex:1"><b>${esc(title)}</b>${body ? `<span class="muted small">${esc(body)}</span>` : ''}</div>${action ? `<button class="btn sm toast-act">${esc(action)}</button>` : ''}`;
  $('#toasts').appendChild(el);
  el.querySelector('.toast-act')?.addEventListener('click', () => { el.remove(); onAction?.(); });
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, action ? 6500 : 4200);
}
const fail = (e) => {
  const m = e?.message || String(e);
  if (/permission denied for function/i.test(m)) return toast('Database permissions need a repair', 'Ask your admin to run supabase/migrations/014_fix_function_permissions.sql in Supabase.', 'red', icon.info);
  toast('Something went wrong', m, 'red', icon.info);
};

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
// Small floating menu. items: [{ label, ic, tone, active, danger, onClick } | { group }]. On phones it opens as a bottom sheet.
function openMenu(anchor, items, { title = '', search = false, minWidth = 0, compact = false } = {}) {
  closeMenu();
  const m = document.createElement('div');
  m.className = `fmenu ${compact ? 'compact' : ''}`; m.setAttribute('role', 'menu');
  m.innerHTML = `${title ? `<div class="fmenu-title">${esc(title)}</div>` : ''}
    ${search ? `<div class="fmenu-search">${icon.search(15)}<input type="search" placeholder="Search" aria-label="Search options" autocomplete="off"></div>` : ''}
    <div class="fmenu-list">${items.map((it, i) => it.group != null ? `<div class="fmenu-group">${esc(it.group)}</div>` : `<button type="button" role="menuitemradio" aria-checked="${!!it.active}" class="fmenu-item ${it.tone ? 'tone-txt-' + it.tone : ''} ${it.active ? 'on' : ''} ${it.danger ? 'danger' : ''} ${it.muted ? 'muted-item' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
      ${it.ic !== false ? `<span class="fm-ic">${it.ic ? it.ic(17) : ''}</span>` : ''}<span class="fm-label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>${it.active ? `<span class="fm-tick">${icon.check(16)}</span>` : ''}</button>`).join('')}
    <div class="fmenu-none hidden">No matches</div></div>`;
  const back = document.createElement('div'); back.className = 'fmenu-back';
  document.body.append(back, m);
  const phone = matchMedia('(max-width: 640px)').matches;
  if (!phone) {
    if (minWidth) m.style.minWidth = Math.min(minWidth, innerWidth - 16) + 'px';
    const r = anchor.getBoundingClientRect(); const w = m.offsetWidth, h = m.offsetHeight;
    let left = Math.min(r.left, innerWidth - w - 8), top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    m.style.left = Math.max(8, left) + 'px'; m.style.top = top + 'px';
  } else m.classList.add('sheet-mode');
  const close = () => closeMenu();
  back.addEventListener('click', close);
  $$('.fmenu-item', m).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const it = items[Number(b.dataset.i)]; close(); it.onClick?.(); }));
  const q = $('.fmenu-search input', m);
  q?.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase(); let any = false;
    $$('.fmenu-item', m).forEach((b) => { const hit = !t || items[Number(b.dataset.i)].label.toLowerCase().includes(t); b.hidden = !hit; any ||= hit; });
    $$('.fmenu-group', m).forEach((g) => { g.hidden = !!t; });
    $('.fmenu-none', m).classList.toggle('hidden', any);
  });
  q?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $$('.fmenu-item', m).find((b) => !b.hidden && !b.disabled)?.click(); } });
  const onKey = (e) => {
    const btns = $$('.fmenu-item', m).filter((b) => !b.hidden && !b.disabled); const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); anchor.focus?.(); }
    else if (e.key === 'Tab') { close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0 && q) q.focus(); else btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === 'Home' && document.activeElement !== q) { e.preventDefault(); btns[0]?.focus(); }
    else if (e.key === 'End' && document.activeElement !== q) { e.preventDefault(); btns[btns.length - 1]?.focus(); }
    else if (!q && e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      // type a letter to jump to the next option starting with it
      clearTimeout(openMenu.tt); openMenu.typed = (openMenu.typed || '') + e.key.toLowerCase(); openMenu.tt = setTimeout(() => { openMenu.typed = ''; }, 700);
      const k = openMenu.typed; const order = k.length > 1 ? [...btns.slice(Math.max(i, 0)), ...btns.slice(0, Math.max(i, 0))] : [...btns.slice(i + 1), ...btns.slice(0, i + 1)];
      order.find((b) => b.textContent.trim().toLowerCase().startsWith(k))?.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  closeMenu.cleanup = () => { document.removeEventListener('keydown', onKey, true); m.remove(); back.remove(); };
  const first = $('.fmenu-item.on', m) || $('.fmenu-item:not([disabled])', m);
  if (q && !phone) q.focus({ preventScroll: true }); else first?.focus({ preventScroll: true });
  first?.scrollIntoView({ block: 'nearest' });
}

// ---------- Every <select class="select"> becomes a styled menu ----------
// The real <select> stays in the page (hidden), so the code that reads .value
// and listens for 'change' keeps working; the button just drives it.
const SEL_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const SEL_INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
const selLabel = (sel) => sel.getAttribute('aria-label') || (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`)?.textContent.trim()) || 'Choose';
function enhanceSelect(sel) {
  if (sel.dataset.enh || sel.multiple) return;
  sel.dataset.enh = '1';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.setAttribute('aria-haspopup', 'menu');
  sel.after(btn);
  sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  const sync = () => {
    const o = sel.options[sel.selectedIndex];
    btn.className = [...sel.classList].filter((c) => c !== 'xsel-native').join(' ') + ' xsel' + (!o || o.value === '' ? ' placeholder' : '');
    if (!sel.classList.contains('xsel-native')) sel.classList.add('xsel-native');
    btn.disabled = sel.disabled;
    const html = `<span class="xsel-v">${esc(o?.textContent.trim() || '')}</span><span class="xsel-chev">${icon.chev(16)}</span>`; if (btn.innerHTML !== html) btn.innerHTML = html;
    btn.setAttribute('aria-label', `${selLabel(sel)}: ${o?.textContent.trim() || 'none'}`);
    if (sel.title) btn.title = sel.title;
  };
  Object.defineProperty(sel, 'value', { configurable: true, get() { return SEL_VALUE.get.call(this); }, set(v) { SEL_VALUE.set.call(this, v); sync(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return SEL_INDEX.get.call(this); }, set(v) { SEL_INDEX.set.call(this, v); sync(); } });
  sel.addEventListener('change', sync);
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'selected'] });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [];
    const add = (o) => items.push({ label: o.textContent.trim(), active: o.selected, disabled: o.disabled, ic: false, muted: o.value === '',
      onClick: () => { if (o.selected) return; SEL_VALUE.set.call(sel, o.value); sync(); sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); btn.focus(); } });
    [...sel.children].forEach((c) => { if (c.tagName === 'OPTGROUP') { items.push({ group: c.label }); [...c.children].forEach(add); } else if (!c.hidden) add(c); });
    openMenu(btn, items, { title: matchMedia('(max-width: 640px)').matches ? selLabel(sel) : '', search: sel.options.length > 8, minWidth: btn.offsetWidth, compact: true });
  });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btn.click(); } });
  sync();
}
const enhanceSelects = (root) => { if (root.matches?.('select.select')) enhanceSelect(root); root.querySelectorAll?.('select.select').forEach(enhanceSelect); };
new MutationObserver((muts) => muts.forEach((mu) => mu.addedNodes.forEach((n) => { if (n.nodeType === 1) enhanceSelects(n); })))
  .observe(document.body, { childList: true, subtree: true });
// A <label for="..."> pointing at an enhanced select focuses its button.
document.addEventListener('click', (e) => {
  const l = e.target.closest('label[for]'); if (!l) return;
  const sel = document.getElementById(l.htmlFor);
  if (sel?.classList.contains('xsel-native')) { e.preventDefault(); sel.nextElementSibling?.focus(); }
});
function closeMenu() { closeMenu.cleanup?.(); closeMenu.cleanup = null; }
window.addEventListener('resize', () => closeMenu());
document.addEventListener('scroll', (e) => { if (!matchMedia('(max-width: 640px)').matches && !e.target.closest?.('.fmenu')) closeMenu(); }, true);

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
// Like confirmDialog but with a text box. Resolves the text, or null when cancelled.
function promptDialog({ title, body = '', placeholder = '', value = '', confirm = 'Save' } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'confirm-ov';
    ov.innerHTML = `<div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="pd-title" style="text-align:left">
      <h3 id="pd-title" style="margin-top:0">${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}
      <textarea class="textarea" id="pd-text" maxlength="1000" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
      <div class="confirm-actions" style="margin-top:14px"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(confirm)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.classList.add('closing'); setTimeout(() => ov.remove(), 150); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); done(null); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done($('#pd-text', ov).value.trim()); }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
    $('[data-no]', ov).addEventListener('click', () => done(null));
    $('[data-yes]', ov).addEventListener('click', () => done($('#pd-text', ov).value.trim()));
    document.body.appendChild(ov);
    setTimeout(() => $('#pd-text', ov).focus(), 30);
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
const isDark = () => document.documentElement.dataset.theme === 'dark';

// =====================================================================
//  Auth screens
// =====================================================================
function renderAuth(mode = 'signin') {
  const demo = store.mode === 'demo';
  const titles = {
    signin: ['Welcome back', 'Sign in to see your tasks.'],
    activate: ['Activate your account', 'Use the email your manager or admin added.'],
    reset: ['Forgot your password?', 'Ask your admin to set a temporary password for you (People & Teams → your name). Sign in with it and you\'ll be asked to choose your own. Or get a reset link by email:'],
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
        <button class="btn primary block" type="submit">${mode === 'signin' ? 'Sign in' : mode === 'activate' ? 'Create account' : 'Email me a reset link'}</button>
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

// Password field with a show/hide eye.
function pwInput(id, value = '', shown = false) {
  return `<span class="pw-wrap"><input class="input" id="${id}" type="${shown ? 'text' : 'password'}" value="${esc(value)}" autocomplete="new-password" spellcheck="false"><button type="button" class="pw-eye" data-eye="${id}" aria-label="Show or hide password" title="Show or hide">${icon.eye(16)}</button></span>`;
}
function bindPwInput(root) {
  $$('[data-eye]', root).forEach((b) => b.addEventListener('click', () => { const i = $('#' + b.dataset.eye, root); i.type = i.type === 'password' ? 'text' : 'password'; i.focus(); }));
}
// Change your own password. forced = signed in with a temporary password from an admin.
function openChangePassword(forced = false) {
  openSheet(`${sheetHead(forced ? 'Choose your own password' : 'Change password')}
    <form id="cp-form" novalidate><div class="sheet-body">
      ${forced ? `<div class="notice">${icon.info(18)}<div>You signed in with a temporary password from your admin. Choose a password only you know.</div></div>` : ''}
      <div class="field"><label for="cp-new">New password</label>${pwInput('cp-new')}<span class="small muted">At least 8 characters.</span></div>
      <div class="field"><label for="cp-again">Type it again</label>${pwInput('cp-again')}</div>
      <div class="error" id="cp-err"></div>
    </div><div class="sheet-foot">
      <button type="button" class="btn" data-close>${forced ? 'Later' : 'Cancel'}</button>
      <button class="btn primary" type="submit">Save password</button></div></form>`, (ov) => {
    bindPwInput(ov);
    setTimeout(() => $('#cp-new', ov)?.focus(), 50);
    $('#cp-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#cp-new', ov).value, b = $('#cp-again', ov).value, err = $('#cp-err', ov);
      if (a.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (a !== b) { err.textContent = 'The two passwords don\'t match.'; return; }
      const btn = $('button[type=submit]', ov); btn.disabled = true;
      try {
        await store.updatePassword(a);
        if (state.me.must_change_password) { try { await store.updateProfile(state.me.id, { must_change_password: false }); state.me.must_change_password = false; } catch {} }
        closeSheet(); toast('Password changed', 'Use your new password next time you sign in.', 'green', icon.check);
      } catch (ex) { err.textContent = friendlyAuthError(ex); btn.disabled = false; }
    });
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
    if (me.must_change_password) setTimeout(() => openChangePassword(true), 400);
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
    const bell = $('#bell'); if (bell) { bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring'); }
    setTimeout(() => { const st = $('#alert-strip'); if (st) { st.classList.remove('flash'); void st.offsetWidth; st.classList.add('flash'); } }, 0);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body: n.message, tag: n.id }); } catch {}
    }
    updateCounts();
    if (location.hash === '#/notifications') renderNotificationsPage();
    scheduleRefresh('tasks');
  } else if (msg.kind === 'directory') scheduleRefresh('directory');
  else scheduleRefresh('tasks');
}

// =====================================================================
//  Shell
// =====================================================================
function navItems() {
  const items = [
    { hash: '#/notifications', label: 'Notifications', ic: icon.bell, count: () => state.notifications.filter((n) => !n.read).length, alert: true },
    { hash: '#/tasks', label: 'My Tasks', ic: icon.check, count: () => myTasks().filter((t) => t.status !== 'completed').length },
    { hash: '#/waiting', label: 'Waiting on Me', ic: icon.at, count: () => waitingOnMe().length },
    { hash: '#/calendar', label: 'Calendar', ic: icon.cal },
  ];
  const personal = [{ section: 'Personal' },
    { hash: '#/todo', label: 'To-do', ic: icon.list, count: () => state.todos.filter((t) => !t.done && !t.pending).length },
    { hash: '#/notes', label: 'Notes', ic: icon.note }];
  if (isManager()) items.push({ hash: '#/assigned', label: 'Assigned by Me', ic: icon.send, count: () => assignedByMe().filter((t) => t.status !== 'completed').length });
  if (isAdmin()) items.push({ hash: '#/all', label: 'All Tasks', ic: icon.stack });
  items.push(...personal);
  items.push({ section: 'Performance' });
  if (isManager()) items.push({ hash: '#/team-kpi', label: 'Team Performance', ic: icon.chart });
  else items.push({ hash: '#/kpi', label: 'My Performance', ic: icon.chart });
  items.push({ hash: '#/reports', label: 'Reports', ic: icon.report });
  if (isManager()) { items.push({ section: 'Organisation' }); items.push({ hash: '#/people', label: 'People & Teams', ic: icon.team }); items.push({ hash: '#/platforms', label: 'Platforms', ic: icon.tag }); }
  return items;
}
const remarksFor = (taskId) => state.remarks.filter((r) => r.task_id === taskId);
const openBlockers = (taskId) => state.remarks.filter((r) => r.task_id === taskId && r.kind === 'blocker' && !r.resolved_at);
const waitingOnMe = () => state.tasks.filter((t) => t.status !== 'completed' && openBlockers(t.id).some((r) => r.tagged.includes(state.me.id)));
const myTasks = () => state.tasks.filter((t) => t.assigned_to === state.me.id);
const assignedByMe = () => state.tasks.filter((t) => t.created_by === state.me.id && t.assigned_to !== state.me.id);

const MOBILE_MAIN = ['#/tasks', '#/todo', '#/calendar', '#/notifications'];
const shortLabel = (l) => l.replace('Assigned by Me', 'Assigned').replace('My Performance', 'KPI').replace('Team Performance', 'KPI').replace('People & Teams', 'People').replace('Waiting on Me', 'Waiting').replace('Notifications', 'Alerts');
function renderShell() {
  const me = state.me;
  const items = navItems();
  app().innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><img class="mark" src="icons/icon.svg" alt="" width="30" height="30">${esc(CONFIG.APP_NAME)}</div>
      ${items.map((it) => it.section ? `<div class="nav-label">${esc(it.section)}</div>`
        : `<button class="nav-item" data-nav="${it.hash}">${it.ic()}<span>${esc(it.label)}</span>${it.count ? `<span class="count ${it.alert ? 'alert' : ''}" data-count="${it.hash}"></span>` : ''}</button>`).join('')}
      <div class="spacer"></div>
      ${store.mode === 'demo' ? `<div style="padding:0 10px 8px"><span class="demo-banner">Demo mode</span></div>` : ''}
      <div class="me-row">
        <div class="me-card" id="me-card" title="Your profile">${avatar(me)}<div class="who"><b>${esc(me.full_name)}</b><span>${esc([roleLabel(me.role), byId(state.teams, me.team_id)?.name].filter(Boolean).join(' · '))}</span></div></div>
        <button class="icon-btn logout-btn" id="logout-btn" aria-label="Log out" title="Log out">${icon.out(18)}</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="top-brand"><img class="mark" src="icons/icon.svg" alt="" width="26" height="26"><span>${esc(CONFIG.APP_NAME)}</span></div>
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
      ${MOBILE_MAIN.map((h) => items.find((it) => it.hash === h)).filter(Boolean).map((it) => `<button data-nav="${it.hash}">${it.ic(22)}<span>${esc(shortLabel(it.label))}</span></button>`).join('')}
      <button id="tab-more" aria-haspopup="menu">${icon.dots(22)}<span>More</span></button>
    </nav>
  </div>`;

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.nav; }));
  $('#tab-more').addEventListener('click', (e) => {
    const rest = navItems().filter((it) => !it.section && !MOBILE_MAIN.includes(it.hash));
    const h = location.hash || '#/tasks';
    openMenu(e.currentTarget, rest.map((it) => ({ label: it.label, ic: it.ic, active: h === it.hash || (h.startsWith('#/kpi/') && it.hash === '#/team-kpi'),
      hint: it.count && it.count() ? `${it.count()} open` : '', onClick: () => { location.hash = it.hash; } })), { title: 'More' });
  });
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
  // Tab title and a banner that stays until notifications are read.
  document.title = (unread ? `(${unread}) ` : '') + CONFIG.APP_NAME;
  renderAlertStrip();
}
function renderAlertStrip() {
  const unread = state.notifications.filter((n) => !n.read);
  let el = $('#alert-strip');
  if (!unread.length || location.hash === '#/notifications' || !$('.main')) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'alert-strip'; el.className = 'alert-strip'; $('.topbar').after(el); }
  const n = unread[0]; const { tone, ic } = noteStyle(n.type);
  el.innerHTML = `<span class="pulse-dot"></span><span class="as-ic tone-${tone}">${ic(16)}</span>
    <span class="as-msg"><b>${unread.length === 1 ? '1 new notification' : `${unread.length} new notifications`}</b> · ${esc(n.message)}</span>
    <button class="btn sm primary" id="as-view">View</button><button class="icon-btn" id="as-close" aria-label="Mark all as read" title="Mark all as read">${icon.x(15)}</button>`;
  $('#as-view', el).onclick = () => { location.hash = '#/notifications'; };
  $('#as-close', el).onclick = () => markAllRead();
}
async function markAllRead() {
  const ids = state.notifications.filter((n) => !n.read).map((n) => n.id);
  if (!ids.length) return;
  state.notifications.forEach((n) => { n.read = true; });
  updateCounts();
  try { await store.markNotificationsRead(ids); } catch (e) { console.warn(e); }
}
let noteFilter = 'unread';
function renderNotificationsPage() {
  const all = state.notifications;
  const unread = all.filter((n) => !n.read);
  if (noteFilter === 'unread' && !unread.length && all.length) noteFilter = 'all';
  const list = noteFilter === 'unread' ? unread : all;
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  const muted = isMuted();
  const day = (iso) => { const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
    return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }); };
  let lastDay = '';
  $('#view').innerHTML = `
  <section class="content narrow">
    <div class="page-head"><div><h1>Notifications</h1><p>Everything that needs your attention, newest first.</p></div>
      ${unread.length ? `<button class="btn" id="n-readall">${icon.check(16)} Mark all as read</button>` : ''}</div>
    ${canAsk || muted ? `<div class="notice">${icon.bell(18)}<div>${canAsk ? 'Turn on desktop alerts so you see notifications even when this tab is in the background. ' : ''}${muted ? 'Notification sound is off. ' : ''}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${canAsk ? `<button class="btn sm primary" id="n-desk">Enable desktop alerts</button>` : ''}${muted ? `<button class="btn sm" id="n-sound">${icon.sound(14)} Turn sound on</button>` : ''}</div></div></div>` : ''}
    <div class="segmented" style="margin:14px 0 10px"><button class="${noteFilter === 'unread' ? 'active' : ''}" data-nf="unread">Unread<span class="n">${unread.length}</span></button><button class="${noteFilter === 'all' ? 'active' : ''}" data-nf="all">All<span class="n">${all.length}</span></button></div>
    <div class="card notif-page">${list.length ? list.map((n) => {
      const { tone, title, ic } = noteStyle(n.type);
      const d = day(n.created_at); const head = d !== lastDay ? `<div class="notif-day">${esc(d)}</div>` : ''; lastDay = d;
      return `${head}<button class="notif-row ${n.read ? '' : 'unread'}" data-n="${esc(n.id)}" data-task="${esc(n.task_id || '')}">
        <span class="ic tone-${tone}">${ic(18)}</span>
        <span class="nr-body"><b>${esc(title)}</b><span>${esc(n.message)}</span></span>
        <time title="${esc(fmtDateTime(n.created_at))}">${esc(timeAgo(n.created_at))}</time>${n.read ? '' : '<span class="unread-dot"></span>'}</button>`;
    }).join('') : `<div class="todo-empty">${icon.bell(28)}<b>You're all caught up</b><span>New notifications will show up here and in a banner at the top.</span></div>`}</div>
  </section>`;
  $$('[data-nf]').forEach((b) => b.addEventListener('click', () => { noteFilter = b.dataset.nf; renderNotificationsPage(); }));
  $('#n-readall')?.addEventListener('click', async () => { await markAllRead(); renderNotificationsPage(); });
  $('#n-desk')?.addEventListener('click', async () => { await Notification.requestPermission(); renderNotificationsPage(); });
  $('#n-sound')?.addEventListener('click', () => { setMuted(false); chime('blue', { force: true }); renderShell(); route(); });
  $$('.notif-row').forEach((r) => r.addEventListener('click', async () => {
    const n = byId(state.notifications, r.dataset.n);
    if (n && !n.read) { n.read = true; updateCounts(); store.markNotificationsRead([n.id]).catch(() => {}); }
    const t = byId(state.tasks, r.dataset.task);
    if (t) openTask(t); else if (r.dataset.task) toast('Task no longer available');
    renderNotificationsPage();
  }));
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
  $('#tab-more')?.classList.toggle('active', !MOBILE_MAIN.includes(h));
  document.body.classList.toggle('has-inline-new', /^#\/(tasks|assigned|all|waiting|calendar)$/.test(h));
  closePopover(); closeMenu();
  if (/^#\/(tasks|assigned|all|waiting)$/.test(h)) {
    if ((h === '#/assigned' && !isManager()) || (h === '#/all' && !isAdmin())) { location.hash = '#/tasks'; return; }
    renderTaskView();
  } else if (h === '#/kpi') { if (isManager()) { location.hash = '#/team-kpi'; return; } renderKpi(state.me.id); }
  else if (h.startsWith('#/kpi/')) renderKpi(decodeURIComponent(h.slice(6)));
  else if (h === '#/team-kpi' && isManager()) renderTeamKpi();
  else if (h === '#/todo') renderTodos();
  else if (h === '#/reports') renderReports();
  else if (h === '#/calendar') renderCalendar();
  else if (h === '#/notifications') renderNotificationsPage();
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
  const segLabel = { active: 'Active', all: 'All statuses', ...Object.fromEntries(STATUSES.map((x) => [x.id, x.label])) };
  state.exportList = { tasks: mode === 'board' ? pool : list, title: titles[h][0], filters: [
    mode === 'board' ? 'All statuses' : segLabel[f.status],
    f.priority !== 'all' ? prioOf(f.priority).label + ' priority' : '',
    f.platform === 'none' ? 'No platform' : f.platform !== 'all' ? 'Platform: ' + (platformOf(f.platform)?.name || '') : '',
    q ? `Search: "${f.q.trim()}"` : '',
    { due: 'Sorted by due date', priority: 'Sorted by priority', recent: 'Newest first' }[f.sort] || ''].filter(Boolean) };

  const segs = [['active', 'Active'], ...STATUSES.map((s) => [s.id, s.label]), ['all', 'All']];
  const board = `<div class="board">${STATUSES.map((s) => {
    const col = pool.filter((t) => t.status === s.id);
    return `<div class="column" data-col="${s.id}">
      <div class="col-head tone-${s.tone}">${statusIcon[s.id](16)}<span>${s.label}</span><b>${col.length}</b></div>
      <div class="col-body">${col.map((t, i) => taskCard(t, i)).join('') || `<div class="col-empty">Drop tasks here</div>`}</div>
    </div>`;
  }).join('')}</div>`;
  const cards = list.length ? `<div class="card-grid">${list.map((t, i) => taskCard(t, i)).join('')}</div>` : emptyState(h);
  // People view: one section per person (assignee; on My Tasks, who assigned it).
  const byWho = h === '#/tasks' ? 'created_by' : 'assigned_to';
  const groups = new Map();
  list.forEach((t) => { const k = t[byWho]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  const peopleView = list.length ? `<div class="people-groups">${[...groups.entries()]
    .sort(([a], [b]) => person(a).full_name.localeCompare(person(b).full_name))
    .map(([pid, ts]) => {
      const pp = person(pid);
      const all = pool.filter((t) => t[byWho] === pid);
      const open = all.filter((t) => t.status !== 'completed').length;
      const over = all.filter((t) => t.status !== 'completed' && t.due_date && t.due_date < todayISO()).length;
      const done = all.length - open;
      return `<details class="pgroup" open><summary>${avatar(pp)}<span class="pg-name"><b>${esc(pid === state.me.id ? pp.full_name + ' (you)' : pp.full_name)}</b><span>${esc(orgLine(pp, pp.title || roleLabel(pp.role)))}</span></span>
        <span class="pg-stats"><span class="pill tone-blue">${open} open</span>${over ? `<span class="pill tone-red">${over} overdue</span>` : ''}<span class="pill tone-green">${done} done</span></span>
        <span class="meter pg-meter" title="${all.length ? Math.round((done / all.length) * 100) : 0}% done"><div style="width:${all.length ? (done / all.length) * 100 : 0}%"></div></span></summary>
        <div class="card-grid">${ts.map((t, i) => taskCard(t, i)).join('')}</div></details>`;
    }).join('')}</div>` : emptyState(h);

  $('#view').innerHTML = `
  <section class="content wide">
    <div class="page-head"><div><div class="title-row"><h1>${titles[h][0]}</h1><button class="btn primary new-task-inline" data-new-task>${icon.plus(16)}<span>New Task</span></button></div><p>${titles[h][1]}</p></div>
      <div class="segmented view-toggle" aria-label="Layout">
        <button class="${mode === 'board' ? 'active' : ''}" data-mode="board">${icon.board(15)} Board</button>
        <button class="${mode === 'cards' ? 'active' : ''}" data-mode="cards">${icon.grid(15)} Cards</button>
        <button class="${mode === 'people' ? 'active' : ''}" data-mode="people">${icon.people(15)} People</button>
      </div>
      <button class="btn" id="t-export" aria-haspopup="menu" ${list.length || pool.length ? '' : 'disabled'}>${icon.download(15)}<span>Export</span></button></div>
    <div class="toolbar">
      ${mode !== 'board' ? `<div class="segmented" role="tablist">${segs.map(([id, label]) => `<button class="${f.status === id ? 'active' : ''}" data-status="${id}">${label}<span class="n">${counts[id]}</span></button>`).join('')}</div>` : ''}
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
    ${mode === 'board' ? (pool.length ? board : emptyState(h)) : mode === 'people' ? peopleView : cards}
  </section>`;

  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { setViewMode(b.dataset.mode); renderTaskView(); }));
  $('[data-new-task]')?.addEventListener('click', () => openTaskEditor());
  $('#t-export').addEventListener('click', (e) => openExportMenu(e.currentTarget, state.exportList));
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

const REPEATS = { daily: 'Every day', weekdays: 'Every weekday (Mon–Fri)', weekly: 'Every week', monthly: 'Every month' };
const REPEAT_SHORT = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' };
const repeatReady = () => store.mode === 'demo' || state.tasks.some((t) => 'repeat' in t);
const STATUS_HINT = { not_started: 'Not picked up yet', in_progress: 'Being worked on', on_hold: 'Paused or blocked', completed: 'Done' };
function statusSelect(t) {
  const s = statusOf(t.status);
  return `<button type="button" class="st-pick tone-${s.tone}" data-status-btn="${esc(t.id)}" aria-haspopup="menu" aria-label="Work status: ${esc(s.label)}. Change">
    <span class="st-ic">${statusIcon[s.id](15)}</span><span>${esc(s.label)}</span>${icon.chev(14)}</button>`;
}
function openStatusMenu(btn) {
  const t = byId(state.tasks, btn.dataset.statusBtn); if (!t) return;
  openMenu(btn, STATUSES.map((x) => ({ label: x.label, hint: STATUS_HINT[x.id], ic: statusIcon[x.id], tone: x.tone, active: x.id === t.status,
    onClick: () => changeStatus(t.id, x.id) })), { title: 'Work status' });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-status-btn]');
  if (b) { e.stopPropagation(); openStatusMenu(b); }
});

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
    tip: `Due ${new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}${at ? ' at' + at : ''} · ${days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : `${hoursLeft} h left`} · ${Math.round(pct * 100)}% of the time used` };
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
  // The left edge shows the state at a glance: overdue, due soon, or the work status.
  const tmr = new Date(Date.now() + 864e5); const tmrISO = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
  const soon = !overdue && t.status !== 'completed' && t.due_date && t.due_date <= tmrISO;
  const edgeLabel = overdue ? 'Overdue' : soon ? 'Due soon' : statusOf(t.status).label;
  const links = (t.links || []).map((l) => ({ ...l, href: safeUrl(l.url) })).filter((l) => l.href);
  return `
  <article class="tcard ${t.status === 'completed' ? 'done' : ''} st-${esc(t.status)} ${overdue ? 'is-overdue' : soon ? 'is-soon' : ''}" data-id="${esc(t.id)}" data-edge="${esc(edgeLabel)}" style="--prio:${p.color};animation-delay:${Math.min(i, 12) * 30}ms" tabindex="0" ${canStatus ? 'draggable="true"' : ''}>
    <div class="tcard-top">
      <span class="pill tone-${p.tone}">${p.label}</span>
      ${platformChip(t)}
      ${dueChip(t)}
      ${t.repeat && REPEATS[t.repeat] ? `<span class="rep-chip" title="Repeats ${esc(REPEATS[t.repeat].toLowerCase())}">${icon.repeat(12)}${esc(REPEAT_SHORT[t.repeat])}</span>` : ''}
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
      <span class="foot-icons">
        ${nextReminder(t) ? `<span class="rem-count" title="Reminder ${esc(fmtDateTime(nextReminder(t).remind_at))}">${icon.bell(13)}</span>` : ''}
        ${remarksFor(t.id).length ? `<span class="remark-count" title="Remarks">${icon.chat(13)} ${remarksFor(t.id).length}</span>` : ''}
      </span>
    </div>
    <div class="tcard-when ${t.completed_at && t.status === 'completed' ? 'is-done' : ''}">
      ${t.completed_at && t.status === 'completed' ? `${icon.check(13)}<span>Completed ${esc(fmtDateTime(t.completed_at))}</span>` : `<span>Added ${esc(timeAgo(t.created_at))}</span>`}
    </div>
  </article>`;
}

// A to-do linked to a task: ticking it completes the task, and a completed task ticks its to-dos.
async function completeLinkedTodos(taskId) {
  const open = state.todos.filter((x) => x.task_id === taskId && !x.done);
  for (const td of open) { try { Object.assign(td, await store.updateTodo(td.id, { done: true, ...('pending' in td ? { pending: false } : {}) })); } catch {} }
  return open.length;
}

async function changeStatus(id, status) {
  const t = byId(state.tasks, id);
  if (!t || t.status === status) return;
  const prev = t.status;
  t.status = status;
  try {
    const updated = await store.updateTask(id, { status });
    Object.assign(t, updated);
    if (status === 'completed') await completeLinkedTodos(id);
    if (status === 'completed' && t.repeat) { try { state.tasks = await store.listTasks(); } catch {} toast('Next one created', `"${t.title}" repeats ${REPEATS[t.repeat].toLowerCase()}.`, 'blue', icon.repeat); }
    if (status === 'completed') toast('Nice work', t.created_by !== state.me.id ? `${person(t.created_by).full_name} has been notified.` : 'Task completed.', 'green', icon.check);
  } catch (e) { t.status = prev; fail(e); }
  if (/^#\/(tasks|assigned|all|waiting)/.test(location.hash)) renderTaskView();
  else if (location.hash === '#/calendar') renderCalendar();
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
      ${todoButton(t)}
      <div data-remarks></div>
      ${links.length ? `<div><div class="field"><label>Related links</label></div><div class="links">${links.map((l) => `<a class="link-chip" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${icon.link(14)}<span>${esc(l.label || l.href)}</span>${icon.arrow(12)}</a>`).join('')}</div></div>` : ''}
      ${canStatus ? `<div class="field"><label>Work status</label>
        <div class="status-picker">${STATUSES.map((s) => `<button type="button" class="tone-${s.tone} ${s.id === t.status ? 'active' : ''}" data-set="${s.id}" style="background:${s.id === t.status ? '' : 'var(--surface)'}">${statusIcon[s.id](22)}${s.label}</button>`).join('')}</div></div>`
        : `<div class="detail"><div class="k">Status</div><div class="v"><span class="pill dot tone-${statusOf(t.status).tone}">${statusOf(t.status).label}</span></div></div>`}
    </div>`, (ov) => {
    loadHistory(t, ov);
    renderRemarks(t, ov);
    bindTodoButton(t, ov);
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

// Highlighted key facts at the top of the task editor.
function taskSummary(t) {
  const by = person(t.created_by), to = person(t.assigned_to), st = statusOf(t.status), pr = prioOf(t.priority), pl = platformOf(t.platform_id), d = dueInfo(t);
  const who = (k, p) => `<div class="ts-who"><span class="ts-k">${k}</span><span class="ts-v">${avatar(p)}<span><b>${esc(p.id === state.me.id ? p.full_name + ' (you)' : p.full_name)}</b>${p.title ? `<small>${esc(p.title)}</small>` : ''}</span></span></div>`;
  return `<section class="task-summary" aria-label="Task summary">
    <div class="ts-people">${who('Assigned by', by)}<span class="ts-arrow">${icon.send(16)}</span>${who('Assigned to', to)}</div>
    <div class="ts-chips">
      <span class="ts-chip tone-${st.tone}">${statusIcon[st.id](14)}${esc(st.label)}</span>
      <span class="ts-chip tone-${pr.tone}">${esc(pr.label)} priority</span>
      ${t.due_date ? `<span class="ts-chip ${d ? 'due-' + d.state : ''}">${icon.cal(14)}Due ${esc(fmtDate(t.due_date))}${t.due_time ? ', ' + esc(fmtTime(t.due_time)) : ''}${d && d.state !== 'ok' && d.state !== 'done' ? ` · ${esc(d.label)}` : ''}</span>` : `<span class="ts-chip">${icon.cal(14)}No due date</span>`}
      ${pl ? `<span class="ts-chip plat">${icon.tag(14)}${esc(pl.name)}</span>` : ''}
      ${t.repeat && REPEATS[t.repeat] ? `<span class="ts-chip">${icon.repeat(14)}${esc(REPEATS[t.repeat])}</span>` : ''}
    </div>
    <div class="ts-meta">Created ${esc(fmtDateTime(t.created_at))}${t.completed_at && t.status === 'completed' ? ` · Completed ${esc(fmtDateTime(t.completed_at))}` : ''}</div>
  </section>`;
}
function openTaskEditor(t = null, prefill = {}) {
  const editing = !!t;
  const data = t || { title: '', description: '', priority: 'medium', status: 'not_started', due_date: '', links: [], platform_id: null, assigned_to: isManager() ? '' : state.me.id, ...prefill };
  openSheet(`${sheetHead(editing ? 'Edit task' : 'New task')}
    <form id="task-form" novalidate><div class="sheet-body">
      ${editing ? taskSummary(t) : ''}
      <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" maxlength="200" placeholder="What needs to be done?" value="${esc(data.title)}" required></div>
      <div class="field"><label id="t-status-l">Work status</label>
        <div class="st-seg" role="radiogroup" aria-labelledby="t-status-l">${STATUSES.map((x) => `<button type="button" role="radio" aria-checked="${x.id === data.status}" class="st-opt tone-${x.tone} ${x.id === data.status ? 'on' : ''}" data-st="${x.id}">${statusIcon[x.id](16)}<span>${x.label}</span></button>`).join('')}</div>
        <input type="hidden" id="t-status" value="${esc(data.status)}"></div>
      <div class="field"><label for="t-desc">Details</label><textarea class="textarea" id="t-desc" placeholder="Add context, steps or acceptance criteria">${esc(data.description)}</textarea></div>
      <div class="row ap-row"><div class="field"><label for="t-assignee">Assign to</label>
        <select class="select" id="t-assignee" ${isManager() ? '' : 'disabled'}>${assigneeOptions(data.assigned_to)}</select>
        ${isManager() ? '' : '<span class="small muted">Team members can add tasks for themselves. Managers can assign to anyone.</span>'}</div>
      <div class="field" id="plat-field" hidden></div></div>
      <div class="row">
        <div class="field"><label for="t-prio">Priority</label><select class="select" id="t-prio">${PRIORITIES.map((p) => `<option value="${p.id}" ${p.id === data.priority ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="field"><label for="t-due">Due date</label><input class="input" type="date" id="t-due" value="${esc(data.due_date || '')}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="t-time">Time <span class="muted" style="font-weight:400">(optional)</span></label><input type="hidden" id="t-time" value="${esc(data.due_time || '')}"><div data-timepick></div></div>
        <div class="field"><label for="t-repeat">${icon.repeat(14)} Repeat</label>
        <select class="select" id="t-repeat" ${editing && t.created_by !== state.me.id && !isAdmin() ? 'disabled' : ''}>
          <option value="">Doesn't repeat</option>${Object.entries(REPEATS).map(([k, v]) => `<option value="${k}" ${data.repeat === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <span class="small muted" id="t-repeat-hint">${data.repeat ? 'Next one is created when this is completed.' : ''}</span></div>
      </div>
      <div data-reminders></div>
      <div class="field"><label>Related links</label>
        <div id="links" style="display:grid;gap:8px">${(data.links || []).map(linkRow).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-link" style="justify-self:start">${icon.plus(14)} Add link</button></div>
      ${editing ? todoButton(t) + timingBlock(t) + '<div data-remarks></div>' : ''}
      <div class="error" id="t-error"></div>
    </div>
    <div class="sheet-foot">
      ${editing ? `<button type="button" class="btn danger left" id="t-delete">${icon.trash(16)} Delete</button>` : ''}
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">${editing ? 'Save changes' : 'Create task'}</button>
    </div></form>`, (ov) => {
    if (editing) { loadHistory(t, ov); renderRemarks(t, ov); bindTodoButton(t, ov); }
    // Platform picker follows the assignee's department; hidden when that department has none.
    let chosenPlat = data.platform_id || '';
    const renderPlat = () => {
      const box = $('#plat-field', ov);
      const assignee = person($('#t-assignee', ov).value || data.assigned_to);
      const opts = platformsFor(assignee.department_id, data.platform_id);
      if (!opts.some((o) => o.id === chosenPlat)) chosenPlat = '';
      box.hidden = !opts.length;
      box.innerHTML = opts.length ? `<label for="t-plat">Platform</label>
        <select class="select" id="t-plat">
          <option value="" ${chosenPlat ? '' : 'selected'}>None</option>
          ${opts.map((o) => `<option value="${esc(o.id)}" ${o.id === chosenPlat ? 'selected' : ''}>${esc(o.name)}${o.archived ? ' (removed)' : ''}</option>`).join('')}
        </select>` : '';
      $('#t-plat', box)?.addEventListener('change', (e) => { chosenPlat = e.target.value; });
    };
    renderPlat();
    $$('.st-opt', ov).forEach((b) => b.addEventListener('click', () => {
      $('#t-status', ov).value = b.dataset.st;
      $$('.st-opt', ov).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    }));
    $('.st-seg', ov).addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return; e.preventDefault();
      const bs = $$('.st-opt', ov); const i = bs.indexOf(document.activeElement); const n = bs[(i + (/Right|Down/.test(e.key) ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click();
    });
    $('#t-repeat', ov).addEventListener('change', (e) => { $('#t-repeat-hint', ov).textContent = e.target.value ? 'Next one is created when this is completed.' : ''; });
    mountTimePicker($('[data-timepick]', ov), $('#t-time', ov));
    const rem = mountReminders($('[data-reminders]', ov), {
      task: t, getDue: () => ({ date: $('#t-due', ov).value || ($('#t-time', ov).value ? localToday() : ''), time: $('#t-time', ov).value }),
      needDue: () => {
        if (!$('#t-due', ov).value) $('#t-due', ov).value = localToday();
        if (!$('#t-time', ov).value) { const n = new Date(Date.now() + 60 * 60e3); $('#t-time', ov).value = `${String(n.getHours()).padStart(2, '0')}:00`; }
        $('#t-time', ov).dispatchEvent(new Event('change'));
        const ti = $('.tp-btn', ov); ti.classList.add('flash'); setTimeout(() => ti.classList.remove('flash'), 1400);
        toast('Due time set to ' + fmtTime($('#t-time', ov).value) + ' today', 'Change the date or time if needed; the reminder follows it.', 'blue', icon.clock);
      },
      assigneeId: () => (isManager() ? $('#t-assignee', ov).value : state.me.id) || null,
    });
    $('#t-assignee', ov).addEventListener('change', () => { renderPlat(); rem.redraw(); });
    ['#t-due', '#t-time'].forEach((sel) => ['change', 'input'].forEach((ev) => $(sel, ov).addEventListener(ev, () => {
      // Picking a time with no date means today.
      if (sel === '#t-time' && $('#t-time', ov).value && !$('#t-due', ov).value) $('#t-due', ov).value = localToday();
      rem.redraw();
    })));
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
        due_date: $('#t-due', ov).value || ($('#t-time', ov).value ? localToday() : null),
        due_time: $('#t-time', ov).value || null,
        status: $('#t-status', ov).value,
        links,
      };
      // Only send platform_id when platforms exist, so databases without migration 006 keep working.
      if (state.platforms.length || data.platform_id) payload.platform_id = chosenPlat || null;
      if (!state.remindersReady && !payload.due_time) delete payload.due_time;  // database not updated yet
      const rp = $('#t-repeat', ov).value || null;
      if (repeatReady() || rp) payload.repeat = rp;
      if (rp && !payload.due_date) payload.due_date = localToday();
      if (!payload.title) { err.textContent = 'Give the task a title.'; return; }
      if (!payload.assigned_to) { err.textContent = 'Choose who this task is for.'; $('#t-assignee', ov).focus(); return; }
      if (bad) { err.textContent = `"${bad.url}" is not a valid link.`; return; }
      const btn = $('button[type=submit]', ov); btn.disabled = true;
      try {
        if (editing) {
          const u = await store.updateTask(t.id, payload);
          Object.assign(byId(state.tasks, t.id), u);
          if (u.status === 'completed') await completeLinkedTodos(t.id);
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
  const weekLabel = (i) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * (7 - i)); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
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
    if (!rows.length) { $('#view .content').innerHTML = `<div class="empty"><h3>Not available</h3><p>Managers can see the performance of their own team members only. Only admins can see other managers and admins.</p></div>`; return; }
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
  $('#view').innerHTML = `<section class="content"><div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Combined performance of everyone, across all departments.' : 'Combined performance of you and the team members you manage. Other managers and admins are not included.'}</p></div></div><div class="boot" style="min-height:200px"><div class="spinner"></div></div></section>`;
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
      <div class="page-head"><div><h1>${title}</h1><p>${isAdmin() ? 'Combined performance of everyone, across all departments.' : 'Combined performance of you and the team members you manage. Other managers and admins are not included.'}</p></div></div>
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
    if (isAdmin()) openPersonEditor(p);
    else if (p.id === state.me.id || (p.role === 'member' && (p.manager_id === state.me.id || (!p.manager_id && state.me.department_id && p.department_id === state.me.department_id && (!state.me.team_id || p.team_id === state.me.team_id))))) location.hash = '#/kpi/' + encodeURIComponent(p.id);
    else toast('Not available', 'Managers can see the performance of their own team members only. Only admins can see other managers.', 'gray', icon.lock);
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

// To-do: several lists shown as cards side by side (like Google Tasks). Each list has
// "Add a task", square checkboxes, a Pending section (with the reason) and a folded
// Completed section. The first list, "My Tasks", always exists.
const DEFAULT_LIST = { id: '', name: 'My Tasks' };
const todoListOf = (t) => (t.list_id && state.todoLists?.some((l) => l.id === t.list_id)) ? t.list_id : '';
const openDone = new Set();   // lists whose Completed section is open
async function renderTodos() {
  try {
    const [todos, lists] = await Promise.all([store.listTodos(), store.listTodoLists ? store.listTodoLists().catch(() => null) : null]);
    state.todos = todos; state.todoLists = lists; state.personalError = '';
  } catch (e) { state.personalError = e.message; }
  // Tasks completed elsewhere tick their linked to-dos.
  for (const td of state.todos) {
    const task = td.task_id && !td.done ? byId(state.tasks, td.task_id) : null;
    if (task && task.status === 'completed') await completeLinkedTodos(task.id);
  }
  drawTodos();
}
function drawTodos() {
  const hasPending = state.todos.some((t) => 'pending' in t) || store.mode === 'demo';
  const listsReady = Array.isArray(state.todoLists);
  const lists = [DEFAULT_LIST, ...(state.todoLists || [])];
  const ago = (iso) => timeAgo(iso).replace(/^Just now$/, 'just now');
  const linked = (t) => { const task = t.task_id ? byId(state.tasks, t.task_id) : null; return task ? `<button class="todo-task" data-open-task="${esc(task.id)}" title="Open the full task">${icon.arrow(12)} Task · ${esc(statusOf(task.status).label)}</button>` : ''; };
  const row = (t) => `<li class="tl-row ${t.done ? 'is-done' : ''} ${t.pending ? 'is-pending' : ''}" data-todo="${esc(t.id)}" ${!t.done && !t.pending ? 'draggable="true"' : ''}>
      <button class="tl-check" data-toggle role="checkbox" aria-checked="${t.done}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}" title="${t.done ? 'Mark as not done' : 'Mark as done'}">${I('<path d="M6 12.5l4 4 8-9"/>', 14)}</button>
      <div class="tl-main">
        <span class="todo-title" data-edit tabindex="0" title="Click to edit">${esc(t.title)}</span>
        ${t.pending || t.task_id || t.done ? `<div class="tl-meta">
          ${t.pending ? `<button class="todo-why" data-why title="Click to edit the reason">${icon.clock(12)}<span>${t.pending_note ? esc(t.pending_note) : '<i>No reason given</i>'}</span></button>` : ''}
          ${linked(t)}
          ${t.done && t.done_at ? `<span class="tl-when">Done ${esc(ago(t.done_at))}</span>` : ''}
        </div>` : ''}
      </div>
      <div class="tl-acts">
        ${!t.done && hasPending ? (t.pending
          ? `<button class="icon-btn" data-unpend aria-label="Move back to the list" title="Move back to the list">${icon.undo(15)}</button>`
          : `<button class="icon-btn" data-pend aria-label="Move to Pending" title="Move to Pending (add a reason)">${icon.clock(15)}</button>`) : ''}
        <button class="icon-btn tl-del" data-del aria-label="Delete" title="Delete">${icon.trash(15)}</button>
      </div>
    </li>`;
  const card = (l) => {
    const mine = state.todos.filter((t) => todoListOf(t) === l.id);
    const open = mine.filter((t) => !t.done && !t.pending).sort((a, b) => a.position - b.position);
    const pending = mine.filter((t) => !t.done && t.pending).sort((a, b) => (b.pending_at || '').localeCompare(a.pending_at || ''));
    const done = mine.filter((t) => t.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
    const empty = !open.length && !pending.length;
    return `<section class="tl-card" data-list="${esc(l.id)}">
      <header class="tl-head">
        <h3 class="tl-name" ${l.id ? 'data-rename tabindex="0" title="Click to rename"' : ''}>${esc(l.name)}</h3>
        <span class="tl-count">${open.length || ''}</span>
        <button class="icon-btn" data-list-menu aria-label="List options" title="List options">${icon.dots(18)}</button>
      </header>
      <form class="tl-add" data-add>
        <span class="tl-plus">${icon.plus(18)}</span>
        <input class="tl-input" maxlength="300" placeholder="Add a task" aria-label="Add a task to ${esc(l.name)}" ${state.personalError ? 'disabled' : ''}>
      </form>
      <ul class="tl-items" data-items>${open.map(row).join('')}</ul>
      ${empty ? `<div class="tl-empty">${done.length
          ? `<div class="tl-art done">${icon.check(30)}</div><b>All tasks complete</b><span>Nice work!</span>`
          : `<div class="tl-art">${icon.list(28)}</div><b>No tasks yet</b><span>Add your to-dos above.</span>`}</div>` : ''}
      ${pending.length ? `<details class="tl-sec pend" open><summary>${icon.chev(16)} Pending (${pending.length})</summary><ul class="tl-items">${pending.map(row).join('')}</ul></details>` : ''}
      ${done.length ? `<details class="tl-sec" data-done ${openDone.has(l.id) ? 'open' : ''}><summary>${icon.chev(16)} Completed (${done.length})</summary><ul class="tl-items">${done.map(row).join('')}</ul></details>` : ''}
    </section>`;
  };
  $('#view').innerHTML = `
  <section class="content wide">
    <div class="page-head"><div><h1>To-do</h1><p>Your private lists for quick work. Only you can see them.</p></div>
      ${listsReady ? `<button class="btn primary" id="tl-new">${icon.plus(16)} New list</button>` : ''}</div>
    ${personalBlocked()}
    ${!hasPending && !state.personalError ? `<p class="small muted">To use Pending, run supabase/migrations/010_todo_pending.sql in Supabase.</p>` : ''}
    <div class="tl-board">${lists.map(card).join('')}
      ${listsReady ? `<button class="tl-newcard" id="tl-new2">${icon.plus(20)}<span>Create new list</span></button>`
        : !state.personalError ? `<div class="tl-newcard muted small" style="cursor:default">To add more lists, run supabase/migrations/015_lists_and_repeat.sql in Supabase.</div>` : ''}
    </div>
  </section>`;
  bindTodos(hasPending);
}

function bindTodos(hasPending) {
  const view = $('#view');
  const refresh = () => { drawTodos(); updateCounts(); };
  const newList = async () => {
    const name = await promptDialog({ title: 'Create new list', placeholder: 'e.g. Today, Calls to make, This week', confirm: 'Create list' });
    if (!name?.trim()) return;
    try { const l = await store.addTodoList(name.trim()); state.todoLists.push(l); refresh(); $(`[data-list="${l.id}"] .tl-input`)?.focus(); toast('List created', l.name, 'green', icon.list); } catch (ex) { fail(ex); }
  };
  $('#tl-new')?.addEventListener('click', newList);
  $('#tl-new2')?.addEventListener('click', newList);

  $$('.tl-card', view).forEach((cardEl) => {
    const listId = cardEl.dataset.list;
    const l = listId ? byId(state.todoLists, listId) : DEFAULT_LIST;
    // add
    $('[data-add]', cardEl).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('.tl-input', cardEl); const title = input.value.trim(); if (!title) return;
      const open = state.todos.filter((t) => todoListOf(t) === listId && !t.done && !t.pending);
      const top = open.length ? Math.min(...open.map((t) => t.position)) - 1 : Date.now() / 1000;
      input.value = '';
      try { const t = await store.addTodo(title, top, null, listId || null); state.todos.push(t); refresh(); $(`[data-list="${listId}"] .tl-input`)?.focus(); }
      catch (ex) { input.value = title; fail(ex); }
    });
    // rename
    const nm = $('[data-rename]', cardEl);
    const rename = async () => {
      const v = await promptDialog({ title: 'Rename list', value: l.name, confirm: 'Save' });
      if (!v?.trim() || v.trim() === l.name) return;
      try { Object.assign(l, await store.updateTodoList(l.id, { name: v.trim() })); refresh(); } catch (ex) { fail(ex); }
    };
    nm?.addEventListener('click', rename); nm?.addEventListener('keydown', (e) => { if (e.key === 'Enter') rename(); });
    // list menu
    $('[data-list-menu]', cardEl).addEventListener('click', (e) => {
      const done = state.todos.filter((t) => todoListOf(t) === listId && t.done);
      openMenu(e.currentTarget, [
        ...(listId ? [{ label: 'Rename list', ic: icon.pencil, onClick: rename }] : []),
        { label: `Clear completed (${done.length})`, ic: icon.check, onClick: async () => {
          if (!done.length) return toast('Nothing to clear', '', 'gray', icon.check);
          if (!await confirmDialog({ title: `Clear ${done.length} completed to-do${done.length === 1 ? '' : 's'}?`, confirm: 'Clear' })) return;
          try { for (const t of done) await store.deleteTodo(t.id); state.todos = state.todos.filter((t) => !done.includes(t)); refresh(); } catch (ex) { fail(ex); }
        } },
        ...(listId ? [{ label: 'Delete list', ic: icon.trash, danger: true, onClick: async () => {
          const n = state.todos.filter((t) => t.list_id === listId).length;
          if (!await confirmDialog({ title: `Delete "${l.name}"?`, body: n ? `Its ${n} to-do${n === 1 ? '' : 's'} will be deleted too.` : 'The list is empty.', confirm: 'Delete list' })) return;
          try { await store.deleteTodoList(listId); state.todoLists = state.todoLists.filter((x) => x.id !== listId); state.todos = state.todos.filter((t) => t.list_id !== listId); refresh(); toast('List deleted', l.name, 'gray', icon.trash); } catch (ex) { fail(ex); }
        } }] : []),
      ], { title: l.name });
    });
    $('[data-done]', cardEl)?.addEventListener('toggle', (e) => { e.target.open ? openDone.add(listId) : openDone.delete(listId); });
  });

  const askWhy = (t) => promptDialog({ title: t.pending ? 'Why is this pending?' : 'Move to Pending', body: t.title, placeholder: 'e.g. Waiting for the rate card from Prozo', value: t.pending_note || '', confirm: t.pending ? 'Save' : 'Move to Pending' });
  $$('[data-todo]', view).forEach((li) => {
    const id = li.dataset.todo; const t = byId(state.todos, id);
    $('[data-toggle]', li).addEventListener('click', async () => {
      li.classList.add('ticking');
      try {
        Object.assign(t, await store.updateTodo(id, { done: !t.done, ...(t.done ? {} : hasPending ? { pending: false } : {}) }));
        if (t.done) chime('green');
        const task = t.done && t.task_id ? byId(state.tasks, t.task_id) : null;
        if (task && task.status !== 'completed') {
          if (canChangeStatus(task)) await changeStatus(task.id, 'completed');
          else toast('To-do done', 'The task itself stays open: only the assignee or the person who created it can complete it.', 'orange', icon.lock);
        }
        setTimeout(refresh, t.done ? 420 : 0);
      } catch (ex) { li.classList.remove('ticking'); fail(ex); }
    });
    $('[data-pend]', li)?.addEventListener('click', async () => {
      const why = await askWhy(t); if (why === null) return;
      try { Object.assign(t, await store.updateTodo(id, { pending: true, pending_note: why, pending_at: new Date().toISOString() })); refresh(); toast('Moved to Pending', why || '', 'orange', icon.clock); } catch (ex) { fail(ex); }
    });
    $('[data-unpend]', li)?.addEventListener('click', async () => {
      try { Object.assign(t, await store.updateTodo(id, { pending: false })); refresh(); } catch (ex) { fail(ex); }
    });
    const why = $('[data-why]', li);
    why?.addEventListener('click', async () => { const v = await askWhy(t); if (v === null) return; try { Object.assign(t, await store.updateTodo(id, { pending_note: v })); refresh(); } catch (ex) { fail(ex); } });
    $('[data-open-task]', li)?.addEventListener('click', () => openTask(byId(state.tasks, li.querySelector('[data-open-task]').dataset.openTask)));
    $('[data-del]', li).addEventListener('click', async () => {
      li.classList.add('removing');
      try { await store.deleteTodo(id); state.todos = state.todos.filter((x) => x.id !== id); setTimeout(refresh, 180); } catch (ex) { li.classList.remove('removing'); fail(ex); }
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
      ed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
      ed.addEventListener('blur', () => finish(true));
    };
    title.addEventListener('click', startEdit);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') startEdit(); });
  });

  // Drag to reorder, or drop on another list to move it there.
  let dragging = null;
  view.ondragstart = (e) => {
    dragging = e.target.closest?.('.tl-row[draggable="true"]'); if (!dragging) return;
    dragging.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging.dataset.todo);
  };
  $$('.tl-card', view).forEach((cardEl) => {
    const ul = $('.tl-items[data-items]', cardEl);
    cardEl.addEventListener('dragover', (e) => {
      if (!dragging) return; e.preventDefault(); cardEl.classList.add('drop');
      const after = [...ul.querySelectorAll('[data-todo]:not(.dragging)')].find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
      if (after) ul.insertBefore(dragging, after); else ul.appendChild(dragging);
    });
    cardEl.addEventListener('dragleave', (e) => { if (!cardEl.contains(e.relatedTarget)) cardEl.classList.remove('drop'); });
  });
  view.ondragend = async () => {
    if (!dragging) return;
    const el = dragging; dragging = null; el.classList.remove('dragging');
    $$('.tl-card.drop', view).forEach((c) => c.classList.remove('drop'));
    const cardEl = el.closest('.tl-card'); const listId = cardEl.dataset.list;
    const ids = [...$('.tl-items[data-items]', cardEl).querySelectorAll('[data-todo]')].map((x) => x.dataset.todo);
    const i = ids.indexOf(el.dataset.todo);
    const pos = (k) => byId(state.todos, ids[k])?.position;
    const prev = i > 0 ? pos(i - 1) : null, next = i < ids.length - 1 ? pos(i + 1) : null;
    const t = byId(state.todos, el.dataset.todo);
    const np = prev === null && next === null ? t.position : prev === null ? next - 1 : next === null ? prev + 1 : (prev + next) / 2;
    const patch = {};
    if (np !== t.position) patch.position = np;
    if ((t.list_id || '') !== listId) patch.list_id = listId || null;
    if (!Object.keys(patch).length) return;
    try { Object.assign(t, await store.updateTodo(t.id, patch)); if ('list_id' in patch) { refresh(); toast('Moved', `To ${(listId ? byId(state.todoLists, listId) : DEFAULT_LIST).name}`, 'blue', icon.list); } }
    catch (ex) { fail(ex); refresh(); }
  };
}

// =====================================================================
//  Reports: completed work for a period, ready to send to management
// =====================================================================
const rpt = { period: 'this_week', from: '', to: '', person: 'all', platform: 'all' };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function reportRange() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const monday = (x) => { const y = new Date(x); y.setDate(y.getDate() - ((y.getDay() + 6) % 7)); return y; };
  const add = (x, n) => { const y = new Date(x); y.setDate(y.getDate() + n); return y; };
  switch (rpt.period) {
    case 'today': return [isoDay(d), isoDay(d), 'Today'];
    case 'yesterday': return [isoDay(add(d, -1)), isoDay(add(d, -1)), 'Yesterday'];
    case 'last_week': { const m = add(monday(d), -7); return [isoDay(m), isoDay(add(m, 6)), 'Last week']; }
    case 'this_month': return [isoDay(new Date(d.getFullYear(), d.getMonth(), 1)), isoDay(d), 'This month'];
    case 'last_month': return [isoDay(new Date(d.getFullYear(), d.getMonth() - 1, 1)), isoDay(new Date(d.getFullYear(), d.getMonth(), 0)), 'Last month'];
    case 'custom': return [rpt.from || isoDay(d), rpt.to || isoDay(d), 'Custom'];
    default: return [isoDay(monday(d)), isoDay(d), 'This week'];
  }
}
// Whose work this person may report on: admins everyone; managers themselves and the tasks they assign; members themselves.
const reportTasks = () => state.tasks.filter((t) => isAdmin() || t.assigned_to === state.me.id || (isManager() && t.created_by === state.me.id));

function buildReport() {
  const [from, to, label] = reportRange();
  const inPeople = (t) => rpt.person === 'all' || t.assigned_to === rpt.person;
  const inPlat = (t) => rpt.platform === 'all' || (rpt.platform === 'none' ? !t.platform_id : t.platform_id === rpt.platform);
  const pool = reportTasks().filter((t) => inPeople(t) && inPlat(t));
  const doneIn = pool.filter((t) => t.status === 'completed' && t.completed_at && localDay(t.completed_at) >= from && localDay(t.completed_at) <= to)
    .sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const onTime = (t) => !t.due_date || localDay(t.completed_at) <= t.due_date;
  const open = pool.filter((t) => t.status !== 'completed');
  const today = localToday();
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const people = [...new Set([...doneIn, ...open].map((t) => t.assigned_to))].map((id) => {
    const d = doneIn.filter((t) => t.assigned_to === id), o = open.filter((t) => t.assigned_to === id);
    return { p: person(id), done: d.length, onTime: d.filter(onTime).length, open: o.length, overdue: o.filter((t) => t.due_date && t.due_date < today).length,
      hold: o.filter((t) => t.status === 'on_hold').length };
  }).sort((a, b) => b.done - a.done || a.p.full_name.localeCompare(b.p.full_name));
  const hrs = doneIn.map((t) => (new Date(t.completed_at) - new Date(t.created_at)) / 36e5).filter((h) => h >= 0);
  return { from, to, label, doneIn, open, overdue, people, onTime, onTimeN: doneIn.filter(onTime).length,
    avgHrs: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
    scope: rpt.person === 'all' ? (isAdmin() ? 'Everyone' : isManager() ? 'My team' : state.me.full_name) : person(rpt.person).full_name,
    plat: rpt.platform === 'all' ? '' : rpt.platform === 'none' ? 'No platform' : (platformOf(rpt.platform)?.name || '') };
}
const fmtSpan = (r) => r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
const fmtHrs = (h) => h == null ? '—' : h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`;
const pctOf = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';

function reportText(r) {
  const L = [];
  L.push(`Task completion report · ${r.scope}${r.plat ? ' · ' + r.plat : ''}`);
  L.push(`${r.label}: ${fmtSpan(r)}`);
  L.push('');
  L.push(`Completed: ${r.doneIn.length} (on time ${pctOf(r.onTimeN, r.doneIn.length)})`);
  L.push(`Still open: ${r.open.length}${r.overdue.length ? ` · overdue: ${r.overdue.length}` : ''}`);
  if (r.people.length > 1) { L.push(''); L.push('By person:'); r.people.forEach((x) => L.push(`• ${x.p.full_name}: ${x.done} completed, ${x.open} open${x.overdue ? `, ${x.overdue} overdue` : ''}`)); }
  if (r.doneIn.length) { L.push(''); L.push('Completed tasks:'); r.doneIn.forEach((t) => L.push(`✓ ${t.title} (${person(t.assigned_to).full_name}${platformOf(t.platform_id) ? ', ' + platformOf(t.platform_id).name : ''}) · ${fmtDate(localDay(t.completed_at))}${r.onTime(t) ? '' : ' · late'}`)); }
  if (r.overdue.length) { L.push(''); L.push('Overdue:'); r.overdue.forEach((t) => L.push(`! ${t.title} (${person(t.assigned_to).full_name}) · due ${fmtDate(t.due_date)}`)); }
  L.push(''); L.push(`Prepared by ${state.me.full_name} with ${CONFIG.APP_NAME} on ${fmtDateTime(new Date().toISOString())}`);
  return L.join('\n');
}
function reportCsv(r) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Task', 'Assigned to', 'Assigned by', 'Platform', 'Priority', 'Status', 'Due date', 'Completed on', 'On time']];
  [...r.doneIn, ...r.open].forEach((t) => rows.push([t.title, person(t.assigned_to).full_name, person(t.created_by).full_name, platformOf(t.platform_id)?.name || '',
    prioOf(t.priority).label, statusOf(t.status).label, t.due_date || '', t.completed_at ? localDay(t.completed_at) : '', t.completed_at ? (r.onTime(t) ? 'Yes' : 'No') : '']));
  return rows.map((x) => x.map(q).join(',')).join('\r\n');
}

function renderReports() {
  const r = buildReport();
  const ppl = [...new Set(reportTasks().map((t) => t.assigned_to))].map(person).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const plats = [...new Set(reportTasks().map((t) => t.platform_id).filter(Boolean))].map(platformOf).filter(Boolean);
  const P = { today: 'Today', yesterday: 'Yesterday', this_week: 'This week', last_week: 'Last week', this_month: 'This month', last_month: 'Last month', custom: 'Custom dates' };
  const tile = (k, v, sub = '', tone = '') => `<div class="r-tile ${tone}"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  $('#view').innerHTML = `
  <section class="content">
    <div class="page-head no-print"><div><h1>Reports</h1><p>A summary of completed work, ready to send to management.</p></div>
      <div class="r-actions">
        <button class="btn" id="r-copy">${icon.copy(15)} Copy</button>
        <button class="btn" id="r-mail">${icon.mail(15)} Email</button>
        <button class="btn" id="r-csv">${icon.download(15)} Excel (CSV)</button>
        <button class="btn primary" id="r-print">${icon.print(15)} PDF / Print</button>
      </div></div>
    <div class="toolbar r-filters no-print">
      <div class="segmented" id="r-period">${['today', 'this_week', 'last_week', 'this_month', 'last_month', 'custom'].map((k) => `<button class="${rpt.period === k ? 'active' : ''}" data-p="${k}">${P[k]}</button>`).join('')}</div>
      ${rpt.period === 'custom' ? `<input class="input r-date" type="date" id="r-from" value="${esc(r.from)}" aria-label="From"><span class="muted">to</span><input class="input r-date" type="date" id="r-to" value="${esc(r.to)}" aria-label="To">` : ''}
      ${ppl.length > 1 ? `<select class="select" id="r-person" aria-label="Person"><option value="all">${isAdmin() ? 'Everyone' : 'Everyone on my tasks'}</option>${ppl.map((p) => `<option value="${esc(p.id)}" ${rpt.person === p.id ? 'selected' : ''}>${esc(p.id === state.me.id ? p.full_name + ' (me)' : p.full_name)}</option>`).join('')}</select>` : ''}
      ${plats.length ? `<select class="select" id="r-plat" aria-label="Platform"><option value="all">All platforms</option>${plats.map((p) => `<option value="${esc(p.id)}" ${rpt.platform === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="none" ${rpt.platform === 'none' ? 'selected' : ''}>No platform</option></select>` : ''}
    </div>
    <article class="card report" id="report">
      <header class="r-head">
        <div><h2>Task completion report</h2><p>${esc(r.scope)}${r.plat ? ' · ' + esc(r.plat) : ''} · ${esc(r.label)}: <b>${esc(fmtSpan(r))}</b></p></div>
        <div class="r-by">Prepared by ${esc(state.me.full_name)}<br>${esc(fmtDateTime(new Date().toISOString()))}</div>
      </header>
      <div class="r-tiles">
        ${tile('Completed', r.doneIn.length, r.doneIn.length ? `${r.onTimeN} on time` : '', 'green')}
        ${tile('On-time rate', pctOf(r.onTimeN, r.doneIn.length), r.doneIn.length - r.onTimeN ? `${r.doneIn.length - r.onTimeN} late` : '')}
        ${tile('Avg. time to finish', fmtHrs(r.avgHrs))}
        ${tile('Still open', r.open.length, r.open.filter((t) => t.status === 'on_hold').length ? `${r.open.filter((t) => t.status === 'on_hold').length} on hold` : '')}
        ${tile('Overdue', r.overdue.length, '', r.overdue.length ? 'red' : '')}
      </div>
      ${r.people.length ? `<h3>By person</h3><div class="r-scroll"><table class="r-table">
        <thead><tr><th>Person</th><th>Completed</th><th>On time</th><th>Open</th><th>Overdue</th></tr></thead>
        <tbody>${r.people.map((x) => `<tr><td><span class="r-who">${avatar(x.p, 'sm')}${esc(x.p.full_name)}</span></td><td><b>${x.done}</b></td><td>${pctOf(x.onTime, x.done)}</td><td>${x.open}${x.hold ? ` <span class="muted small">(${x.hold} on hold)</span>` : ''}</td><td class="${x.overdue ? 'r-bad' : ''}">${x.overdue}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3>Completed tasks (${r.doneIn.length})</h3>
      ${r.doneIn.length ? `<div class="r-scroll"><table class="r-table">
        <thead><tr><th>Task</th><th>Person</th><th>Platform</th><th>Due</th><th>Completed</th><th></th></tr></thead>
        <tbody>${r.doneIn.map((t) => `<tr><td class="r-title">${esc(t.title)}</td><td>${esc(person(t.assigned_to).full_name)}</td><td>${esc(platformOf(t.platform_id)?.name || '—')}</td>
          <td>${t.due_date ? esc(fmtDate(t.due_date)) : '—'}</td><td>${esc(fmtDate(localDay(t.completed_at)))}</td>
          <td>${r.onTime(t) ? '<span class="pill tone-green">On time</span>' : '<span class="pill tone-orange">Late</span>'}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="muted">No tasks were completed in this period.</p>`}
      ${r.overdue.length ? `<h3>Overdue (${r.overdue.length})</h3><div class="r-scroll"><table class="r-table">
        <thead><tr><th>Task</th><th>Person</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>${r.overdue.map((t) => `<tr><td class="r-title">${esc(t.title)}</td><td>${esc(person(t.assigned_to).full_name)}</td><td class="r-bad">${esc(fmtDate(t.due_date))}</td><td>${esc(statusOf(t.status).label)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </article>
  </section>`;

  $$('[data-p]').forEach((b) => b.addEventListener('click', () => { rpt.period = b.dataset.p; renderReports(); }));
  $('#r-from')?.addEventListener('change', (e) => { rpt.from = e.target.value; renderReports(); });
  $('#r-to')?.addEventListener('change', (e) => { rpt.to = e.target.value; renderReports(); });
  $('#r-person')?.addEventListener('change', (e) => { rpt.person = e.target.value; renderReports(); });
  $('#r-plat')?.addEventListener('change', (e) => { rpt.platform = e.target.value; renderReports(); });
  $('#r-copy').addEventListener('click', async () => {
    const text = reportText(r);
    try { await navigator.clipboard.writeText(text); toast('Report copied', 'Paste it into email, WhatsApp or Teams.', 'green', icon.copy); } catch { prompt('Copy this report', text); }
  });
  $('#r-mail').addEventListener('click', () => {
    const subject = `Task completion report · ${r.scope} · ${fmtSpan(r)}`;
    let body = reportText(r); if (body.length > 1800) body = body.slice(0, 1800) + '\n… (full report: use Copy or PDF)';
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
  $('#r-csv').addEventListener('click', () => {
    const blob = new Blob(['﻿' + reportCsv(r)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `task-report-${r.from}-to-${r.to}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $('#r-print').addEventListener('click', () => window.print());
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
//  Export a task list to Excel (.xlsx) or PDF. Runs in the browser; the
//  libraries are bundled in js/vendor and loaded only when needed.
// =====================================================================
const loaded = {};
const loadScript = (src) => (loaded[src] ||= new Promise((ok, no) => {
  const el = document.createElement('script'); el.src = src; el.onload = ok;
  el.onerror = () => { delete loaded[src]; no(new Error('Could not load the export tool. Check your connection and try again.')); };
  document.head.appendChild(el);
}));
function openExportMenu(anchor, ex) {
  if (!ex?.tasks.length) { toast('Nothing to export', 'There are no tasks in this list.', 'gray', icon.info); return; }
  const n = ex.tasks.length;
  openMenu(anchor, [
    { label: 'Excel (.xlsx)', hint: `${n} task${n === 1 ? '' : 's'}, one row each, with filters`, ic: icon.grid, onClick: () => runExport('xlsx', ex) },
    { label: 'PDF report', hint: 'Summary and a table, ready to share', ic: icon.report, onClick: () => runExport('pdf', ex) },
  ], { title: `Export ${ex.title}` });
}
async function runExport(kind, ex) {
  try {
    if (kind === 'xlsx') { await loadScript('js/vendor/xlsx.mini.min.js'); exportXlsx(ex); }
    else { await loadScript('js/vendor/jspdf.umd.min.js'); await loadScript('js/vendor/jspdf.plugin.autotable.min.js'); exportPdf(ex); }
  } catch (e) { fail(e); }
}
// A plain download link works on desktop browsers and on iPhone/Android.
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const exportName = (ex, ext) => `${CONFIG.APP_NAME}-${ex.title}-${localToday()}`.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase() + '.' + ext;
const latestRemark = (t) => remarksFor(t.id).slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
const isLate = (t) => t.status !== 'completed' && dueInfo(t)?.state === 'overdue';
function exportSummary(tasks) {
  return { total: tasks.length, done: tasks.filter((t) => t.status === 'completed').length, prog: tasks.filter((t) => t.status === 'in_progress').length,
    hold: tasks.filter((t) => t.status === 'on_hold').length, over: tasks.filter(isLate).length };
}
function exportRange(tasks) {
  const d = tasks.map((t) => t.due_date).filter(Boolean).sort();
  return d.length ? (d[0] === d[d.length - 1] ? fmtDate(d[0]) : `${fmtDate(d[0])} - ${fmtDate(d[d.length - 1])}`) : 'No due dates';
}
function exportScope() {
  const me = state.me;
  return [me.department_id ? deptName(me.department_id) : '', me.team_id ? teamName(me.team_id) : ''].filter(Boolean).join(' / ') || 'All teams';
}

function exportXlsx(ex) {
  const X = window.XLSX;
  const day = (iso) => iso ? (iso.length === 10 ? new Date(iso + 'T00:00:00') : istWall(iso)) : '';
  const head = ['Task', 'Platform', 'Priority', 'Status', 'Assigned by', 'Assigned to', 'Created', 'Due', 'Completed', 'Latest remark'];
  const rows = ex.tasks.map((t) => {
    const r = latestRemark(t);
    return [t.title, platformOf(t.platform_id)?.name || '', prioOf(t.priority).label, isLate(t) ? `${statusOf(t.status).label} (overdue)` : statusOf(t.status).label,
      person(t.created_by).full_name, person(t.assigned_to).full_name, day(t.created_at), day(t.due_date), t.completed_at ? day(t.completed_at) : '',
      r ? `${person(r.author_id).full_name}: ${r.body || ''}`.slice(0, 2000) : ''];
  });
  const ws = X.utils.aoa_to_sheet([head, ...rows], { cellDates: true, dateNF: 'dd-mmm-yyyy' });
  // date columns: show as dates, and completed with the time
  for (let i = 0; i < rows.length; i++) ['G', 'H', 'I'].forEach((c) => { const cell = ws[c + (i + 2)]; if (cell && cell.t === 'd') cell.z = c === 'I' ? 'dd-mmm-yyyy h:mm AM/PM' : 'dd-mmm-yyyy'; });
  ws['!cols'] = [48, 16, 10, 22, 20, 20, 13, 13, 18, 60].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: `A1:J${rows.length + 1}` };
  const sm = exportSummary(ex.tasks);
  const info = X.utils.aoa_to_sheet([
    [`${CONFIG.APP_NAME} · Task report`], [],
    ['List', ex.title], ['Due dates', exportRange(ex.tasks)], ['Team', exportScope()], ['Exported by', state.me.full_name], ['Exported on', fmtDateTime(new Date().toISOString()) + ' IST'], ['Filters', ex.filters.join(', ')], [],
    ['Total tasks', sm.total], ['Completed', sm.done], ['In progress', sm.prog], ['On hold', sm.hold], ['Overdue', sm.over],
  ], { cellDates: true });
  info['!cols'] = [{ wch: 16 }, { wch: 50 }];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Tasks');
  X.utils.book_append_sheet(wb, info, 'Summary');
  wb.Props = { Title: `${ex.title} - task report`, Author: state.me.full_name, CreatedDate: new Date() };
  saveBlob(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array', compression: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(ex, 'xlsx'));
  toast('Excel file ready', `${rows.length} task${rows.length === 1 ? '' : 's'} exported.`, 'green', icon.download);
}

function exportPdf(ex) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  // The built-in PDF fonts only cover Western characters; swap the few others we use.
  const txt = (v) => String(v ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '?');
  const W = doc.internal.pageSize.getWidth(), M = 40;
  const ink = [32, 34, 36], muted = [110, 113, 118], line = [225, 227, 229];
  const TONE = { not_started: [[241, 242, 243], [74, 74, 74]], in_progress: [[224, 240, 255], [0, 82, 163]], on_hold: [[255, 241, 204], [122, 79, 1]],
    completed: [[205, 254, 225], [12, 82, 48]], overdue: [[254, 226, 222], [142, 31, 11]] };
  const sm = exportSummary(ex.tasks);
  // header
  doc.setFillColor(26, 26, 26); doc.rect(0, 0, W, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...ink);
  doc.text(txt(`${CONFIG.APP_NAME} · Task report`), M, 46);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...muted);
  doc.text(txt(`${ex.title}  ·  Due ${exportRange(ex.tasks)}  ·  ${exportScope()}`), M, 64);
  doc.text(txt(`Exported by ${state.me.full_name} on ${fmtDateTime(new Date().toISOString())} IST`), M, 78);
  // summary boxes
  const boxes = [['Total', sm.total, ink], ['Completed', sm.done, [12, 82, 48]], ['In progress', sm.prog, [0, 82, 163]], ['Overdue', sm.over, [142, 31, 11]]];
  const gap = 10, bw = (W - 2 * M - gap * 3) / 4, by = 94;
  boxes.forEach(([k, v, c], i) => {
    const x = M + i * (bw + gap);
    doc.setDrawColor(...line); doc.setFillColor(250, 250, 251); doc.roundedRect(x, by, bw, 52, 6, 6, 'FD');
    doc.setFontSize(9); doc.setTextColor(...muted); doc.text(k.toUpperCase(), x + 12, by + 18);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...c); doc.text(String(v), x + 12, by + 41);
    doc.setFont('helvetica', 'normal');
  });
  const pct = sm.total ? Math.round((sm.done / sm.total) * 100) : 0;
  doc.setDrawColor(...line); doc.setFillColor(236, 237, 238); doc.roundedRect(M, by + 62, W - 2 * M, 5, 2.5, 2.5, 'F');
  if (pct) { doc.setFillColor(4, 123, 93); doc.roundedRect(M, by + 62, (W - 2 * M) * pct / 100, 5, 2.5, 2.5, 'F'); }
  doc.setFontSize(9); doc.setTextColor(...muted); doc.text(`${pct}% completed`, W - M, by + 80, { align: 'right' });
  // table
  const body = ex.tasks.map((t, i) => {
    const late = isLate(t); const pl = platformOf(t.platform_id)?.name;
    const due = t.due_date ? fmtDate(t.due_date) + (t.due_time ? ' ' + fmtTime(t.due_time) : '') : '-';
    return { i: i + 1, task: txt(t.title) + (pl || t.priority === 'high' || t.priority === 'urgent' ? `\n${txt([pl, prioOf(t.priority).label + ' priority'].filter(Boolean).join('  ·  '))}` : ''),
      who: txt(person(t.assigned_to).full_name), due: txt(due), status: txt(late ? `${statusOf(t.status).label} - overdue` : statusOf(t.status).label), key: late ? 'overdue' : t.status };
  });
  doc.autoTable({
    startY: by + 92, margin: { left: M, right: M, bottom: 50 },
    head: [['#', 'Task', 'Assigned to', 'Due', 'Status']],
    body: body.map((r) => [r.i, r.task, r.who, r.due, r.status]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, textColor: ink, cellPadding: { top: 7, bottom: 7, left: 6, right: 6 }, lineColor: line, lineWidth: { bottom: 0.6 }, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [243, 243, 244], textColor: muted, fontStyle: 'bold', fontSize: 8.5, lineWidth: { bottom: 0.8 } },
    columnStyles: { 0: { cellWidth: 24, textColor: muted, halign: 'right' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 100 }, 3: { cellWidth: 78 }, 4: { cellWidth: 104 } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      if (d.column.index === 4) { const [bg, fg] = TONE[body[d.row.index].key] || TONE.not_started; d.cell.styles.fillColor = bg; d.cell.styles.textColor = fg; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 8.5; }
      if (d.column.index === 3 && body[d.row.index].key === 'overdue') { d.cell.styles.textColor = [142, 31, 11]; d.cell.styles.fontStyle = 'bold'; }
    },
  });
  // footer on every page
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...line); doc.line(M, H - 34, W - M, H - 34);
    doc.setFontSize(8.5); doc.setTextColor(...muted);
    doc.text(txt(`Filters: ${ex.filters.join(', ') || 'none'}`), M, H - 20, { maxWidth: W - 2 * M - 90 });
    doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: 'right' });
  }
  doc.setProperties({ title: `${ex.title} - task report`, author: state.me.full_name, creator: CONFIG.APP_NAME });
  saveBlob(doc.output('blob'), exportName(ex, 'pdf'));
  toast('PDF ready', `${body.length} task${body.length === 1 ? '' : 's'} in the report.`, 'green', icon.download);
}

// =====================================================================
//  Calendar
// =====================================================================
const cal = { month: null, week: null, scope: 'all' };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = (iso) => new Date(iso + 'T00:00:00');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
function calTasks() {
  const mine = (t) => t.assigned_to === state.me.id, gave = (t) => t.created_by === state.me.id && !mine(t);
  return state.tasks.filter((t) => t.due_date && (cal.scope === 'mine' ? mine(t) : cal.scope === 'assigned' ? gave(t) : (isAdmin() || mine(t) || gave(t))));
}
function calState(t) {
  if (t.status === 'completed') return 'done';
  const d = dueInfo(t)?.state;
  return d === 'overdue' ? 'overdue' : d === 'today' ? 'today' : 'upcoming';
}
const CAL_LABEL = { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', done: 'Completed' };
function calChip(t, { full = false } = {}) {
  const st = calState(t), a = person(t.assigned_to);
  const drag = canEditTask(t) && t.status !== 'completed';
  const tip = `${t.title} · ${CAL_LABEL[st]}${t.due_time ? ' · ' + fmtTime(t.due_time) : ''} · ${a.id === state.me.id ? 'You' : a.full_name}`;
  return `<button type="button" class="cal-chip cal-${st}" data-cal-task="${esc(t.id)}" ${drag ? 'draggable="true"' : ''} title="${esc(tip)}">
    ${st === 'done' ? icon.check(12) : `<i class="cal-dot"></i>`}${t.due_time ? `<span class="cal-time">${esc(fmtTime(t.due_time))}</span>` : ''}<span class="cal-t">${esc(t.title)}</span>
    ${full ? `<span class="cal-who">${avatar(a, 'xs')}${esc(a.id === state.me.id ? 'You' : a.full_name.split(' ')[0])}</span>` : ''}${t.repeat ? `<span class="cal-rep">${icon.repeat(11)}</span>` : ''}</button>`;
}
const byDueTime = (a, b) => (a.status === 'completed') - (b.status === 'completed') || (a.due_time || '99').localeCompare(b.due_time || '99') || a.title.localeCompare(b.title);

function renderCalendar() {
  const phone = matchMedia('(max-width: 640px)').matches;
  const today = new Date(), todayIso = localToday();
  cal.month ||= new Date(today.getFullYear(), today.getMonth(), 1);
  cal.week ||= mondayOf(today);
  if (cal.scope === 'assigned' && !isManager()) cal.scope = 'all';
  const tasks = calTasks();
  const byDay = {}; tasks.forEach((t) => (byDay[t.due_date] ||= []).push(t));
  Object.values(byDay).forEach((l) => l.sort(byDueTime));
  const scopes = [['all', isAdmin() ? 'Everyone' : 'All my tasks'], ['mine', 'Assigned to me'], ...(isManager() ? [['assigned', 'Assigned by me']] : [])];
  const head = phone
    ? `${cal.week.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${addDays(cal.week, 6).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : cal.month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  // range shown, for the counters
  let from, to;
  if (phone) { from = cal.week; to = addDays(cal.week, 6); }
  else { from = mondayOf(cal.month); const last = new Date(cal.month.getFullYear(), cal.month.getMonth() + 1, 0); to = addDays(mondayOf(last), 6); }
  const inRange = tasks.filter((t) => t.due_date >= isoOf(from) && t.due_date <= isoOf(to));
  const count = (k) => inRange.filter((t) => calState(t) === k).length;
  const overdueAll = tasks.filter((t) => calState(t) === 'overdue').length;

  let body;
  if (!phone) {
    const days = []; for (let d = new Date(from); d <= to; d = addDays(d, 1)) days.push(new Date(d));
    const MAX = 3;
    body = `<div class="cal-grid" role="grid" aria-label="${esc(head)}">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="cal-wd" role="columnheader">${w}</div>`).join('')}
      ${days.map((d) => {
        const iso = isoOf(d), list = byDay[iso] || [], out = d.getMonth() !== cal.month.getMonth();
        return `<div class="cal-day ${out ? 'out' : ''} ${iso === todayIso ? 'today' : ''} ${iso < todayIso ? 'past' : ''} ${d.getDay() % 6 === 0 ? 'wkend' : ''}" data-day="${iso}" role="gridcell">
          <div class="cal-num"><span>${d.getDate() === 1 ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : d.getDate()}</span>
            <button type="button" class="cal-add" data-cal-add="${iso}" aria-label="New task on ${esc(fmtDate(iso))}" title="New task on this day">${icon.plus(14)}</button></div>
          <div class="cal-list">${list.slice(0, MAX).map((t) => calChip(t)).join('')}
            ${list.length > MAX ? `<button type="button" class="cal-more" data-cal-more="${iso}">+${list.length - MAX} more</button>` : ''}</div>
        </div>`;
      }).join('')}</div>`;
  } else {
    const days = []; for (let i = 0; i < 7; i++) days.push(addDays(cal.week, i));
    body = `<div class="cal-agenda">${days.map((d) => {
      const iso = isoOf(d), list = byDay[iso] || [];
      return `<section class="ag-day ${iso === todayIso ? 'today' : ''} ${iso < todayIso ? 'past' : ''}" data-day="${iso}">
        <header><b>${d.toLocaleDateString('en-IN', { weekday: 'short' })}</b><span class="ag-num">${d.getDate()}</span>
          <span class="muted small">${iso === todayIso ? 'Today' : d.toLocaleDateString('en-IN', { month: 'short' })}</span>
          <button type="button" class="cal-add" data-cal-add="${iso}" aria-label="New task on ${esc(fmtDate(iso))}">${icon.plus(16)}</button></header>
        ${list.length ? `<div class="ag-list">${list.map((t) => calChip(t, { full: true })).join('')}</div>` : `<p class="ag-empty">Nothing due</p>`}
      </section>`;
    }).join('')}</div>`;
  }

  $('#view').innerHTML = `
  <section class="content cal-page">
    <div class="page-head"><div><div class="title-row"><h1>Calendar</h1><button class="btn primary new-task-inline" data-new-task>${icon.plus(16)}<span>New Task</span></button></div><p>${phone ? 'Your week at a glance. Tap a task to open it.' : 'Tasks on their due dates. Drag a task to another day to move its due date.'}</p></div></div>
    <div class="cal-bar">
      <div class="cal-nav">
        <button class="icon-btn" id="cal-prev" aria-label="${phone ? 'Previous week' : 'Previous month'}">${icon.chev(18)}</button>
        <button class="btn" id="cal-today">Today</button>
        <button class="icon-btn" id="cal-next" aria-label="${phone ? 'Next week' : 'Next month'}">${icon.chev(18)}</button>
        <h2 class="cal-title">${esc(head)}</h2>
      </div>
      <div class="segmented" id="cal-scope">${scopes.map(([k, l]) => `<button class="${cal.scope === k ? 'active' : ''}" data-scope="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="cal-legend">
      ${['overdue', 'today', 'upcoming', 'done'].map((k) => `<span class="cal-key cal-${k}"><i class="cal-dot"></i>${CAL_LABEL[k]} <b>${count(k)}</b></span>`).join('')}
      ${overdueAll > count('overdue') ? `<button class="btn sm cal-jump" id="cal-overdue">${overdueAll} overdue in total</button>` : ''}
    </div>
    ${body}
  </section>`;
  bindCalendar(phone, byDay);
}

function bindCalendar(phone, byDay) {
  const v = $('#view');
  const move = (n) => { if (phone) cal.week = addDays(cal.week, 7 * n); else cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() + n, 1); renderCalendar(); };
  $('[data-new-task]')?.addEventListener('click', () => openTaskEditor());
  $('#cal-prev').addEventListener('click', () => move(-1));
  $('#cal-next').addEventListener('click', () => move(1));
  $('#cal-today').addEventListener('click', () => { const t = new Date(); cal.month = new Date(t.getFullYear(), t.getMonth(), 1); cal.week = mondayOf(t); renderCalendar(); });
  $$('#cal-scope button').forEach((b) => b.addEventListener('click', () => { cal.scope = b.dataset.scope; renderCalendar(); }));
  $('#cal-overdue')?.addEventListener('click', () => {
    const first = calTasks().filter((t) => calState(t) === 'overdue').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    if (!first) return; const d = dayOf(first.due_date); cal.month = new Date(d.getFullYear(), d.getMonth(), 1); cal.week = mondayOf(d); renderCalendar();
  });
  v.onclick = (e) => {
    const chip = e.target.closest('[data-cal-task]');
    if (chip && v.contains(chip)) { openTask(byId(state.tasks, chip.dataset.calTask)); return; }
    const more = e.target.closest('[data-cal-more]');
    if (more) {
      const iso = more.dataset.calMore;
      openMenu(more, (byDay[iso] || []).map((t) => ({ label: t.title, hint: `${CAL_LABEL[calState(t)]}${t.due_time ? ' · ' + fmtTime(t.due_time) : ''} · ${person(t.assigned_to).full_name}`,
        ic: calState(t) === 'done' ? icon.check : icon.circle, tone: { overdue: 'red', today: 'orange', upcoming: 'blue', done: 'green' }[calState(t)], onClick: () => openTask(byId(state.tasks, t.id)) })),
        { title: dayOf(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) });
      return;
    }
    const add = e.target.closest('[data-cal-add]');
    if (add) openTaskEditor(null, { due_date: add.dataset.calAdd });
  };
  if (phone) return;
  // drag a task to another day
  let dragId = null;
  v.ondragstart = (e) => {
    const c = e.target.closest?.('[data-cal-task]'); if (!c) return;
    dragId = c.dataset.calTask; c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch {}
    v.querySelector('.cal-grid')?.classList.add('is-dragging');
  };
  v.ondragend = () => { dragId = null; $$('.cal-chip.dragging, .cal-day.drop', v).forEach((x) => x.classList.remove('dragging', 'drop')); v.querySelector('.cal-grid')?.classList.remove('is-dragging'); };
  $$('.cal-day', v).forEach((cell) => {
    cell.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drop'); });
    cell.addEventListener('dragleave', (e) => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('drop'); });
    cell.addEventListener('drop', async (e) => {
      e.preventDefault(); cell.classList.remove('drop');
      const id = dragId || e.dataTransfer.getData('text/plain'); dragId = null;
      await moveTaskTo(id, cell.dataset.day);
    });
  });
}

async function moveTaskTo(id, iso) {
  const t = byId(state.tasks, id);
  if (!t || t.due_date === iso) return;
  if (!canEditTask(t)) { toast('Only the person who created this task can change its date', '', 'gray', icon.lock); return; }
  const prev = t.due_date;
  t.due_date = iso; renderCalendar();
  try {
    Object.assign(t, await store.updateTask(id, { due_date: iso }));
    try { await syncReminders(t, state.me.id, reminderSelection(t.id, state.me.id)); } catch {}
    const undo = async () => { try { t.due_date = prev; Object.assign(t, await store.updateTask(id, { due_date: prev })); await syncReminders(t, state.me.id, reminderSelection(t.id, state.me.id)).catch(() => {}); } catch (e) { fail(e); } if (location.hash === '#/calendar') renderCalendar(); };
    toast('Due date moved', `"${t.title}" is now due ${fmtDate(iso)}.`, 'blue', icon.cal, { action: 'Undo', onAction: undo });
  } catch (e) { t.due_date = prev; fail(e); renderCalendar(); }
}

// =====================================================================
//  Reminders
// =====================================================================
const REMIND_OFFSETS = [[0, 'At due time'], [5, '5 min before'], [15, '15 min before'], [60, '1 hour before'], [1440, '1 day before']];
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
function mountReminders(box, { task, getDue, live = false, assigneeId = null, needDue = null }) {
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
          return `<button type="button" class="rem-chip ${sel.offsets.has(m) ? 'on' : ''} ${past && !sel.offsets.has(m) ? 'past' : ''}" data-off="${m}" title="${at ? esc((past ? 'Already passed: ' : '') + fmtDateTime(at.toISOString())) : 'Counts back from the due time'}">${esc(l)}</button>`;
        }).join('')}
        ${sel.customs.map((iso, i) => `<span class="rem-chip on custom">${icon.bell(12)} ${esc(fmtDateTime(iso))}<button type="button" data-rm-custom="${i}" aria-label="Remove">${icon.x(12)}</button></span>`).join('')}
        ${adding ? `<span class="rem-add"><input type="datetime-local" class="input" id="rem-dt"><button type="button" class="btn sm primary" id="rem-dt-ok">Add</button></span>`
          : `<button type="button" class="rem-chip ghost" id="rem-custom">${icon.plus(12)} Pick date & time</button>`}
      </div>
      ${!due ? '<span class="small muted">Pick a reminder and then set the time it counts back from.</span>' : !time ? '<span class="small muted">No time set, so reminders count back from 9:00 AM on the due date.</span>' : ''}
      ${aId && aId !== state.me.id ? `<label class="check-row"><input type="checkbox" id="rem-assignee" ${alsoAssignee ? 'checked' : ''}> Also remind ${esc(person(aId).full_name)}</label>` : ''}
    </div>`;
    $$('[data-off]', box).forEach((b) => b.addEventListener('click', async () => {
      const m = Number(b.dataset.off);
      // No due time yet: ask for one (the form fills in today and focuses Time).
      if (!dueMoment(getDue().date, getDue().time)) {
        if (needDue) { needDue(); } else return toast('This task has no due date', 'Ask the person who assigned it, or pick a custom date and time.', 'orange', icon.bell);
      }
      const d2 = getDue(); const due2 = dueMoment(d2.date, d2.time);
      if (due2 && !sel.offsets.has(m) && new Date(due2 - m * 60e3) < Date.now()) return toast('That time has already passed', `Pick a shorter reminder, or move the due time later.`, 'orange', icon.bell);
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

// Friendly time picker: quick picks plus hour / minute / AM-PM buttons.
// Writes "HH:MM" (24h) into the hidden input and fires "change".
function mountTimePicker(box, input) {
  let open = false;
  const parse = () => { const m = /^(\d\d):(\d\d)$/.exec(input.value || ''); return m ? { h: +m[1], m: +m[2] } : null; };
  const set = (h, m) => { input.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; input.dispatchEvent(new Event('change')); };
  const QUICK = [[9, 0], [10, 0], [12, 0], [14, 0], [16, 0], [18, 0]];
  let anim = false;
  const draw = () => {
    const v = parse();
    const h12 = v ? (v.h % 12 || 12) : null, pm = v ? v.h >= 12 : (new Date().getHours() >= 12), min = v ? v.m : null;
    box.innerHTML = `<div class="tp">
      <button type="button" class="tp-btn ${v ? 'set' : ''}" aria-expanded="${open}" aria-haspopup="dialog">${icon.clock(16)}<span>${v ? esc(fmtTime(input.value)) : 'Add a time'}</span>${v ? `<span class="tp-x" data-tp-clear role="button" aria-label="Clear time" title="Clear time">${icon.x(13)}</span>` : ''}</button>
      ${open ? `<div class="tp-pop ${anim ? 'anim' : ''}" role="dialog" aria-label="Pick a time" tabindex="-1">
        <div class="tp-sec">Quick pick</div>
        <div class="tp-quick">
          <button type="button" data-in="30">In 30 min</button><button type="button" data-in="60">In 1 hour</button>
          ${QUICK.map(([h, m]) => `<button type="button" data-q="${h}:${m}" class="${v && v.h === h && v.m === m ? 'on' : ''}">${esc(fmtTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`))}</button>`).join('')}
        </div>
        <div class="tp-cols">
          <div><div class="tp-sec">Hour</div><div class="tp-grid">${[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => `<button type="button" data-h="${h}" class="${h === h12 ? 'on' : ''}">${h}</button>`).join('')}</div></div>
          <div><div class="tp-sec">Minute</div><div class="tp-grid">${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => `<button type="button" data-m="${m}" class="${m === min ? 'on' : ''}">:${String(m).padStart(2, '0')}</button>`).join('')}</div></div>
          <div><div class="tp-sec">&nbsp;</div><div class="tp-ampm"><button type="button" data-ap="am" class="${v && !pm ? 'on' : ''}">AM</button><button type="button" data-ap="pm" class="${v && pm ? 'on' : ''}">PM</button></div></div>
        </div>
        <div class="tp-foot"><span class="small muted">${v ? 'Due at ' + esc(fmtTime(input.value)) : 'Pick an hour to start'}</span><button type="button" class="btn primary sm" data-tp-done>Done</button></div>
      </div>` : ''}
    </div>`;
    const cur = () => parse() || { h: pm ? 12 : 9, m: 0 };
    $('.tp-btn', box).addEventListener('click', (e) => {
      if (e.target.closest('[data-tp-clear]')) { input.value = ''; input.dispatchEvent(new Event('change')); open = false; draw(); return; }
      open = !open; anim = open; draw(); anim = false;
    });
    $$('[data-in]', box).forEach((b) => b.addEventListener('click', () => {
      const d = new Date(Date.now() + Number(b.dataset.in) * 60e3);
      let m = Math.ceil(d.getMinutes() / 5) * 5, h = d.getHours(); if (m === 60) { m = 0; h = (h + 1) % 24; }
      set(h, m); open = false; draw();
    }));
    $$('[data-q]', box).forEach((b) => b.addEventListener('click', () => { const [h, m] = b.dataset.q.split(':').map(Number); set(h, m); open = false; draw(); }));
    $$('[data-h]', box).forEach((b) => b.addEventListener('click', () => {
      const c = cur(); const isPm = parse() ? c.h >= 12 : pm; const h = Number(b.dataset.h) % 12 + (isPm ? 12 : 0);
      set(h, c.m); draw();
    }));
    $$('[data-m]', box).forEach((b) => b.addEventListener('click', () => { const c = cur(); set(c.h, Number(b.dataset.m)); draw(); }));
    $$('[data-ap]', box).forEach((b) => b.addEventListener('click', () => { const c = cur(); const h = c.h % 12 + (b.dataset.ap === 'pm' ? 12 : 0); set(h, c.m); draw(); }));
    $('[data-tp-done]', box)?.addEventListener('click', () => { open = false; draw(); $('.tp-btn', box).focus(); });
    if (open && !box.contains(document.activeElement)) $('.tp-pop', box).focus({ preventScroll: true });
  };
  input.addEventListener('change', () => { if (!box.contains(document.activeElement) || !open) draw(); });
  document.addEventListener('mousedown', (e) => { if (open && box.isConnected && !box.contains(e.target)) { open = false; draw(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && box.isConnected) { e.stopImmediatePropagation(); e.preventDefault(); open = false; draw(); $('.tp-btn', box).focus(); } }, true);
  draw();
}

let reminderTimer = null;
function startReminderLoop() {
  clearInterval(reminderTimer);
  const tick = () => { if (state.me) store.fireMyReminders().catch(() => {}); };
  tick();
  reminderTimer = setInterval(tick, 30e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) store.fireMyReminders().catch(() => {}); });

// "Add to To-do": a to-do that only carries the title and links back to the task.
const todoFor = (taskId) => state.todos.find((x) => x.task_id === taskId && !x.done);
function todoButton(t) {
  if (state.personalError || t.status === 'completed') return '';
  const td = todoFor(t.id);
  return `<div class="todo-link-row" data-todo-row>${td
    ? `<span class="small muted">${icon.list(15)} On your To-do list${td.pending ? ' (pending)' : ''}</span><a class="btn ghost sm" href="#/todo" data-go-todo>Open To-do</a>`
    : `<button type="button" class="btn sm" data-add-todo>${icon.list(15)} Add to my To-do</button>`}</div>`;
}
function bindTodoButton(t, ov) {
  $('[data-go-todo]', ov)?.addEventListener('click', () => closeSheet());
  $('[data-add-todo]', ov)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const open = state.todos.filter((x) => !x.done && !x.pending);
      const top = open.length ? Math.min(...open.map((x) => x.position)) - 1 : Date.now() / 1000;
      const td = await store.addTodo(t.title.slice(0, 300), top, t.id);
      state.todos.push(td); updateCounts();
      $('[data-todo-row]', ov).outerHTML = todoButton(t); bindTodoButton(t, ov);
      toast('Added to your To-do', t.title, 'green', icon.list);
    } catch (ex) { fail(ex); }
  });
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
      <div class="field"><label>Temporary password <span class="muted" style="font-weight:400">(type your own, or press Generate)</span></label>
        <div class="pw-set">${pwInput('act-pw', pw, true)}<button type="button" class="btn" id="act-gen">Generate</button></div>
        <span class="small muted">They'll be asked to choose their own password after their first sign-in.</span></div>
      <div class="error" id="act-error"></div>
    </div><div class="sheet-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Activate account</button></div></form>`, (ov) => {
    bindPwInput(ov);
    $('#act-gen', ov).addEventListener('click', () => { const i = $('#act-pw', ov); i.value = genPassword(); i.type = 'text'; });
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
  if (/rate limit/i.test(m)) return 'Supabase email limit reached. Run supabase/migrations/011_admin_create_login.sql in Supabase once, then Activate works without sending any email.';
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
        <div><b>Set a temporary password</b><div class="small muted">Nobody (including admins) can see an existing password. Type one or generate one; ${p.id === state.me.id ? 'this changes your own password.' : `${esc(p.full_name)} will be asked to choose their own after signing in with it.`}</div></div>
        <div class="pw-set">${pwInput('p-newpw', '')}<button type="button" class="btn sm" id="p-gen" title="Generate a random password">Generate</button><button type="button" class="btn sm primary" id="p-reset">Set password</button></div>
        <div class="error" id="p-pw-err"></div>
        <div class="pw-result hidden" id="p-pw-result"></div>
      </div>
      <div class="small muted">${esc(p.email)}</div>
    </div><div class="sheet-foot">
      ${p.id !== state.me.id ? `<button type="button" class="btn ${p.active ? 'danger' : ''} left" id="p-active">${p.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
      ${p.id !== state.me.id && isAdmin() ? `<button type="button" class="btn danger" id="p-delete">${icon.trash(16)} Delete user</button>` : ''}
      <button type="button" class="btn" id="p-kpi">View KPIs</button>
      <button class="btn primary" type="submit">Save</button></div></form>`, (ov) => {
    $('#p-dept', ov).addEventListener('change', (e) => { $('#p-team', ov).innerHTML = teamOptions(e.target.value); });
    bindPwInput(ov);
    $('#p-gen', ov).addEventListener('click', () => { const i = $('#p-newpw', ov); i.value = genPassword(); i.type = 'text'; i.focus(); });
    $('#p-reset', ov).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const pw = $('#p-newpw', ov).value;
      $('#p-pw-err', ov).textContent = '';
      if (pw.length < 8) { $('#p-pw-err', ov).textContent = 'Use at least 8 characters.'; $('#p-newpw', ov).focus(); return; }
      if (!await confirmDialog({ title: `Set a new password for ${p.id === state.me.id ? 'yourself' : p.full_name}?`, body: 'Their current password stops working straight away.', confirm: 'Set password', tone: 'blue' })) return;
      b.disabled = true;
      try {
        await store.adminResetPassword(p.id, pw);
        const box = $('#p-pw-result', ov);
        box.classList.remove('hidden');
        box.innerHTML = `<div class="small muted">Password set for ${esc(p.full_name)}. Share it privately:</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><code class="pw-code">${esc(pw)}</code><button type="button" class="btn sm primary" id="p-pw-copy">Copy login details</button></div>`;
        $('#p-pw-copy', ov).addEventListener('click', async () => {
          const text = `${CONFIG.APP_NAME}: ${location.origin + location.pathname}\nEmail: ${p.email}\nTemporary password: ${pw}\nPlease change it after signing in (click your name, bottom left).`;
          try { await navigator.clipboard.writeText(text); toast('Copied', 'Share it with them privately.', 'green', icon.check); } catch { prompt('Copy this', text); }
        });
        b.textContent = 'Password set'; setTimeout(() => { b.disabled = false; b.textContent = 'Set password'; }, 2500);
      } catch (ex) { b.disabled = false; fail(new Error(/admin_reset_password|function/i.test(ex.message) && !/Only an admin/.test(ex.message) ? 'Run supabase/migrations/004_people_admin.sql in Supabase first.' : ex.message)); }
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
      <div class="pw-box"><div><b>Password</b><div class="small muted">Change it any time.</div></div><button type="button" class="btn sm" id="me-chpw">${icon.lock(14)} Change password</button></div>
      ${store.mode === 'demo' ? `<button type="button" class="btn sm" id="reset-demo" style="justify-self:start">Reset demo data</button>` : ''}
    </div><div class="sheet-foot">
      <button type="button" class="btn danger left" id="sign-out">${icon.out(16)} Sign out</button>
      <button class="btn primary" type="submit">Save</button></div></form>`, (ov) => {
    $('#sign-out', ov).addEventListener('click', signOut);
    $('#me-chpw', ov).addEventListener('click', () => { closeSheet(true); setTimeout(() => openChangePassword(false), 50); });
    $('#reset-demo', ov)?.addEventListener('click', async () => { store.resetDemo(); await signOut(); toast('Demo data reset'); });
    $('#me-form', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await store.updateProfile(me.id, { full_name: $('#me-name', ov).value.trim() || me.full_name, title: $('#me-title', ov).value.trim() });
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
