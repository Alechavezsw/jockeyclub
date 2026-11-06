import * as M from '../mappers';
import { unwrap, throwOnError } from '../errors';
import { collectMemberMeta, buildLifecycleMeta, splitMemberName } from '../../domain/members/memberAdminActions';
import { dbMemberIsDuesExempt } from '../../domain/members/dues';
import { allocateNextMemberNumber } from '../../domain/members/households';
import { todayAR } from '../../lib/arDate';
import { supabase } from '../../lib/supabase';
import { isUuid, sb, fetchAllRows, fetchAllRowsParallel, audit } from './shared.js';
import { createPortalUser, replaceProfileRoles } from './profiles.js';

/** Tope PostgREST habitual. */
const MEMBERS_PAGE_SIZE = 1000;
/** Todas las páginas restantes salen juntas (≤8). */
const MEMBERS_CONCURRENCY = 8;

/**
 * Grilla mínima: la ficha completa se hidrata al expandir.
 * Menos columnas = menos JSON/RLS por página (~4–5k activos).
 */
const MEMBERS_LIST_SELECT = [
  'id',
  'profile_id',
  'member_number',
  'card_number',
  'full_name',
  'phone',
  'email',
  'tier',
  'status',
  'outstanding_balance',
  'next_due_date',
  'overdue_since',
  'document_number',
  'document_type',
  'last_payment_date:meta->>lastPaymentDate',
  'family_principal:meta->>familyPrincipalNumber',
  'family_group_name:meta->>familyGroupName',
  'cuota_categories:meta->cuotaCategories',
  'current_account_as_of:meta->>currentAccountAsOf',
].join(', ');

/** Solo listado de bajas / inactivos: el padrón activo no los necesita. */
const MEMBERS_LIST_SELECT_INACTIVE = [
  MEMBERS_LIST_SELECT,
  'baja_motivo:meta->>bajaMotivo',
  'baja_fecha:meta->>bajaFecha',
  'baja_actor:meta->>bajaActorName',
  'baja_registrada:meta->>bajaRegistradaAt',
  'reactivate_actor:meta->>reactivateActorName',
  'reactivate_registrada:meta->>reactivateRegistradaAt',
].join(', ');

export function metaFromListRow(row = {}) {
  const principal = row.family_principal ?? row.familyPrincipalNumber ?? row.meta?.familyPrincipalNumber;
  const group = row.family_group_name ?? row.familyGroupName ?? row.meta?.familyGroupName;
  const lastPay = row.last_payment_date ?? row.lastPaymentDate ?? row.meta?.lastPaymentDate;
  const cats = row.cuota_categories ?? row.cuotaCategories ?? row.meta?.cuotaCategories;
  const portalUser = row.portal_username ?? row.portalUsername ?? row.meta?.portalUsername;
  const portalAt = row.portal_provisioned ?? row.portalProvisionedAt ?? row.meta?.portalProvisionedAt;
  const societasApp = row.has_societas_app ?? row.hasSocietasApp ?? row.meta?.hasSocietasApp;
  const accountCut = row.current_account_as_of ?? row.currentAccountAsOf ?? row.meta?.currentAccountAsOf;
  const bajaMotivo = row.baja_motivo ?? row.bajaMotivo ?? row.meta?.bajaMotivo;
  const bajaActorName = row.baja_actor ?? row.bajaActorName ?? row.meta?.bajaActorName;
  const bajaRegistradaAt = row.baja_registrada ?? row.bajaRegistradaAt ?? row.meta?.bajaRegistradaAt;
  const bajaFecha = row.baja_fecha ?? row.bajaFecha ?? row.meta?.bajaFecha;
  const reactivateActorName = row.reactivate_actor ?? row.reactivateActorName ?? row.meta?.reactivateActorName;
  const reactivateRegistradaAt = row.reactivate_registrada ?? row.reactivateRegistradaAt ?? row.meta?.reactivateRegistradaAt;
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? { ...row.meta } : {};
  if (principal != null && principal !== '') meta.familyPrincipalNumber = principal;
  if (group) meta.familyGroupName = group;
  if (lastPay) meta.lastPaymentDate = lastPay;
  if (cats) meta.cuotaCategories = cats;
  if (portalUser) meta.portalUsername = portalUser;
  if (portalAt) meta.portalProvisionedAt = portalAt;
  if (societasApp === true || societasApp === 'true') meta.hasSocietasApp = true;
  if (accountCut) meta.currentAccountAsOf = String(accountCut).slice(0, 10);
  if (bajaMotivo) meta.bajaMotivo = bajaMotivo;
  if (bajaActorName) meta.bajaActorName = bajaActorName;
  if (bajaRegistradaAt) meta.bajaRegistradaAt = bajaRegistradaAt;
  if (bajaFecha) meta.bajaFecha = bajaFecha;
  if (reactivateActorName) meta.reactivateActorName = reactivateActorName;
  if (reactivateRegistradaAt) meta.reactivateRegistradaAt = reactivateRegistradaAt;
  return meta;
}

