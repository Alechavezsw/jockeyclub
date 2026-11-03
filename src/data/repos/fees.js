import { unwrap, throwOnError } from '../errors';
import { debitListingPeriodOptions, previousDebitListingPeriod, remapDebitListingsToPeriod } from '../../domain/accounting/debitListings';
import { sb, audit } from './shared.js';
import { feePeriodClosureFromRow, interestGeneratorFromRow, interestRunFromRow } from './ledgers.js';

export async function listInterestGenerators() {
  const rows = await unwrap(
    sb().from('interest_generators').select('*').order('identifier'),
  );
  return (rows || []).map(interestGeneratorFromRow).filter(Boolean);
}

export async function upsertInterestGenerator(item) {
  const row = {
    id: item.id,
    identifier: item.identifier,
    dues_description: item.duesDescription || '',
    period: item.period || 'manual',
    separate_entries: Boolean(item.separateEntries),
    percentage: Number(item.percentage) || 0,
    include_members: item.includeMembers || [],
    exclude_members: item.excludeMembers || [],
    tolerance: Number(item.tolerance) || 0,
    dues_from: item.duesFrom || null,
    dues_to: item.duesTo || null,
    settlement_date: item.settlementDate || null,
    is_active: item.isActive !== false,
    source: item.source || 'manual',
    created_at: item.createdAt || new Date().toISOString(),
  };
  const saved = await unwrap(
    sb().from('interest_generators').upsert(row, { onConflict: 'id' }).select().single(),
    'No se pudo guardar el generador de intereses',
  );
  return interestGeneratorFromRow(saved);
}

export async function deactivateInterestGenerator(id) {
  const saved = await unwrap(
    sb().from('interest_generators').update({ is_active: false }).eq('id', id).select().single(),
    'No se pudo eliminar el generador de intereses',
  );
  return interestGeneratorFromRow(saved);
}

export async function listInterestRuns() {
  const runs = await unwrap(
    sb().from('interest_runs').select('*').order('created_at', { ascending: false }),
  );
  if (!runs?.length) return [];
  const ids = runs.map((row) => row.id);
  const entryRows = await unwrap(
    sb().from('interest_run_entries').select('*').in('run_id', ids),
  );
  const byRun = new Map();
  (entryRows || []).forEach((row) => {
    const list = byRun.get(row.run_id) || [];
    list.push({
      id: row.id,
      memberId: row.member_number,
      memberName: row.member_name || '',
      amount: Number(row.amount) || 0,
      description: row.description || '',
      balanceBase: Number(row.balance_base) || 0,
    });
    byRun.set(row.run_id, list);
  });
  return runs.map((row) => interestRunFromRow(row, byRun.get(row.id) || [])).filter(Boolean);
}

export async function saveInterestRun(run) {
  await unwrap(
    sb().rpc('save_interest_run', {
      p_run: {
        id: run.id,
        generatorId: run.generatorId,
        generatorLabel: run.generatorLabel,
        imputationDate: run.imputationDate,
        status: run.status || 'completed',
        entriesCreated: run.entriesCreated,
        totalAmount: run.totalAmount,
        percentage: run.percentage,
        separateEntries: Boolean(run.separateEntries),
        createdAt: run.createdAt,
      },
      p_entries: (run.entries || []).map((entry) => ({
        id: entry.id,
        memberId: entry.memberId,
        memberName: entry.memberName || '',
        amount: entry.amount,
        description: entry.description || '',
        balanceBase: entry.balanceBase || 0,
      })),
    }),
    'No se pudo guardar la generación de intereses',
  );
  return run;
}

export async function cancelInterestRunRecord(runId) {
  await unwrap(
    sb().rpc('cancel_interest_run', { p_run_id: runId }),
    'No se pudo anular la generación de intereses',
  );
}

/** Reabre el período en la base. Los importes salen de los cargos guardados, no del navegador. */
export async function reopenFeePeriodRecord(periodId, reason) {
  const data = await unwrap(
    sb().rpc('reopen_fee_period', {
      p_period_id: periodId,
      p_reason: String(reason || '').trim(),
    }),
    'No se pudo reabrir la liquidación',
  );
  const period = feePeriodClosureFromRow(data?.period);
  if (!period?.id) throw new Error('La base no devolvió el período.');
  const reversals = Array.isArray(data?.reversals) ? data.reversals : [];
  return { period, reversals };
}

