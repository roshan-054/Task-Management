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

  // ---------- notifications ----------
  async listNotifications() {
    return unwrap(await this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50));
  }
  async markNotificationsRead(ids) {
    if (!ids.length) return;
    unwrap(await this.sb.from('notifications').update({ read: true }).in('id', ids));
  }

  // ---------- KPI ----------
  async kpiStats(scope, target = null) {
    return unwrap(await this.sb.rpc('kpi_stats', { scope, target }));
  }

  // ---------- realtime ----------
  subscribe(userId, cb) {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = this.sb.channel('taskflow-' + userId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (p) => cb({ kind: 'notification', record: p.new }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
        () => cb({ kind: 'task' }))
      .subscribe();
    return () => { this.sb.removeChannel(this.channel); this.channel = null; };
  }
}
