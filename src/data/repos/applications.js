import * as M from '../mappers';
import { unwrap, throwOnError } from '../errors';
import { emptyJoinConflicts, hasJoinIdentityConflict, joinConflictsFromFlags, joinIdentityConflicts, JoinIdentityTakenError, mergeOpenAccessRequest } from '../../domain/members/selfService';
import { supabase } from '../../lib/supabase';
import { isUuid, sb, audit } from './shared.js';
import { searchMembersDirectory, getMemberByNumber, getMember, isMissingRpc } from './members.js';

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
    saved = await insertPublicRow('membership_applications', row, 'No se pudo crear la solicitud de socio');
  }
  await audit(
    app.id ? 'membership_application.update' : 'membership_application.create',
    'membership_application',
    saved.id,
    { status: saved.status, email: saved.email }
  );
  return M.membershipApplicationFromRow(saved);
}

const LOCAL_APPS_KEY = 'jockey-membership-applications';
const LOCAL_ACCESS_KEY = 'jockey-portal-access-requests';

function readLocalList(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeLocalList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

export function loadLocalMembershipApplications() {
  return readLocalList(LOCAL_APPS_KEY);
}

export function loadLocalPortalAccessRequests() {
  return readLocalList(LOCAL_ACCESS_KEY);
}

function stampLocalRecord(item) {
  const now = new Date().toISOString();
  return {
    ...item,
    id: item.id || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `local-${Date.now()}`),
    status: item.status || 'pending',
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
}

export async function listPortalAccessRequests() {
  const rows = await unwrap(
    sb()
      .from('portal_access_requests')
      .select('*')
      .order('created_at', { ascending: false }),
    'No se pudieron cargar pedidos de acceso'
  );
  return (rows || []).map(M.portalAccessRequestFromRow);
}

export async function upsertPortalAccessRequest(req) {
  const row = M.portalAccessRequestToRow(req);
  let saved;
  if (req.id && isUuid(req.id)) {
    saved = await unwrap(
      sb().from('portal_access_requests').update(row).eq('id', req.id).select().single(),
      'No se pudo actualizar el pedido de acceso'
    );
  } else {
    saved = await insertPublicRow('portal_access_requests', row, 'No se pudo registrar el pedido de acceso');
  }
  await audit(
    req.id ? 'portal_access_request.update' : 'portal_access_request.create',
    'portal_access_request',
    saved.id,
    { status: saved.status, reason: saved.reason }
  );
  return M.portalAccessRequestFromRow(saved);
}

/** Alta pública: el visitante puede insertar, no leer la fila. El id lo pone el cliente. */
async function insertPublicRow(table, row, fallback) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '';
  if (!isUuid(id)) throw new Error(fallback);
  const now = new Date().toISOString();
  const inserted = { ...row, id };
  await unwrap(sb().from(table).insert(inserted), fallback);
  return { ...inserted, created_at: now, updated_at: now };
}

function foldMemberName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Intenta atar el trámite a una ficha del padrón (id, Nº, DNI o nombre único). */
export async function resolveMemberForApplication(app = {}) {
  if (app.memberId && isUuid(app.memberId)) {
    try {
      const row = await getMember(app.memberId);
      if (row) return row;
    } catch {
      /* seguir con Nº / DNI / nombre */
    }
  }
  const number = String(app.memberNumber || '').trim();
  if (number) {
    try {
      const row = await getMemberByNumber(number);
      if (row) return row;
    } catch {
      /* seguir */
    }
  }
  const doc = String(app.documentNumber || '').replace(/\D/g, '');
  const name = String(app.fullName || '').trim();
  const query = doc.length >= 6 ? doc : name;
  if (!query || query.length < 2) return null;
  try {
    const rows = await searchMembersDirectory(query, { limit: 20 });
    if (doc.length >= 6) {
      const exactDoc = (rows || []).filter((m) => String(m.documentNumber || '').replace(/\D/g, '') === doc);
      if (exactDoc.length === 1) return exactDoc[0];
    }
    const q = foldMemberName(name);
    if (q.length >= 4) {
      const exactName = (rows || []).filter((m) => foldMemberName(m.name) === q);
      if (exactName.length === 1) return exactName[0];
      const tokens = q.split(' ').filter((t) => t.length >= 3);
      const contains = (rows || []).filter((m) => {
        const hay = foldMemberName(m.name);
        return hay.includes(q) || (tokens.length > 0 && tokens.every((t) => hay.includes(t)));
      });
      if (contains.length === 1) return contains[0];
    }
  } catch {
    return null;
  }
  return null;
}

