import { supabase } from '../lib/supabase';
import { unwrap } from './errors';
import * as M from './mappers';

const FISCAL_2026 = '11111111-1111-1111-1111-111111111111';

function sb() {
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

async function audit(action, entityType, entityId, payload = {}) {
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

// ---- Members ----
export async function listMembers() {
  const rows = await unwrap(
    sb().from('members').select('*, member_adherents(*)').order('full_name'),
    'No se pudieron cargar socios'
  );
  const payments = await unwrap(
    sb().from('member_payments').select('*').order('paid_at', { ascending: false }),
    'No se pudieron cargar pagos'
  );
  const byMember = {};
  (payments || []).forEach((p) => {
    (byMember[p.member_id] ||= []).push(p);
  });
  return (rows || []).map((r) => M.memberFromRow(r, byMember[r.id] || []));
}

export async function upsertMember(member) {
  const row = M.memberToRow(member);
  let saved;
  if (member.id) {
    saved = await unwrap(
      sb().from('members').update(row).eq('id', member.id).select().single(),
      'No se pudo actualizar socio'
    );
  } else {
    const existing = await unwrap(
      sb().from('members').select('id').eq('member_number', member.memberId).maybeSingle()
    );
    if (existing?.id) {
      saved = await unwrap(
        sb().from('members').update(row).eq('id', existing.id).select().single(),
        'No se pudo actualizar socio'
      );
    } else {
      saved = await unwrap(
        sb().from('members').insert(row).select().single(),
        'No se pudo crear socio'
      );
    }
  }

  if (Array.isArray(member.adherents)) {
    await sb().from('member_adherents').delete().eq('member_id', saved.id);
    if (member.adherents.length) {
      await unwrap(
        sb().from('member_adherents').insert(
          member.adherents.map((a) => ({
            member_id: saved.id,
            full_name: a.name,
            relationship: a.relationship || 'Familiar',
            tier: a.tier || saved.tier,
            status: a.status || 'active',
            outstanding_balance: Number(a.outstandingBalance) || 0,
            disciplines: a.disciplines || [],
          }))
        ),
        'No se pudieron guardar adherentes'
      );
    }
  }
  await audit('upsert', 'members', saved.id, { member_number: saved.member_number });
  const full = await unwrap(
    sb().from('members').select('*, member_adherents(*)').eq('id', saved.id).single()
  );
  return M.memberFromRow(full);
}

export async function insertMemberPayment(memberDbId, payment) {
  const row = {
    member_id: memberDbId,
    amount: Number(payment.amount) || 0,
    paid_at: payment.date || new Date().toISOString().slice(0, 10),
    method: payment.method || null,
    concept: payment.concept || null,
    period_label: payment.period || null,
    receipt_number: payment.receiptNumber || null,
    journal_entry_id: payment.journalEntryId || null,
  };
  const saved = await unwrap(
    sb().from('member_payments').insert(row).select().single(),
    'No se pudo registrar pago'
  );
  await audit('create', 'member_payments', saved.id, row);
  return M.paymentFromRow(saved);
}

// ---- Reservations ----
export async function listReservations() {
  const rows = await unwrap(
    sb().from('reservations').select('*').order('reservation_date', { ascending: false }),
    'No se pudieron cargar reservas'
  );
  return (rows || []).map(M.reservationFromRow);
}

export async function createReservation(res, memberDbId) {
  const saved = await unwrap(
    sb().from('reservations').insert(M.reservationToRow(res, memberDbId)).select().single(),
    'No se pudo crear reserva'
  );
  await audit('create', 'reservations', saved.id);
  return M.reservationFromRow(saved);
}

export async function updateReservation(id, patch) {
  const row = {};
  if (patch.status != null) row.status = patch.status;
  if (patch.date != null) row.reservation_date = patch.date;
  if (patch.time != null) row.time_slot = patch.time;
  if (patch.guests != null) row.guests = patch.guests;
  if (patch.notes != null) row.notes = patch.notes;
  if (patch.guestNames != null || patch.facilityName != null) {
    row.meta = {
      guestNames: patch.guestNames,
      facilityName: patch.facilityName,
    };
  }
  const saved = await unwrap(
    sb().from('reservations').update(row).eq('id', id).select().single(),
    'No se pudo actualizar reserva'
  );
  return M.reservationFromRow(saved);
}

export async function listWaitlist() {
  const rows = await unwrap(
    sb().from('reservation_waitlist').select('*').order('created_at'),
    'No se pudo cargar lista de espera'
  );
  return (rows || []).map(M.waitlistFromRow);
}

export async function upsertWaitlistEntry(entry, memberDbId) {
  const row = {
    facility_id: entry.facilityId,
    member_id: memberDbId || entry.memberDbId || null,
    member_number: entry.memberId,
    member_name: entry.memberName,
    desired_date: entry.date,
    time_slot: entry.time || null,
    status: entry.status || 'waiting',
    notified_at: entry.notifiedAt || null,
    meta: { facilityName: entry.facilityName || '' },
  };
  if (entry.id && String(entry.id).includes('-')) {
    const saved = await unwrap(
      sb().from('reservation_waitlist').update(row).eq('id', entry.id).select().single()
    );
    return M.waitlistFromRow(saved);
  }
  const saved = await unwrap(
    sb().from('reservation_waitlist').insert(row).select().single(),
    'No se pudo agregar a lista de espera'
  );
  return M.waitlistFromRow(saved);
}

export async function replaceWaitlist(entries, memberLookup) {
  await sb().from('reservation_waitlist').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (!entries?.length) return [];
  const rows = entries.map((e) => ({
    facility_id: e.facilityId,
    member_id: memberLookup?.[e.memberId] || e.memberDbId || null,
    member_number: e.memberId,
    member_name: e.memberName,
    desired_date: e.date,
    time_slot: e.time || null,
    status: e.status || 'waiting',
    notified_at: e.notifiedAt || null,
    meta: { facilityName: e.facilityName || '' },
  }));
  const saved = await unwrap(sb().from('reservation_waitlist').insert(rows).select());
  return (saved || []).map(M.waitlistFromRow);
}

// ---- Access ----
export async function listAccessLogs() {
  const rows = await unwrap(
    sb().from('access_logs').select('*').order('created_at', { ascending: false }).limit(500),
    'No se pudieron cargar accesos'
  );
  return (rows || []).map(M.accessLogFromRow);
}

export async function insertAccessLog(log, memberDbId = null) {
  const row = {
    member_id: memberDbId,
    member_number: log.memberId || null,
    member_name: log.memberName || null,
    role_label: log.role || null,
    status: log.status || 'granted',
    notes: log.notes || null,
    logged_on: log.date || new Date().toISOString().slice(0, 10),
    logged_at: log.time || new Date().toLocaleTimeString('es-AR', { hour12: false }),
  };
  const saved = await unwrap(
    sb().from('access_logs').insert(row).select().single(),
    'No se pudo registrar acceso'
  );
  await audit('create', 'access_logs', saved.id, { status: row.status });
  return M.accessLogFromRow(saved);
}

export async function listGuestPasses() {
  const rows = await unwrap(
    sb().from('guest_passes').select('*').order('created_at', { ascending: false }),
    'No se pudieron cargar pases'
  );
  return (rows || []).map(M.guestPassFromRow);
}

export async function upsertGuestPass(pass, hostDbId = null) {
  const row = {
    id: pass.id,
    host_member_id: hostDbId,
    host_member_number: pass.hostMemberId,
    host_name: pass.hostName || null,
    guest_name: pass.guestName,
    pass_date: pass.date,
    status: pass.status || 'active',
    payload: pass.payload,
  };
  const saved = await unwrap(
    sb().from('guest_passes').upsert(row).select().single(),
    'No se pudo guardar pase'
  );
  return M.guestPassFromRow(saved);
}

// ---- Messages / Claims / Surveys / News ----
export async function listMessages() {
  const rows = await unwrap(
    sb().from('messages').select('*').order('created_at', { ascending: false }),
    'No se pudieron cargar mensajes'
  );
  return (rows || []).map(M.messageFromRow);
}

export async function insertMessage(msg) {
  const saved = await unwrap(
    sb().from('messages').insert(M.messageToRow(msg)).select().single(),
    'No se pudo enviar mensaje'
  );
  return M.messageFromRow(saved);
}

export async function updateMessage(id, patch) {
  const row = {};
  if (patch.isRead != null) row.is_read = patch.isRead;
  if (patch.content != null) row.body = patch.content;
  const saved = await unwrap(
    sb().from('messages').update(row).eq('id', id).select().single()
  );
  return M.messageFromRow(saved);
}

export async function listClaims() {
  const rows = await unwrap(
    sb().from('claims').select('*').order('created_at', { ascending: false }),
    'No se pudieron cargar reclamos'
  );
  return (rows || []).map(M.claimFromRow);
}

export async function upsertClaim(claim, memberDbId = null) {
  const row = {
    member_id: memberDbId,
    member_number: claim.memberId || null,
    member_name: claim.memberName || null,
    category: claim.category || null,
    subject: claim.subject || claim.title || 'Reclamo',
    body: claim.description || claim.body || '',
    status: claim.status || 'open',
    priority: claim.priority || 'normal',
    resolution: claim.resolution || null,
    meta: claim.meta || {},
  };
  if (claim.id && String(claim.id).includes('-')) {
    const saved = await unwrap(
      sb().from('claims').update(row).eq('id', claim.id).select().single()
    );
    return M.claimFromRow(saved);
  }
  const saved = await unwrap(
    sb().from('claims').insert(row).select().single(),
    'No se pudo crear reclamo'
  );
  return M.claimFromRow(saved);
}

export async function listSurveys() {
  const rows = await unwrap(sb().from('surveys').select('*').order('created_at', { ascending: false }));
  return (rows || []).map(M.surveyFromRow);
}

export async function upsertSurvey(survey) {
  const row = {
    title: survey.title,
    description: survey.description || null,
    status: survey.status || 'draft',
    questions: survey.questions || survey.options || [],
    meta: { options: survey.options || survey.questions || [] },
  };
  if (survey.id && String(survey.id).includes('-')) {
    const saved = await unwrap(sb().from('surveys').update(row).eq('id', survey.id).select().single());
    return M.surveyFromRow(saved);
  }
  const saved = await unwrap(sb().from('surveys').insert(row).select().single());
  return M.surveyFromRow(saved);
}

export async function listNews() {
  const rows = await unwrap(
    sb().from('news_posts').select('*').order('created_at', { ascending: false })
  );
  return (rows || []).map(M.newsFromRow);
}

export async function upsertNews(item) {
  const row = {
    title: item.title,
    summary: item.excerpt || item.summary || null,
    body: item.content || item.body || null,
    image_url: item.image || null,
    category: item.category || null,
    is_published: item.isPublished !== false,
    event_date: item.eventDate || null,
    meta: { dateLabel: item.date, image: item.image },
  };
  if (item.id && String(item.id).includes('-')) {
    const saved = await unwrap(sb().from('news_posts').update(row).eq('id', item.id).select().single());
    return M.newsFromRow(saved);
  }
  const saved = await unwrap(sb().from('news_posts').insert(row).select().single());
  return M.newsFromRow(saved);
}

export async function listRsvps() {
  const rows = await unwrap(sb().from('news_rsvps').select('*'));
  return (rows || []).map((r) => ({
    id: r.id,
    newsId: r.news_id,
    memberId: r.member_number,
    memberName: r.member_name,
    status: r.status,
  }));
}

export async function upsertRsvp(rsvp, memberDbId = null) {
  const row = {
    news_id: rsvp.newsId,
    member_id: memberDbId,
    member_number: rsvp.memberId,
    member_name: rsvp.memberName || null,
    status: rsvp.status || 'going',
  };
  const saved = await unwrap(
    sb().from('news_rsvps').upsert(row, { onConflict: 'news_id,member_number' }).select().single()
  );
  return {
    id: saved.id,
    newsId: saved.news_id,
    memberId: saved.member_number,
    memberName: saved.member_name,
    status: saved.status,
  };
}

// ---- Accounting ----
export async function listChartOfAccounts() {
  const rows = await unwrap(
    sb().from('chart_of_accounts').select('*').order('code'),
    'No se pudo cargar plan de cuentas'
  );
  return (rows || []).map(M.accountFromRow);
}

export async function listJournalEntries() {
  const entries = await unwrap(
    sb().from('journal_entries').select('*').order('entry_date', { ascending: false }).limit(500)
  );
  if (!entries?.length) return [];
  const ids = entries.map((e) => e.id);
  const lines = await unwrap(sb().from('journal_lines').select('*').in('journal_entry_id', ids));
  const byEntry = {};
  (lines || []).forEach((l) => {
    (byEntry[l.journal_entry_id] ||= []).push(l);
  });
  return entries.map((e) => M.journalFromRow(e, byEntry[e.id] || []));
}

export async function insertJournalEntry(entry, { createdBy } = {}) {
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
    expense_date: expense.date || new Date().toISOString().slice(0, 10),
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
  };
  if (expense.id && String(expense.id).includes('-')) {
    const saved = await unwrap(sb().from('expenses').update(row).eq('id', expense.id).select().single());
    return M.expenseFromRow(saved);
  }
  const saved = await unwrap(sb().from('expenses').insert(row).select().single());
  return M.expenseFromRow(saved);
}

// ---- Staff ----
export async function listEmployees() {
  const rows = await unwrap(sb().from('employees').select('*').order('full_name'));
  const logs = await unwrap(
    sb().from('employee_activity_logs').select('*').order('logged_at', { ascending: false })
  );
  const byEmp = {};
  (logs || []).forEach((l) => {
    (byEmp[l.employee_id] ||= []).push({
      id: l.id,
      at: l.logged_at,
      description: l.description,
    });
  });
  return (rows || []).map((r) => M.employeeFromRow(r, byEmp[r.id] || []));
}

export async function upsertEmployee(emp) {
  const row = {
    employee_number: emp.employeeNumber || emp.id,
    full_name: emp.name,
    role_title: emp.role || emp.roleTitle || 'Personal',
    department: emp.department || null,
    specialty: emp.specialty || null,
    status: emp.status === 'inactive' ? 'terminated' : (emp.status || 'active'),
    hire_date: emp.hireDate || new Date().toISOString().slice(0, 10),
    phone: emp.phone || null,
    email: emp.email || null,
    current_task: emp.currentTask || null,
    on_duty: Boolean(emp.onDuty),
  };
  if (emp.id && String(emp.id).includes('-')) {
    const saved = await unwrap(sb().from('employees').update(row).eq('id', emp.id).select().single());
    return M.employeeFromRow(saved, emp.activities || []);
  }
  const existing = await unwrap(
    sb().from('employees').select('id').eq('employee_number', row.employee_number).maybeSingle()
  );
  if (existing?.id) {
    const saved = await unwrap(sb().from('employees').update(row).eq('id', existing.id).select().single());
    return M.employeeFromRow(saved, emp.activities || []);
  }
  const saved = await unwrap(sb().from('employees').insert(row).select().single());
  return M.employeeFromRow(saved, emp.activities || []);
}

export async function listHrRecords() {
  const rows = await unwrap(
    sb().from('employee_hr_records').select('*').order('created_at', { ascending: false })
  );
  return (rows || []).map(M.hrRecordFromRow);
}

export async function insertHrRecord(rec) {
  const row = {
    employee_id: rec.employeeId || null,
    employee_code: rec.employeeCode || null,
    record_type: rec.type || 'novedad',
    title: rec.title || null,
    details: rec.details || null,
    starts_on: rec.startsOn || null,
    ends_on: rec.endsOn || null,
    amount: rec.amount ?? null,
    status: rec.status || 'open',
    meta: rec.meta || {},
  };
  const saved = await unwrap(sb().from('employee_hr_records').insert(row).select().single());
  return M.hrRecordFromRow(saved);
}

// ---- Events / Alerts ----
export async function listClubEvents() {
  const rows = await unwrap(sb().from('club_events').select('*').order('starts_at', { ascending: false }));
  return (rows || []).map(M.clubEventFromRow);
}

export async function upsertClubEvent(ev) {
  const row = {
    title: ev.title,
    slug: ev.slug || null,
    category: ev.category || 'fiesta',
    description: ev.description || null,
    location: ev.location || null,
    starts_at: ev.startsAt,
    ends_at: ev.endsAt || null,
    capacity: ev.capacity ?? null,
    ticket_price: Number(ev.ticketPrice) || 0,
    status: ev.status || 'draft',
    cover_image_url: ev.coverImageUrl || null,
  };
  if (ev.id && String(ev.id).includes('-')) {
    const saved = await unwrap(sb().from('club_events').update(row).eq('id', ev.id).select().single());
    return M.clubEventFromRow(saved);
  }
  const saved = await unwrap(sb().from('club_events').insert(row).select().single());
  return M.clubEventFromRow(saved);
}

export async function listEventRegistrations() {
  const rows = await unwrap(sb().from('event_registrations').select('*'));
  return (rows || []).map((r) => ({
    id: r.id,
    eventId: r.event_id,
    memberId: r.member_id,
    guestName: r.guest_name,
    guestsCount: r.guests_count,
    amountPaid: Number(r.amount_paid) || 0,
    paymentStatus: r.payment_status,
  }));
}

export async function listAlerts() {
  const rows = await unwrap(sb().from('alerts').select('*').order('created_at', { ascending: false }));
  return (rows || []).map(M.alertFromRow);
}

export async function upsertAlert(alert) {
  const row = {
    code: alert.code || null,
    title: alert.title,
    body: alert.body || '',
    severity: alert.severity || 'info',
    audience: alert.audience || 'all',
    source: alert.source || 'manual',
    starts_at: alert.startsAt || new Date().toISOString(),
    ends_at: alert.endsAt || null,
    is_active: alert.isActive !== false,
    requires_ack: Boolean(alert.requiresAck),
    metadata: alert.metadata || {},
  };
  if (alert.id && String(alert.id).includes('-')) {
    const saved = await unwrap(sb().from('alerts').update(row).eq('id', alert.id).select().single());
    return M.alertFromRow(saved);
  }
  const saved = await unwrap(sb().from('alerts').insert(row).select().single());
  return M.alertFromRow(saved);
}

export async function listAlertAcks() {
  const rows = await unwrap(sb().from('alert_acknowledgements').select('*'));
  return (rows || []).map((r) => ({
    id: r.id,
    alertId: r.alert_id,
    profileId: r.profile_id,
    acknowledgedAt: r.acknowledged_at,
  }));
}

export async function ackAlert(alertId, profileId) {
  const saved = await unwrap(
    sb().from('alert_acknowledgements').upsert({
      alert_id: alertId,
      profile_id: profileId,
    }).select().single()
  );
  return {
    id: saved.id,
    alertId: saved.alert_id,
    profileId: saved.profile_id,
    acknowledgedAt: saved.acknowledged_at,
  };
}

// ---- Concessions / Treasury ----
export async function listConcessions() {
  const rows = await unwrap(sb().from('concessions').select('*').order('name'));
  return (rows || []).map(M.concessionFromRow);
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
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
    paid_at: p.date || new Date().toISOString().slice(0, 10),
    method: p.method || null,
    concept: p.concept || null,
    journal_entry_id: p.journalEntryId || null,
  };
  const saved = await unwrap(sb().from('canon_payments').insert(row).select().single());
  return M.canonPaymentFromRow(saved);
}

