import * as M from '../mappers';
import { unwrap } from '../errors';
import { createDiscount, discountFromRule } from '../../domain/accounting/discounts';
import { todayAR } from '../../lib/arDate';
import { isUuid, sb, audit } from './shared.js';

// ---- Concessions / Treasury ----
export async function listConcessions() {
  const rows = await unwrap(sb().from('concessions').select('*').order('name'));
  return (rows || []).map(M.concessionFromRow);
}

/** Portal público: una concesión por código, sin listar el resto. */
export async function getConcessionPortalByCode(code) {
  const raw = String(code || '').trim();
  if (raw.length < 6) return null;
  const data = await unwrap(
    sb().rpc('concession_portal_by_code', { p_code: raw }),
    'No se pudo abrir el portal del concesionario'
  );
  if (!data?.concession) return null;
  return {
    concession: M.concessionFromRow(data.concession),
    payments: (data.payments || []).map(M.canonPaymentFromRow),
  };
}

export async function upsertConcession(c) {
  const row = {
    space_id: c.spaceId || null,
    name: c.name,
    concession_type: c.type || c.concessionType || 'otro',
    status: c.statusManual || c.status || 'active',
    holder_name: c.concessionaire || c.holderName || null,
    holder_cuit: c.cuit || c.holderCuit || null,
    holder_email: c.contactEmail || c.holderEmail || null,
    holder_phone: c.contactPhone || c.holderPhone || null,
    start_date: c.startDate || null,
    end_date: c.endDate || null,
    monthly_canon: Number(c.monthlyFee ?? c.monthlyCanon) || 0,
    portal_code: c.portalCode || null,
    checklist: c.checklist && typeof c.checklist === 'object' ? c.checklist : {},
    documents: Array.isArray(c.documents) ? c.documents : [],
    renewal_history: Array.isArray(c.renewalHistory) ? c.renewalHistory : [],
    notes: c.notes || null,
    meta: {
      ...(c.meta || {}),
      contactName: c.contactName || '',
      location: c.location || '',
      noticeDays: c.noticeDays ?? 30,
      revenueSharePct: c.revenueSharePct ?? 0,
      deposit: c.deposit ?? 0,
      autoRenew: Boolean(c.autoRenew),
      incomeAccountId: c.incomeAccountId || 'coa-4.1.04',
      concessionaire: c.concessionaire || c.holderName || '',
      concessionaireNumber: c.concessionaireNumber || '',
      cuit: c.cuit || c.holderCuit || '',
    },
  };

  if (isUuid(c.id)) {
    const saved = await unwrap(
      sb().from('concessions').update(row).eq('id', c.id).select().single(),
      'No se pudo actualizar la concesión'
    );
    await audit('upsert', 'concessions', saved.id, { name: saved.name });
    return M.concessionFromRow(saved);
  }

  const saved = await unwrap(
    sb().from('concessions').insert(row).select().single(),
    'No se pudo crear la concesión'
  );
  await audit('create', 'concessions', saved.id, { name: saved.name });
  return M.concessionFromRow(saved);
}

export async function listCanonPayments() {
  const rows = await unwrap(
    sb().from('canon_payments').select('*').order('paid_at', { ascending: false })
  );
  return (rows || []).map(M.canonPaymentFromRow);
}

export async function insertCanonPayment(p) {
  const row = {
    concession_id: p.concessionId,
    period_label: p.period || null,
    amount: Number(p.amount) || 0,
    paid_at: p.date || todayAR(),
    method: p.method || null,
    concept: p.concept || null,
    journal_entry_id: p.journalEntryId || null,
  };
  const saved = await unwrap(sb().from('canon_payments').insert(row).select().single());
  return M.canonPaymentFromRow(saved);
}

export async function listSuppliers() {
  const rows = await unwrap(sb().from('suppliers').select('*').order('name'));
  return (rows || [])
    .map(M.supplierFromRow)
    .toSorted((a, b) => {
      const ca = Number(a.accessinCode) || 0;
      const cb = Number(b.accessinCode) || 0;
      if (ca !== cb) return ca - cb;
      return String(a.legalName || a.name || '').localeCompare(String(b.legalName || b.name || ''), 'es');
    });
}

