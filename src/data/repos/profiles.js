import * as M from '../mappers';
import { unwrap, throwOnError } from '../errors';
import { SYSTEM_ADMIN_ROLES } from '../../domain/auth/roles';
import { isUuid, sb, audit } from './shared.js';

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

/** Solo administradores del sistema (admin / superadmin), aunque también sean socios. */
export async function listSystemAdminProfiles() {
  const [roleRows, columnRows] = await Promise.all([
    unwrap(
      sb()
        .from('profile_roles')
        .select('profile_id')
        .in('role_key', SYSTEM_ADMIN_ROLES)
        .is('revoked_at', null),
      'No se pudieron cargar administradores del sistema'
    ),
    unwrap(
      sb()
        .from('profiles')
        .select('id')
        .in('role', SYSTEM_ADMIN_ROLES),
      'No se pudieron cargar administradores del sistema'
    ),
  ]);
  const ids = [...new Set([
    ...(roleRows || []).map((r) => r.profile_id),
    ...(columnRows || []).map((r) => r.id),
  ].filter(Boolean))];
  if (!ids.length) return [];

  const rows = await unwrap(
    sb()
      .from('profiles')
      .select('*, profile_authorizations(*), profile_identifiers(*)')
      .in('id', ids)
      .order('created_at', { ascending: false }),
    'No se pudieron cargar administradores del sistema'
  );
  const withRoles = await attachProfileRoles(rows || []);
  return withRoles.map(M.profileFromRow).filter((p) => (
    SYSTEM_ADMIN_ROLES.includes(String(p.role || '').toLowerCase())
    || (p.roles || []).some((r) => SYSTEM_ADMIN_ROLES.includes(String(r.roleKey || '').toLowerCase()))
  ));
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
  // El rol primario no se cambia por acá: solo replaceProfileRoles (superadmin).
  if (patch.isActive !== undefined) row.is_active = Boolean(patch.isActive);
  if (patch.disciplineIds !== undefined) {
    row.discipline_ids = Array.isArray(patch.disciplineIds)
      ? patch.disciplineIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
      : [];
  }

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
export async function createPortalUser(payload, options = {}) {
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
  const tasks = [
    audit('profile.create', 'profile', profile.id, {
      email: payload.email,
      username: payload.username,
      roles: payload.roles || [],
    }),
  ];
  if (options.assignRoles !== false && Array.isArray(payload.roles) && payload.roles.length) {
    tasks.push(replaceProfileRoles(profile.id, payload.roles).then((next) => {
      profile = next;
    }));
  }
  await Promise.all(tasks);
  return profile;
}

/**
 * Cuenta de portal que ya usa ese email, si no está vinculada a otro socio.
 * Sirve para no intentar cambiar el email de la ficha vieja (@jockey.sj).
 */
export async function portalProfileIdForLogin(email, memberDbId) {
  const login = String(email || '').trim().toLowerCase();
  if (!login.includes('@')) return null;
  const rows = await unwrap(
    sb().from('profiles').select('id').eq('email', login).limit(1),
    'No se pudo buscar el email'
  );
  const profileId = rows?.[0]?.id;
  if (!profileId) return null;
  const owners = await unwrap(
    sb().from('members').select('id, member_number').eq('profile_id', profileId),
    'No se pudo verificar el acceso'
  );
  const other = (owners || []).find((row) => row.id !== memberDbId);
  if (other) {
    throw new Error(`Ese email ya es el acceso del socio Nº ${other.member_number || '—'}.`);
  }
  return profileId;
}

/** Regenera la contraseña de un usuario existente (superadmin vía edge). */
export async function resetPortalUserPassword(profileId, password, email) {
  if (!isUuid(profileId)) throw new Error('Perfil inválido');
  if (!password || String(password).length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres');
  }

  const { data: sessionData } = await sb().auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sesión no válida. Volvé a iniciar sesión.');

  const loginEmail = String(email || '').trim().toLowerCase();
  const { data, error } = await sb().functions.invoke('admin-create-user', {
    body: {
      action: 'reset_password',
      userId: profileId,
      password,
      ...(loginEmail.includes('@') ? { email: loginEmail } : {}),
    },
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
    if (/error updating user/i.test(detail)) {
      detail = 'Ese email ya pertenece a otra cuenta del portal.';
    }
    throw new Error(data?.error || detail);
  }
  if (data?.error) throw new Error(data.error);

  void audit('profile.reset_password', 'profile', profileId, { reset: true });
  return true;
}

/** Aviso de vencimiento del socio de la sesión: campanita + mail, una vez por fecha. */
export async function requestOwnDueNotice() {
  const { data: sessionData } = await sb().auth.getSession();
  if (!sessionData?.session?.access_token) return { ok: false };
  const { data, error } = await sb().functions.invoke('send-due-notices', {
    body: { scope: 'self' },
  });
  if (error || data?.error) return { ok: false };
  return { ok: true, sent: data?.sent || 0 };
}

/** Envía la plantilla de acceso por Resend (edge function). */
export async function sendAccessInviteEmail({
  to,
  name,
  username,
  loginEmail,
  password,
  portalUrl,
  logoUrl,
} = {}) {
  const dest = String(to || '').trim();
  if (!dest || !dest.includes('@')) {
    throw new Error('Falta el email de contacto para enviar el acceso.');
  }
  const { data: sessionData } = await sb().auth.getSession();
  if (!sessionData?.session?.access_token) {
    throw new Error('Sesión no válida. Volvé a iniciar sesión.');
  }
  const { data, error } = await sb().functions.invoke('send-access-invite', {
    body: {
      to: dest,
      name,
      username,
      loginEmail,
      password,
      portalUrl,
      logoUrl,
    },
  });
  if (error) {
    let detail = error.message || 'No se pudo enviar el mail';
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
  return { ok: true, id: data?.id || null, to: dest };
}

async function invokeFunction(name, body, fallback) {
  const { data, error } = await sb().functions.invoke(name, { body });
  if (error) {
    let detail = error.message || fallback;
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json();
        if (parsed?.error) detail = parsed.error;
      }
    } catch {
      /* ignore */
    }
    const raw = String(data?.error || detail || fallback);
    if (/restricted to only send/i.test(raw)) {
      throw new Error('La clave de Resend solo puede enviar. Hace falta una clave con acceso a la bandeja.');
    }
    if (/Failed to send a request to the Edge Function/i.test(raw)) {
      throw new Error(name === 'send-club-mail'
        ? 'El envío de mail no está disponible. Reintentá.'
        : 'La bandeja de mail no está disponible. Reintentá.');
    }
    throw new Error(raw);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createMercadoPagoCheckout({
  kind = 'dues',
  amount,
  memberNumber,
  concept,
  guestName,
  booking = null,
  channel,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
} = {}) {
  return invokeFunction('mp-create', {
    kind,
    amount,
    memberNumber,
    concept,
    guestName,
    booking,
    channel,
    origin,
  }, 'No se pudo abrir Mercado Pago');
}

export async function getMercadoPagoIntent(id) {
  if (!id) return null;
  const row = await unwrap(
    sb().from('mp_intents').select('*').eq('id', id).maybeSingle(),
    'No se pudo leer el cobro de Mercado Pago',
  );
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amount: Number(row.amount) || 0,
    initPoint: row.init_point || row.sandbox_init_point || '',
    qrData: row.meta?.qr_data || '',
    appliedAt: row.applied_at || null,
    memberNumber: row.member_number,
  };
}

/** Mail del boleto de Mercado Pago al socio logueado. El destino sale de su ficha. */
export async function sendPaymentBoletoEmail({
  amountLabel,
  receiptNo,
  periodLabel,
  pdfBase64,
  fileName,
} = {}) {
  const { data, error } = await sb().functions.invoke('send-payment-boleto', {
    body: {
      amountLabel,
      receiptNo,
      periodLabel,
      pdfBase64,
      fileName,
    },
  });
  if (error) {
    let detail = error.message || 'No se pudo enviar el boleto por mail';
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
  return data;
}

/**
 * Envía boletos/comprobantes de un lote de importación Excel (edge send-import-receipts).
 * Reintenta mientras queden pendientes del mismo importSource.
 */
export async function sendImportReceiptsBatch({
  importSource,
  limit = 40,
  maxRounds = 40,
  onProgress,
} = {}) {
  const source = String(importSource || '').trim();
  if (!source) throw new Error('Falta importSource del lote.');
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let rounds = 0;
  let pending = null;
  while (rounds < maxRounds) {
    rounds += 1;
    const { data, error } = await sb().functions.invoke('send-import-receipts', {
      body: { importSource: source, limit },
    });
    if (error) {
      let detail = error.message || 'No se pudieron enviar los boletos';
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
    sent += Number(data?.sent) || 0;
    skipped += Number(data?.skipped) || 0;
    failed += Number(data?.failed) || 0;
    pending = Number(data?.pending);
    if (typeof onProgress === 'function') {
      onProgress({
        rounds,
        sent,
        skipped,
        failed,
        pending: Number.isFinite(pending) ? pending : null,
        last: data,
      });
    }
    const processed = Number(data?.processed) || 0;
    if (!processed || (Number.isFinite(pending) && pending <= processed)) break;
  }
  return { ok: true, importSource: source, sent, skipped, failed, rounds, pending };
}

/** Comprobante de pago (caja / cuota) al mail real del socio. Misma regla que Mercado Pago. */
export async function sendPaymentReceiptEmail({
  memberNumber,
  amountLabel,
  receiptNo,
  concept,
  methodLabel,
  dateLabel,
  periodLabel,
  pdfBase64,
  fileName,
} = {}) {
  const { data, error } = await sb().functions.invoke('send-payment-receipt', {
    body: {
      memberNumber,
      amountLabel,
      receiptNo,
      concept,
      methodLabel,
      dateLabel,
      periodLabel,
      pdfBase64,
      fileName,
    },
  });
  if (error) {
    let detail = error.message || 'No se pudo enviar el comprobante por mail';
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
  return data;
}

/** Comunicado por mail (uno o a todos). Reintenta mientras queden lotes. */
export async function sendClubMailCampaign({
  subject,
  text,
  audience = 'all',
  memberNumber = '',
  campaignId,
  onProgress,
} = {}) {
  const { data: sessionData } = await sb().auth.getSession();
  if (!sessionData?.session?.access_token) {
    throw new Error('Sesión no válida. Volvé a iniciar sesión.');
  }
  let id = campaignId || (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `camp-${Date.now()}`);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let more = true;
  let guard = 0;
  let lastError = '';
  while (more && guard < 40) {
    const data = await invokeFunction('send-club-mail', {
      subject,
      text,
      audience,
      memberNumber,
      campaignId: id,
    }, 'No se pudo enviar el mail');
    sent += Number(data?.sent) || 0;
    failed += Number(data?.failed) || 0;
    skipped += Number(data?.skipped) || 0;
    more = Boolean(data?.more);
    id = data?.campaignId || id;
    lastError = String(data?.error || '');
    guard += 1;
    if (typeof onProgress === 'function') onProgress({ sent, failed, skipped, more, campaignId: id });
    if (audience === 'one') break;
  }
  if (lastError && sent === 0 && failed === 0) {
    throw new Error(lastError);
  }
  return { ok: true, sent, failed, skipped, campaignId: id };
}

/** Bandeja de mail recibido en socios@ (Resend inbox). */
export async function listClubInbox() {
  const data = await invokeFunction('club-mail-inbox', { action: 'list' }, 'No se pudo leer el mail recibido');
  const threads = Array.isArray(data?.threads) ? data.threads : [];
  return {
    threads,
    total: Number(data?.total) || threads.length,
    unread: Number(data?.unread) || threads.filter((row) => row?.unread).length,
    truncated: Boolean(data?.truncated),
  };
}

export async function readClubInboxThread(threadId) {
  const data = await invokeFunction('club-mail-inbox', { action: 'read', threadId }, 'No se pudo abrir el mail');
  return Array.isArray(data?.emails) ? data.emails : [];
}

export async function markClubInboxThreadRead(threadId) {
  const data = await invokeFunction(
    'club-mail-inbox',
    { action: 'mark_read', threadId },
    'No se pudo marcar el mail como leído',
  );
  return Boolean(data?.ok);
}

/** Bandeja de comunicados por mail enviados desde Mensajería. */
export async function listClubMailSends({ limit = 500 } = {}) {
  const { data, error } = await sb()
    .from('club_mail_sends')
    .select('id, campaign_id, email, member_number, subject, resend_id, email_error, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(2000, Math.max(1, Number(limit) || 500)));
  throwOnError(error, 'No se pudo leer la bandeja de mail');
  return (data || []).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    email: row.email,
    memberNumber: row.member_number,
    subject: row.subject,
    sent: Boolean(row.resend_id),
    error: row.email_error || '',
    createdAt: row.created_at,
  }));
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
  teacher: 'Profesor',
  staff: 'Personal',
  hr: 'Recursos humanos',
  admin_employee: 'Empleado de administración',
  gate_operator: 'Operador de portería',
  pool_operator: 'Operario de pileta',
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
