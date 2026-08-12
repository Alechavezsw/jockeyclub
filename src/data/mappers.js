/** Mapeo fila Postgres ↔ shape de UI. */

export function adherentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.full_name,
    relationship: row.relationship,
    tier: row.tier,
    status: row.status,
    outstandingBalance: Number(row.outstanding_balance) || 0,
    disciplines: row.disciplines || [],
  };
}

export function memberFromRow(row, payments = []) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.member_number,
    name: row.full_name,
    phone: row.phone || '',
    phoneAlt: row.phone_alt || '',
    email: row.email || '',
    address: row.address || '',
    city: row.city || '',
    province: row.province || '',
    postalCode: row.postal_code || '',
    documentType: row.document_type || '',
    documentNumber: row.document_number || '',
    birthDate: row.birth_date || '',
    gender: row.gender || '',
    maritalStatus: row.marital_status || '',
    nationality: row.nationality || '',
    joinDate: row.joined_at || '',
    emergencyContact: row.emergency_contact || '',
    emergencyPhone: row.emergency_phone || '',
    paymentMethod: row.payment_method || '',
    billingName: row.billing_name || '',
    cuitCuil: row.cuit_cuil || '',
    taxCondition: row.tax_condition || '',
    disciplines: row.disciplines || [],
    tier: row.tier,
    status: row.status,
    outstandingBalance: Number(row.outstanding_balance) || 0,
    yearsActive: row.years_active || 0,
    nextDueDate: row.next_due_date || null,
    overdueSince: row.overdue_since || null,
    photo: row.photo_url || null,
    cardNumber: row.card_number || null,
    profileId: row.profile_id || null,
    adherents: (row.member_adherents || []).map(adherentFromRow),
    paymentHistory: payments.map(paymentFromRow),
    ...(row.meta || {}),
  };
}

export function memberToRow(member) {
  return {
    member_number: member.memberId,
    full_name: member.name,
    phone: member.phone || null,
    phone_alt: member.phoneAlt || null,
    email: member.email || null,
    address: member.address || null,
    city: member.city || null,
    province: member.province || null,
    postal_code: member.postalCode || null,
    document_type: member.documentType || null,
    document_number: member.documentNumber || null,
    birth_date: member.birthDate || null,
    gender: member.gender || null,
    marital_status: member.maritalStatus || null,
    nationality: member.nationality || null,
    joined_at: member.joinDate || null,
    emergency_contact: member.emergencyContact || null,
    emergency_phone: member.emergencyPhone || null,
    payment_method: member.paymentMethod || null,
    billing_name: member.billingName || null,
    cuit_cuil: member.cuitCuil || null,
    tax_condition: member.taxCondition || null,
    disciplines: member.disciplines || [],
    tier: member.tier || 'gold',
    status: member.status || 'active',
    outstanding_balance: Number(member.outstandingBalance) || 0,
    years_active: Number(member.yearsActive) || 0,
    next_due_date: member.nextDueDate || null,
    overdue_since: member.overdueSince || null,
    photo_url: member.photo || null,
    card_number: member.cardNumber || null,
  };
}

export function paymentFromRow(row) {
  return {
    id: row.id,
    memberDbId: row.member_id,
    amount: Number(row.amount) || 0,
    date: row.paid_at,
    method: row.method || '',
    concept: row.concept || '',
    period: row.period_label || '',
    receiptNumber: row.receipt_number || '',
    journalEntryId: row.journal_entry_id || null,
  };
}

export function reservationFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: meta.facilityName || row.facility_id,
    memberId: row.member_number,
    memberDbId: row.member_id,
    memberName: row.member_name,
    date: row.reservation_date,
    time: row.time_slot,
    guests: row.guests || 0,
    guestNames: meta.guestNames || '',
    status: row.status || 'confirmed',
    notes: row.notes || '',
  };
}

export function reservationToRow(res, memberDbId = null) {
  return {
    facility_id: res.facilityId,
    member_id: memberDbId || res.memberDbId || null,
    member_number: res.memberId || null,
    member_name: res.memberName,
    reservation_date: res.date,
    time_slot: res.time,
    status: res.status || 'confirmed',
    guests: Number(res.guests) || 0,
    notes: res.notes || null,
    meta: {
      facilityName: res.facilityName || '',
      guestNames: res.guestNames || '',
    },
  };
}