export async function upsertSupplier(s) {
  const legalName = String(s.legalName || s.name || '').trim();
  if (!legalName) throw new Error('La razón social es obligatoria.');
  const prevMeta = s.meta && typeof s.meta === 'object' ? s.meta : {};
  const row = {
    name: legalName,
    cuit: s.cuit || null,
    category: s.category || null,
    email: s.email || null,
    phone: s.phone || null,
    status: s.status || 'active',
    notes: s.notes || null,
    meta: {
      ...prevMeta,
      legalName,
      tradeName: s.tradeName || prevMeta.tradeName || '',
      address: s.address || prevMeta.address || '',
      payableAccountId: s.payableAccountId || prevMeta.payableAccountId || 'coa-2.1.01',
      accessinCode: s.accessinCode || prevMeta.accessinCode || '',
      openingBalance: s.openingBalance != null ? Number(s.openingBalance) || 0 : (prevMeta.openingBalance || 0),
      asOf: s.asOf || prevMeta.asOf || '2026-09-26',
      source: prevMeta.source || (s.accessinCode ? 'accessin' : undefined),
    },
  };
  if (isUuid(s.id)) {
    const saved = await unwrap(sb().from('suppliers').update(row).eq('id', s.id).select().single());
    return M.supplierFromRow(saved);
  }
  const saved = await unwrap(sb().from('suppliers').insert(row).select().single());
  return M.supplierFromRow(saved);
}

export async function listRetenciones() {
  const rows = await unwrap(
    sb().from('retenciones').select('*').order('retention_date', { ascending: false })
  );
  return (rows || []).map(M.retencionFromRow);
}

export async function upsertRetencion(item) {
  const prevMeta = item.meta && typeof item.meta === 'object' ? item.meta : {};
  const row = {
    line_number: item.lineNumber != null ? Number(item.lineNumber) || null : null,
    client_name: item.clientName || null,
    supplier_name: item.supplierName || null,
    payment_order_number: item.paymentOrderNumber || null,
    payment_order_amount: Number(item.paymentOrderAmount) || 0,
    retention_type: item.retentionType || null,
    retention_date: item.retentionDate || null,
    retention_amount: Number(item.retentionAmount) || 0,
    status: item.status || 'recorded',
    notes: item.notes || null,
    meta: {
      ...prevMeta,
      source: item.source || prevMeta.source || 'manual',
      asOf: item.asOf || prevMeta.asOf || '',
      notes: item.notes || prevMeta.notes || '',
    },
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(sb().from('retenciones').update(row).eq('id', item.id).select().single());
    return M.retencionFromRow(saved);
  }
  const saved = await unwrap(sb().from('retenciones').insert(row).select().single());
  return M.retencionFromRow(saved);
}

export async function listFiscalDocuments() {
  const rows = await unwrap(
    sb().from('fiscal_documents').select('*').order('doc_date', { ascending: false })
  );
  return (rows || []).map((row) => ({
    ...(row.payload || {}),
    id: row.client_key || row.payload?.id,
    docKind: row.doc_kind || row.payload?.docKind,
    status: row.status || row.payload?.status,
    date: row.doc_date || row.payload?.date || null,
    period: row.period || row.payload?.period || '',
  }));
}

export async function upsertFiscalDocument(item) {
  const row = {
    client_key: item.id,
    doc_kind: item.docKind || 'comprobante',
    status: item.status || 'recorded',
    doc_date: item.date || null,
    period: item.period || null,
    payload: item,
    updated_at: new Date().toISOString(),
  };
  const saved = await unwrap(
    sb().from('fiscal_documents').upsert(row, { onConflict: 'client_key' }).select().single()
  );
  return saved?.payload ? { ...saved.payload, id: saved.client_key || item.id } : item;
}

export async function listSupplierPaymentImports() {
  const rows = await unwrap(
    sb().from('supplier_payment_imports').select('*').order('imported_at', { ascending: false })
  );
  return (rows || []).map(M.supplierPaymentImportFromRow);
}

