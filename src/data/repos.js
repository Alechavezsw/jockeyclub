import { supabase } from '../lib/supabase';
import { unwrap, throwOnError } from './errors';
import * as M from './mappers';
import { collectMemberMeta, buildLifecycleMeta, splitMemberName } from '../domain/members/memberAdminActions';

const FISCAL_2026 = '11111111-1111-1111-1111-111111111111';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(id) {
  return UUID_RE.test(String(id || ''));
}

function sb() {
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

/** PostgREST pagina de a N filas; fetchAllRows recorre todo el padrón sin tope de socios. */
const PAGE_SIZE = 1000;
/** Páginas chicas + poca concurrencia evitan statement_timeout y saturar el pool. */
const MEMBERS_PAGE_SIZE = 250;
const MEMBERS_CONCURRENCY = 2;
const PAYMENTS_CONCURRENCY = 2;

/** Ficha completa; adherentes se cargan aparte y se adjuntan en cliente. */
const MEMBERS_FULL_SELECT = '*';

async function fetchAllRows(queryFactory, fallback, pageSize = PAGE_SIZE) {
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
async function fetchAllRowsParallel(
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

/** Conteo exacto de socios (sin descargar filas). */
export async function countMembers() {
  const { count, error } = await sb()
    .from('members')
    .select('*', { count: 'exact', head: true });
  throwOnError(error, 'No se pudo contar socios');
  return count || 0;
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
  // Secuencial: primero socios, luego adherentes+pagos (menos pico en el pool).
  const rows = await fetchAllRowsParallel(
    sb().from('members').select('id', { count: 'exact', head: true }),
    (from, to) => sb()
      .from('members')
      .select(MEMBERS_FULL_SELECT)
      .order('full_name')
      .order('id')
      .range(from, to),
    'No se pudieron cargar socios',
    MEMBERS_PAGE_SIZE,
    MEMBERS_CONCURRENCY
  );

  const [adherents, payments] = await Promise.all([
    fetchAllRows(
      (from, to) => sb()
        .from('member_adherents')
        .select('*')
        .order('full_name')
        .order('id')
        .range(from, to),
      'No se pudieron cargar adherentes'
    ).catch(() => []),
    fetchAllRowsParallel(
      sb().from('member_payments').select('id', { count: 'exact', head: true }),
      (from, to) => sb()
        .from('member_payments')
        .select('*')
        .order('paid_at', { ascending: false })
        .order('id')
        .range(from, to),
      'No se pudieron cargar pagos',
      PAGE_SIZE,
      PAYMENTS_CONCURRENCY
    ).catch(() => []),
  ]);

  const adherentsByMember = {};
  for (const a of adherents || []) {
    (adherentsByMember[a.member_id] ||= []).push(a);
  }
  const byMember = {};
  for (const p of payments || []) {
    (byMember[p.member_id] ||= []).push(p);
  }
  return rows.map((r) => M.memberFromRow(
    { ...r, member_adherents: adherentsByMember[r.id] || [] },
    byMember[r.id] || []
  ));
}

/** Historial de pagos de un socio (ficha / cuenta). */
export async function listMemberPayments(memberDbId) {
  if (!memberDbId) return [];
  return fetchAllRows(
    (from, to) => sb()
      .from('member_payments')
      .select('*')
      .eq('member_id', memberDbId)
      .order('paid_at', { ascending: false })
      .order('id')
      .range(from, to),
    'No se pudieron cargar pagos'
  ).then((rows) => rows.map(M.paymentFromRow));
}

export async function getMemberByNumber(memberNumber, { withPayments = false } = {}) {
  const row = await unwrap(
    sb()
      .from('members')
      .select('*, member_adherents(*)')
      .eq('member_number', String(memberNumber))
      .maybeSingle(),
    'No se pudo cargar el socio'
  );
  if (!row) return null;
  const payments = withPayments
    ? await fetchAllRows(
      (from, to) => sb()
        .from('member_payments')
        .select('*')
        .eq('member_id', row.id)
        .order('paid_at', { ascending: false })
        .order('id')
        .range(from, to),
      'No se pudieron cargar pagos'
    )
    : [];
  return M.memberFromRow(row, payments);
}

export async function listMemberAdherents(memberDbId) {
  if (!memberDbId) return [];
  const rows = await unwrap(
    sb()
      .from('member_adherents')
      .select('id, full_name, relationship, tier, status, outstanding_balance, disciplines')
      .eq('member_id', memberDbId)
      .order('full_name'),
    'No se pudieron cargar adherentes'
  );
  return (rows || []).map(M.adherentFromRow);
}

export async function upsertMember(member) {
  const row = M.memberToRow(member);
  if (member.profileId) row.profile_id = member.profileId;
  row.meta = { ...collectMemberMeta(member), ...(row.meta || {}) };
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

/**
 * Cambia estado del socio (activar / suspender / baja) con motivo auditado.
 */
export async function setMemberLifecycle(member, {
  status,
  action,
  reasonId,
  reasonLabel,
  detail = '',
  actorName = '',
} = {}) {
  if (!member?.id && !member?.memberId) throw new Error('Socio inválido');
  const meta = buildLifecycleMeta(collectMemberMeta(member), {
    action,
    reasonId,
    reasonLabel,
    detail,
    actorName,
  });
  const next = {
    ...member,
    status,
    meta,
    bajaMotivo: meta.bajaMotivo,
    bajaFecha: meta.bajaFecha,
    bajaDetail: meta.bajaDetail,
  };
  const saved = await upsertMember(next);
  await audit(`member.${action}`, 'members', saved.id || member.id, {
    member_number: saved.memberId || member.memberId,
    status,
    reasonId,
    reason: reasonLabel,
    detail: String(detail || '').trim() || null,
  });
  return saved;
}

/**
 * Provisiona acceso portal para un socio (Auth + profile) y lo vincula.
 */
export async function provisionMemberPortalAccess(member, creds, { actorName = '' } = {}) {
  if (!member) throw new Error('Socio inválido');
  const { firstName, lastName } = splitMemberName(member);
  const profile = await createPortalUser({
    firstName: firstName || member.name || 'Socio',
    lastName: lastName || '',
    email: member.email || creds.email,
    username: creds.username,
    password: creds.password,
    phone: member.phone || '',
    contactEmail: member.email || null,
    documentType: member.documentType || 'DNI',
    documentNumber: member.documentNumber || '',
    gender: member.gender || '',
    birthDate: member.birthDate || null,
    address: member.address || '',
    role: 'member',
    roles: [{ roleKey: 'member', label: 'Socio', kind: 'system' }],
    identifiers: member.documentNumber
      ? [{ idType: 'dni', identifier: String(member.documentNumber).replace(/\D/g, '') || member.documentNumber }]
      : [],
  });

  const meta = {
    ...collectMemberMeta(member),
    portalUsername: creds.username,
    portalProvisionedAt: new Date().toISOString(),
    portalProvisionedBy: actorName || null,
  };
  const linked = await upsertMember({
    ...member,
    profileId: profile.id,
    email: member.email || creds.email,
    meta,
  });
  await audit('member.provision_access', 'members', linked.id || member.id, {
    member_number: linked.memberId || member.memberId,
    username: creds.username,
    profile_id: profile.id,
  });
  return { member: linked, profile, creds };
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
export async function listReservations({ limit } = {}) {
  let q = sb().from('reservations').select('*').order('reservation_date', { ascending: false });
  if (limit && Number(limit) > 0) q = q.limit(Number(limit));
  const rows = await unwrap(q, 'No se pudieron cargar reservas');
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

/** Hora HH:MM:SS 24h — Postgres `time` rechaza formatos locales (`p. m.`, puntos, etc.). */
function toSqlTime(value) {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const hh = String(Math.min(23, Number(m[1]))).padStart(2, '0');
      const mm = m[2];
      const ss = (m[3] || '00').padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }
  }
  const d = value instanceof Date ? value : new Date();
  return d.toTimeString().slice(0, 8);
}

export async function insertAccessLog(log, memberDbId = null) {
  const row = {
    member_id: isUuid(memberDbId) ? memberDbId : null,
    member_number: log.memberId ? String(log.memberId) : null,
    member_name: log.memberName || null,
    role_label: log.role || null,
    status: log.status || 'granted',
    notes: log.notes || null,
    logged_on: log.date || new Date().toISOString().slice(0, 10),
    logged_at: toSqlTime(log.time || new Date()),
    meta: {
      clientId: log.id && !isUuid(log.id) ? String(log.id) : undefined,
      source: log.source || 'access_gate',
      group: log.group || '',
      activity: log.activity || '',
    },
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

function surveyToRow(survey) {
  const options = Array.isArray(survey.options)
    ? survey.options
    : Array.isArray(survey.questions)
      ? survey.questions
      : [];
  const question = survey.question || survey.title || 'Encuesta';
  const active = survey.active !== false;
  const status =
    survey.status ||
    (active ? 'open' : 'closed');
  return {
    title: question,
    description: survey.description || null,
    status,
    questions: options,
    meta: {
      question,
      category: survey.category || '',
      active,
      votedBy: Array.isArray(survey.votedBy) ? survey.votedBy : [],
      options,
    },
  };
}

export async function upsertSurvey(survey) {
  const row = surveyToRow(survey);
  if (survey.id && String(survey.id).includes('-')) {
    const saved = await unwrap(
      sb().from('surveys').update(row).eq('id', survey.id).select().single()
    );
    await audit('survey.upsert', 'survey', saved.id, { title: saved.title, status: saved.status });
    return M.surveyFromRow(saved);
  }
  const saved = await unwrap(sb().from('surveys').insert(row).select().single());
  await audit('survey.upsert', 'survey', saved.id, { title: saved.title, status: saved.status });
  return M.surveyFromRow(saved);
}

export async function deleteSurvey(surveyId) {
  if (!surveyId || !String(surveyId).includes('-')) return;
  await unwrap(sb().from('surveys').delete().eq('id', surveyId));
  await audit('survey.delete', 'survey', surveyId, {});
}

export async function castSurveyVote({ survey, memberId, memberNumber, optionId }) {
  if (!survey?.id || !optionId) throw new Error('Voto incompleto');
  const options = (survey.options || []).map((opt) =>
    String(opt.id) === String(optionId) ? { ...opt, votes: (Number(opt.votes) || 0) + 1 } : opt
  );
  const votedBy = Array.from(new Set([...(survey.votedBy || []), memberId].filter(Boolean)));
  const saved = await upsertSurvey({ ...survey, options, votedBy, active: survey.active !== false });
  try {
    await unwrap(
      sb().from('survey_responses').upsert(
        {
          survey_id: survey.id,
          member_number: memberNumber || null,
          answers: { optionId },
        },
        { onConflict: 'survey_id,member_number' }
      )
    );
  } catch {
    /* response log best-effort */
  }
  return saved;
}

export async function listNews() {
  const rows = await unwrap(
    sb().from('news_posts').select('*').order('created_at', { ascending: false })
  );
  return (rows || []).map(M.newsFromRow);
}

export async function upsertNews(item) {
  const status = item.status
    || (item.isPublished === false ? 'draft' : 'published');
  const eventDate = item.eventDate && String(item.eventDate).trim()
    ? String(item.eventDate).slice(0, 10)
    : null;
  const row = {
    title: item.title,
    summary: item.excerpt || item.summary || null,
    body: item.content || item.body || null,
    image_url: item.image || null,
    category: item.category || null,
    is_published: status === 'published',
    event_date: eventDate,
    meta: {
      dateLabel: item.date || null,
      image: item.image || null,
      gallery: Array.isArray(item.gallery) ? item.gallery : [],
      isEvent: Boolean(item.isEvent || item.allowRsvp),
      allowRsvp: Boolean(item.allowRsvp || item.isEvent),
      slug: item.slug || null,
      author: item.author || null,
      tags: Array.isArray(item.tags) ? item.tags : [],
      featured: Boolean(item.featured),
      pinned: Boolean(item.pinned),
      status,
      scheduledAt: item.scheduledAt || null,
      seoTitle: item.seoTitle || null,
      seoDescription: item.seoDescription || null,
      coverCredit: item.coverCredit || null,
      updatedAt: item.updatedAt || new Date().toISOString(),
      createdAt: item.createdAt || null,
    },
  };
  const isPersistedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(item.id || ''));
  if (isPersistedUuid) {
    const saved = await unwrap(sb().from('news_posts').update(row).eq('id', item.id).select().single());
    return M.newsFromRow(saved);
  }
  // Nunca mandar ids temporales (tmp-news-…) a columnas uuid
  const saved = await unwrap(sb().from('news_posts').insert(row).select().single());
  return M.newsFromRow(saved);
}

export async function deleteNews(newsId) {
  await unwrap(sb().from('news_posts').delete().eq('id', newsId), 'No se pudo eliminar la noticia');
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

/** Lecturas de campanita (por usuario). */
export async function listNotificationReads() {
  const rows = await unwrap(
    sb().from('notification_reads').select('notif_key, read_at').order('read_at', { ascending: false }),
    'No se pudieron cargar lecturas de notificaciones'
  );
  return (rows || []).map((r) => String(r.notif_key));
}

export async function markNotificationRead(notifKey, profileId) {
  if (!notifKey || !profileId) return null;
  const saved = await unwrap(
    sb().from('notification_reads').upsert(
      { profile_id: profileId, notif_key: String(notifKey) },
      { onConflict: 'profile_id,notif_key' }
    ).select('notif_key').single(),
    'No se pudo marcar la notificación como leída'
  );
  return saved?.notif_key ? String(saved.notif_key) : String(notifKey);
}

export async function markNotificationsRead(notifKeys, profileId) {
  if (!profileId || !Array.isArray(notifKeys) || notifKeys.length === 0) return [];
  const rows = notifKeys.map((k) => ({
    profile_id: profileId,
    notif_key: String(k),
  }));
  const saved = await unwrap(
    sb().from('notification_reads').upsert(rows, { onConflict: 'profile_id,notif_key' }).select('notif_key'),
    'No se pudieron marcar las notificaciones como leídas'
  );
  return (saved || []).map((r) => String(r.notif_key));
}

// ---- Concessions / Treasury ----
export async function listConcessions() {
  const rows = await unwrap(sb().from('concessions').select('*').order('name'));
  return (rows || []).map(M.concessionFromRow);
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
    received_on: item.date || new Date().toISOString().slice(0, 10),
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
  };
  if (isUuid(item.id)) {
    const saved = await unwrap(sb().from('fixed_discounts').update(row).eq('id', item.id).select().single());
    return (await listFixedDiscounts()).find((x) => x.id === saved.id) || { ...item, id: saved.id, active, percent };
  }
  const saved = await unwrap(sb().from('fixed_discounts').insert(row).select().single());
  await audit('upsert', 'fixed_discount', saved.id, { name: row.name });
  return (await listFixedDiscounts()).find((x) => x.id === saved.id) || { ...item, id: saved.id, active, percent };
}

export async function listPaymentOrders() {
  return listJsonTable('payment_orders', (r) => {
    const meta = metaOf(r);
    return {
      id: r.id,
      number: meta.number || null,
      date: meta.date || r.created_at?.slice?.(0, 10) || null,
      payee: r.beneficiary || meta.payee || '',
      beneficiary: r.beneficiary || meta.payee || '',
      concept: r.concept || meta.concept || '',
      amount: Number(r.amount) || 0,
      dueDate: r.due_date || meta.dueDate || null,
      status: r.status || 'draft',
      paymentMethod: meta.paymentMethod || 'transferencia',
      supplierId: r.supplier_id || null,
      createdAt: r.created_at || meta.createdAt || null,
      updatedAt: meta.updatedAt || null,
      journalEntryId: meta.journalEntryId || null,
    };
  });
}

export async function upsertPaymentOrder(item) {
  const meta = {
    number: item.number || null,
    date: item.date || null,
    payee: item.payee || item.beneficiary || null,
    concept: item.concept || null,
    paymentMethod: item.paymentMethod || null,
    dueDate: item.dueDate || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    journalEntryId: item.journalEntryId || null,
  };
  const row = {
    beneficiary: item.payee || item.beneficiary || 'Beneficiario',
    amount: Number(item.amount) || 0,
    due_date: item.dueDate || item.date || null,
    status: item.status || 'draft',
    concept: item.concept || null,
    supplier_id: isUuid(item.supplierId) ? item.supplierId : null,
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

/** Usuarios con cuenta en el portal (public.profiles). */
export async function countRegisteredProfiles() {
  const { count, error } = await sb()
    .from('profiles')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message || 'No se pudieron contar usuarios registrados');
  return count || 0;
}

export async function listProfiles() {
  const rows = await unwrap(
    sb()
      .from('profiles')
      .select('*, profile_authorizations(*), profile_identifiers(*)')
      .order('created_at', { ascending: false }),
    'No se pudieron cargar usuarios registrados'
  );
  const withRoles = await attachProfileRoles(rows || []);
  return withRoles.map(M.profileFromRow);
}

export async function getProfile(profileId) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  const row = await unwrap(
    sb()
      .from('profiles')
      .select('*, profile_authorizations(*), profile_identifiers(*)')
      .eq('id', profileId)
      .maybeSingle(),
    'No se pudo cargar el perfil'
  );
  if (!row) return null;
  const [withRoles] = await attachProfileRoles([row]);
  return M.profileFromRow(withRoles);
}

async function attachProfileRoles(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const ids = list.map((r) => r.id).filter(Boolean);
  if (!ids.length) return list.map((r) => ({ ...r, profile_roles: r.profile_roles || [] }));

  const roleRows = await unwrap(
    sb()
      .from('profile_roles')
      .select('*')
      .in('profile_id', ids)
      .is('revoked_at', null)
      .order('created_at', { ascending: true }),
    'No se pudieron cargar roles de usuarios'
  );

  const byProfile = {};
  (roleRows || []).forEach((r) => {
    (byProfile[r.profile_id] ||= []).push(r);
  });

  return list.map((r) => ({
    ...r,
    profile_roles: byProfile[r.id] || [],
  }));
}

export async function updateProfile(profileId, patch = {}) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  const row = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.firstName !== undefined) row.first_name = patch.firstName || null;
  if (patch.lastName !== undefined) row.last_name = patch.lastName || null;
  if (patch.phone !== undefined) row.phone = patch.phone || null;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl || null;
  if (patch.documentType !== undefined) row.document_type = patch.documentType || null;
  if (patch.documentNumber !== undefined) row.document_number = patch.documentNumber || null;
  if (patch.gender !== undefined) row.gender = patch.gender || null;
  if (patch.birthDate !== undefined) row.birth_date = patch.birthDate || null;
  if (patch.bloodType !== undefined) row.blood_type = patch.bloodType || null;
  if (patch.healthInsurance !== undefined) row.health_insurance = patch.healthInsurance || null;
  if (patch.emergencyPhone !== undefined) row.emergency_phone = patch.emergencyPhone || null;
  if (patch.emergencyClinic !== undefined) row.emergency_clinic = patch.emergencyClinic || null;
  if (patch.address !== undefined) row.address = patch.address || null;
  if (patch.prismaId !== undefined) row.prisma_id = patch.prismaId || null;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.isActive !== undefined) row.is_active = Boolean(patch.isActive);

  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    const first = patch.firstName !== undefined ? patch.firstName : undefined;
    const last = patch.lastName !== undefined ? patch.lastName : undefined;
    if (first !== undefined || last !== undefined) {
      // full_name se recalcula si vienen ambos o uno + el otro ya en DB vía cliente
      if (patch.fullName === undefined && first !== undefined && last !== undefined) {
        row.full_name = [first, last].filter(Boolean).join(' ').trim() || null;
      }
    }
  }

  if (patch.username !== undefined || patch.contactEmail !== undefined || patch.meta !== undefined) {
    const current = await unwrap(
      sb().from('profiles').select('meta').eq('id', profileId).maybeSingle(),
      'No se pudo leer meta del perfil'
    );
    const prevMeta = current?.meta && typeof current.meta === 'object' ? current.meta : {};
    row.meta = {
      ...prevMeta,
      ...(patch.meta && typeof patch.meta === 'object' ? patch.meta : {}),
    };
    if (patch.username !== undefined) {
      row.meta.username = String(patch.username || '').trim() || null;
    }
    if (patch.contactEmail !== undefined) {
      row.meta.contactEmail = String(patch.contactEmail || '').trim() || null;
    }
  }

  const saved = await unwrap(
    sb().from('profiles').update(row).eq('id', profileId).select('*, profile_authorizations(*), profile_identifiers(*)').single(),
    'No se pudo actualizar el usuario'
  );
  const [withRoles] = await attachProfileRoles([saved]);
  await audit('profile.update', 'profile', saved.id, patch);
  return M.profileFromRow(withRoles);
}

/** Alta de usuario Auth + ficha (vía edge function admin). */
export async function createPortalUser(payload) {
  const { data: sessionData } = await sb().auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sesión no válida. Volvé a iniciar sesión.');

  const { data, error } = await sb().functions.invoke('admin-create-user', {
    body: { ...payload, action: 'create' },
  });

  if (error) {
    let detail = error.message || 'No se pudo crear el usuario';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch {
      /* ignore */
    }
    throw new Error(data?.error || detail);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.profile) throw new Error('Respuesta inválida al crear usuario');

  let profile = M.profileFromRow(data.profile);
  if (Array.isArray(payload.roles) && payload.roles.length) {
    profile = await replaceProfileRoles(profile.id, payload.roles);
  }
  await audit('profile.create', 'profile', profile.id, {
    email: payload.email,
    username: payload.username,
    roles: payload.roles || [],
  });
  return profile;
}

/** Regenera la contraseña de un usuario existente (superadmin vía edge). */
export async function resetPortalUserPassword(profileId, password) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  if (!password || String(password).length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres');
  }

  const { data: sessionData } = await sb().auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sesión no válida. Volvé a iniciar sesión.');

  const { data, error } = await sb().functions.invoke('admin-create-user', {
    body: { action: 'reset_password', userId: profileId, password },
  });

  if (error) {
    let detail = error.message || 'No se pudo regenerar la contraseña';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch {
      /* ignore */
    }
    throw new Error(data?.error || detail);
  }
  if (data?.error) throw new Error(data.error);

  await audit('profile.reset_password', 'profile', profileId, { reset: true });
  return true;
}