export function waitlistFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: meta.facilityName || row.facility_id,
    memberId: row.member_number,
    memberDbId: row.member_id,
    memberName: row.member_name,
    date: row.desired_date,
    time: row.time_slot,
    status: row.status || 'waiting',
    notifiedAt: row.notified_at || null,
  };
}

export function accessLogFromRow(row) {
  const rawTime = String(row.logged_at || '');
  // Postgres time / timetz → "HH:MM:SS" o "HH:MM:SS.mmm"
  const timeMatch = rawTime.match(/(\d{2}:\d{2}:\d{2})/);
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    date: row.logged_on,
    time: timeMatch ? timeMatch[1] : rawTime.slice(0, 8),
    memberName: row.member_name,
    memberId: row.member_number,
    role: row.role_label || '',
    group: meta.group || '',
    activity: meta.activity || '',
    status: row.status,
    notes: row.notes || '',
    source: meta.source || 'access_gate',
  };
}

export function guestPassFromRow(row) {
  return {
    id: row.id,
    hostMemberId: row.host_member_number,
    hostName: row.host_name || '',
    guestName: row.guest_name,
    date: row.pass_date,
    createdAt: row.created_at,
    status: row.status,
    payload: row.payload,
  };
}

export function messageFromRow(row) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    date: (row.created_at || '').slice(0, 10),
    createdAt: row.created_at,
    sender: row.sender_name,
    senderId: row.sender_key,
    recipientId: row.recipient_key,
    subject: row.subject,
    content: row.body,
    isRead: Boolean(row.is_read),
    parentId: row.parent_id,
    clientId: meta.clientId || null,
    meta,
  };
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
}

export function messageToRow(msg) {
  return {
    sender_name: msg.sender,
    sender_key: msg.senderId || null,
    recipient_key: msg.recipientId,
    subject: msg.subject,
    body: msg.content,
    is_read: Boolean(msg.isRead),
    parent_id: isUuid(msg.parentId) ? msg.parentId : null,
    meta: {
      ...(msg.meta || {}),
      clientId: msg.id && !isUuid(msg.id) ? String(msg.id) : undefined,
    },
  };
}

export function claimFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    memberId: row.member_number,
    memberName: row.member_name,
    category: row.category || meta.category || '',
    subject: row.subject,
    description: row.body,
    status: row.status,
    priority: row.priority || 'normal',
    resolution: row.resolution || '',
    date: (row.created_at || '').slice(0, 10),
    createdAt: row.created_at,
    ...meta,
  };
}

export function surveyFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    questions: row.questions || [],
    options: meta.options || row.questions || [],
    ...meta,
  };
}

export function newsFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    title: row.title,
    category: row.category || '',
    date: meta.dateLabel || row.event_date || (row.created_at || '').slice(0, 10),
    excerpt: row.summary || '',
    content: row.body || '',
    image: row.image_url || meta.image || '',
    ...meta,
  };
}

export function accountFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    accountType: row.account_type,
    parentId: row.parent_id,
    level: row.level,
    isPostable: row.is_postable,
    isCashAccount: row.is_cash_account,
    isActive: row.is_active !== false,
    description: row.description || '',
  };
}

export function journalFromRow(entry, lines = []) {
  return {
    id: entry.id,
    date: entry.entry_date,
    concept: entry.concept,
    description: entry.concept,
    reference: entry.reference || '',
    status: entry.status,
    sourceModule: entry.source_module,
    fiscalPeriodId: entry.fiscal_period_id,
    lines: lines.map((l) => ({
      id: l.id,
      accountId: l.account_id,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo || '',
      lineOrder: l.line_order,
    })),
  };
}

export function cashRegisterFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    location: row.location || '',
    accountId: row.account_id,
    isActive: row.is_active !== false,
  };
}

export function cashSessionFromRow(row) {
  return {
    id: row.id,
    cashRegisterId: row.cash_register_id,
    status: row.status,
    openingBalance: Number(row.opening_balance) || 0,
    countedBalance: row.counted_balance != null ? Number(row.counted_balance) : null,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openedBy: row.opened_by,
    closedBy: row.closed_by,
  };
}

export function cashMovementFromRow(row) {
  return {
    id: row.id,
    cashSessionId: row.cash_session_id,
    movementType: row.movement_type,
    amount: Number(row.amount) || 0,
    concept: row.concept || '',
    relatedAccountId: row.related_account_id,
    memberId: row.member_id,
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
  };
}

