// Demo backend: keeps everything in this browser's localStorage and
// applies the same permission rules as supabase/schema.sql, so you can
// try the whole app without any setup. Open two tabs, sign in as a
// manager in one and a member in the other to see live notifications.
//
// This file is also the reference for the adapter interface: a new
// backend (Firebase, your own API, ...) only needs these methods.

const DB_KEY = 'taskflow-demo-v1';
const SESSION_KEY = 'taskflow-demo-session';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const now = () => new Date().toISOString();
const daysFromNow = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

function seed() {
  const dOps = uid(), dSales = uid();
  const tDel = uid(), tSup = uid(), tField = uid(), tInside = uid();
  const P = (email, full_name, role, department_id, team_id, title) =>
    ({ id: uid(), email, full_name, role, department_id, team_id, title, active: true, created_at: now(), password: 'demo123' });
  const admin = P('admin@demo.app', 'Asha Admin', 'admin', dOps, null, 'Administrator');
  const mOps = P('meera@demo.app', 'Meera Kapoor', 'manager', dOps, tDel, 'Operations Manager');
  const mSales = P('rahul@demo.app', 'Rahul Verma', 'manager', dSales, tField, 'Sales Manager');
  const u1 = P('arjun@demo.app', 'Arjun Mehta', 'member', dOps, tDel, 'Delivery Lead');
  const u2 = P('priya@demo.app', 'Priya Nair', 'member', dOps, tSup, 'Support Specialist');
  const u3 = P('kabir@demo.app', 'Kabir Singh', 'member', dSales, tField, 'Account Executive');
  const u4 = P('sara@demo.app', 'Sara Khan', 'member', dSales, tInside, 'Inside Sales');
  [u1, u2].forEach((u) => { u.manager_id = mOps.id; }); [u3, u4].forEach((u) => { u.manager_id = mSales.id; });

  const T = (title, by, to, status, priority, due, extra = {}) => {
    const created_at = extra.created_at || hoursAgo(24 * 6);
    return {
      id: uid(), title, description: extra.description || '', status, priority, due_date: due,
      links: extra.links || [], created_by: by.id, assigned_to: to.id, created_at, updated_at: created_at,
      completed_at: status === 'completed' ? (extra.completed_at || hoursAgo(30)) : null,
    };
  };
  const tasks = [
    T('Prepare Q4 delivery schedule', mOps, u1, 'in_progress', 'high', daysFromNow(2), {
      description: 'Consolidate all client delivery dates for October to December and flag conflicts.',
      links: [{ label: 'Delivery tracker', url: 'https://example.com/tracker' }] }),
    T('Resolve ticket backlog over 3 days old', mOps, u2, 'not_started', 'urgent', daysFromNow(1), {
      links: [{ label: 'Helpdesk queue', url: 'https://example.com/helpdesk' }] }),
    T('Update vendor contact sheet', mOps, u2, 'completed', 'low', daysFromNow(-3), { completed_at: hoursAgo(24 * 4) }),
    T('Warehouse audit checklist', mOps, u1, 'completed', 'medium', daysFromNow(-1), { completed_at: hoursAgo(20) }),
    T('Client onboarding deck for Zenith', mOps, u3, 'on_hold', 'high', daysFromNow(4), {
      description: 'Waiting on final pricing from finance.',
      links: [{ label: 'Draft deck', url: 'https://example.com/deck' }, { label: 'Pricing doc', url: 'https://example.com/pricing' }] }),
    T('Follow up with 10 warm leads', mSales, u3, 'in_progress', 'medium', daysFromNow(3)),
    T('Monthly pipeline report', mSales, u4, 'completed', 'high', daysFromNow(-5), { completed_at: hoursAgo(24 * 7) }),
    T('Demo call with Orion Labs', mSales, u4, 'not_started', 'medium', daysFromNow(-1)),
    T('Share route plan for field visits', mSales, u1, 'completed', 'medium', daysFromNow(-2), { completed_at: hoursAgo(24 * 1.5) }),
    T('Clean up my inbox rules', u1, u1, 'not_started', 'low', null),
  ];
  return {
    departments: [{ id: dOps, name: 'Operations', created_at: now() }, { id: dSales, name: 'Sales', created_at: now() }],
    teams: [
      { id: tDel, name: 'Delivery', department_id: dOps }, { id: tSup, name: 'Support', department_id: dOps },
      { id: tField, name: 'Field Sales', department_id: dSales }, { id: tInside, name: 'Inside Sales', department_id: dSales },
    ],
    profiles: [admin, mOps, mSales, u1, u2, u3, u4],
    invitations: [],
    tasks,
    notifications: [],
    task_remarks: [
      { id: uid(), task_id: tasks[4].id, author_id: u3.id, kind: 'blocker', reason: 'dependency', tagged: [u2.id, mSales.id],
        body: 'Waiting for final pricing sheet from Priya before I can finish the deck.', created_at: hoursAgo(20), resolved_at: null, resolved_by: null },
      { id: uid(), task_id: tasks[0].id, author_id: u1.id, kind: 'note', reason: null, tagged: [],
        body: 'Draft shared with the team, final version by Wednesday.', created_at: hoursAgo(5), resolved_at: null, resolved_by: null },
    ],
    task_events: tasks.flatMap((t) => [
      { id: uid(), task_id: t.id, changed_by: t.created_by, from_status: null, to_status: 'not_started', created_at: t.created_at },
      ...(t.completed_at ? [{ id: uid(), task_id: t.id, changed_by: t.assigned_to, from_status: 'in_progress', to_status: 'completed', created_at: t.completed_at }] : []),
    ]),
  };
}

