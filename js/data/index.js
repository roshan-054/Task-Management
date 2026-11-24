// Picks the storage backend. Every backend implements the same
// interface (see local-adapter.js for the reference), so switching
// to another database later only means writing one new adapter.
import { CONFIG } from '../config.js';

export async function createDataStore() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    const { SupabaseAdapter } = await import('./supabase-adapter.js');
    return new SupabaseAdapter(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  const { LocalAdapter } = await import('./local-adapter.js');
  return new LocalAdapter();
}