export async function upsertSupplierPaymentImport(batch) {
  const prevMeta = batch.meta && typeof batch.meta === 'object' ? batch.meta : {};
  const row = {
    imported_at: batch.importedAt || new Date().toISOString(),
    module: batch.module || 'excel_manual',
    status: batch.status || 'completed',
    imported_count: Number(batch.importedCount) || 0,
    total_amount: Number(batch.totalAmount) || 0,
    file_name: batch.fileName || null,
    error_count: Number(batch.errorCount) || 0,
    meta: {
      ...prevMeta,
      moduleLabel: batch.moduleLabel || prevMeta.moduleLabel || '',
      errors: batch.errors || prevMeta.errors || [],
      paymentIds: batch.paymentIds || prevMeta.paymentIds || [],
      fileName: batch.fileName || prevMeta.fileName || '',
    },
  };
  if (isUuid(batch.id)) {
    const saved = await unwrap(
      sb().from('supplier_payment_imports').update(row).eq('id', batch.id).select().single()
    );
    return M.supplierPaymentImportFromRow(saved);
  }
  const saved = await unwrap(sb().from('supplier_payment_imports').insert(row).select().single());
  return M.supplierPaymentImportFromRow(saved);
}

export async function listExpenseImports() {
  const rows = await unwrap(
    sb().from('expense_imports').select('*').order('imported_at', { ascending: false })
  );
  return (rows || []).map(M.expenseImportFromRow);
}

export async function upsertExpenseImport(batch) {
  const prevMeta = batch.meta && typeof batch.meta === 'object' ? batch.meta : {};
  const row = {
    imported_at: batch.importedAt || new Date().toISOString(),
    module: batch.module || 'excel_manual_invoice',
    status: batch.status || 'completed',
    imported_count: Number(batch.importedCount) || 0,
    total_amount: Number(batch.totalAmount) || 0,
    file_name: batch.fileName || null,
    error_count: Number(batch.errorCount) || 0,
    meta: {
      ...prevMeta,
      moduleLabel: batch.moduleLabel || prevMeta.moduleLabel || '',
      errors: batch.errors || prevMeta.errors || [],
      expenseIds: batch.expenseIds || prevMeta.expenseIds || [],
      fileName: batch.fileName || prevMeta.fileName || '',
    },
  };
  if (isUuid(batch.id)) {
    const saved = await unwrap(
      sb().from('expense_imports').update(row).eq('id', batch.id).select().single()
    );
    return M.expenseImportFromRow(saved);
  }
  const saved = await unwrap(sb().from('expense_imports').insert(row).select().single());
  return M.expenseImportFromRow(saved);
}

