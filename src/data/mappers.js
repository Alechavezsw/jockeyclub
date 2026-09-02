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
    notes: row.notes || '',
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
    joined_at: member.joinDate || '1900-01-01',
    emergency_contact: member.emergencyContact || null,
    emergency_phone: member.emergencyPhone || null,
    payment_method: member.paymentMethod || null,
    billing_name: member.billingName || null,
    cuit_cuil: member.cuitCuil || null,
    tax_condition: member.taxCondition || null,
    disciplines: member.disciplines || [],
    tier: member.tier || 'socio_individual',
    status: member.status || 'active',
    outstanding_balance: Number(member.outstandingBalance) || 0,
    years_active: Number(member.yearsActive) || 0,
    next_due_date: member.nextDueDate || null,
    overdue_since: member.overdueSince || null,
    photo_url: member.photo || null,
    card_number: member.cardNumber || null,
    notes: member.notes || null,
    profile_id: member.profileId || null,
    meta: {
      ...(member.meta && typeof member.meta === 'object' ? member.meta : {}),
      ...(member.joinTime ? { joinTime: member.joinTime } : {}),
      ...(member.bloodType ? { bloodType: member.bloodType } : {}),
      ...(member.healthInsurance ? { healthInsurance: member.healthInsurance } : {}),
      ...(member.emergencyClinic ? { emergencyClinic: member.emergencyClinic } : {}),
      ...(Array.isArray(member.documents) ? { documents: member.documents } : {}),
    },
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
    endTime: meta.endTime || null,
    guests: row.guests || 0,
    guestNames: meta.guestNames || '',
    status: row.status || 'confirmed',
    notes: row.notes || '',
    estimatedPrice: meta.estimatedPrice ?? null,
    chargedPrice: meta.chargedPrice ?? null,
    paymentMethod: meta.paymentMethod || null,
    externalId: meta.externalId || null,
    source: meta.source || null,
    createdAt: meta.createdAt || row.created_at || null,
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
      endTime: res.endTime || null,
      estimatedPrice: res.estimatedPrice ?? null,
      chargedPrice: res.chargedPrice ?? null,
      paymentMethod: res.paymentMethod || null,
      externalId: res.externalId || null,
      source: res.source || null,
      createdAt: res.createdAt || null,
      document: res.document || null,
      mpTransactionId: res.mpTransactionId || null,
      voucher: res.voucher || null,
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

export function membershipApplicationFromRow(row) {
  const meta = row.meta || {};
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email || '',
    phone: row.phone || '',
    documentType: row.document_type || '',
    documentNumber: row.document_number || '',
    birthDate: row.birth_date || '',
    address: row.address || '',
    city: row.city || '',
    province: row.province || '',
    notes: row.notes || '',
    requestedTier: row.requested_tier || '',
    status: row.status || 'pending',
    profileId: row.profile_id || null,
    memberId: row.member_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...meta,
  };
}

export function membershipApplicationToRow(app) {
  return {
    full_name: app.fullName,
    email: app.email || null,
    phone: app.phone || null,
    document_type: app.documentType || null,
    document_number: app.documentNumber || null,
    birth_date: app.birthDate || null,
    address: app.address || null,
    city: app.city || null,
    province: app.province || null,
    notes: app.notes || null,
    requested_tier: app.requestedTier || null,
    status: app.status || 'pending',
    profile_id: app.profileId || null,
    member_id: app.memberId || null,
    reviewed_by: app.reviewedBy || null,
    reviewed_at: app.reviewedAt || null,
    meta: app.meta && typeof app.meta === 'object' ? app.meta : {},
  };
}