/** Nota de crédito o débito sobre la cuota. No reescribe una liquidación procesada. */
export async function notaAjusteCuota({ memberNumber, kind, amount, reason }) {
  const balance = await unwrap(
    sb().rpc('nota_ajuste_cuota', {
      p_member_number: String(memberNumber || '').trim(),
      p_kind: kind,
      p_amount: Number(amount) || 0,
      p_reason: String(reason || '').trim(),
    }),
    'No se pudo registrar la nota',
  );
  const value = Number(balance);
  if (!Number.isFinite(value)) throw new Error('La base no devolvió el saldo.');
  return value;
}

export async function applyMemberBalanceDeltas(deltas = []) {
  const rows = (deltas || [])
    .map((row) => ({
      memberId: String(row.memberId || row.memberNumber || '').trim(),
      amount: Number(row.amount ?? row.addAmount) || 0,
    }))
    .filter((row) => row.memberId && row.amount);
  if (!rows.length) return;
  await unwrap(
    sb().rpc('apply_member_balance_deltas', { p_deltas: rows }),
    'No se pudo imputar la deuda de las cuotas',
  );
}

function feeLedgerAccountFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accessinId: row.accessin_id == null ? null : Number(row.accessin_id),
    name: row.name,
    description: row.description || '',
    feeCategories: row.fee_categories || [],
    balance: Number(row.balance) || 0,
    detailAccountLabel: row.detail_account_label || row.name,
    isActive: row.is_active !== false,
    source: row.source || 'manual',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function feeLedgerLineFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    memberNumber: row.member_number || '',
    memberName: row.member_name || '',
    dni: row.dni || '',
    date: row.line_date || '',
    dateLabel: row.date_label || '',
    collectedAt: row.collected_at || '',
    collectedAtLabel: row.collected_at_label || '',
    type: row.type_label || '',
    description: row.description || '',
    amount: Number(row.amount) || 0,
    collected: Number(row.collected) || 0,
    pending: Number(row.pending) || 0,
    source: row.source || 'manual',
  };
}

export async function listFeeLedgerAccounts() {
  const rows = await unwrap(
    sb().from('fee_ledger_accounts').select('*').order('accessin_id', { ascending: true }),
    'No se pudieron leer las cuentas contables',
  );
  return (rows || []).map(feeLedgerAccountFromRow).filter(Boolean);
}

export async function upsertFeeLedgerAccount(input) {
  const row = {
    id: input.id,
    accessin_id: input.accessinId ?? null,
    name: input.name,
    description: input.description || '',
    fee_categories: input.feeCategories || [],
    balance: Number(input.balance) || 0,
    detail_account_label: input.detailAccountLabel || input.name,
    is_active: input.isActive !== false,
    source: input.source || 'manual',
  };
  const saved = await unwrap(
    sb().from('fee_ledger_accounts').upsert(row, { onConflict: 'id' }).select().single(),
    'No se pudo guardar la cuenta contable',
  );
  return feeLedgerAccountFromRow(saved);
}

export async function deactivateFeeLedgerAccount(id) {
  const saved = await unwrap(
    sb().from('fee_ledger_accounts').update({ is_active: false }).eq('id', id).select().single(),
    'No se pudo eliminar la cuenta contable',
  );
  return feeLedgerAccountFromRow(saved);
}

export async function listFeeLedgerLines(accountId) {
  if (!accountId) return [];
  const lines = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const batch = await unwrap(
      sb()
        .from('fee_ledger_lines')
        .select('id, account_id, member_number, member_name, dni, line_date, date_label, collected_at, collected_at_label, type_label, description, amount, collected, pending, source')
        .eq('account_id', accountId)
        .order('line_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1),
      'No se pudo leer la cuenta corriente',
    );
    lines.push(...(batch || []).map(feeLedgerLineFromRow).filter(Boolean));
    if (!batch || batch.length < pageSize) break;
  }
  return lines;
}

function feeLedgerLineToRow(line) {
  return {
    id: line.id,
    account_id: line.accountId,
    member_number: line.memberNumber || '',
    member_name: line.memberName || '',
    dni: line.dni || '',
    line_date: line.date || null,
    date_label: line.dateLabel || '',
    collected_at: line.collectedAt || null,
    collected_at_label: line.collectedAtLabel || '',
    type_label: line.type || '',
    description: line.description || '',
    amount: Number(line.amount) || 0,
    collected: Number(line.collected) || 0,
    pending: Number(line.pending) || 0,
    source: line.source || 'liquidation',
  };
}

export async function postFeeLedgerLines(lines = []) {
  if (!lines.length) return;
  await unwrap(
    sb().rpc('post_fee_ledger_lines', { p_lines: lines }),
    'No se pudieron imputar los movimientos de la cuenta',
  );
}