export async function listSuppliers() {
  const rows = await unwrap(sb().from('suppliers').select('*').order('name'));
  return (rows || []).map(M.supplierFromRow);
}

export async function upsertSupplier(s) {
  const row = {
    name: s.name,
    cuit: s.cuit || null,
    category: s.category || null,
    email: s.email || null,
    phone: s.phone || null,
    status: s.status || 'active',
    notes: s.notes || null,
  };
  if (s.id && String(s.id).includes('-')) {
    const saved = await unwrap(sb().from('suppliers').update(row).eq('id', s.id).select().single());
    return M.supplierFromRow(saved);
  }
  const saved = await unwrap(sb().from('suppliers').insert(row).select().single());
  return M.supplierFromRow(saved);
}

async function listJsonTable(table, mapFn) {
  const rows = await unwrap(sb().from(table).select('*').order('created_at', { ascending: false }));
  return (rows || []).map(mapFn);
}

export async function listUnidentifiedCollections() {
  return listJsonTable('unidentified_collections', (r) => ({
    id: r.id,
    amount: Number(r.amount) || 0,
    date: r.received_on,
    reference: r.reference || '',
    status: r.status,
    notes: r.notes || '',
    memberId: r.member_id,
  }));
}

export async function listGaliciaDebits() {
  return listJsonTable('galicia_debits', (r) => ({
    id: r.id,
    memberId: r.member_number,
    memberName: r.member_name,
    amount: Number(r.amount) || 0,
    date: r.debit_date,
    status: r.status,
    reference: r.reference || '',
  }));
}

export async function listFixedExpenses() {
  return listJsonTable('fixed_expenses', (r) => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount) || 0,
    cadence: r.cadence,
    nextDue: r.next_due,
    accountCode: r.account_code,
    status: r.status,
  }));
}

export async function listFixedDiscounts() {
  return listJsonTable('fixed_discounts', (r) => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount) || 0,
    memberId: r.member_number,
    cadence: r.cadence,
    status: r.status,
  }));
}

export async function listPaymentOrders() {
  return listJsonTable('payment_orders', (r) => ({
    id: r.id,
    beneficiary: r.beneficiary,
    amount: Number(r.amount) || 0,
    dueDate: r.due_date,
    status: r.status,
    concept: r.concept || '',
    supplierId: r.supplier_id,
  }));
}

export async function replaceTableRows(table, rows) {
  await sb().from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (!rows?.length) return [];
  const saved = await unwrap(sb().from(table).insert(rows).select());
  return saved || [];
}

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

export async function findMemberDbIdByNumber(memberNumber) {
  if (!memberNumber) return null;
  const row = await unwrap(
    sb().from('members').select('id').eq('member_number', memberNumber).maybeSingle()
  );
  return row?.id || null;
}
