import * as M from '../mappers';
import { unwrap } from '../errors';
import { todayAR } from '../../lib/arDate';
import { resolveAccountId } from '../../domain/accounting/chartOfAccounts';
import { rewriteDuesCobroConcept } from '../../domain/members/duesPaymentMethodChange';
import { isUuid, sb, audit, FISCAL_2026 } from './shared.js';

// ---- Accounting ----
export async function listChartOfAccounts() {
  const rows = await unwrap(
    sb().from('chart_of_accounts').select('*').order('code'),
    'No se pudo cargar plan de cuentas'
  );
  return (rows || []).map(M.accountFromRow);
}

function mapJournalPage(entries) {
  return (entries || []).map((entry) => M.journalFromRow(entry, entry.journal_lines || []));
}

/** Asientos con líneas en la misma respuesta. Antes eran dos viajes (cabecera y un IN enorme). */
async function listJournalEntriesNested() {
  const pageSize = 400;
  const pageCount = 15;
  const pages = [];
  for (let start = 0; start < pageCount; start += 2) {
    const batch = await Promise.all(
      [0, 1].map((offset) => {
        const index = start + offset;
        const from = index * pageSize;
        return unwrap(
          sb()
            .from('journal_entries')
            .select('*, journal_lines(*)')
            .order('entry_date', { ascending: false })
            .range(from, from + pageSize - 1),
          'No se pudo cargar el libro diario',
        );
      }),
    );
    pages.push(...batch);
    const short = batch.some((rows) => (rows || []).length < pageSize);
    if (short) break;
  }
  return pages.flatMap(mapJournalPage);
}

export async function listJournalEntries() {
  try {
    return await listJournalEntriesNested();
  } catch {
    const entries = await unwrap(
      sb().from('journal_entries').select('*').order('entry_date', { ascending: false }).limit(5000),
      'No se pudo cargar el libro diario',
    );
    if (!entries?.length) return [];
    const ids = entries.map((entry) => entry.id);
    const lines = await unwrap(sb().from('journal_lines').select('*').in('journal_entry_id', ids));
    const byEntry = {};
    (lines || []).forEach((line) => {
      (byEntry[line.journal_entry_id] ||= []).push(line);
    });
    return entries.map((entry) => M.journalFromRow(entry, byEntry[entry.id] || []));
  }
}

function journalRpcMissing(error) {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883';
}

export async function insertJournalEntry(entry, { createdBy } = {}) {
  const created = isUuid(createdBy) ? createdBy : null;
  const { data, error } = await sb().rpc('post_journal_entry', {
    p_entry: {
      fiscalPeriodId: entry.fiscalPeriodId || FISCAL_2026,
      date: entry.date,
      concept: entry.concept || entry.description || 'Asiento',
      reference: entry.reference || null,
      status: entry.status == null ? 'posted' : entry.status,
      sourceModule: entry.sourceModule || 'manual',
      createdBy: created,
      lines: (entry.lines || []).map((line, index) => ({
        accountId: line.accountId,
        lineOrder: line.lineOrder || index + 1,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        memo: line.memo || null,
      })),
    },
  });
  if (!error && data?.entry) {
    return M.journalFromRow(data.entry, Array.isArray(data.lines) ? data.lines : []);
  }
  if (error && !journalRpcMissing(error)) {
    throw new Error(error.message || 'No se pudo crear asiento');
  }

  const header = {
    fiscal_period_id: entry.fiscalPeriodId || FISCAL_2026,
    entry_date: entry.date,
    concept: entry.concept || entry.description || 'Asiento',
    reference: entry.reference || null,
    status: 'draft',
    source_module: entry.sourceModule || 'manual',
    created_by: createdBy || null,
  };
  const saved = await unwrap(
    sb().from('journal_entries').insert(header).select().single(),
    'No se pudo crear asiento'
  );
  const lineRows = (entry.lines || []).map((l, i) => ({
    journal_entry_id: saved.id,
    account_id: l.accountId,
    line_order: l.lineOrder || i + 1,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    memo: l.memo || null,
  }));
  if (lineRows.length) {
    await unwrap(sb().from('journal_lines').insert(lineRows), 'No se pudieron crear líneas');
  }
  if (entry.status === 'posted' || entry.status == null) {
    await unwrap(
      sb().from('journal_entries').update({
        status: 'posted',
        posted_at: new Date().toISOString(),
        posted_by: createdBy || null,
      }).eq('id', saved.id)
    );
  }
  await audit('create', 'journal_entries', saved.id);
  const lines = await unwrap(sb().from('journal_lines').select('*').eq('journal_entry_id', saved.id));
  const fresh = await unwrap(sb().from('journal_entries').select('*').eq('id', saved.id).single());
  return M.journalFromRow(fresh, lines || []);
}