/** Meses que ya tienen movimientos. No toca el balance de la cuenta. */
export async function listFeeLedgerMonths() {
  const months = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const batch = await unwrap(
      sb()
        .from('fee_ledger_lines')
        .select('line_date')
        .range(from, from + pageSize - 1),
      'No se pudieron leer los meses de la cuenta corriente',
    );
    for (const row of batch || []) {
      const key = String(row.line_date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
    }
    if (!batch || batch.length < pageSize) break;
  }
  return [...months];
}

/** Guarda líneas históricas que faltan. Si el id ya existe, no suma el balance. */
export async function insertFeeLedgerLines(lines = []) {
  if (!lines.length) return;
  const rows = lines.map(feeLedgerLineToRow);
  const pageSize = 200;
  for (let i = 0; i < rows.length; i += pageSize) {
    await unwrap(
      sb()
        .from('fee_ledger_lines')
        .upsert(rows.slice(i, i + pageSize), { onConflict: 'id', ignoreDuplicates: true }),
      'No se pudieron completar los meses de la cuenta corriente',
    );
  }
}

export async function listFeePeriodClosures() {
  const rows = await unwrap(
    sb().from('fee_period_closures').select('*').order('year').order('month'),
  );
  return (rows || []).map(feePeriodClosureFromRow).filter(Boolean);
}

function debitListingFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    year: Number(row.year),
    month: Number(row.month),
    sheetKind: row.sheet_kind || 'credito',
    brand: row.brand || '',
    section: row.section || 'padron',
    sortOrder: Number(row.sort_order) || 0,
    cardNumber: row.card_number || null,
    receipt: row.receipt || null,
    dueDate: row.due_date || null,
    duesAmount: Number(row.dues_amount) || 0,
    abonoAmount: Number(row.abono_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    memberId: row.member_id || null,
    statusCode: row.status_code || null,
    holderName: row.holder_name || '',
    note: row.note || '',
    sourceSheet: row.source_sheet || null,
    cardEdits: Array.isArray(row.card_edits) ? row.card_edits : [],
  };
}

/** Listados mensuales de débitos (planilla Argencard/Visa). Por período para no bajar 14k filas. */
export async function listDebitListings({ year, month, sheetKind } = {}) {
  let q = sb()
    .from('debit_listings')
    .select('*')
    .order('sort_order', { ascending: true });
  if (year) q = q.eq('year', Number(year));
  if (month) q = q.eq('month', Number(month));
  if (sheetKind) q = q.eq('sheet_kind', sheetKind);
  const rows = await unwrap(q);
  return (rows || []).map(debitListingFromRow).filter(Boolean);
}

/** Totales livianos del mes (crédito / débito) sin bajar la planilla completa. */
export async function sumDebitListingAmounts({ year, month } = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return { credito: 0, debito: 0 };
  let credito = 0;
  let debito = 0;
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb()
      .from('debit_listings')
      .select('sheet_kind, total_amount')
      .eq('year', y)
      .eq('month', m)
      .range(from, from + page - 1);
    throwOnError(error, 'No se pudieron sumar los listados de débitos');
    const rows = data || [];
    for (const row of rows) {
      const amount = Number(row.total_amount) || 0;
      if (row.sheet_kind === 'debito') debito += amount;
      else credito += amount;
    }
    if (rows.length < page) break;
    from += page;
  }
  return {
    credito: Math.round(credito * 100) / 100,
    debito: Math.round(debito * 100) / 100,
  };
}

