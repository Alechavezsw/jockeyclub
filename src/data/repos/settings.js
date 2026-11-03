import { unwrap } from '../errors';
import { sb } from './shared.js';

// ---- Settings / Health ----
export async function getSetting(key) {
  const row = await unwrap(sb().from('app_settings').select('*').eq('key', key).maybeSingle());
  return row?.value ?? null;
}

export async function setSetting(key, value, updatedBy = null) {
  const saved = await unwrap(
    sb().from('app_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    }).select().single()
  );
  return saved.value;
}

export async function healthCheck() {
  const { count, error } = await sb()
    .from('chart_of_accounts')
    .select('id', { count: 'exact', head: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, chartCount: count || 0 };
}