export async function listCashRegisters() {
  const rows = await unwrap(sb().from('cash_registers').select('*').order('code'));
  return (rows || []).map(M.cashRegisterFromRow);
}

export async function listCashSessions() {
  const rows = await unwrap(
    sb().from('cash_sessions').select('*').order('opened_at', { ascending: false })
  );
  return (rows || []).map(M.cashSessionFromRow);
}

export async function insertCashSession(session) {
  const row = {
    cash_register_id: session.cashRegisterId,
    status: session.status || 'open',
    opening_balance: Number(session.openingBalance) || 0,
    opened_by: session.openedBy || null,
  };
  const saved = await unwrap(sb().from('cash_sessions').insert(row).select().single());
  return M.cashSessionFromRow(saved);
}

export async function updateCashSession(id, patch) {
  if (patch?.status === 'closed' || patch?.status === 'discrepancy') {
    throw new Error('La caja permanece abierta: no se cierra.');
  }
  const row = {};
  if (patch.status != null) row.status = patch.status;
  if (patch.countedBalance != null) row.counted_balance = patch.countedBalance;
  if (patch.closedAt != null) row.closed_at = patch.closedAt;
  if (patch.closedBy != null) row.closed_by = patch.closedBy;
  const saved = await unwrap(sb().from('cash_sessions').update(row).eq('id', id).select().single());
  return M.cashSessionFromRow(saved);
}

export async function listCashMovements() {
  const rows = await unwrap(
    sb().from('cash_movements').select('*').order('created_at', { ascending: false })
  );
  return (rows || []).map(M.cashMovementFromRow);
}

/**
 * Alinea asiento + movimientos de caja al nuevo medio de un cobro de cuota.
 * Cambia la cuenta de tesorería del debe y el texto del concepto.
 */