export const DEMO_ACCOUNTS = [
  { email: 'admin@demo.app', label: 'Admin' },
  { email: 'meera@demo.app', label: 'Manager · Ops' },
  { email: 'rahul@demo.app', label: 'Manager · Sales' },
  { email: 'arjun@demo.app', label: 'Member · Ops' },
  { email: 'kabir@demo.app', label: 'Member · Sales' },
];

const strip = ({ password, ...p }) => p;
const clone = (x) => JSON.parse(JSON.stringify(x));

export class LocalAdapter {
  constructor() {
    this.mode = 'demo';
    this.demoAccounts = DEMO_ACCOUNTS;
    this.listeners = new Set();
    this.bc = 'BroadcastChannel' in window ? new BroadcastChannel('taskflow-demo') : null;
    const onRemote = (msg) => this.listeners.forEach((fn) => fn(msg));
    if (this.bc) this.bc.onmessage = (e) => onRemote(e.data);
    else window.addEventListener('storage', (e) => e.key === DB_KEY + ':event' && e.newValue && onRemote(JSON.parse(e.newValue)));
  }

  // ---------- storage ----------
  get db() {
    let raw = null;
    try { raw = localStorage.getItem(DB_KEY); } catch {}
    if (!raw) { const s = seed(); this.save(s); return s; }
    const db = JSON.parse(raw);
    db.task_events ||= [];
    db.task_remarks ||= [];
    return db;
  }
  save(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} }
  emit(msg) {
    this.listeners.forEach((fn) => fn(msg));               // this tab
    if (this.bc) this.bc.postMessage(msg);                  // other tabs
    else try { localStorage.setItem(DB_KEY + ':event', JSON.stringify({ ...msg, t: Date.now() })); } catch {}
  }
  resetDemo() { try { localStorage.removeItem(DB_KEY); } catch {} }

  // ---------- auth ----------
  get uid() { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } }
  me(db = this.db) {
    const p = db.profiles.find((x) => x.id === this.uid && x.active);
    if (!p) throw new Error('Please sign in again.');
    return p;
  }
  async getSessionUserId() { return this.db.profiles.some((p) => p.id === this.uid && p.active) ? this.uid : null; }
  async signIn(email, password) {
    const p = this.db.profiles.find((x) => x.email === email.trim().toLowerCase());
    if (!p || p.password !== password) throw new Error('Invalid login credentials');
    if (!p.active) throw new Error('This account has been deactivated.');
    sessionStorage.setItem(SESSION_KEY, p.id);
  }
  async activate(email, password, fullName) {
    const db = this.db;
    const e = email.trim().toLowerCase();
    if (db.profiles.some((p) => p.email === e)) throw new Error('An account with this email already exists. Sign in instead.');
    const inv = db.invitations.find((i) => i.email === e);
    if (!inv) throw new Error('This email has not been invited. Ask your admin or manager to add you first.');
    if (password.length < 6) throw new Error('Password should be at least 6 characters.');
    const p = { id: uid(), email: e, full_name: inv.full_name || fullName || e.split('@')[0], title: inv.title || '',
      role: inv.role, department_id: inv.department_id, team_id: inv.team_id, active: true, created_at: now(), password };
    db.profiles.push(p);
    inv.accepted_at = now();
    this.save(db);
    sessionStorage.setItem(SESSION_KEY, p.id);
    this.emit({ kind: 'directory' });
    return { needsConfirmation: false };
  }
  async resetPassword() { throw new Error('Password reset email is not available in demo mode. Demo password is demo123.'); }
  async updatePassword(password) {
    const db = this.db; this.me(db).password = password; this.save(db);
  }
  onAuthChange() {}
  async signOut() { sessionStorage.removeItem(SESSION_KEY); }

  // ---------- directory ----------
  async getProfile(id) { const p = this.db.profiles.find((x) => x.id === id); return p ? strip(p) : null; }
  async listProfiles() { return this.db.profiles.map(strip).sort((a, b) => a.full_name.localeCompare(b.full_name)); }
  async updateProfile(id, patch) {
    const db = this.db; const me = this.me(db);
    const p = db.profiles.find((x) => x.id === id);
    if (!p) throw new Error('Not found');
    if (patch.manager_id && patch.manager_id === id) throw new Error('Someone cannot report to themselves.');
    if (me.role !== 'admin') {
      if (id !== me.id) throw new Error('You can only edit your own profile.');
      for (const k of ['role', 'department_id', 'team_id', 'manager_id', 'active', 'email'])
        if (k in patch && patch[k] !== p[k]) throw new Error('Only an admin can change role, department, team or status.');
    }
    Object.assign(p, patch); this.save(db); this.emit({ kind: 'directory' });
    return strip(p);
  }
  requireAdmin(db) { if (this.me(db).role !== 'admin') throw new Error('Only an admin can do this.'); }
  async listDepartments() { return clone(this.db.departments).sort((a, b) => a.name.localeCompare(b.name)); }
  async createDepartment(name) {
    const db = this.db; this.requireAdmin(db);
    if (db.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw new Error('That department already exists.');
    const d = { id: uid(), name, created_at: now() }; db.departments.push(d); this.save(db); this.emit({ kind: 'directory' }); return d;
  }
  async deleteDepartment(id) {
    const db = this.db; this.requireAdmin(db);
    const teamIds = db.teams.filter((t) => t.department_id === id).map((t) => t.id);
    db.departments = db.departments.filter((d) => d.id !== id);
    db.teams = db.teams.filter((t) => t.department_id !== id);
    db.profiles.forEach((p) => { if (p.department_id === id) p.department_id = null; if (teamIds.includes(p.team_id)) p.team_id = null; });
    this.save(db); this.emit({ kind: 'directory' });
  }
  async listTeams() { return clone(this.db.teams).sort((a, b) => a.name.localeCompare(b.name)); }
  async createTeam(name, department_id) {
    const db = this.db; this.requireAdmin(db);
    const t = { id: uid(), name, department_id }; db.teams.push(t); this.save(db); this.emit({ kind: 'directory' }); return t;
  }
  async deleteTeam(id) {
    const db = this.db; this.requireAdmin(db);
    db.teams = db.teams.filter((t) => t.id !== id);
    db.profiles.forEach((p) => { if (p.team_id === id) p.team_id = null; });
    this.save(db); this.emit({ kind: 'directory' });
  }
  async listInvitations() {
    const db = this.db; const me = this.me(db);
    return clone(db.invitations.filter((i) => me.role === 'admin' || i.invited_by === me.id));
  }
  async createInvitation(inv) {
    const db = this.db; const me = this.me(db);
    const e = inv.email.trim().toLowerCase();
    if (me.role === 'member') throw new Error('Only admins and managers can add people.');
    if (me.role === 'manager' && (inv.role !== 'member' || inv.department_id !== me.department_id))
      throw new Error('Managers can add members to their own department only.');
    if (db.invitations.some((i) => i.email === e) || db.profiles.some((p) => p.email === e)) throw new Error('This email is already added.');
    const row = { ...inv, email: e, invited_by: me.id, created_at: now(), accepted_at: null };
    db.invitations.push(row); this.save(db); return row;
  }
  async activateMember(email, password, fullName) {
    const db = this.db; const me = this.me(db);
    const e = email.trim().toLowerCase();
    const inv = db.invitations.find((i) => i.email === e && !i.accepted_at);
    if (!inv || (me.role !== 'admin' && inv.invited_by !== me.id)) throw new Error('No pending invitation for this email.');
    if (db.profiles.some((p) => p.email === e)) throw new Error('An account with this email already exists.');
    if (password.length < 6) throw new Error('Password should be at least 6 characters.');
    db.profiles.push({ id: uid(), email: e, full_name: inv.full_name || fullName || e.split('@')[0], title: inv.title || '',
      role: inv.role, department_id: inv.department_id, team_id: inv.team_id, manager_id: inv.manager_id || null, active: true, created_at: now(), password });
    inv.accepted_at = now();
    this.save(db); this.emit({ kind: 'directory' });
    return { needsConfirmation: false };
  }
  async adminResetPassword(userId, password) {
    const db = this.db; this.requireAdmin(db);
    if (password.length < 8) throw new Error('Use at least 8 characters.');
    const p = db.profiles.find((x) => x.id === userId);
    if (!p) throw new Error('Person not found.');
    p.password = password; this.save(db);
  }
  async deleteInvitation(email) {
    const db = this.db; const me = this.me(db);
    db.invitations = db.invitations.filter((i) => !(i.email === email && (me.role === 'admin' || (i.invited_by === me.id && !i.accepted_at))));
    this.save(db);
  }

  // ---------- tasks ----------
  canSee(me, t, db = this.db) {
    return t.assigned_to === me.id || t.created_by === me.id || me.role === 'admin'
      || (db.task_remarks || []).some((r) => r.task_id === t.id && r.tagged.includes(me.id));
  }
  async listTasks() {
    const db = this.db; const me = this.me(db);
    return clone(db.tasks.filter((t) => this.canSee(me, t, db))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  notify(db, user_id, task, type, message) {
    db.notifications.unshift({ id: uid(), user_id, task_id: task.id, type, message, read: false, created_at: now() });
    return db.notifications[0];
  }
  async createTask(input) {
    const db = this.db; const me = this.me(db);
    if (input.assigned_to !== me.id && !['admin', 'manager'].includes(me.role)) throw new Error('Members can only create tasks for themselves.');
    if (!input.title?.trim()) throw new Error('Give the task a title.');
    const t = { id: uid(), description: '', status: 'not_started', priority: 'medium', due_date: null, links: [], ...input,
      created_by: me.id, created_at: now(), updated_at: now(), completed_at: input.status === 'completed' ? now() : null };
    if (['in_progress', 'completed'].includes(t.status)) t.started_at = now();
    db.tasks.push(t);
    db.task_events.push({ id: uid(), task_id: t.id, changed_by: me.id, from_status: null, to_status: t.status, created_at: now() });
    const notes = [];
    if (t.assigned_to !== me.id) notes.push(this.notify(db, t.assigned_to, t, 'assigned', `${me.full_name} assigned you "${t.title}"`));
    this.save(db);
    this.emit({ kind: 'task' });
    notes.forEach((n) => this.emit({ kind: 'notification', record: n }));
    return clone(t);
  }
  async updateTask(id, patch) {
    const db = this.db; const me = this.me(db);
    const t = db.tasks.find((x) => x.id === id);
    if (!t || !(t.assigned_to === me.id || t.created_by === me.id || me.role === 'admin')) throw new Error('You can only add remarks to this task.');
    if (me.id !== t.created_by && me.role !== 'admin') {
      for (const k of Object.keys(patch))
        if (k !== 'status' && JSON.stringify(patch[k]) !== JSON.stringify(t[k]))
          throw new Error('This task was assigned to you. You can only update its status.');
    }
    if ('assigned_to' in patch && patch.assigned_to !== t.assigned_to && patch.assigned_to !== me.id && !['admin', 'manager'].includes(me.role))
      throw new Error('Only managers can assign tasks to other people.');
    const old = { ...t };
    const { created_by, created_at, ...rest } = patch;
    Object.assign(t, rest, { updated_at: now() });
    if (t.status === 'completed' && old.status !== 'completed') t.completed_at = now();
    if (t.status !== 'completed') t.completed_at = null;
    if (!t.started_at && t.status !== old.status && ['in_progress', 'completed'].includes(t.status)) t.started_at = now();
    if (t.status !== old.status) db.task_events.push({ id: uid(), task_id: t.id, changed_by: me.id, from_status: old.status, to_status: t.status, created_at: now() });
    const notes = [];
    if (t.status !== old.status && me.id !== t.created_by) {
      const again = old.status === 'on_hold' ? ' again (resumed from on hold)' : old.status === 'completed' ? ' again (reopened)' : '';
      const msg = { completed: `completed "${t.title}"`, on_hold: `put "${t.title}" on hold`,
        in_progress: `started working on "${t.title}"${again}`, not_started: `moved "${t.title}" back to not started` }[t.status];
      notes.push(this.notify(db, t.created_by, t, t.status, `${me.full_name} ${msg}`));
    }
    if (t.status !== old.status && me.id === t.created_by && t.assigned_to !== t.created_by) {
      const lbl = { completed: 'Completed', on_hold: 'On hold', in_progress: 'In progress', not_started: 'Not started' }[t.status];
      notes.push(this.notify(db, t.assigned_to, t, t.status, `${me.full_name} changed "${t.title}" to ${lbl}`));
    }
    if (t.assigned_to !== old.assigned_to && t.assigned_to !== t.created_by)
      notes.push(this.notify(db, t.assigned_to, t, 'assigned', `${me.full_name} assigned you "${t.title}"`));
    this.save(db);
    this.emit({ kind: 'task' });
    notes.forEach((n) => this.emit({ kind: 'notification', record: n }));
    return clone(t);
  }
  async deleteTask(id) {
    const db = this.db; const me = this.me(db);
    const t = db.tasks.find((x) => x.id === id);
    if (!t || (t.created_by !== me.id && me.role !== 'admin')) throw new Error('Only the person who created this task can delete it.');
    db.tasks = db.tasks.filter((x) => x.id !== id);
    db.notifications = db.notifications.filter((n) => n.task_id !== id);
    this.save(db); this.emit({ kind: 'task' });
  }

  async listTaskEvents(taskId) {
    const db = this.db; const me = this.me(db);
    const t = db.tasks.find((x) => x.id === taskId);
    if (!t || !this.canSee(me, t)) return [];
    return clone(db.task_events.filter((e) => e.task_id === taskId)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---------- remarks (mirrors migrations/003_task_remarks.sql) ----------
  async listRemarks() {
    const db = this.db; const me = this.me(db);
    const visible = new Set(db.tasks.filter((t) => this.canSee(me, t, db)).map((t) => t.id));
    return clone(db.task_remarks.filter((r) => visible.has(r.task_id))).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async addRemark(input) {
    const db = this.db; const me = this.me(db);
    const t = db.tasks.find((x) => x.id === input.task_id);
    if (!t || !this.canSee(me, t, db)) throw new Error('Task not found.');
    const body = (input.body || '').trim();
    if (!body) throw new Error('Write a remark first.');
    const kind = input.kind === 'blocker' ? 'blocker' : 'note';
    const tagged = [...new Set(input.tagged || [])].filter((id) => id !== me.id && db.profiles.some((p) => p.id === id && p.active));
    const r = { id: uid(), task_id: t.id, author_id: me.id, body, kind, reason: kind === 'blocker' ? (input.reason || 'other') : null,
      tagged, created_at: now(), resolved_at: null, resolved_by: null };
    db.task_remarks.push(r);
    const why = { issue: 'an issue', delay: 'a delay', dependency: 'a dependency' }[r.reason] || 'a blocker';
    const notes = tagged.map((u) => this.notify(db, u, t, 'tagged', `${me.full_name} tagged you on "${t.title}"${kind === 'blocker' ? ` (blocked by ${why})` : ''}`));
    [...new Set([t.created_by, t.assigned_to])].filter((u) => u !== me.id && !tagged.includes(u)).forEach((u) =>
      notes.push(this.notify(db, u, t, kind === 'blocker' ? 'blocked' : 'remark',
        kind === 'blocker' ? `${me.full_name} flagged "${t.title}" as blocked by ${why}` : `${me.full_name} added a remark on "${t.title}"`)));
    this.save(db);
    this.emit({ kind: 'task' });
    notes.forEach((n) => this.emit({ kind: 'notification', record: n }));
    return clone(r);
  }
  async resolveRemark(id, resolved = true) {
    const db = this.db; const me = this.me(db);
    const r = db.task_remarks.find((x) => x.id === id);
    const t = r && db.tasks.find((x) => x.id === r.task_id);
    if (!r || !t || !this.canSee(me, t, db)) throw new Error('Remark not found.');
    const was = !!r.resolved_at;
    r.resolved_at = resolved ? now() : null; r.resolved_by = resolved ? me.id : null;
    const notes = [];
    if (resolved && !was) [...new Set([r.author_id, t.created_by, t.assigned_to])].filter((u) => u !== me.id)
      .forEach((u) => notes.push(this.notify(db, u, t, 'resolved', `${me.full_name} resolved a blocker on "${t.title}"`)));
    this.save(db); this.emit({ kind: 'task' });
    notes.forEach((n) => this.emit({ kind: 'notification', record: n }));
    return clone(r);
  }
  async deleteRemark(id) {
    const db = this.db; const me = this.me(db);
    const r = db.task_remarks.find((x) => x.id === id);
    if (!r || (r.author_id !== me.id && me.role !== 'admin')) throw new Error('Only the author can delete this remark.');
    db.task_remarks = db.task_remarks.filter((x) => x.id !== id);
    this.save(db); this.emit({ kind: 'task' });
  }

  // ---------- notifications ----------
  async listNotifications() {
    const db = this.db; const me = this.me(db);
    return clone(db.notifications.filter((n) => n.user_id === me.id).slice(0, 50));
  }
  async markNotificationsRead(ids) {
    const db = this.db; const me = this.me(db);
    db.notifications.forEach((n) => { if (n.user_id === me.id && ids.includes(n.id)) n.read = true; });
    this.save(db);
  }

  // ---------- KPI (mirrors kpi_stats() in schema.sql) ----------
  async kpiStats(scope, target = null) {
    const db = this.db; const me = this.me(db);
    const mayView = (p) => p.id === me.id || me.role === 'admin' || (me.role === 'manager' && (p.department_id === me.department_id || p.manager_id === me.id));
    const people = db.profiles.filter((p) => p.active && (
      (scope === 'me' && p.id === me.id) ||
      (scope === 'department' && (me.role === 'admin' || (me.role === 'manager' && (p.department_id === me.department_id || p.manager_id === me.id)))) ||
      (scope === 'user' && p.id === target && mayView(p))));
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d; })();
    return people.map((p) => {
      const ts = db.tasks.filter((t) => t.assigned_to === p.id);
      const done = ts.filter((t) => t.status === 'completed');
      const hrs = done.map((t) => (new Date(t.completed_at) - new Date(t.created_at)) / 3600e3);
      const weekly = [];
      for (let w = 7; w >= 0; w--) {
        const from = new Date(weekStart); from.setDate(from.getDate() - 7 * w);
        const to = new Date(from); to.setDate(to.getDate() + 7);
        weekly.push(done.filter((t) => new Date(t.completed_at) >= from && new Date(t.completed_at) < to).length);
      }
      return {
        user_id: p.id, total: ts.length, completed: done.length,
        in_progress: ts.filter((t) => t.status === 'in_progress').length,
        on_hold: ts.filter((t) => t.status === 'on_hold').length,
        not_started: ts.filter((t) => t.status === 'not_started').length,
        overdue_open: ts.filter((t) => t.status !== 'completed' && t.due_date && t.due_date < today).length,
        completed_on_time: done.filter((t) => !t.due_date || t.completed_at.slice(0, 10) <= t.due_date).length,
        completed_late: done.filter((t) => t.due_date && t.completed_at.slice(0, 10) > t.due_date).length,
        avg_completion_hours: hrs.length ? Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10 : null,
        high_priority_completed: done.filter((t) => ['high', 'urgent'].includes(t.priority)).length,
        weekly,
      };
    });
  }

  // ---------- realtime ----------
  subscribe(userId, cb) {
    const fn = (msg) => {
      if (msg.kind === 'notification' && msg.record.user_id !== userId) return;
      cb(msg);
    };
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
