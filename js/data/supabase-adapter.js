// Supabase backend. All permission rules live in the database
// (supabase/schema.sql), so this file only moves data around.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.78.0/+esm';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export class SupabaseAdapter {
  constructor(url, key) {
    this.mode = 'supabase';
    this.url = url; this.key = key;
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  // ---------- auth ----------
  async getSessionUserId() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user?.id ?? null;
  }
  async signIn(email, password) {
    unwrap(await this.sb.auth.signInWithPassword({ email: email.trim(), password }));
  }
  async activate(email, password, fullName) {
    const data = unwrap(await this.sb.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: fullName }, emailRedirectTo: location.origin + location.pathname },
    }));
    return { needsConfirmation: !data.session };
  }
  async resetPassword(email) {
    unwrap(await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname }));
  }
  async updatePassword(password) {
    unwrap(await this.sb.auth.updateUser({ password }));
  }
  onAuthChange(cb) {
    this.sb.auth.onAuthStateChange((event) => cb(event));
  }
  async signOut() {
    if (this.channel) { this.sb.removeChannel(this.channel); this.channel = null; }
    await this.sb.auth.signOut();
  }

  // ---------- directory ----------
  async getProfile(id) {
    return unwrap(await this.sb.from('profiles').select('*').eq('id', id).maybeSingle());
  }
  async listProfiles() {
    return unwrap(await this.sb.from('profiles').select('*').order('full_name'));
  }
  async updateProfile(id, patch) {
    return unwrap(await this.sb.from('profiles').update(patch).eq('id', id).select().single());
  }
  async listDepartments() {
    return unwrap(await this.sb.from('departments').select('*').order('name'));
  }
  async createDepartment(name) {
    return unwrap(await this.sb.from('departments').insert({ name }).select().single());
  }
  async deleteDepartment(id) {
    unwrap(await this.sb.from('departments').delete().eq('id', id));
  }
  async listTeams() {
    return unwrap(await this.sb.from('teams').select('*').order('name'));
  }
  async createTeam(name, department_id) {
    return unwrap(await this.sb.from('teams').insert({ name, department_id }).select().single());
  }
  async renameDepartment(id, name) {
    return unwrap(await this.sb.from('departments').update({ name }).eq('id', id).select().single());
  }
  async renameTeam(id, name) {
    return unwrap(await this.sb.from('teams').update({ name }).eq('id', id).select().single());
  }
  // Platforms (per department). Returns [] if migration 006 has not been run yet.
  async listPlatforms() {
    const { data, error } = await this.sb.from('platforms').select('*').order('name');
    if (error) { console.warn('platforms:', error.message); return []; }
    return data;
  }
  async createPlatform(department_id, name) {
    return unwrap(await this.sb.from('platforms').insert({ department_id, name }).select().single());
  }
  async renamePlatform(id, name) {
    return unwrap(await this.sb.from('platforms').update({ name }).eq('id', id).select().single());
  }
  async restorePlatform(id) {
    return unwrap(await this.sb.from('platforms').update({ archived: false }).eq('id', id).select().single());
  }
  async removePlatform(id) {
    return unwrap(await this.sb.rpc('remove_platform', { p_id: id }));
  }
  async deleteTeam(id) {
    unwrap(await this.sb.from('teams').delete().eq('id', id));
  }
  async listInvitations() {
    return unwrap(await this.sb.from('invitations').select('*').order('created_at', { ascending: false }));
  }
  async createInvitation(inv) {
    const uid = await this.getSessionUserId();
    return unwrap(await this.sb.from('invitations')
      .insert({ ...inv, email: inv.email.trim().toLowerCase(), invited_by: uid }).select().single());
  }
  // Admin/manager creates the account for an invited person with a
  // temporary password. Uses a separate, non-persistent client so the
  // admin stays signed in. The database still checks the invitation.
  async activateMember(email, password, fullName) {
    // Preferred: create the login inside the database (migration 011). No email is sent, so no email limit.
    const { error } = await this.sb.rpc('admin_create_login', { p_email: email.trim().toLowerCase(), p_password: password, p_full_name: fullName || '' });
    if (!error) return { needsConfirmation: false };
    if (!/admin_create_login|schema cache|Could not find the function/i.test(error.message)) throw new Error(error.message);
    // Database not updated yet: fall back to Supabase sign-up (sends a confirmation email).
    const tmp = createClient(this.url, this.key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'taskflow-activate' } });
    const data = unwrap(await tmp.auth.signUp({
      email: email.trim().toLowerCase(), password,
      options: { data: { full_name: fullName || '' }, emailRedirectTo: location.origin + location.pathname },
    }));
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      throw new Error('An account with this email already exists.');
    if (data.session) await tmp.auth.signOut();
    return { needsConfirmation: !data.session };
  }
  async adminResetPassword(userId, password) {
    unwrap(await this.sb.rpc('admin_reset_password', { p_user: userId, p_password: password }));
  }
  async adminDeleteUser(userId, reassignTo = null) {
    const { data, error } = await this.sb.rpc('admin_delete_user', { p_user: userId, p_reassign_to: reassignTo });
    if (error) throw new Error(/admin_delete_user|schema cache/i.test(error.message) ? 'Run supabase/migrations/008_delete_user.sql in Supabase first.' : error.message);
    return data;
  }
  async deleteInvitation(email) {
    unwrap(await this.sb.from('invitations').delete().eq('email', email));
  }

  // ---------- tasks ----------
  async listTasks() {
    return unwrap(await this.sb.from('tasks').select('*').order('created_at', { ascending: false }));
  }
  async createTask(task) {
    return unwrap(await this.sb.from('tasks').insert(task).select().single());
  }
  async updateTask(id, patch) {
    return unwrap(await this.sb.from('tasks').update(patch).eq('id', id).select().single());
  }
  async deleteTask(id) {
    unwrap(await this.sb.from('tasks').delete().eq('id', id));
  }

  async listTaskEvents(taskId) {
    return unwrap(await this.sb.from('task_events').select('*').eq('task_id', taskId).order('created_at'));
  }

  // ---------- remarks ----------
  async listRemarks() {
    return unwrap(await this.sb.from('task_remarks').select('*').order('created_at'));
  }
  async addRemark(r) {
    const uid = await this.getSessionUserId();
    return unwrap(await this.sb.from('task_remarks').insert({ ...r, author_id: uid }).select().single());
  }
  async resolveRemark(id, resolved = true) {
    return unwrap(await this.sb.from('task_remarks').update({ resolved_at: resolved ? new Date().toISOString() : null }).eq('id', id).select().single());
  }
  async deleteRemark(id) {
    unwrap(await this.sb.from('task_remarks').delete().eq('id', id));
  }

  // ---------- personal to-do & notes (private to each person) ----------
  async personal(q) {
    const { data, error } = await q;
    if (error) {
      if (/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)) throw new Error('To-do and Notes need a one-time database update: run supabase/migrations/007_todos_notes.sql in Supabase.');
      throw new Error(error.message);
    }
    return data;
  }
  async listTodos() { return this.personal(this.sb.from('todos').select('*').order('position')); }
  async addTodo(title, position, task_id = null, list_id = null) {
    const row = { title, position }; if (task_id) row.task_id = task_id; if (list_id) row.list_id = list_id;
    return this.personal(this.sb.from('todos').insert(row).select().single());
  }
  async updateTodo(id, patch) { return this.personal(this.sb.from('todos').update(patch).eq('id', id).select().single()); }
  async deleteTodo(id) { await this.personal(this.sb.from('todos').delete().eq('id', id)); }
  async clearDoneTodos() { await this.personal(this.sb.from('todos').delete().eq('done', true)); }
  // ---------- to-do lists (migration 015) ----------
  async listTodoLists() {
    const { data, error } = await this.sb.from('todo_lists').select('*').order('position');
    if (error) { if (/todo_lists|schema cache/i.test(error.message)) return null; throw new Error(error.message); }
    return data;
  }
  async addTodoList(name) {
    const { data, error } = await this.sb.from('todo_lists').insert({ name }).select().single();
    if (error) throw new Error(/todo_lists|schema cache/i.test(error.message) ? 'Run supabase/migrations/015_lists_and_repeat.sql in Supabase first.' : error.message);
    return data;
  }
  async updateTodoList(id, patch) { return unwrap(await this.sb.from('todo_lists').update(patch).eq('id', id).select().single()); }
  async deleteTodoList(id) { unwrap(await this.sb.from('todo_lists').delete().eq('id', id)); }
  async listNotes() { return this.personal(this.sb.from('notes').select('*').order('updated_at', { ascending: false })); }
  async addNote(n = {}) { return this.personal(this.sb.from('notes').insert({ title: n.title || '', body: n.body || '' }).select().single()); }
  async updateNote(id, patch) { return this.personal(this.sb.from('notes').update(patch).eq('id', id).select().single()); }
  async deleteNote(id) { await this.personal(this.sb.from('notes').delete().eq('id', id)); }

  // ---------- reminders (migration 009) ----------
  async listReminders() {
    const { data, error } = await this.sb.from('reminders').select('*').order('remind_at');
    if (error) { console.warn('reminders:', error.message); return []; }
    return data;
  }
  async addReminder(r) {
    const { data, error } = await this.sb.from('reminders').insert(r).select().single();
    if (error) throw new Error(/reminders|schema cache/i.test(error.message) && /exist|find/i.test(error.message) ? 'Run supabase/migrations/009_reminders.sql in Supabase first.' : error.message);
    return data;
  }
  async updateReminder(id, patch) { return unwrap(await this.sb.from('reminders').update(patch).eq('id', id).select().single()); }
  async deleteReminder(id) { unwrap(await this.sb.from('reminders').delete().eq('id', id)); }
  async fireMyReminders() {
    const { data, error } = await this.sb.rpc('fire_my_reminders');
    if (error) return 0;
    return data || 0;
  }

  // ---------- notifications ----------
  async listNotifications() {
    return unwrap(await this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50));
  }
  async deleteNotifications(ids) {
    if (!ids.length) return;
    unwrap(await this.sb.from('notifications').delete().in('id', ids));
  }
  async markNotificationsRead(ids) {
    if (!ids.length) return;
    unwrap(await this.sb.from('notifications').update({ read: true }).in('id', ids));
  }

  // ---------- KPI ----------
  async kpiStats(scope, target = null) {
    return unwrap(await this.sb.rpc('kpi_stats', { scope, target }));
  }
  async kpiPlatforms(scope, target = null) {
    const { data, error } = await this.sb.rpc('kpi_platforms', { scope, target });
    if (error) { console.warn('kpi_platforms:', error.message); return []; }
    return data;
  }

  // ---------- realtime ----------
  subscribe(userId, cb) {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = this.sb.channel('taskflow-' + userId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (p) => cb({ kind: 'notification', record: p.new }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
        () => cb({ kind: 'task' }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_remarks' },
        () => cb({ kind: 'task' }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platforms' },
        () => cb({ kind: 'directory' }))
      .subscribe();
    return () => { this.sb.removeChannel(this.channel); this.channel = null; };
  }
}