export function expenseFromRow(row) {
  return {
    id: row.id,
    date: row.expense_date,
    vendorName: row.vendor_name || '',
    categoryAccountId: row.category_account_id,
    paymentAccountId: row.payment_account_id,
    amount: Number(row.amount) || 0,
    concept: row.concept,
    invoiceNumber: row.invoice_number || '',
    status: row.status,
    rejectionReason: row.rejection_reason || '',
    journalEntryId: row.journal_entry_id,
    cashSessionId: row.cash_session_id,
  };
}

export function employeeFromRow(row, activities = []) {
  const meta = row.meta || {};
  return {
    id: row.id,
    employeeNumber: row.employee_number,
    name: row.full_name,
    role: row.role_title,
    department: row.department || '',
    specialty: row.specialty || '',
    status: row.status,
    hireDate: row.hire_date,
    phone: row.phone || '',
    email: row.email || '',
    currentTask: row.current_task || '',
    onDuty: Boolean(row.on_duty),
    attendance: meta.attendance || [],
    documents: meta.documents || [],
    activities,
  };
}

export function hrRecordFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeCode: row.employee_code,
    type: row.record_type,
    title: row.title || '',
    details: row.details || '',
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    amount: row.amount != null ? Number(row.amount) : null,
    status: row.status,
    ...meta,
  };
}

export function alertFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    body: row.body,
    severity: row.severity,
    audience: row.audience,
    source: row.source,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
    requiresAck: row.requires_ack,
    metadata: row.metadata || {},
  };
}

export function clubEventFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    category: row.category,
    description: row.description || '',
    location: row.location || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    ticketPrice: Number(row.ticket_price) || 0,
    status: row.status,
    coverImageUrl: row.cover_image_url,
  };
}

function normalizeChecklist(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

export function concessionFromRow(row) {
  const meta = row.meta || {};
  const monthly = Number(row.monthly_canon) || 0;
  return {
    id: row.id,
    spaceId: row.space_id || meta.spaceId || '',
    name: row.name,
    type: row.concession_type || meta.type || 'otro',
    status: row.status,
    statusManual: row.status || meta.statusManual || 'active',
    // Shape UI (dominio)
    concessionaire: row.holder_name || meta.concessionaire || '',
    cuit: row.holder_cuit || meta.cuit || '',
    contactEmail: row.holder_email || meta.contactEmail || '',
    contactPhone: row.holder_phone || meta.contactPhone || '',
    contactName: meta.contactName || '',
    location: meta.location || '',
    noticeDays: meta.noticeDays ?? 30,
    revenueSharePct: meta.revenueSharePct ?? 0,
    deposit: meta.deposit ?? 0,
    autoRenew: Boolean(meta.autoRenew),
    incomeAccountId: meta.incomeAccountId || 'coa-4.1.04',
    // Compat aliases
    holderName: row.holder_name || '',
    holderCuit: row.holder_cuit || '',
    holderEmail: row.holder_email || '',
    holderPhone: row.holder_phone || '',
    startDate: row.start_date,
    endDate: row.end_date,
    monthlyFee: monthly,
    monthlyCanon: monthly,
    portalCode: row.portal_code || '',
    checklist: normalizeChecklist(row.checklist),
    documents: Array.isArray(row.documents) ? row.documents : [],
    renewalHistory: Array.isArray(row.renewal_history) ? row.renewal_history : [],
    notes: row.notes || '',
  };
}

export function canonPaymentFromRow(row) {
  return {
    id: row.id,
    concessionId: row.concession_id,
    period: row.period_label || '',
    amount: Number(row.amount) || 0,
    date: row.paid_at,
    method: row.method || '',
    concept: row.concept || '',
    journalEntryId: row.journal_entry_id,
  };
}

export function supplierFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    cuit: row.cuit || '',
    category: row.category || '',
    email: row.email || '',
    phone: row.phone || '',
    status: row.status,
    notes: row.notes || '',
  };
}

export function jsonRowFromUi(ui, fieldMap) {
  const out = {};
  Object.entries(fieldMap).forEach(([uiKey, dbKey]) => {
    if (ui[uiKey] !== undefined) out[dbKey] = ui[uiKey];
  });
  return out;
}