function listRowToMember(row) {
  if (!row) return null;
  const mapped = M.memberFromRow({
    ...row,
    meta: metaFromListRow(row),
    photo_url: undefined,
    credential_token: undefined,
  }, []);
  if (row.has_portal === true) return { ...mapped, hasApp: true, recordScope: 'list' };
  return { ...mapped, recordScope: 'list' };
}

const membersListInflight = { active: null, inactive: null };
const membersListCache = { active: null, inactive: null };

export function invalidateMembersListCache() {
  membersListCache.active = null;
  membersListCache.inactive = null;
}

/** Activos en el arranque. Inactivos, suspendidos y bajas solo si se piden. */
function applyMemberScope(req, scope) {
  if (scope === 'inactive') return req.neq('status', 'active');
  if (scope === 'active') return req.eq('status', 'active');
  return req;
}

/** Conteo exacto de socios (sin descargar filas). status: 'active' | 'inactive' | otro valor. */
export async function countMembers(status) {
  let req = sb().from('members').select('id', { count: 'exact', head: true });
  if (status === 'rest') req = req.neq('status', 'active');
  else if (status) req = req.eq('status', status);
  const { count, error } = await req;
  throwOnError(error, 'No se pudo contar socios');
  return count || 0;
}

// ---- Members ----
/**
 * Padrón por páginas. onBatch se llama tras cada lote para pintar la UI
 * sin esperar los ~5k socios ni pagos/adherentes.
 */
export async function listMembers({ onBatch, scope = 'active' } = {}) {
  const key = scope === 'inactive' ? 'inactive' : 'active';
  if (scope === 'all') {
    const active = await listMembers({ onBatch, scope: 'active' });
    const inactive = await listMembers({ scope: 'inactive' });
    const rows = [...(active || []), ...(inactive || [])];
    onBatch?.(rows, { loaded: rows.length, total: rows.length, done: true });
    return rows;
  }
  if (membersListCache[key]?.length) {
    onBatch?.(membersListCache[key], {
      loaded: membersListCache[key].length,
      total: membersListCache[key].length,
      done: true,
    });
    return membersListCache[key];
  }
  if (membersListInflight[key]) {
    const shared = await membersListInflight[key];
    onBatch?.(shared, { loaded: shared.length, total: shared.length, done: true });
    return shared;
  }

  membersListInflight[key] = downloadMembersList({ onBatch, scope: key })
    .then((rows) => {
      membersListCache[key] = rows;
      return rows;
    })
    .finally(() => {
      membersListInflight[key] = null;
    });
  return membersListInflight[key];
}

async function downloadMembersListViaRpc({ onBatch, scope = 'active' } = {}) {
  const { data, error } = await sb().rpc('list_members_padron', { p_scope: scope });
  if (error) throw error;
  const rows = data || [];
  const mapped = [];
  const total = rows.length;
  const paintEvery = 1000;
  for (let i = 0; i < rows.length; i += 1) {
    const member = listRowToMember(rows[i]);
    if (member) mapped.push(member);
    const done = (i + 1) === rows.length;
    const atPaint = done || (mapped.length > 0 && mapped.length % paintEvery === 0);
    if (atPaint) {
      onBatch?.(mapped, {
        loaded: mapped.length,
        total,
        done,
        firstPage: mapped.length <= paintEvery,
      });
    }
  }
  if (!rows.length) {
    onBatch?.([], { loaded: 0, total: 0, done: true, firstPage: true });
  }
  return mapped;
}

