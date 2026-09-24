import { nextDuesDueDate, pinDuesDueDate, toWhatsAppPhone } from './dues';
import { todayISODateAR } from '../../lib/arDate';
import { loginEmailFromUsername } from '../auth/credentials';
import { buildAccessInviteEmail } from './accessInviteEmail';

/** Pedidos públicos de alta y de acceso al portal. Secretaría los resuelve. */

export const ACCESS_REASONS = [
  { id: 'first_access', label: 'No tengo usuario' },
  { id: 'forgot_password', label: 'Olvidé la contraseña' },
];

export function accessReasonLabel(reason) {
  return ACCESS_REASONS.find((r) => r.id === reason)?.label || 'Pedido de acceso';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function foldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Últimos 10 dígitos nacionales (AR) para comparar celulares. */
export function joinPhoneKey(value) {
  let d = digits(value);
  if (!d) return '';
  if (d.startsWith('549') && d.length >= 12) return d.slice(-10);
  if (d.startsWith('54') && d.length >= 11) return d.slice(-10);
  if (d.length >= 10) return d.slice(-10);
  return d;
}

export function emptyJoinConflicts() {
  return { fullName: false, documentNumber: false, phone: false };
}

export function joinConflictsFromFlags(flags = {}) {
  return {
    fullName: Boolean(flags.fullName),
    documentNumber: Boolean(flags.documentNumber),
    phone: Boolean(flags.phone),
  };
}

export function hasJoinIdentityConflict(conflicts) {
  return Boolean(conflicts?.fullName || conflicts?.documentNumber || conflicts?.phone);
}

export function joinFieldConflictHint(field) {
  if (field === 'documentNumber') return 'Ese documento ya figura en el padrón.';
  if (field === 'phone') return 'Ese celular ya figura en el padrón.';
  if (field === 'fullName') return 'Ese nombre y apellido ya figura en el padrón.';
  return '';
}

export function joinConflictMessage(conflicts) {
  const parts = [];
  if (conflicts?.documentNumber) parts.push('documento');
  if (conflicts?.phone) parts.push('celular');
  if (conflicts?.fullName) parts.push('nombre y apellido');
  if (!parts.length) return '';
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
  return `Ese ${list} ya figura en el padrón. Si ya sos socio, usá “Ya soy socio”.`;
}

export class JoinIdentityTakenError extends Error {
  constructor(conflicts = emptyJoinConflicts()) {
    super(joinConflictMessage(conflicts) || 'JOIN_IDENTITY_TAKEN');
    this.name = 'JoinIdentityTakenError';
    this.code = 'JOIN_IDENTITY_TAKEN';
    this.conflicts = joinConflictsFromFlags(conflicts);
  }
}

/** Marca campos de alta que coinciden exactos con un socio existente. */
export function joinIdentityConflicts(form = {}, members = []) {
  const name = foldName(form.fullName);
  const nameOk = name.length >= 5 && name.split(' ').filter(Boolean).length >= 2;
  const doc = digits(form.documentNumber);
  const phone = joinPhoneKey(form.phone);
  let fullName = false;
  let documentNumber = false;
  let phoneTaken = false;
  for (const member of members) {
    if (nameOk && foldName(member?.name) === name) fullName = true;
    if (doc.length >= 6 && digits(member?.documentNumber) === doc) documentNumber = true;
    if (phone.length >= 8 && joinPhoneKey(member?.phone) === phone) phoneTaken = true;
  }
  return { fullName, documentNumber, phone: phoneTaken };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Candidatos por nombre/apellido (Bonilla, etc.). */
export function findMemberNameCandidates(members = [], query, { limit = 8 } = {}) {
  const q = foldName(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ').filter((t) => t.length >= 2);
  const scored = [];
  for (const member of members) {
    const name = foldName(member?.name);
    if (!name) continue;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q) || name.includes(` ${q}`)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (tokens.length && tokens.every((t) => name.includes(t))) score = 50;
    else continue;
    scored.push({ member, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(20, Math.max(1, Number(limit) || 8)))
    .map((row) => row.member);
}

/** Busca ficha por id, Nº de socio, DNI o nombre único. */
export function matchMemberForAccessRequest(members = [], request) {
  const dbId = String(request?.memberDbId || '').trim()
    || (UUID_RE.test(String(request?.memberId || '')) ? String(request.memberId) : '');
  if (dbId) {
    const byId = members.find((m) => String(m.id) === dbId);
    if (byId) return byId;
  }
  const num = String(request?.memberNumber || request?.matchedMemberNumber || '').trim()
    || (!UUID_RE.test(String(request?.memberId || '')) ? String(request?.memberId || '').trim() : '');
  if (num) {
    const byNumber = members.find((m) => String(m.memberId || '') === num);
    if (byNumber) return byNumber;
  }
  const doc = digits(request?.documentNumber);
  if (doc.length >= 6) {
    const byDoc = members.find((m) => digits(m.documentNumber) === doc);
    if (byDoc) return byDoc;
  }
  const hits = findMemberNameCandidates(members, request?.fullName, { limit: 8 });
  return hits.length === 1 ? hits[0] : null;
}

export function requestStatusLabel(status) {
  if (status === 'approved') return 'Resuelto';
  if (status === 'rejected') return 'Rechazado';
  return 'Pendiente';
}

export function formatRequestWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatRequestDate(iso) {
  if (!iso) return '—';
  const raw = String(iso).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}/${m}/${y}`;
  }
  return formatRequestWhen(iso);
}

function dash(value) {
  const text = String(value || '').trim();
  return text || '—';
}

/** Filas de la ficha (modal + PDF). */
export function buildRequestDetail(kind, item, extras = {}) {
  const status = requestStatusLabel(item?.status);
  if (kind === 'acceso') {
    return {
      kind,
      title: 'Pedido de acceso al portal',
      subtitle: dash(item?.fullName),
      filePrefix: 'pedido-acceso',
      rows: [
        ['Nombre', dash(item?.fullName)],
        ['DNI', dash(item?.documentNumber)],
        ['Nº de socio', dash(item?.memberNumber)],
        ['Celular', dash(item?.phone)],
        ['Email', dash(item?.email)],
        ['Motivo', accessReasonLabel(item?.reason)],
        ['Estado', status],
        ['Recibido', formatRequestWhen(item?.createdAt)],
        ['Ficha en padrón', extras.matchName || 'Sin coincidencia automática'],
        ['Nota', dash(item?.notes)],
      ],
    };
  }
  const address = [item?.address, item?.city, item?.province].filter(Boolean).join(', ');
  return {
    kind,
    title: 'Solicitud de ingreso',
    subtitle: dash(item?.fullName),
    filePrefix: 'solicitud-ingreso',
    rows: [
      ['Nombre', dash(item?.fullName)],
      ['Documento', `${item?.documentType || 'DNI'} ${dash(item?.documentNumber)}`.trim()],
      ['Celular', dash(item?.phone)],
      ['Email', dash(item?.email)],
      ['Nacimiento', formatRequestDate(item?.birthDate)],
      ['Domicilio', dash(address)],
      ['Categoría pedida', extras.tierLabel || 'A definir con secretaría'],
      ['Comentario', dash(item?.notes)],
      ['Estado', status],
      ['Recibido', formatRequestWhen(item?.createdAt)],
      ['Ficha en padrón', extras.matchName || 'Sin coincidencia automática'],
    ],
  };
}

export function portalLoginUrl() {
  if (typeof window === 'undefined') return '/';
  return `${window.location.origin}/`;
}

/** Día de ingreso en Argentina: el de la solicitud, no el de la ficha vieja. */
export function joinDateFromApplication(app, fallback = null) {
  const raw = app?.createdAt;
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return todayISODateAR(date);
  }
  return fallback || todayISODateAR();
}

/** Alta mínima desde una solicitud pública (sin disciplinas obligatorias). */
export function memberDraftFromApplication(app) {
  const joinDate = joinDateFromApplication(app);
  return {
    name: String(app?.fullName || '').trim(),
    memberId: String(Math.floor(1000000000000000 + Math.random() * 9000000000000000)),
    documentType: app?.documentType || 'DNI',
    documentNumber: String(app?.documentNumber || '').trim(),
    birthDate: app?.birthDate || null,
    email: String(app?.email || '').trim(),
    phone: String(app?.phone || '').trim(),
    address: String(app?.address || '').trim(),
    city: String(app?.city || 'San Juan').trim(),
    province: String(app?.province || 'San Juan').trim(),
    nationality: 'Argentina',
    tier: app?.requestedTier || 'socio_individual',
    status: 'active',
    joinDate,
    nextDueDate: pinDuesDueDate(nextDuesDueDate(joinDate)),
    disciplines: ['Social'],
    notes: String(app?.notes || '').trim(),
    outstandingBalance: 0,
    yearsActive: 1,
    adherents: [],
    billingName: String(app?.fullName || '').trim(),
    paymentMethod: 'transferencia',
    taxCondition: 'consumidor_final',
  };
}

/**
 * Alta desde el formulario: si el DNI ya está en el padrón, no se deja
 * la ficha vieja. Se pisan nombre, contacto y la categoría pedida.
 */
export function applyJoinApplicationToMember(app, existing = null) {
  const draft = memberDraftFromApplication(app);
  if (!existing) return draft;
  return {
    ...existing,
    name: draft.name || existing.name,
    documentType: draft.documentType || existing.documentType,
    documentNumber: draft.documentNumber || existing.documentNumber,
    birthDate: draft.birthDate || existing.birthDate,
    email: draft.email || existing.email,
    phone: draft.phone || existing.phone,
    address: draft.address || existing.address,
    city: draft.city || existing.city,
    province: draft.province || existing.province,
    tier: app?.requestedTier || existing.tier || draft.tier,
    status: existing.status === 'inactive' ? 'active' : (existing.status || 'active'),
    joinDate: joinDateFromApplication(app, existing.joinDate),
  };
}

/** Mensaje y links de WhatsApp / mail con usuario, clave y URL del portal. */
export function buildAccessInvite({
  name = '',
  phone = '',
  contactEmail = '',
  creds = {},
  portalUrl = '',
} = {}) {
  const url = portalUrl || portalLoginUrl();
  const username = creds.username || '';
  const email = creds.email || loginEmailFromUsername(username);
  const password = creds.password || '';
  const greeting = name ? `Hola ${name}` : 'Hola';
  const message = [
    `${greeting}, te saludamos del Jockey Club San Juan.`,
    '',
    'Ya tenés acceso al portal de socios:',
    url,
    '',
    ...(username && username.toLowerCase() !== email.toLowerCase() ? [`Usuario: ${username}`] : []),
    `Email de ingreso: ${email}`,
    `Contraseña: ${password}`,
    '',
    'Ingresá con esos datos y cambiá la contraseña cuando puedas.',
  ].join('\n');

  const digits = toWhatsAppPhone(phone);
  const mail = String(contactEmail || '').trim();
  const pack = buildAccessInviteEmail({
    name,
    username,
    loginEmail: email,
    password,
    portalUrl: url,
    logoUrl: typeof window !== 'undefined' && window.location?.protocol === 'https:'
      ? `${window.location.origin}/logo-jockey-club.png`
      : '',
  });
  return {
    creds: { username, email, password },
    portalUrl: url,
    contactEmail: mail,
    message,
    email: pack,
    whatsappUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null,
    mailUrl: mail
      ? `mailto:${mail}?subject=${encodeURIComponent(pack.subject)}&body=${encodeURIComponent(message)}`
      : null,
  };
}

export function markApplicationApproved(app, member) {
  return {
    ...app,
    status: 'approved',
    memberId: member?.id || app.memberId || null,
    reviewedAt: new Date().toISOString(),
  };
}

export function markAccessApproved(req, member) {
  return {
    ...req,
    status: 'approved',
    memberDbId: member?.id || req.memberId || null,
    notes: req.notes || 'Credenciales generadas',
    reviewedAt: new Date().toISOString(),
  };
}

export function requestPdfFileName(detail) {
  const raw = String(detail?.subtitle || 'solicitud')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${detail?.filePrefix || 'solicitud'}-${raw || 'socio'}.pdf`;
}