export async function replaceProfileAuthorizations(profileId, authorizations = []) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  await unwrap(
    sb().from('profile_authorizations').delete().eq('profile_id', profileId),
    'No se pudieron limpiar autorizaciones'
  );
  const rows = (authorizations || [])
    .filter((a) => a.title || a.kind)
    .map((a) => ({
      profile_id: profileId,
      kind: a.kind || 'custom',
      title: a.title || a.kind || 'Autorización',
      role_label: a.roleLabel || null,
      expires_at: a.expiresAt || null,
      pin: a.pin || null,
      meta: {},
    }));
  if (!rows.length) return [];
  const saved = await unwrap(
    sb().from('profile_authorizations').insert(rows).select(),
    'No se pudieron guardar autorizaciones'
  );
  return saved || [];
}

export async function replaceProfileIdentifiers(profileId, identifiers = []) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  await unwrap(
    sb().from('profile_identifiers').delete().eq('profile_id', profileId),
    'No se pudieron limpiar identificadores'
  );
  const rows = (identifiers || [])
    .filter((i) => i.idType && i.identifier)
    .map((i) => ({
      profile_id: profileId,
      id_type: i.idType,
      identifier: i.identifier,
      meta: {},
    }));
  if (!rows.length) return [];
  const saved = await unwrap(
    sb().from('profile_identifiers').insert(rows).select(),
    'No se pudieron guardar identificadores'
  );
  return saved || [];
}