async function downloadMembersListPaged({ onBatch, scope = 'active' } = {}) {
  const mapped = [];
  const baseSelect = scope === 'inactive' ? MEMBERS_LIST_SELECT_INACTIVE : MEMBERS_LIST_SELECT;
  let listSelect = baseSelect;
  let knownTotal = 0;
  let finished = false;

  const report = (done, { firstPage = false } = {}) => {
    if (finished && !done) return;
    if (done) finished = true;
    onBatch?.(mapped, {
      loaded: mapped.length,
      total: knownTotal || (done ? mapped.length : 0),
      done,
      firstPage,
    });
  };

  const fetchPageRaw = async (from, { withCount = false } = {}) => {
    const selectOpts = withCount ? { count: 'exact' } : undefined;
    try {
      const req = applyMemberScope(
        sb().from('members').select(listSelect, selectOpts),
        scope,
      )
        .order('id')
        .range(from, from + MEMBERS_PAGE_SIZE - 1);
      const { data, error, count } = await req;
      throwOnError(error, 'No se pudieron cargar socios');
      return { rows: data || [], count: count ?? null };
    } catch (err) {
      if (listSelect === baseSelect) {
        listSelect = baseSelect
          .replace(', last_payment_date:meta->>lastPaymentDate', '')
          .replace(', family_principal:meta->>familyPrincipalNumber', '')
          .replace(', family_group_name:meta->>familyGroupName', '')
          .replace(', cuota_categories:meta->cuotaCategories', '')
          .replace(', current_account_as_of:meta->>currentAccountAsOf', '');
        const req = applyMemberScope(
          sb().from('members').select(listSelect, selectOpts),
          scope,
        )
          .order('id')
          .range(from, from + MEMBERS_PAGE_SIZE - 1);
        const { data, error, count } = await req;
        throwOnError(error, 'No se pudieron cargar socios');
        return { rows: data || [], count: count ?? null };
      }
      throw err;
    }
  };

  const absorb = (chunk) => {
    for (const row of chunk || []) {
      const member = listRowToMember(row);
      if (member) mapped.push(member);
    }
  };

  // Primera página + count en el mismo viaje → UI a los ~1k sin HEAD aparte.
  const firstPack = await fetchPageRaw(0, { withCount: true });
  absorb(firstPack.rows);
  if (firstPack.count) knownTotal = firstPack.count;
  report(false, { firstPage: true });
  if ((firstPack.rows || []).length < MEMBERS_PAGE_SIZE) {
    report(true);
    return mapped;
  }

  const totalForPages = knownTotal || (mapped.length + MEMBERS_PAGE_SIZE * 20);
  const remainingStarts = [];
  for (let from = MEMBERS_PAGE_SIZE; from < totalForPages; from += MEMBERS_PAGE_SIZE) {
    remainingStarts.push(from);
  }
  // Si el count falló, pedimos olas hasta página corta.
  if (!knownTotal && remainingStarts.length === 0) {
    remainingStarts.push(MEMBERS_PAGE_SIZE);
  }

  for (let i = 0; i < remainingStarts.length; i += MEMBERS_CONCURRENCY) {
    const batch = remainingStarts.slice(i, i + MEMBERS_CONCURRENCY);
    const packs = await Promise.all(batch.map((from) => fetchPageRaw(from)));
    let reachedEnd = false;
    for (const pack of packs) {
      absorb(pack.rows);
      if ((pack.rows || []).length < MEMBERS_PAGE_SIZE) reachedEnd = true;
    }
    report(false);
    if (reachedEnd) break;
    // Sin count: seguir pidiendo si la última ola vino completa.
    if (!knownTotal && !reachedEnd && i + MEMBERS_CONCURRENCY >= remainingStarts.length) {
      const nextFrom = remainingStarts[remainingStarts.length - 1] + MEMBERS_PAGE_SIZE;
      remainingStarts.push(nextFrom);
    }
  }

  report(true);
  return mapped;
}

async function downloadMembersList({ onBatch, scope = 'active' } = {}) {
  try {
    return await downloadMembersListViaRpc({ onBatch, scope });
  } catch {
    // RPC ausente / sin permiso → páginas PostgREST.
    return downloadMembersListPaged({ onBatch, scope });
  }
}

function escapeIlike(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/[%_(),]/g, (ch) => `\\${ch}`)
    .slice(0, 80);
}

/** Columnas mínimas para la puerta: sin meta ni foto (eso se hidrata al elegir). */
const MEMBERS_GATE_SELECT = [
  'id',
  'member_number',
  'full_name',
  'document_number',
  'status',
  'outstanding_balance',
  'profile_id',
].join(', ');