export async function listSupplierEntries() {
  const rows = await unwrap(
    sb().from('supplier_entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })
  );
  return (rows || []).map(M.supplierEntryFromRow);
}

export async function upsertSupplierEntry(entry) {
  const prevMeta = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
  const row = {
    entry_type: entry.type || 'otros',
    supplier_id: isUuid(entry.supplierId) ? entry.supplierId : null,
    supplier_name: entry.supplierName || '',
    entry_date: entry.date || todayAR(),
    amount: Number(entry.amount) || 0,
    concept: entry.concept || '',
    invoice_number: entry.invoiceNumber || null,
    notes: entry.notes || null,
    status: entry.status || 'posted',
    meta: {
      ...prevMeta,
      type: entry.type,
      typeLabel: entry.typeLabel,
      effect: entry.effect,
      supplierId: entry.supplierId,
      supplierName: entry.supplierName,
      accessinCode: entry.accessinCode || '',
      balanceDelta: entry.balanceDelta,
      invoiceNumber: entry.invoiceNumber || '',
      notes: entry.notes || '',
      expenseCategory: entry.expenseCategory || '',
      paymentMethod: entry.paymentMethod || '',
      paymentOrderId: entry.paymentOrderId || null,
      createdAt: entry.createdAt || null,
    },
  };
  if (isUuid(entry.id)) {
    const saved = await unwrap(
      sb().from('supplier_entries').update(row).eq('id', entry.id).select().single()
    );
    return M.supplierEntryFromRow(saved);
  }
  const saved = await unwrap(sb().from('supplier_entries').insert(row).select().single());
  return M.supplierEntryFromRow(saved);
}

export async function listOtherIncomes() {
  const rows = await unwrap(
    sb().from('other_incomes').select('*').order('income_date', { ascending: false }).order('created_at', { ascending: false })
  );
  return (rows || []).map(M.otherIncomeFromRow);
}

export async function upsertOtherIncome(item) {
  const prevMeta = item.meta && typeof item.meta === 'object' ? item.meta : {};
  const row = {
    income_date: item.date || todayAR(),
    payer_type: item.payerType || 'manual',
    payer_name: item.payerName || '',
    concept: item.concept || '',
    income_group: item.group || 'uncategorized',
    payment_method: item.paymentMethod || 'efectivo',
    amount: Number(item.amount) || 0,
    notes: item.notes || null,
    status: item.status || 'posted',
    meta: {
      ...prevMeta,
      payerType: item.payerType,
      payerTypeLabel: item.payerTypeLabel,
      payerName: item.payerName,
      group: item.group,
      groupLabel: item.groupLabel,
      paymentMethod: item.paymentMethod,
      paymentMethodLabel: item.paymentMethodLabel,
      lines: item.lines || [],
      documentId: item.documentId || '',
      address: item.address || '',
      contact: item.contact || '',
      operationRef: item.operationRef || '',
      notes: item.notes || '',
      renderedBy: item.renderedBy || '',
      renderedById: item.renderedById || '',
      bookNumber: item.bookNumber || '',
      signatureLegend: item.signatureLegend || '',
      attachments: item.attachments || [],
      createdAt: item.createdAt || null,
    },
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(
      sb().from('other_incomes').update(row).eq('id', item.id).select().single()
    );
    return M.otherIncomeFromRow(saved);
  }
  const saved = await unwrap(sb().from('other_incomes').insert(row).select().single());
  return M.otherIncomeFromRow(saved);
}

async function listJsonTable(table, mapFn) {
  const rows = await unwrap(sb().from(table).select('*').order('created_at', { ascending: false }));
  return (rows || []).map(mapFn);
}

function metaOf(row) {
  return row?.meta && typeof row.meta === 'object' ? row.meta : {};
}

export async function listUnidentifiedCollections() {
  return listJsonTable('unidentified_collections', (r) => {
    const meta = metaOf(r);
    return {
      id: r.id,
      amount: Number(r.amount) || 0,
      date: r.received_on || meta.date || null,
      bankRef: meta.bankRef || r.reference || '',
      originLabel: meta.originLabel || 'Cobranza bancaria',
      note: r.notes || meta.note || '',
      status: r.status || 'pending',
      matchedMemberId: meta.matchedMemberId || r.member_id || null,
      matchedAt: meta.matchedAt || null,
      rejectedAt: meta.rejectedAt || null,
      createdAt: r.created_at || meta.createdAt || null,
      journalEntryId: meta.journalEntryId || null,
    };
  });
}

export async function upsertUnidentifiedCollection(item) {
  const meta = {
    bankRef: item.bankRef || null,
    originLabel: item.originLabel || null,
    note: item.note || null,
    matchedMemberId: item.matchedMemberId || null,
    matchedAt: item.matchedAt || null,
    rejectedAt: item.rejectedAt || null,
    createdAt: item.createdAt || null,
    journalEntryId: item.journalEntryId || null,
  };
  const row = {
    amount: Number(item.amount) || 0,
    received_on: item.date || todayAR(),
    reference: item.bankRef || item.reference || null,
    status: item.status || 'pending',
    notes: item.note || null,
    member_id: isUuid(item.matchedMemberId) ? item.matchedMemberId : null,
    meta,
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(
      sb().from('unidentified_collections').update(row).eq('id', item.id).select().single()
    );
    return (await listUnidentifiedCollections()).find((x) => x.id === saved.id)
      || { ...item, id: saved.id };
  }
  const saved = await unwrap(sb().from('unidentified_collections').insert(row).select().single());
  const mapped = (await listUnidentifiedCollections()).find((x) => x.id === saved.id);
  await audit('upsert', 'unidentified_collection', saved.id, { amount: row.amount, status: row.status });
  return mapped || { ...item, id: saved.id };
}

export async function listGaliciaDebits() {
  return listJsonTable('galicia_debits', (r) => {
    const meta = metaOf(r);
    return {
      id: r.id,
      period: meta.period || (r.debit_date ? String(r.debit_date).slice(0, 7) : null),
      memberId: r.member_number || meta.memberId || '',
      memberName: r.member_name || meta.memberName || '',
      cbuMask: meta.cbuMask || '****0000',
      amount: Number(r.amount) || 0,
      status: r.status || 'scheduled',
      scheduledDate: r.debit_date || meta.scheduledDate || null,
      reference: r.reference || meta.reference || '',
      createdAt: r.created_at || meta.createdAt || null,
      updatedAt: meta.updatedAt || null,
      journalEntryId: meta.journalEntryId || null,
    };
  });
}

export async function upsertGaliciaDebit(item) {
  const meta = {
    period: item.period || null,
    memberId: item.memberId || null,
    memberName: item.memberName || null,
    cbuMask: item.cbuMask || null,
    scheduledDate: item.scheduledDate || null,
    reference: item.reference || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    journalEntryId: item.journalEntryId || null,
  };
  const row = {
    member_number: item.memberId || null,
    member_name: item.memberName || null,
    amount: Number(item.amount) || 0,
    debit_date: item.scheduledDate || null,
    status: item.status || 'scheduled',
    reference: item.reference || null,
    meta,
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(sb().from('galicia_debits').update(row).eq('id', item.id).select().single());
    return (await listGaliciaDebits()).find((x) => x.id === saved.id) || { ...item, id: saved.id };
  }
  const saved = await unwrap(sb().from('galicia_debits').insert(row).select().single());
  await audit('upsert', 'galicia_debit', saved.id, { amount: row.amount, status: row.status });
  return (await listGaliciaDebits()).find((x) => x.id === saved.id) || { ...item, id: saved.id };
}

export async function listFixedExpenses() {
  return listJsonTable('fixed_expenses', (r) => {
    const meta = metaOf(r);
    const active = r.status === 'active' || (r.status !== 'inactive' && meta.active !== false);
    return {
      id: r.id,
      name: r.name,
      vendorName: meta.vendorName || '',
      amount: Number(r.amount) || 0,
      dayOfMonth: meta.dayOfMonth || (r.next_due ? Number(String(r.next_due).slice(8, 10)) : 1),
      accountHint: meta.accountHint || r.account_code || 'Servicios e Insumos',
      cadence: r.cadence || 'monthly',
      nextDue: r.next_due || null,
      accountCode: r.account_code || null,
      status: active ? 'active' : 'inactive',
      active,
    };
  });
}

export async function upsertFixedExpense(item) {
  const active = item.active !== false && item.status !== 'inactive';
  const meta = {
    vendorName: item.vendorName || null,
    dayOfMonth: item.dayOfMonth || null,
    accountHint: item.accountHint || null,
    active,
  };
  const row = {
    name: item.name || 'Gasto fijo',
    amount: Number(item.amount) || 0,
    cadence: item.cadence || 'monthly',
    next_due: item.nextDue || null,
    account_code: item.accountCode || item.accountHint || null,
    status: active ? 'active' : 'inactive',
    meta,
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(sb().from('fixed_expenses').update(row).eq('id', item.id).select().single());
    return (await listFixedExpenses()).find((x) => x.id === saved.id) || { ...item, id: saved.id, active };
  }
  const saved = await unwrap(sb().from('fixed_expenses').insert(row).select().single());
  await audit('upsert', 'fixed_expense', saved.id, { name: row.name });
  return (await listFixedExpenses()).find((x) => x.id === saved.id) || { ...item, id: saved.id, active };
}

export async function listDiscountRules() {
  const rows = await unwrap(
    sb().from('discount_rules').select('*').order('member_name', { ascending: true }),
  );
  return (rows || []).map(discountFromRule).filter(Boolean);
}

function benefitReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 8) {
    throw new Error('Falta el motivo de la bonificación (mínimo 8 caracteres).');
  }
  return reason;
}