const SYSTEM_ROLE_LABELS = {
  member: 'Socio',
  staff: 'Personal',
  hr: 'Recursos humanos',
  admin_employee: 'Empleado de administración',
  gate_operator: 'Operador de portería',
  cashier: 'Cajero',
  accountant: 'Contador',
  admin: 'Administrador',
  superadmin: 'Superadministrador',
};

/** Reemplaza el set activo de roles (sistema + títulos). Todo queda auditado por trigger. */
export async function replaceProfileRoles(profileId, roles = []) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  const { data: { user } } = await sb().auth.getUser();

  const desired = [];
  const seen = new Set();
  for (const raw of roles || []) {
    const roleKey = String(raw.roleKey || raw.key || raw).trim().toLowerCase();
    if (!roleKey || seen.has(roleKey)) continue;
    seen.add(roleKey);
    const kind = raw.kind || (SYSTEM_ROLE_LABELS[roleKey] ? 'system' : 'title');
    const label = raw.label || SYSTEM_ROLE_LABELS[roleKey] || roleKey;
    desired.push({ roleKey, kind, label });
  }

  const existing = await unwrap(
    sb().from('profile_roles').select('*').eq('profile_id', profileId).is('revoked_at', null),
    'No se pudieron leer roles del perfil'
  );

  const existingByKey = new Map((existing || []).map((r) => [String(r.role_key).toLowerCase(), r]));
  const desiredKeys = new Set(desired.map((d) => d.roleKey));

  // Revocar los que ya no están
  for (const [key, row] of existingByKey) {
    if (!desiredKeys.has(key)) {
      await unwrap(
        sb().from('profile_roles').update({ revoked_at: new Date().toISOString() }).eq('id', row.id),
        'No se pudo revocar rol'
      );
    }
  }

  // Alta de nuevos
  const toInsert = desired
    .filter((d) => !existingByKey.has(d.roleKey))
    .map((d) => ({
      profile_id: profileId,
      role_key: d.roleKey,
      label: d.label,
      kind: d.kind,
      granted_by: user?.id || null,
    }));

  if (toInsert.length) {
    await unwrap(
      sb().from('profile_roles').insert(toInsert),
      'No se pudieron asignar roles'
    );
  }

  const refreshed = await unwrap(
    sb().from('profiles').select('*, profile_authorizations(*), profile_identifiers(*)').eq('id', profileId).single(),
    'No se pudo recargar el perfil'
  );
  const [withRoles] = await attachProfileRoles([refreshed]);
  return M.profileFromRow(withRoles);
}

