import { supabase } from '../../lib/supabase';
import { unwrap, throwOnError } from '../errors';

export const FISCAL_2026 = '11111111-1111-1111-1111-111111111111';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(id) {
  return UUID_RE.test(String(id || ''));
}

export function sb() {
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

/** PostgREST pagina de a N filas; fetchAllRows recorre todo el padrón sin tope de socios. */
export const PAGE_SIZE = 1000;

export async function fetchAllRows(queryFactory, fallback, pageSize = PAGE_SIZE) {
  const all = [];
  let from = 0;
  for (;;) {
    const chunk = await unwrap(queryFactory(from, from + pageSize - 1), fallback);
    const rows = chunk || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/** Páginas en paralelo (mucho más rápido que encadenar range). */
export async function fetchAllRowsParallel(
  countQuery,
  pageQuery,
  fallback,
  pageSize = PAGE_SIZE,
  concurrency = 6
) {
  const { count, error } = await countQuery;
  throwOnError(error, fallback);
  const total = count || 0;
  if (!total) return [];
  const pageCount = Math.ceil(total / pageSize);
  const all = [];
  for (let start = 0; start < pageCount; start += concurrency) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(concurrency, pageCount - start) }, (_, j) => {
        const i = start + j;
        const from = i * pageSize;
        return unwrap(pageQuery(from, from + pageSize - 1), fallback);
      })
    );
    for (const chunk of batch) all.push(...(chunk || []));
  }
  return all;
}

export async function audit(action, entityType, entityId, payload = {}) {
  try {
    const { data: { user } } = await sb().auth.getUser();
    await sb().from('audit_logs').insert({
      actor_id: user?.id || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      payload,
    });
  } catch {
    /* audit best-effort */
  }
}