export async function upsertDiscountRule(input) {
  const d = createDiscount(input);
  const row = {
    category: d.category,
    member_numbers: (d.memberIds || []).join(', ') || null,
    member_name: d.memberName || null,
    fee_categories: (d.feeCategories || []).join(', ') || null,
    family_group: d.familyGroup || null,
    description: d.description,
    value_type: d.valueType,
    value: d.value,
    valid_from: d.validFrom || null,
    valid_to: d.validTo || null,
    is_active: d.isActive !== false,
    accessin_id: input.accessinId ?? null,
    source: input.source || d.source || 'manual',
    change_reason: benefitReason(input.changeReason),
  };
  if (input.ruleKey) row.rule_key = input.ruleKey;
  if (isUuid(d.id)) {
    const saved = await unwrap(
      sb().from('discount_rules').update(row).eq('id', d.id).select().single(),
    );
    return discountFromRule(saved);
  }
  row.rule_key = input.ruleKey || d.id;
  const saved = await unwrap(sb().from('discount_rules').insert(row).select().single());
  return discountFromRule(saved);
}

export async function deactivateDiscountRule(id, reason) {
  if (!isUuid(id)) return null;
  const saved = await unwrap(
    sb().from('discount_rules').update({
      is_active: false,
      change_reason: benefitReason(reason),
    }).eq('id', id).select().single(),
  );
  return discountFromRule(saved);
}