export async function syncDuesPaymentMethodAccounting({
  paymentId,
  journalEntryId = null,
  methodLabel,
  journalAccountName,
  actorName = '',
} = {}) {
  const payId = isUuid(paymentId) ? paymentId : null;
  let entryId = isUuid(journalEntryId) ? journalEntryId : null;
  if (!entryId && payId) {
    try {
      const bySource = await unwrap(
        sb()
          .from('journal_entries')
          .select('id')
          .eq('source_module', 'cuotas')
          .eq('source_id', payId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        'No se pudo buscar el asiento',
      );
      entryId = bySource?.id || null;
    } catch {
      entryId = null;
    }
  }
  if (!entryId) {
    return { journalEntryId: null, updatedLines: 0, updatedMovements: 0 };
  }

  const chart = await listChartOfAccounts();
  const treasuryAccountId = resolveAccountId(chart, journalAccountName)
    || resolveAccountId(chart, 'Caja General');
  if (!treasuryAccountId) {
    throw new Error('No se encontró la cuenta de tesorería para el nuevo medio.');
  }

  const entry = await unwrap(
    sb().from('journal_entries').select('*').eq('id', entryId).maybeSingle(),
    'No se encontró el asiento',
  );
  if (!entry) return { journalEntryId: entryId, updatedLines: 0, updatedMovements: 0 };

  const nextConcept = rewriteDuesCobroConcept(entry.concept, methodLabel);
  if (nextConcept && nextConcept !== entry.concept) {
    await unwrap(
      sb().from('journal_entries').update({
        concept: nextConcept,
        updated_at: new Date().toISOString(),
      }).eq('id', entryId),
      'No se pudo actualizar el concepto del asiento',
    );
  }

  const lines = await unwrap(
    sb().from('journal_lines').select('*').eq('journal_entry_id', entryId),
    'No se pudieron leer las líneas del asiento',
  );
  const treasuryIds = new Set(
    (chart || [])
      .filter((acc) => acc?.isCashAccount || /caja|banco|mercado/i.test(String(acc?.name || '')))
      .map((acc) => acc.id),
  );
  let updatedLines = 0;
  for (const line of lines || []) {
    const debit = Number(line.debit) || 0;
    if (!(debit > 0)) continue;
    if (treasuryIds.size && !treasuryIds.has(line.account_id)) continue;
    if (line.account_id === treasuryAccountId) continue;
    await unwrap(
      sb().from('journal_lines').update({ account_id: treasuryAccountId }).eq('id', line.id),
      'No se pudo actualizar la cuenta del asiento',
    );
    updatedLines += 1;
  }

  const movements = await unwrap(
    sb().from('cash_movements').select('*').eq('journal_entry_id', entryId),
    'No se pudieron leer movimientos de caja',
  );
  let updatedMovements = 0;
  for (const move of movements || []) {
    const patch = {
      related_account_id: treasuryAccountId,
    };
    const nextMoveConcept = rewriteDuesCobroConcept(move.concept, methodLabel);
    if (nextMoveConcept && nextMoveConcept !== move.concept) {
      patch.concept = nextMoveConcept;
    }
    await unwrap(
      sb().from('cash_movements').update(patch).eq('id', move.id),
      'No se pudo actualizar el movimiento de caja',
    );
    updatedMovements += 1;
  }

  await audit('update_method_accounting', 'journal_entries', entryId, {
    paymentId: payId,
    methodLabel,
    journalAccountName,
    updatedLines,
    updatedMovements,
    by: actorName || null,
  });

  if (payId && !journalEntryId) {
    try {
      await unwrap(
        sb().from('member_payments').update({ journal_entry_id: entryId }).eq('id', payId),
        'No se pudo vincular el asiento al cobro',
      );
    } catch {
      /* best-effort */
    }
  }

  return {
    journalEntryId: entryId,
    updatedLines,
    updatedMovements,
    concept: nextConcept,
    journalAccountName: journalAccountName || null,
    treasuryAccountId,
  };
}

export async function insertCashMovement(movement) {
  const row = {
    cash_session_id: movement.cashSessionId,
    movement_type: movement.movementType,
    amount: Number(movement.amount) || 0,
    concept: movement.concept || null,
    related_account_id: movement.relatedAccountId || null,
    member_id: movement.memberDbId || null,
    journal_entry_id: movement.journalEntryId || null,
    created_by: movement.createdBy || null,
  };
  const saved = await unwrap(sb().from('cash_movements').insert(row).select().single());
  return M.cashMovementFromRow(saved);
}

export async function listExpenses() {
  const rows = await unwrap(
    sb().from('expenses').select('*').order('expense_date', { ascending: false })
  );
  return (rows || []).map(M.expenseFromRow);
}

export async function upsertExpense(expense) {
  const row = {
    expense_date: expense.date || todayAR(),
    vendor_name: expense.vendorName || null,
    category_account_id: expense.categoryAccountId,
    payment_account_id: expense.paymentAccountId || null,
    amount: Number(expense.amount) || 0,
    concept: expense.concept || 'Gasto',
    invoice_number: expense.invoiceNumber || null,
    status: expense.status || 'draft',
    rejection_reason: expense.rejectionReason || null,
    journal_entry_id: expense.journalEntryId || null,
    cash_session_id: expense.cashSessionId || null,
    supplier_id: isUuid(expense.supplierId) ? expense.supplierId : null,
    meta: {
      ...(expense.meta && typeof expense.meta === 'object' ? expense.meta : {}),
      ivaAliquotId: expense.ivaAliquotId || '',
      fiscalCondition: expense.fiscalCondition || '',
    },
  };
  if (expense.id && String(expense.id).includes('-')) {
    const saved = await unwrap(sb().from('expenses').update(row).eq('id', expense.id).select().single());
    return M.expenseFromRow(saved);
  }
  const saved = await unwrap(sb().from('expenses').insert(row).select().single());
  return M.expenseFromRow(saved);
}