/** Guarda un cambio de N° tarjeta en el listado (Supabase = fuente de verdad). */
export async function updateDebitListingCard(row) {
  if (!row?.id) throw new Error('Falta el id de la fila del listado.');
  const saved = await unwrap(
    sb()
      .from('debit_listings')
      .update({
        card_number: row.cardNumber || null,
        note: row.note || '',
        card_edits: Array.isArray(row.cardEdits) ? row.cardEdits : [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('*')
      .single(),
  );
  const mapped = debitListingFromRow(saved);
  const last = mapped.cardEdits?.[mapped.cardEdits.length - 1];
  await audit('update', 'debit_listing', saved.id, {
    field: 'card_number',
    from: last?.from || null,
    to: last?.to || mapped.cardNumber,
    memberId: mapped.memberId,
  });
  return mapped;
}

function debitMoveEventFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    year: Number(row.year),
    month: Number(row.month),
    moveType: row.move_type,
    cardKind: row.card_kind || 'credito',
    brand: row.brand || '',
    memberId: row.member_id || null,
    memberDbId: row.member_db_id || null,
    holderName: row.holder_name || '',
    cardNumber: row.card_number || null,
    receipt: row.receipt || null,
    dueDate: row.due_date || null,
    duesAmount: Number(row.dues_amount) || 0,
    abonoAmount: Number(row.abono_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    statusCode: row.status_code || null,
    note: row.note || '',
    listingId: row.listing_id || null,
    actorId: row.actor_id || null,
    actorName: row.actor_name || '',
    actorEmail: row.actor_email || '',
    createdAt: row.created_at || null,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
  };
}

/** Historial de altas/bajas del mes (Supabase). */
export async function listDebitMoveEvents({ year, month } = {}) {
  let q = sb()
    .from('debit_move_events')
    .select('*')
    .order('created_at', { ascending: false });
  if (year) q = q.eq('year', Number(year));
  if (month) q = q.eq('month', Number(month));
  const rows = await unwrap(q);
  return (rows || []).map(debitMoveEventFromRow).filter(Boolean);
}

/**
 * Alta/baja en planilla + historial trazable.
 * Inserta fila en debit_listings (sección altas/bajas) y evento en debit_move_events.
 */
export async function registerDebitMove({
  draft,
  member = null,
  actor = null,
} = {}) {
  const year = Number(draft?.year);
  const month = Number(draft?.month);
  const moveType = draft?.moveType === 'baja' ? 'baja' : 'alta';
  const sheetKind = draft?.cardKind === 'debito' ? 'debito' : 'credito';
  const section = moveType === 'baja' ? 'bajas' : 'altas';
  if (!year || !month) throw new Error('Falta el período de la planilla.');

  const maxRows = await unwrap(
    sb()
      .from('debit_listings')
      .select('sort_order')
      .eq('year', year)
      .eq('month', month)
      .eq('sheet_kind', sheetKind)
      .order('sort_order', { ascending: false })
      .limit(1),
  );
  const sortOrder = (Number(maxRows?.[0]?.sort_order) || 0) + 1;
  const listingId = `dl-${year}${String(month).padStart(2, '0')}-${sheetKind}-${section}-${Date.now()}`;
  const listingRow = {
    id: listingId,
    year,
    month,
    sheet_kind: sheetKind,
    brand: draft.brand || (sheetKind === 'debito' ? 'VISA DEBITO' : 'VISA'),
    section,
    sort_order: sortOrder,
    card_number: draft.cardNumber || null,
    receipt: draft.receipt || null,
    due_date: draft.dueDate || null,
    dues_amount: Number(draft.duesAmount) || 0,
    abono_amount: Number(draft.abonoAmount) || 0,
    total_amount: Number(draft.totalAmount) || 0,
    member_id: draft.memberId || null,
    status_code: draft.statusCode || 'N',
    holder_name: draft.holderName || '',
    note: draft.note || '',
    source_sheet: 'operacion',
    card_edits: [],
  };

  const savedListing = await unwrap(
    sb().from('debit_listings').insert(listingRow).select('*').single(),
    'No se pudo guardar la fila en el listado de débitos',
  );

  const eventRow = {
    year,
    month,
    move_type: moveType,
    card_kind: sheetKind,
    brand: listingRow.brand,
    member_id: draft.memberId || null,
    member_db_id: member?.id || null,
    holder_name: draft.holderName || '',
    card_number: draft.cardNumber || null,
    receipt: draft.receipt || null,
    due_date: draft.dueDate || null,
    dues_amount: Number(draft.duesAmount) || 0,
    abono_amount: Number(draft.abonoAmount) || 0,
    total_amount: Number(draft.totalAmount) || 0,
    status_code: draft.statusCode || 'N',
    note: draft.note || '',
    listing_id: savedListing.id,
    actor_id: actor?.id || null,
    actor_name: actor?.name || '',
    actor_email: actor?.email || '',
    payload: {
      fichaMemberId: member?.memberId || null,
      channel: sheetKind === 'debito' ? 'Visa Débito / ficha' : 'Crédito / ficha',
      cardExpiry: draft.cardExpiry || null,
    },
  };

  const savedEvent = await unwrap(
    sb().from('debit_move_events').insert(eventRow).select('*').single(),
    'No se pudo registrar el historial de alta/baja',
  );

  await audit(moveType, 'debit_move_event', savedEvent.id, {
    memberId: draft.memberId,
    cardNumber: draft.cardNumber,
    holderName: draft.holderName,
    listingId: savedListing.id,
    actor: actor?.email || actor?.name || null,
  });

  return {
    listing: debitListingFromRow(savedListing),
    event: debitMoveEventFromRow(savedEvent),
  };
}

export async function listDebitListingPeriods() {
  // No pedimos el histórico completo: el selector arranca en oct-2026.
  return debitListingPeriodOptions([]);
}

function debitListingToRow(row) {
  return {
    id: row.id,
    year: Number(row.year),
    month: Number(row.month),
    sheet_kind: row.sheetKind === 'debito' ? 'debito' : 'credito',
    brand: row.brand || '',
    section: row.section || 'padron',
    sort_order: Number(row.sortOrder) || 0,
    card_number: row.cardNumber || null,
    receipt: row.receipt || null,
    due_date: row.dueDate || null,
    dues_amount: Number(row.duesAmount) || 0,
    abono_amount: Number(row.abonoAmount) || 0,
    total_amount: Number(row.totalAmount) || 0,
    member_id: row.memberId || null,
    status_code: row.statusCode || null,
    holder_name: row.holderName || '',
    note: row.note || '',
    source_sheet: row.sourceSheet || null,
    card_edits: Array.isArray(row.cardEdits) ? row.cardEdits : [],
  };
}

/**
 * Carga el listado del mes anterior sobre el período elegido (crédito + débito).
 * Reemplaza las hojas del mes destino.
 */
export async function copyDebitListingsFromPreviousMonth({ year, month } = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new Error('Falta el período destino.');
  const prev = previousDebitListingPeriod(y, m);
  const [credito, debito] = await Promise.all([
    listDebitListings({ year: prev.year, month: prev.month, sheetKind: 'credito' }),
    listDebitListings({ year: prev.year, month: prev.month, sheetKind: 'debito' }),
  ]);
  const source = [...(credito || []), ...(debito || [])];
  if (!source.length) {
    throw new Error(`No hay planilla en ${prev.key} para copiar.`);
  }
  const rows = remapDebitListingsToPeriod(source, { year: y, month: m });
  const result = await importDebitListings(rows, {
    fileName: `mes-anterior:${prev.key}→${y}-${String(m).padStart(2, '0')}`,
  });
  return {
    ...result,
    from: prev,
    to: { year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` },
  };
}

/**
 * Importa planilla Excel (misma estructura de export) a debit_listings.
 * Reemplaza por completo cada (año, mes, hoja) presente en el archivo.
 */
export async function importDebitListings(rows = [], { fileName = '' } = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('El Excel no trajo filas para importar.');
  }
  const groups = new Map();
  for (const row of rows) {
    const year = Number(row.year);
    const month = Number(row.month);
    const sheetKind = row.sheetKind === 'debito' ? 'debito' : 'credito';
    if (!year || !month) continue;
    const key = `${year}-${month}-${sheetKind}`;
    if (!groups.has(key)) groups.set(key, { year, month, sheetKind, rows: [] });
    groups.get(key).rows.push(row);
  }
  if (!groups.size) throw new Error('No hay períodos válidos en el Excel.');

  let inserted = 0;
  for (const group of groups.values()) {
    await unwrap(
      sb()
        .from('debit_listings')
        .delete()
        .eq('year', group.year)
        .eq('month', group.month)
        .eq('sheet_kind', group.sheetKind),
      `No se pudo limpiar ${group.year}-${group.month} (${group.sheetKind})`,
    );
    const payload = group.rows.map(debitListingToRow);
    const BATCH = 500;
    for (let i = 0; i < payload.length; i += BATCH) {
      const chunk = payload.slice(i, i + BATCH);
      await unwrap(
        sb().from('debit_listings').insert(chunk),
        `No se pudo importar el lote de ${group.year}-${group.month}`,
      );
      inserted += chunk.length;
    }
  }

  await audit('import', 'debit_listings', null, {
    fileName: fileName || null,
    periods: [...groups.keys()],
    count: inserted,
  });

  return {
    count: inserted,
    periods: [...groups.values()].map((g) => ({
      year: g.year,
      month: g.month,
      sheetKind: g.sheetKind,
      count: g.rows.length,
      key: `${g.year}-${String(g.month).padStart(2, '0')}`,
    })),
  };
}

export async function upsertFeePeriodClosure(period) {
  const availableAt = period.availableAt || period.pack?.availableAt || null;
  const pack = period.pack && typeof period.pack === 'object'
    ? { ...period.pack, availableAt: availableAt || period.pack.availableAt || null }
    : null;
  const row = {
    id: period.id,
    accessin_id: period.accessinId ?? null,
    year: Number(period.year),
    month: Number(period.month),
    amount: Number(period.amount) || 0,
    generated_at: period.generatedAt || null,
    status: period.status || 'processed',
    lines: Array.isArray(period.lines) ? period.lines : [],
    pack,
  };
  const saved = await unwrap(
    sb().from('fee_period_closures').upsert(row, { onConflict: 'id' }).select().single(),
  );
  return feePeriodClosureFromRow(saved);
}