export function profileFromRow(row) {
  const authorizations = Array.isArray(row.profile_authorizations)
    ? row.profile_authorizations.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      roleLabel: a.role_label || '',
      expiresAt: a.expires_at || '',
      pin: a.pin || '',
    }))
    : [];
  const identifiers = Array.isArray(row.profile_identifiers)
    ? row.profile_identifiers.map((i) => ({
      id: i.id,
      idType: i.id_type,
      identifier: i.identifier,
    }))
    : [];
  const roles = Array.isArray(row.profile_roles)
    ? row.profile_roles
      .filter((r) => !r.revoked_at)
      .map((r) => ({
        id: r.id,
        publicId: r.public_id || null,
        roleKey: r.role_key,
        label: r.label,
        kind: r.kind || (roleRank(r.role_key) > 0 ? 'system' : 'title'),
        createdAt: r.created_at,
      }))
    : [];
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const username = meta.username
    || (row.email ? String(row.email).split('@')[0] : '')
    || '';
  return {
    id: row.id,
    email: row.email || '',
    username,
    contactEmail: meta.contactEmail || '',
    fullName: row.full_name || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    phone: row.phone || '',
    avatarUrl: row.avatar_url || '',
    documentType: row.document_type || 'Arg-DNI',
    documentNumber: row.document_number || '',
    gender: row.gender || '',
    birthDate: row.birth_date || '',
    bloodType: row.blood_type || '',
    healthInsurance: row.health_insurance || '',
    emergencyPhone: row.emergency_phone || '',
    emergencyClinic: row.emergency_clinic || '',
    address: row.address || '',
    prismaId: row.prisma_id || '',
    role: row.role || 'member',
    roles,
    disciplineIds: Array.isArray(row.discipline_ids)
      ? row.discipline_ids.map(String)
      : (Array.isArray(meta.disciplineIds) ? meta.disciplineIds.map(String) : []),
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorizations,
    identifiers,
    meta,
  };
}

function roleRank(roleKey) {
  const map = {
    superadmin: 60,
    admin: 50,
    accountant: 40,
    cashier: 30,
    staff: 20,
    teacher: 15,
    member: 10,
  };
  return map[String(roleKey || '').toLowerCase()] || 0;
}

export function surveyFromRow(row) {
  const meta = row.meta || {};
  const options = Array.isArray(meta.options)
    ? meta.options
    : Array.isArray(row.questions)
      ? row.questions
      : [];
  const status = row.status || 'draft';
  const active =
    typeof meta.active === 'boolean'
      ? meta.active
      : status === 'open' || status === 'published';
  return {
    id: row.id,
    title: row.title,
    question: meta.question || row.title || '',
    description: row.description || meta.description || '',
    category: meta.category || '',
    status,
    active,
    votedBy: Array.isArray(meta.votedBy) ? meta.votedBy : [],
    options: options.map((opt, idx) => ({
      id: opt.id ?? idx + 1,
      text: opt.text || opt.label || String(opt),
      votes: Number(opt.votes) || 0,
    })),
    questions: row.questions || options,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
  };
}

export function newsFromRow(row) {
  const meta = row.meta || {};
  const status = meta.status
    || (row.is_published === false ? 'draft' : 'published');
  return {
    id: row.id,
    title: row.title,
    slug: meta.slug || '',
    category: row.category || '',
    date: meta.dateLabel || row.event_date || (row.created_at || '').slice(0, 10),
    excerpt: row.summary || '',
    content: row.body || '',
    image: row.image_url || meta.image || '',
    gallery: Array.isArray(meta.gallery) ? meta.gallery : [],
    isEvent: Boolean(meta.isEvent ?? meta.allowRsvp),
    allowRsvp: Boolean(meta.allowRsvp ?? meta.isEvent),
    isPublished: row.is_published !== false && status === 'published',
    status,
    author: meta.author || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    featured: Boolean(meta.featured),
    pinned: Boolean(meta.pinned),
    scheduledAt: meta.scheduledAt || '',
    eventDate: row.event_date || meta.eventDate || null,
    seoTitle: meta.seoTitle || '',
    seoDescription: meta.seoDescription || '',
    coverCredit: meta.coverCredit || '',
    updatedAt: row.updated_at || meta.updatedAt || null,
    createdAt: row.created_at || meta.createdAt || null,
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
    concessionaireNumber: meta.concessionaireNumber || '',
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
    meta,
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
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  const legalName = row.name || meta.legalName || '';
  return {
    id: row.id,
    name: legalName,
    legalName,
    tradeName: meta.tradeName || '',
    cuit: row.cuit || '',
    category: row.category || meta.category || 'general',
    email: row.email || '',
    phone: row.phone || '',
    address: meta.address || '',
    payableAccountId: meta.payableAccountId || 'coa-2.1.01',
    status: row.status || 'active',
    notes: row.notes || '',
    accessinCode: meta.accessinCode || '',
    openingBalance: Number(meta.openingBalance) || 0,
    createdAt: row.created_at || meta.createdAt || null,
    updatedAt: row.updated_at || null,
    meta,
  };
}

export function retencionFromRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    lineNumber: row.line_number != null ? Number(row.line_number) : (meta.lineNumber || null),
    clientName: row.client_name || meta.clientName || '',
    supplierName: row.supplier_name || meta.supplierName || '',
    paymentOrderNumber: row.payment_order_number || meta.paymentOrderNumber || '',
    paymentOrderAmount: Number(row.payment_order_amount) || 0,
    retentionType: row.retention_type || meta.retentionType || '',
    retentionDate: row.retention_date || meta.retentionDate || '',
    retentionAmount: Number(row.retention_amount) || 0,
    status: row.status || 'recorded',
    notes: row.notes || meta.notes || '',
    source: meta.source || 'accessin',
    asOf: meta.asOf || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    meta,
  };
}