const MEMBER_SEARCH_CACHE = new Map();
const MEMBER_SEARCH_CACHE_MAX = 48;
let memberLookupRpcOk = true;

function memberSearchKey(query, cap) {
  return `${String(query || '').trim().toLowerCase()}|${cap}`;
}

function rememberMemberSearch(key, rows) {
  MEMBER_SEARCH_CACHE.set(key, rows);
  if (MEMBER_SEARCH_CACHE.size <= MEMBER_SEARCH_CACHE_MAX) return;
  const first = MEMBER_SEARCH_CACHE.keys().next().value;
  MEMBER_SEARCH_CACHE.delete(first);
}

export function isMissingRpc(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return code === 'PGRST202' || code === '42883' || /search_members_lookup/i.test(msg);
}

/** Cache síncrono del typeahead (misma tecla / atrás no espera red). */
export function peekMembersDirectory(query, { limit = 20 } = {}) {
  const cap = Math.min(50, Math.max(5, Number(limit) || 20));
  return MEMBER_SEARCH_CACHE.get(memberSearchKey(query, cap)) || null;
}

/**
 * Búsqueda puntual para puerta / pileta / registro.
 * Prefiere RPC (índice trigram, sin RLS por fila).
 */
export async function searchMembersDirectory(query, { limit = 20, signal } = {}) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const cap = Math.min(50, Math.max(5, Number(limit) || 20));
  const memoKey = memberSearchKey(raw, cap);
  const cached = MEMBER_SEARCH_CACHE.get(memoKey);
  if (cached) return cached;

  if (memberLookupRpcOk) {
    const { data, error } = await sb().rpc('search_members_lookup', {
      p_query: raw,
      p_limit: cap,
    }, signal ? { abortSignal: signal } : undefined);
    if (signal?.aborted) return [];
    if (!error) {
      const mapped = (data || []).map(listRowToMember);
      rememberMemberSearch(memoKey, mapped);
      return mapped;
    }
    if (signal?.aborted || error?.name === 'AbortError') return [];
    if (isMissingRpc(error)) memberLookupRpcOk = false;
    else throwOnError(error, 'No se pudo buscar socios');
  }

  const q = escapeIlike(raw);
  const digits = raw.replace(/\D/g, '');
  const nameLike = /[a-záéíóúüñ]/i.test(raw);
  const rows = await unwrap(
    buildMemberSearch(
      sb().from('members').select(MEMBERS_GATE_SELECT),
      raw,
      q,
      digits,
      nameLike,
    ).limit(cap),
    'No se pudo buscar socios'
  );
  const mapped = (rows || []).map(listRowToMember);
  rememberMemberSearch(memoKey, mapped);
  return mapped;
}

function buildMemberSearch(req, _raw, q, digits, nameLike) {
  if (digits && !nameLike) {
    return req.or([
      `member_number.eq.${digits}`,
      `document_number.eq.${digits}`,
      `member_number.ilike.%${digits}%`,
      `document_number.ilike.%${digits}%`,
    ].join(','));
  }
  const clauses = [
    `full_name.ilike.%${q}%`,
  ];
  if (digits) {
    clauses.push(`member_number.ilike.%${digits}%`, `document_number.ilike.%${digits}%`);
  }
  return req.or(clauses.join(','));
}

let gateIndexCache = null;
let gateIndexPromise = null;

/** Padrón liviano para la puerta: ~5k filas, 6 columnas. */
export async function listMembersGateIndex() {
  if (gateIndexCache?.length) return gateIndexCache;
  if (gateIndexPromise) return gateIndexPromise;
  gateIndexPromise = fetchAllRowsParallel(
    sb().from('members').select('id', { count: 'exact', head: true }),
    (from, to) => sb()
      .from('members')
      .select(MEMBERS_GATE_SELECT)
      .order('id')
      .range(from, to),
    'No se pudieron cargar socios',
    1000,
    2,
  ).then((rows) => {
    gateIndexCache = (rows || []).map((r) => M.memberFromRow(r, []));
    return gateIndexCache;
  }).finally(() => {
    gateIndexPromise = null;
  });
  return gateIndexPromise;
}

/** Recalcula y guarda mora/saldo del socio autenticado desde sus pagos. */
export async function syncOwnDuesStanding() {
  const { data, error } = await sb().rpc('sync_own_dues_standing');
  throwOnError(error, 'No se pudo guardar el estado de cuota');
  return data;
}