export async function listFixedDiscounts() {
  return listJsonTable('fixed_discounts', (r) => {
    const meta = metaOf(r);
    const active = r.status === 'active' || (r.status !== 'inactive' && meta.active !== false);
    return {
      id: r.id,
      name: r.name,
      percent: meta.percent != null ? Number(meta.percent) : Number(r.amount) || 0,
      appliesTo: meta.appliesTo || r.member_number || 'general',
      amount: Number(r.amount) || 0,
      memberId: r.member_number || null,
      cadence: r.cadence || 'monthly',
      status: active ? 'active' : 'inactive',
      active,
    };
  });
}

export async function upsertFixedDiscount(item) {
  const active = item.active !== false && item.status !== 'inactive';
  const percent = item.percent != null ? Number(item.percent) : Number(item.amount) || 0;
  const meta = {
    percent,
    appliesTo: item.appliesTo || null,
    active,
  };
  const row = {
    name: item.name || 'Descuento',
    amount: percent,
    member_number: item.memberId || (item.appliesTo && item.appliesTo !== 'general' ? item.appliesTo : null),
    cadence: item.cadence || 'monthly',
    status: active ? 'active' : 'inactive',
    meta,
    change_reason: benefitReason(item.changeReason),
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(sb().from('fixed_discounts').update(row).eq('id', item.id).select().single());
    return (await listFixedDiscounts()).find((x) => x.id === saved.id) || { ...item, id: saved.id, active, percent };
  }
  const saved = await unwrap(sb().from('fixed_discounts').insert(row).select().single());
  return (await listFixedDiscounts()).find((x) => x.id === saved.id) || { ...item, id: saved.id, active, percent };
}