export function supplierPaymentImportFromRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    importedAt: row.imported_at || meta.importedAt || row.created_at || null,
    module: row.module || meta.module || 'excel_manual',
    moduleLabel: meta.moduleLabel || '',
    status: row.status || 'completed',
    importedCount: Number(row.imported_count) || 0,
    totalAmount: Number(row.total_amount) || 0,
    fileName: row.file_name || meta.fileName || '',
    errorCount: Number(row.error_count) || 0,
    errors: Array.isArray(meta.errors) ? meta.errors : [],
    paymentIds: Array.isArray(meta.paymentIds) ? meta.paymentIds : [],
    createdAt: row.created_at || null,
    meta,
  };
}

export function expenseImportFromRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    importedAt: row.imported_at || meta.importedAt || row.created_at || null,
    module: row.module || meta.module || 'excel_manual_invoice',
    moduleLabel: meta.moduleLabel || '',
    status: row.status || 'completed',
    importedCount: Number(row.imported_count) || 0,
    totalAmount: Number(row.total_amount) || 0,
    fileName: row.file_name || meta.fileName || '',
    errorCount: Number(row.error_count) || 0,
    errors: Array.isArray(meta.errors) ? meta.errors : [],
    expenseIds: Array.isArray(meta.expenseIds) ? meta.expenseIds : [],
    createdAt: row.created_at || null,
    meta,
  };
}

export function supplierEntryFromRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    type: row.entry_type || meta.type || 'otros',
    typeLabel: meta.typeLabel || row.entry_type || 'Otros',
    effect: meta.effect || 'debit',
    supplierId: row.supplier_id || meta.supplierId || null,
    supplierName: row.supplier_name || meta.supplierName || '',
    accessinCode: meta.accessinCode || '',
    date: row.entry_date || meta.date || null,
    amount: Number(row.amount) || 0,
    balanceDelta: Number(meta.balanceDelta) || 0,
    concept: row.concept || meta.concept || '',
    invoiceNumber: row.invoice_number || meta.invoiceNumber || '',
    notes: row.notes || meta.notes || '',
    status: row.status || meta.status || 'posted',
    paymentOrderId: meta.paymentOrderId || null,
    createdAt: row.created_at || meta.createdAt || null,
    meta,
  };
}

export function otherIncomeFromRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    date: row.income_date || meta.date || null,
    payerType: row.payer_type || meta.payerType || 'manual',
    payerTypeLabel: meta.payerTypeLabel || '',
    payerName: row.payer_name || meta.payerName || '',
    concept: row.concept || meta.concept || '',
    group: row.income_group || meta.group || 'uncategorized',
    groupLabel: meta.groupLabel || '',
    paymentMethod: row.payment_method || meta.paymentMethod || 'efectivo',
    paymentMethodLabel: meta.paymentMethodLabel || '',
    amount: Number(row.amount) || 0,
    lines: Array.isArray(meta.lines) ? meta.lines : [],
    documentId: meta.documentId || '',
    address: meta.address || '',
    contact: meta.contact || '',
    operationRef: meta.operationRef || '',
    notes: row.notes || meta.notes || '',
    signatureLegend: meta.signatureLegend || '',
    attachments: Array.isArray(meta.attachments) ? meta.attachments : [],
    status: row.status || meta.status || 'posted',
    createdAt: row.created_at || meta.createdAt || null,
    meta,
  };
}

export function jsonRowFromUi(ui, fieldMap) {
  const out = {};
  Object.entries(fieldMap).forEach(([uiKey, dbKey]) => {
    if (ui[uiKey] !== undefined) out[dbKey] = ui[uiKey];
  });
  return out;
}