export async function listProfileAudit(profileId, { limit = 80 } = {}) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  const rows = await unwrap(
    sb()
      .from('audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, payload, created_at')
      .eq('entity_id', profileId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'No se pudo cargar el historial del perfil'
  );

  const actorIds = [...new Set((rows || []).map((r) => r.actor_id).filter(Boolean))];
  let actorsById = {};
  if (actorIds.length) {
    try {
      const actors = await unwrap(
        sb().from('profiles').select('id, full_name, email, first_name, last_name').in('id', actorIds),
        'No se pudieron cargar actores del historial'
      );
      actorsById = Object.fromEntries((actors || []).map((a) => {
        const name = a.full_name
          || [a.last_name, a.first_name].filter(Boolean).join(' ')
          || a.email
          || a.id;
        return [a.id, name];
      }));
    } catch {
      actorsById = {};
    }
  }

  return (rows || []).map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorName: r.actor_id ? (actorsById[r.actor_id] || 'Usuario del sistema') : 'Sistema',
    action: r.action,
    entityType: r.entity_type,
    payload: r.payload || {},
    createdAt: r.created_at,
  }));
}

export async function listMembershipApplications() {
  const rows = await unwrap(
    sb()
      .from('membership_applications')
      .select('*')
      .order('created_at', { ascending: false }),
    'No se pudieron cargar solicitudes de socio'
  );
  return (rows || []).map(M.membershipApplicationFromRow);
}

export async function countPendingMembershipApplications() {
  const { count, error } = await sb()
    .from('membership_applications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw new Error(error.message || 'No se pudieron contar solicitudes de socio');
  return count || 0;
}

export async function upsertMembershipApplication(app) {
  const row = M.membershipApplicationToRow(app);
  let saved;
  if (app.id && isUuid(app.id)) {
    saved = await unwrap(
      sb().from('membership_applications').update(row).eq('id', app.id).select().single(),
      'No se pudo actualizar la solicitud de socio'
    );
  } else {
    saved = await unwrap(
      sb().from('membership_applications').insert(row).select().single(),
      'No se pudo crear la solicitud de socio'
    );
  }
  await audit(
    app.id ? 'membership_application.update' : 'membership_application.create',
    'membership_application',
    saved.id,
    { status: saved.status, email: saved.email }
  );
  return M.membershipApplicationFromRow(saved);
}

export async function findMemberDbIdByNumber(memberNumber) {
  if (!memberNumber) return null;
  const row = await unwrap(
    sb().from('members').select('id').eq('member_number', memberNumber).maybeSingle()
  );
  return row?.id || null;
}