async function attachImputations(payments) {
  const list = payments || [];
  const ids = list.map((row) => row.id).filter((id) => isUuid(id));
  if (!ids.length) return list;
  const rows = await unwrap(
    sb()
      .from('dues_imputations')
      .select('payment_id, due_on, capital, surcharge, capital_open, surcharge_open, voided_at')
      .in('payment_id', ids)
      .is('voided_at', null),
    'No se pudieron cargar las imputaciones del cobro',
  );
  const byPayment = new Map();
  for (const row of rows || []) {
    const bucket = byPayment.get(row.payment_id) || [];
    bucket.push(M.imputationFromRow(row));
    byPayment.set(row.payment_id, bucket);
  }
  return list.map((payment) => ({
    ...payment,
    imputations: (byPayment.get(payment.id) || [])
      .toSorted((a, b) => String(a.dueOn).localeCompare(String(b.dueOn))),
  }));
}

/** Historial de pagos de un socio (ficha / cuenta). */
export async function listMemberPayments(memberDbId) {
  if (!memberDbId) return [];
  const payments = await fetchAllRows(
    (from, to) => sb()
      .from('member_payments')
      .select('*')
      .eq('member_id', memberDbId)
      .order('paid_at', { ascending: false })
      .order('id')
      .range(from, to),
    'No se pudieron cargar pagos',
  );
  return attachImputations(payments.map(M.paymentFromRow));
}

async function hydrateMemberRow(row, { withPayments = false } = {}) {
  if (!row) return null;
  const payments = withPayments
    ? await attachImputations((await fetchAllRows(
      (from, to) => sb()
        .from('member_payments')
        .select('*')
        .eq('member_id', row.id)
        .order('paid_at', { ascending: false })
        .order('id')
        .range(from, to),
      'No se pudieron cargar pagos',
    )).map(M.paymentFromRow))
    : [];
  return M.memberFromRow(row, payments);
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
  return hydrateMemberRow(row, { withPayments });
}

export async function getMember(memberDbId, { withPayments = false } = {}) {
  if (!isUuid(memberDbId)) return null;
  const row = await unwrap(
    sb()
      .from('members')
      .select('*, member_adherents(*)')
      .eq('id', memberDbId)
      .maybeSingle(),
    'No se pudo cargar el socio'
  );
  return hydrateMemberRow(row, { withPayments });
}