function isMissingJoinIdentityRpc(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return code === 'PGRST202' || code === '42883' || /check_join_identity_taken/i.test(msg);
}

/** ¿Nombre, DNI o celular ya están en el padrón? No revela la ficha. */
export async function checkJoinIdentityTaken(app = {}) {
  const empty = emptyJoinConflicts();
  const name = String(app.fullName || '').trim();
  const doc = String(app.documentNumber || '').replace(/\D/g, '');
  const phone = String(app.phone || '').trim();
  if (!name && !doc && !phone) return empty;

  if (supabase) {
    const { data, error } = await sb().rpc('check_join_identity_taken', {
      p_full_name: name,
      p_document: doc,
      p_phone: phone,
    });
    if (!error) return joinConflictsFromFlags(data || {});
    if (!isMissingJoinIdentityRpc(error)) {
      throwOnError(error, 'No se pudo verificar el padrón');
    }
  }

  const queries = [];
  if (doc.length >= 6) queries.push(searchMembersDirectory(doc, { limit: 20 }));
  if (name.length >= 5) queries.push(searchMembersDirectory(name, { limit: 20 }));
  if (!queries.length) return empty;
  const batches = await Promise.all(queries);
  return joinIdentityConflicts(app, batches.flat());
}

/** Alta pública o local: no revela ni ata a un socio existente. */
export async function submitMembershipApplication(app) {
  const taken = await checkJoinIdentityTaken(app);
  if (hasJoinIdentityConflict(taken)) {
    throw new JoinIdentityTakenError(taken);
  }
  const payload = { ...app, status: app.status || 'pending', memberId: null };
  if (!supabase) {
    const item = stampLocalRecord(payload);
    writeLocalList(LOCAL_APPS_KEY, [item, ...loadLocalMembershipApplications().filter((x) => x.id !== item.id)]);
    return item;
  }
  return upsertMembershipApplication(payload);
}

export async function submitPortalAccessRequest(req) {
  let matched;
  try {
    matched = await resolveMemberForApplication({
      fullName: req.fullName,
      documentNumber: req.documentNumber,
      memberNumber: req.memberNumber,
      memberId: req.memberDbId || req.memberId,
    });
  } catch {
    matched = null;
  }
  const payload = {
    ...req,
    status: req.status || 'pending',
    memberNumber: matched?.memberId || req.memberNumber || null,
    memberDbId: matched?.id || req.memberDbId || null,
  };
  if (!supabase) {
    const stamped = stampLocalRecord(payload);
    const merged = mergeOpenAccessRequest(loadLocalPortalAccessRequests(), stamped);
    writeLocalList(LOCAL_ACCESS_KEY, merged.list);
    return merged.item;
  }
  const { data, error } = await sb().rpc('submit_portal_access_request', {
    p_full_name: payload.fullName,
    p_document_number: payload.documentNumber || null,
    p_member_number: payload.memberNumber || null,
    p_phone: payload.phone || null,
    p_email: payload.email || null,
    p_reason: payload.reason || 'first_access',
    p_member_id: isUuid(payload.memberDbId) ? payload.memberDbId : null,
  });
  if (!error && data) {
    return { ...payload, id: data, status: 'pending' };
  }
  if (error && !isMissingRpc(error)) {
    throwOnError(error, 'No se pudo registrar el pedido de acceso');
  }
  return upsertPortalAccessRequest(payload);
}