function mapPaymentOrder(r) {
  const meta = metaOf(r);
  const payments = (r.payment_order_payments || []).map((payment) => ({
    id: payment.id,
    lilaPaymentId: payment.lila_payment_id || '',
    memberNumber: payment.member_number || '',
    memberName: payment.member_name || '',
    imputedAmount: Number(payment.imputed_amount) || 0,
    groupAccountId: payment.group_account_id || '',
    lines: (payment.payment_order_lines || [])
      .slice()
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .map((line) => ({
        id: line.id,
        position: Number(line.position) || 0,
        lineType: line.line_type || '',
        debtLabel: line.debt_label || '',
        concept: line.concept || '',
        amount: Number(line.amount) || 0,
      })),
  }));
  return {
    id: r.id,
    orderKind: r.order_kind || 'supplier',
    number: r.lila_number || meta.number || null,
    date: r.ordered_on || meta.date || r.due_date || r.created_at?.slice?.(0, 10) || null,
    memberNumber: r.member_number || '',
    responsible: r.responsible || '',
    payee: r.beneficiary || meta.payee || '',
    beneficiary: r.beneficiary || meta.payee || '',
    concept: r.concept || meta.concept || '',
    amount: Number(r.amount) || 0,
    dueDate: r.due_date || meta.dueDate || null,
    status: r.status || 'draft',
    paymentMethod: r.payment_method || meta.paymentMethod || '',
    supplierId: r.supplier_id || null,
    invoiceNumber: meta.invoiceNumber || '',
    entryId: meta.entryId || null,
    payments,
    balanceApplied: Boolean(r.balance_applied),
    deletedAt: r.deleted_at || null,
    createdAt: r.created_at || meta.createdAt || null,
    updatedAt: meta.updatedAt || null,
    journalEntryId: meta.journalEntryId || null,
  };
}

export async function listPaymentOrders() {
  const rows = await unwrap(sb()
    .from('payment_orders')
    .select('*, payment_order_payments(*, payment_order_lines(*))')
    .is('deleted_at', null)
    .order('ordered_on', { ascending: false }));
  return (rows || []).map(mapPaymentOrder);
}

export async function upsertPaymentOrder(item) {
  const meta = {
    number: item.number || null,
    date: item.date || null,
    payee: item.payee || item.beneficiary || null,
    concept: item.concept || null,
    paymentMethod: item.paymentMethod || null,
    paymentMethodLabel: item.paymentMethodLabel || null,
    dueDate: item.dueDate || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    journalEntryId: item.journalEntryId || null,
    invoiceNumber: item.invoiceNumber || null,
    preparedBy: item.preparedBy || null,
    authorizedBy: item.authorizedBy || null,
    withdrawnBy: item.withdrawnBy || null,
    accessinCode: item.accessinCode || null,
    importSource: item.importSource || null,
    entryId: item.entryId || null,
  };
  const row = {
    beneficiary: item.payee || item.beneficiary || item.responsible || 'Beneficiario',
    amount: Number(item.amount) || 0,
    due_date: item.dueDate || item.date || null,
    status: item.status || 'draft',
    concept: item.concept || null,
    supplier_id: isUuid(item.supplierId) ? item.supplierId : null,
    order_kind: item.orderKind || 'supplier',
    meta,
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(sb().from('payment_orders').update(row).eq('id', item.id).select().single());
    return (await listPaymentOrders()).find((x) => x.id === saved.id) || { ...item, id: saved.id };
  }
  const saved = await unwrap(sb().from('payment_orders').insert(row).select().single());
  await audit('upsert', 'payment_order', saved.id, { amount: row.amount, status: row.status });
  return (await listPaymentOrders()).find((x) => x.id === saved.id) || { ...item, id: saved.id };
}

export async function archivePaymentOrder(id) {
  await unwrap(
    sb().from('payment_orders').update({ deleted_at: new Date().toISOString() }).eq('id', id),
    'No se pudo eliminar la orden de pago',
  );
}

export async function upsertChartAccount(account) {
  const row = {
    code: account.code,
    name: account.name,
    account_type: account.accountType,
    parent_id: isUuid(account.parentId) ? account.parentId : null,
    level: Number(account.level) || 1,
    is_postable: account.isPostable !== false,
    is_cash_account: Boolean(account.isCashAccount),
    is_active: account.isActive !== false,
    description: account.description || null,
  };
  if (isUuid(account.id)) {
    const saved = await unwrap(
      sb().from('chart_of_accounts').update(row).eq('id', account.id).select().single()
    );
    return M.accountFromRow(saved);
  }
  const saved = await unwrap(sb().from('chart_of_accounts').insert(row).select().single());
  await audit('upsert', 'chart_of_accounts', saved.id, { code: row.code });
  return M.accountFromRow(saved);
}

export async function replaceTableRows(table, rows) {
  await sb().from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (!rows?.length) return [];
  const saved = await unwrap(sb().from(table).insert(rows).select());
  return saved || [];
}