export async function linkMemberProfile(memberDbId, profileId) {
  if (!isUuid(memberDbId) || !isUuid(profileId)) return;
  await unwrap(
    sb().from('members').update({ profile_id: profileId }).eq('id', memberDbId),
    'No se pudo vincular el socio al usuario'
  );
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

/** Próximo Nº de socio (1–6 dígitos). RPC en cloud; correlativo local como respaldo. */
export async function nextClubMemberNumber(members = []) {
  if (supabase) {
    const { data, error } = await sb().rpc('next_club_member_number');
    if (!error && data != null && String(data).trim()) {
      return String(data).replace(/\D/g, '') || String(data);
    }
  }
  return allocateNextMemberNumber(members);
}

async function updateMemberWithoutPrivilegeColumns(memberId, row) {
  const safe = { ...row };
  delete safe.tier;
  delete safe.status;
  delete safe.meta;
  return unwrap(
    sb().from('members').update(safe).eq('id', memberId).select().single(),
    'No se pudo actualizar socio'
  );
}

async function saveMemberMeta(memberId, meta) {
  await unwrap(
    sb().rpc('guardar_meta_socio', { p_member_id: memberId, p_meta: meta || {} }),
    'No se pudo guardar la ficha'
  );
}

export async function eximirCuotaSocio(memberId, tier, reason) {
  const clean = String(reason || '').trim();
  if (clean.length < 8) {
    throw new Error('Falta el motivo de la exención (mínimo 8 caracteres).');
  }
  return unwrap(
    sb().rpc('eximir_cuota_socio', {
      p_member_id: memberId,
      p_tier: tier,
      p_reason: clean,
    }),
    'No se pudo eximir la cuota'
  );
}

export async function upsertMember(member) {
  invalidateMembersListCache();
  const row = M.memberToRow(member);
  if (member.recordScope === 'list') {
    delete row.address;
    delete row.city;
    delete row.province;
    delete row.postal_code;
    delete row.birth_date;
    delete row.gender;
    delete row.marital_status;
    delete row.nationality;
    delete row.emergency_contact;
    delete row.emergency_phone;
    delete row.billing_name;
    delete row.cuit_cuil;
    delete row.tax_condition;
    delete row.notes;
    delete row.phone_alt;
  }
  if (member.profileId) row.profile_id = member.profileId;
  row.meta = { ...collectMemberMeta(member), ...(row.meta || {}) };
  let saved;
  let targetId = member.id || null;
  if (!targetId && member.memberId) {
    const existing = await unwrap(
      sb().from('members').select('id').eq('member_number', member.memberId).maybeSingle()
    );
    targetId = existing?.id || null;
  }
  if (targetId) {
    const current = await unwrap(
      sb().from('members').select('id, tier, meta').eq('id', targetId).maybeSingle(),
      'No se pudo leer el socio'
    );
    const nextExempt = dbMemberIsDuesExempt(row.tier, row.meta);
    const prevExempt = dbMemberIsDuesExempt(current?.tier, current?.meta);
    const tierChanged = String(row.tier || '') !== String(current?.tier || '');
    if (nextExempt && (!prevExempt || tierChanged)) {
      await eximirCuotaSocio(targetId, row.tier, member.exemptionReason);
    } else if (tierChanged) {
      await unwrap(
        sb().rpc('cambiar_categoria_socio', { p_member_id: targetId, p_tier: row.tier }),
        'No se pudo cambiar la categoría'
      );
    }
    const metaChanged = JSON.stringify(row.meta || {}) !== JSON.stringify(current?.meta || {});
    if (metaChanged) await saveMemberMeta(targetId, row.meta);
    saved = await updateMemberWithoutPrivilegeColumns(targetId, row);
  } else {
    saved = await unwrap(
      sb().from('members').insert(row).select().single(),
      'No se pudo crear socio'
    );
    const firstDues = Number(member.outstandingBalance) || 0;
    if (firstDues > 0) {
      await postMemberDuesDelta({
        memberId: saved.id,
        amount: firstDues,
        kind: 'alta',
        source: `alta:${saved.id}`,
      });
    }
  }

  if (Array.isArray(member.adherents)) {
    const persistable = member.adherents.filter((a) => a && !a.fromPadron);
    await sb().from('member_adherents').delete().eq('member_id', saved.id);
    if (persistable.length) {
      await unwrap(
        sb().from('member_adherents').insert(
          persistable.map((a) => ({
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
  const lastEdit = row.meta?.lastProfileEdit;
  await audit(
    lastEdit ? 'member.profile_update' : 'upsert',
    'members',
    saved.id,
    {
      member_number: saved.member_number,
      ...(lastEdit ? {
        actor_name: lastEdit.actorName || null,
        actor_id: lastEdit.actorId || null,
        source: lastEdit.source || null,
        at: lastEdit.at || null,
        changes: lastEdit.changes || [],
      } : {}),
    },
  );
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
  actorId = '',
  actorEmail = '',
  presentedOn = '',
  amount,
} = {}) {
  if (!member?.id && !member?.memberId) throw new Error('Socio inválido');
  const meta = buildLifecycleMeta(collectMemberMeta(member), {
    action,
    reasonId,
    reasonLabel,
    detail,
    actorName,
    actorId,
    actorEmail,
    presentedOn,
    amount,
  });
  const reason = [reasonLabel, detail].filter(Boolean).join('. ').trim();
  if (reason.length < 8) {
    throw new Error('Falta el motivo (mínimo 8 caracteres).');
  }
  const memberId = member.id;
  if (!isUuid(memberId)) throw new Error('Socio inválido');
  await unwrap(
    sb().rpc('cambiar_estado_socio', {
      p_member_id: memberId,
      p_status: status,
      p_reason: reason,
      p_meta: meta,
    }),
    'No se pudo cambiar el estado'
  );
  const full = await unwrap(
    sb().from('members').select('*, member_adherents(*)').eq('id', memberId).single()
  );
  const saved = M.memberFromRow(full);
  await audit(`member.${action}`, 'members', saved.id || member.id, {
    member_number: saved.memberId || member.memberId,
    status,
    reasonId,
    reason: reasonLabel,
    detail: String(detail || '').trim() || null,
    actor_name: (action === 'activate' ? saved.reactivateActorName : saved.bajaActorName)
      || saved.meta?.lastLifecycle?.actorName || actorName || null,
    actor_email: (action === 'activate' ? saved.reactivateActorEmail : saved.bajaActorEmail)
      || saved.meta?.lastLifecycle?.actorEmail || actorEmail || null,
    registered_at: (action === 'activate' ? saved.reactivateRegistradaAt : saved.bajaRegistradaAt)
      || saved.meta?.lastLifecycle?.registeredAt || null,
    reactivate_motivo: saved.reactivateMotivo || null,
    reactivate_fecha: saved.reactivateFecha || null,
    baja_kind: saved.bajaKind || null,
    baja_presentada: saved.bajaPresentada || null,
    baja_fecha: saved.bajaFecha || null,
    baja_monto: saved.bajaMonto ?? null,
  });
  return saved;
}

/**
 * Vincula el usuario de portal sin reescribir la ficha ni los adherentes.
 * El padrón completo pesa y el alta de acceso no necesita tocarla.
 */
export async function linkMemberPortalAccess(member, profileId, creds, actorName = '') {
  const portalMeta = {
    portalUsername: creds?.username || null,
    portalProvisionedAt: new Date().toISOString(),
    portalProvisionedBy: actorName || null,
  };
  if (!member?.id || !isUuid(member.id)) {
    return upsertMember({
      ...member,
      profileId,
      email: member?.email || creds?.email,
      meta: { ...collectMemberMeta(member), ...portalMeta },
    });
  }
  const current = await unwrap(
    sb().from('members').select('meta').eq('id', member.id).maybeSingle(),
    'No se pudo leer la ficha'
  );
  const prev = current?.meta && typeof current.meta === 'object' ? current.meta : {};
  const meta = { ...prev, ...portalMeta };
  const saved = await unwrap(
    sb().from('members').update({
      profile_id: profileId,
    }).eq('id', member.id).select('id, profile_id, member_number').single(),
    'No se pudo vincular el acceso'
  );
  await saveMemberMeta(member.id, meta);
  void audit('member.provision_access', 'members', saved.id, {
    member_number: saved.member_number || member.memberId,
    username: creds?.username || null,
    profile_id: profileId,
  });
  return {
    ...member,
    id: saved.id,
    profileId: saved.profile_id || profileId,
    memberId: member.memberId || saved.member_number,
    meta,
  };
}

/**
 * Provisiona acceso portal para un socio (Auth + profile) y lo vincula.
 */
export async function provisionMemberPortalAccess(member, creds, { actorName = '' } = {}) {
  if (!member) throw new Error('Socio inválido');
  const { firstName, lastName } = splitMemberName(member);
  const payload = {
    firstName: firstName || member.name || 'Socio',
    lastName: lastName || '',
    email: creds.email || member.email,
    username: creds.username,
    password: creds.password,
    phone: member.phone || '',
    contactEmail: member.email && member.email !== creds.email ? member.email : (member.email || null),
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
  };
  const profile = await createPortalUser(payload, { assignRoles: false });
  const [, linked] = await Promise.all([
    replaceProfileRoles(profile.id, payload.roles),
    linkMemberPortalAccess(member, profile.id, creds, actorName),
  ]);
  return { member: linked, profile, creds };
}

export async function insertMemberPayment(memberDbId, payment) {
  if (Number(payment.waivedSurcharge) > 0) {
    throw new Error('El recargo no se perdona al cobrar.');
  }
  const paidDay = String(payment.date || '').slice(0, 10) || todayAR();
  const row = {
    member_id: memberDbId,
    amount: Number(payment.amount) || 0,
    paid_at: paidDay,
    method: payment.method || null,
    concept: payment.concept || null,
    period_label: payment.period || null,
    receipt_number: payment.receiptNumber || payment.receipt || null,
    journal_entry_id: payment.journalEntryId || null,
    meta: {
      ...(payment.paidAt ? { paidAt: payment.paidAt } : {}),
      ...(payment.time ? { time: payment.time } : {}),
      ...(payment.bankName ? { bank: payment.bankName } : {}),
      ...(payment.bankId ? { bankId: payment.bankId } : {}),
      ...(payment.receiptName ? { receiptName: payment.receiptName } : {}),
      ...(payment.receiptPath ? { receiptPath: payment.receiptPath } : {}),
      ...(payment.receiptBucket ? { receiptBucket: payment.receiptBucket } : {}),
      ...(payment.receiptMime ? { receiptMime: payment.receiptMime } : {}),
      ...(payment.receiptSize != null ? { receiptSize: payment.receiptSize } : {}),
      ...(Array.isArray(payment.periodDueOns) && payment.periodDueOns.length
        ? { periodDueOns: payment.periodDueOns }
        : {}),
      ...(payment.quota != null ? { quota: payment.quota } : {}),
      ...(payment.surcharge != null ? { surcharge: payment.surcharge } : {}),
      ...(Number(payment.waivedSurcharge) > 0
        ? { waiveSurcharge: true, waivedSurcharge: Number(payment.waivedSurcharge) }
        : {}),
      ...(payment.paymentPlanId ? { paymentPlanId: payment.paymentPlanId } : {}),
      ...(payment.paymentPlanLabel ? { paymentPlanLabel: payment.paymentPlanLabel } : {}),
      ...(payment.receiptParse && typeof payment.receiptParse === 'object'
        ? { receiptParse: payment.receiptParse }
        : {}),
      ...(Array.isArray(payment.paymentSplits) && payment.paymentSplits.length
        ? { paymentSplits: payment.paymentSplits }
        : {}),
    },
  };
  const saved = await unwrap(
    sb().from('member_payments').insert(row).select().single(),
    'No se pudo registrar pago'
  );
  await audit('create', 'member_payments', saved.id, row);
  return M.paymentFromRow(saved);
}

/** Quita el recargo de un cobro ya acreditado. Solo superadmin, con motivo. */
export async function quitarRecargoCuota({ paymentId, reason }) {
  const balance = await unwrap(
    sb().rpc('quitar_recargo_cuota', {
      p_payment_id: paymentId,
      p_reason: String(reason || '').trim(),
    }),
    'No se pudo quitar el recargo',
  );
  const value = Number(balance);
  if (!Number.isFinite(value)) throw new Error('La base no devolvió el saldo.');
  return value;
}

/** Suma o resta el saldo del socio. Un ajuste pide motivo: lo exige la base. */
export async function postMemberDuesDelta({ memberId, amount, kind = 'ajuste', source, reason }) {
  const valueAmount = Number(amount) || 0;
  const why = String(reason || '').trim();
  if ((valueAmount < 0 || kind !== 'alta') && why.length < 8) {
    throw new Error('Falta el motivo del ajuste (mínimo 8 caracteres).');
  }
  const balance = await unwrap(
    sb().rpc('post_member_dues_delta', {
      p_member_id: memberId,
      p_amount: valueAmount,
      p_kind: kind,
      p_source: source || '',
      p_reason: why,
    }),
    'No se pudo actualizar el saldo',
  );
  const value = Number(balance);
  if (!Number.isFinite(value)) throw new Error('La base no devolvió el saldo.');
  return value;
}

/** Devuelve al saldo el capital que había bajado ese cobro. Exige un motivo. */
export async function revertDuesPayment(paymentId, reason) {
  const why = String(reason || '').trim();
  if (why.length < 8) {
    throw new Error('Falta el motivo de la anulación (mínimo 8 caracteres).');
  }
  const balance = await unwrap(
    sb().rpc('revert_dues_payment', { p_payment_id: paymentId, p_reason: why }),
    'No se pudo anular el cobro en el saldo',
  );
  const value = Number(balance);
  if (!Number.isFinite(value)) throw new Error('La base no devolvió el saldo.');
  return value;
}

/** Recibo, imputación de períodos y saldo, en una sola transacción. */
export async function registrarCobro({ memberId, amount, periods, idempotencyKey }) {
  const data = await unwrap(
    sb().rpc('registrar_cobro', {
      p_member_id: memberId,
      p_importe: Number(amount) || 0,
      p_periodos: periods && typeof periods === 'object' ? periods : {},
      p_idempotency_key: String(idempotencyKey || ''),
    }),
    'No se pudo registrar el cobro',
  );
  const paymentRow = data?.payment;
  if (!paymentRow?.id) {
    throw new Error('No se pudo registrar el cobro');
  }
  const balance = Number(data.outstandingBalance);
  if (!Number.isFinite(balance)) {
    throw new Error('El cobro no devolvió el saldo.');
  }
  const imputations = Array.isArray(data.imputations) ? data.imputations : [];
  return {
    payment: { ...M.paymentFromRow(paymentRow), imputations },
    outstandingBalance: balance,
    nextDueDate: data.nextDueDate ? String(data.nextDueDate).slice(0, 10) : null,
    idempotent: Boolean(data.idempotent),
    imputations,
  };
}
