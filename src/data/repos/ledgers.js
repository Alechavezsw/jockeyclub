import { unwrap, throwOnError } from '../errors';
import { sb } from './shared.js';

export async function findMemberDbIdByNumber(memberNumber) {
  if (!memberNumber) return null;
  const row = await unwrap(
    sb().from('members').select('id').eq('member_number', memberNumber).maybeSingle()
  );
  return row?.id || null;
}

const ACCOUNT_COLUMNS = 'id, titular_number, opening_on, opening_balance, closing_on, closing_balance';

/** Cuántos extractos familiares hay cargados. No trae movimientos. */
export async function countGroupAccountLedgers() {
  const { count, error } = await sb()
    .from('group_accounts')
    .select('id', { count: 'exact', head: true });
  throwOnError(error, 'No se pudo contar los extractos de cuenta');
  return count || 0;
}

/** Extracto de Lila del socio: el suyo si es titular, o el del grupo donde figura. */
export async function listGroupAccountLedger(memberNumber) {
  const key = String(memberNumber || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!key) return null;
  let account = await unwrap(
    sb()
      .from('group_accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('titular_number', key)
      .order('loaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  if (!account) {
    const hits = await unwrap(
      sb()
        .from('group_account_lines')
        .select('group_account_id')
        .eq('member_number', key)
        .limit(1)
    );
    const groupAccountId = hits?.[0]?.group_account_id;
    if (!groupAccountId) return null;
    account = await unwrap(
      sb()
        .from('group_accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('id', groupAccountId)
        .maybeSingle()
    );
  }
  if (!account) return null;

  const lines = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const batch = await unwrap(
      sb()
        .from('group_account_lines')
        .select('lila_line_id, member_number, member_name, line_date, type_label, description, amount')
        .eq('group_account_id', account.id)
        .order('line_date', { ascending: true })
        .order('lila_line_id', { ascending: true })
        .range(from, from + pageSize - 1)
    );
    lines.push(...(batch || []));
    if (!batch || batch.length < pageSize) break;
  }
  return { ...account, lines };
}

/** Resumen de soporte de un socio: pendiente y pagos imputados. */
export async function listMemberAccountSupport(memberNumber) {
  const key = String(memberNumber || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!key) return null;
  const account = await unwrap(
    sb()
      .from('member_support_accounts')
      .select('titular_number, opening_on, opening_balance, closing_on, closing_balance, month_balances')
      .eq('titular_number', key)
      .maybeSingle()
  );
  if (!account) return null;

  const lines = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const batch = await unwrap(
      sb()
        .from('member_support_lines')
        .select('lila_line_id, line_date, type_label, description, pending_amount, amount, links')
        .eq('titular_number', key)
        .order('line_date', { ascending: true })
        .order('lila_line_id', { ascending: true })
        .range(from, from + pageSize - 1)
    );
    lines.push(...(batch || []));
    if (!batch || batch.length < pageSize) break;
  }
  return { ...account, lines };
}

export function feePeriodClosureFromRow(row) {
  if (!row) return null;
  const pack = row.pack && typeof row.pack === 'object' ? row.pack : null;
  return {
    id: row.id,
    accessinId: row.accessin_id == null ? null : Number(row.accessin_id),
    year: Number(row.year),
    month: Number(row.month),
    amount: Number(row.amount) || 0,
    generatedAt: row.generated_at || null,
    // available_at vive en pack (no hay columna en fee_period_closures).
    availableAt: pack?.availableAt || null,
    status: row.status || 'draft',
    lines: Array.isArray(row.lines) ? row.lines : [],
    pack,
    source: 'app',
  };
}

export function interestGeneratorFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    identifier: row.identifier,
    duesDescription: row.dues_description || '',
    period: row.period || 'manual',
    separateEntries: Boolean(row.separate_entries),
    percentage: Number(row.percentage) || 0,
    includeMembers: row.include_members || [],
    excludeMembers: row.exclude_members || [],
    tolerance: Number(row.tolerance) || 0,
    duesFrom: row.dues_from || '',
    duesTo: row.dues_to || '',
    settlementDate: row.settlement_date || null,
    isActive: row.is_active !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    source: row.source || 'manual',
  };
}

export function interestRunFromRow(row, entries = []) {
  if (!row) return null;
  return {
    id: row.id,
    generatorId: row.generator_id,
    generatorLabel: row.generator_label || '',
    imputationDate: row.imputation_date || '',
    createdAt: row.created_at || null,
    cancelledAt: row.cancelled_at || null,
    status: row.status || 'completed',
    entriesCreated: Number(row.entries_created) || entries.length,
    totalAmount: Number(row.total_amount) || 0,
    percentage: Number(row.percentage) || 0,
    separateEntries: Boolean(row.separate_entries),
    entries,
  };
}
