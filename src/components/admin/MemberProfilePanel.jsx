import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, User, CreditCard, Users, Wallet, DoorOpen, CalendarDays,
  MessageSquare, ClipboardList, Activity, Phone, Mail, MapPin,
  Pencil, FileText, Ticket, Bell, IdCard, Cake, Heart, Flag, Clock,
  ShieldCheck, CalendarClock, Banknote, Building2, AlertTriangle,
  Camera, X, Plus, Loader2,
} from 'lucide-react';
import VirtualCard from '../VirtualCard';
import GuestPassPanel from '../GuestPassPanel';
import CollectDuesModal from './CollectDuesModal';
import ModalDialog from '../ModalDialog';
import {
  dbMemberIsDuesExempt,
  formatShortDate,
  isDuesExemptMember,
  memberDueFact,
  quotaHeadline,
} from '../../domain/members/dues';
import { imputationPeriodLabel } from '../../domain/members/duesImputations';
import { familyChildStanding, regularidadOf, upsertRegularidad } from '../../domain/members/familyStanding';
import {
  effectiveJoinDate,
  membershipTenureLabel,
  shouldOfferVitalicio,
} from '../../domain/members/membership';
import { canRemoveDuesSurcharge, canVoidDuesPayment } from '../../domain/auth/roles';
import { useAuth } from '../../context/AuthContext';
import { formatDateTimeAR, formatInstantAR, todayISODateAR } from '../../lib/arDate';
import { formatPaymentWhen, paymentWhenStamp } from '../../domain/members/paymentHistory';
import { DEFAULT_POOL_SETTINGS } from '../../domain/pool/poolAccess';
import { piletaPayAccess } from '../../domain/pool/seasonDuesGate';
import {
  duesStandingDisplayAmount,
  duesStandingDisplayHint,
  memberDuesStandingSummary,
} from '../../domain/accounting/appMonthlyDebts';
import { cobranzasSeed, filterAccessinCobranzas } from '../../domain/accounting/cobranzas';
import { buildDetailedCcAccountEntries } from '../../domain/accounting/detailedCurrentAccounts';
import useSnapshots from '../../hooks/useSnapshots';
import { collectMemberMeta, isPendingBaja, memberAppAccess } from '../../domain/members/memberAdminActions';
import { getActiveTiers, getTierDisplayName, tierBadgeStyle } from '../../domain/members/tiers';
import { DISCIPLINE_OPTIONS, getDisciplineOptions, normalizeLabel } from '../../domain/sports/disciplines';
import {
  allocateNextMemberNumber,
  applyMemberListRefresh,
  attachHouseholdToMembers,
  familyPrincipalOf,
  householdMemberAsAdherent,
  isFamilyDependent,
  memberNumberOf,
  uniqueFamilyMembers,
} from '../../domain/members/households';
import {
  applyMemberProfileUpdate,
  upsertMemberDocument,
  DOCUMENT_TYPES,
  withProfileEditTrace,
} from '../../domain/members/profileEdit';
import { duesMethodLabel, isDuesCollectionJournal, journalEntryBelongsToMember, persistDuesCollection, persistDuesVoid, recordDuesCollection, removeDuesSurcharge, voidMemberDuesPayment } from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import { signedDuesReceiptUrl } from '../../data/storage';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import CurrentAccountCutNote from '../erp/CurrentAccountCutNote';
import { isMpAdhered } from '../../domain/payments/mercadoPago';

const SECTIONS = [
  { id: 'ficha', label: 'Ficha', icon: User },
  { id: 'editar', label: 'Editar', icon: Pencil },
  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
  { id: 'invitados', label: 'Invitados', icon: Ticket, memberOnly: true },
  { id: 'docs', label: 'Documentos', icon: FileText, memberOnly: true },
  { id: 'familia', label: 'Grupo familiar', icon: Users },
  { id: 'movimientos', label: 'Movimientos', icon: Wallet },
  { id: 'entradas', label: 'Entradas', icon: DoorOpen },
  { id: 'asistencia', label: 'Asistencia', icon: CalendarDays },
  { id: 'reclamos', label: 'Reclamos', icon: ClipboardList },
  { id: 'mensajes', label: 'Mensajes', icon: MessageSquare },
  { id: 'trazabilidad', label: 'Trazabilidad', icon: Activity },
];

const STATUS_COPY = {
  active: { label: 'Cuenta habilitada', hint: 'Puede ingresar y usar instalaciones', tone: 'ok' },
  pending: { label: 'Pendiente de aprobación', hint: 'Alta en revisión de Secretaría', tone: 'warn' },
  suspended: { label: 'Cuenta suspendida', hint: 'Acceso restringido hasta regularizar', tone: 'danger' },
  inactive: { label: 'Baja del padrón', hint: 'Registro inactivo con motivo auditado', tone: 'danger' },
};

const PAYMENT_LABELS = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  /** Preferencia LILA / Galicia: no es la adhesión de MP en Mi cuenta. */
  debito: 'Débito Galicia',
  debito_automatico: 'Débito Galicia',
  galicia: 'Débito Galicia',
};

const TAX_LABELS = {
  consumidor_final: 'Consumidor final',
  monotributo: 'Monotributo',
  responsable_inscripto: 'Responsable inscripto',
  exento: 'Exento',
};

function titleCase(value) {
  if (!value) return null;
  return String(value)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDocument(type, number) {
  if (!number) return null;
  const digits = String(number).replace(/\D/g, '');
  const formatted = digits.length >= 7
    ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(number);
  return `${type || 'DNI'} ${formatted}`;
}

function documentParts(type, number) {
  const formatted = formatDocument(type, number);
  if (!formatted) return { kind: type || 'Documento', nro: null };
  const digits = String(number).replace(/\D/g, '');
  const nro = digits.length >= 7
    ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(number);
  return { kind: type || 'DNI', nro };
}

function SheetHead({ index, title, kicker }) {
  return (
    <header className="mp-sheet-head">
      <span className="mp-sheet-idx">{index}</span>
      <div>
        <h5>{title}</h5>
        {kicker ? <p>{kicker}</p> : null}
      </div>
    </header>
  );
}

function ageFromBirth(iso) {
  if (!iso) return null;
  const birth = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function Fact({ icon: Icon, label, value, hint }) {
  const empty = value == null || value === '';
  return (
    <div className={`mp-fact${empty ? ' is-empty' : ''}`}>
      {Icon ? (
        <span className="mp-fact-stamp" aria-hidden>
          <Icon size={14} />
        </span>
      ) : null}
      <div>
        <div className="mp-fact-label">{label}</div>
        <div className={`mp-fact-value${empty ? ' muted' : ''}`}>{empty ? 'Sin dato' : value}</div>
        {hint && !empty ? <div className="mp-fact-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href }) {
  const empty = !value;
  const content = empty ? (
    <span className="mp-contact-value muted">No cargado</span>
  ) : href ? (
    <a href={href} className="mp-contact-value link">{value}</a>
  ) : (
    <span className="mp-contact-value">{value}</span>
  );
  return (
    <div className={`mp-contact-row${empty ? ' is-empty' : ''}`}>
      <span className="mp-contact-stamp" aria-hidden>
        <Icon size={15} />
      </span>
      <div>
        <span className="mp-contact-label">{label}</span>
        {content}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="mp-empty">{text}</p>;
}

const FAMILY_RELATIONSHIPS = ['Titular', 'Cónyuge', 'Hijo/a', 'Padre/Madre', 'Hermano/a', 'Nieto/a', 'Grupo familiar', 'Otro'];

function findMemberByNumber(members, id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (!digits) return null;
  return (members || []).find((m) => {
    const mid = String(m.memberId || '');
    return mid === String(id) || mid.replace(/\D/g, '') === digits || memberNumberOf(m) === digits;
  }) || null;
}

function familyCardMember(adh, fallbackHost) {
  return {
    memberId: adh.memberId || adh.id || fallbackHost?.memberId,
    name: adh.name,
    photo: adh.photo,
    tier: adh.tier,
    status: adh.status || 'active',
    familyPrincipalNumber: fallbackHost ? (isFamilyDependent(fallbackHost) ? fallbackHost.familyPrincipalNumber : memberNumberOf(fallbackHost)) : adh.memberId,
  };
}

function canonDisciplineList(labels = [], catalogNames = []) {
  const byKey = new Map((catalogNames || []).map((name) => [normalizeLabel(name), name]));
  const seen = new Set();
  const next = [];
  for (const label of labels || []) {
    const canon = byKey.get(normalizeLabel(label)) || String(label || '').trim();
    const key = normalizeLabel(canon);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(canon);
  }
  return next;
}

function editFormFromMember(member, disciplineOptions) {
  if (!member) return null;
  return {
    name: member.name || '',
    documentNumber: member.documentNumber || '',
    birthDate: member.birthDate || '',
    tier: member.tier || '',
    phone: member.phone || '',
    phoneAlt: member.phoneAlt || '',
    email: member.email || '',
    address: member.address || '',
    city: member.city || '',
    province: member.province || '',
    postalCode: member.postalCode || '',
    emergencyContact: member.emergencyContact || '',
    emergencyPhone: member.emergencyPhone || '',
    photo: member.photo || '',
    disciplines: canonDisciplineList(
      member.disciplines?.length ? member.disciplines : (member.preferredSports || []),
      disciplineOptions
    ),
    notifyDues: isDuesExemptMember(member) ? false : member.notifyDues !== false,
    notifyReservations: member.notifyReservations !== false,
    notifyEvents: member.notifyEvents !== false,
  };
}

function isDisciplineSelected(current, name) {
  const key = normalizeLabel(name);
  return (current || []).some((d) => normalizeLabel(d) === key);
}

function toggleDiscipline(current, name) {
  const key = normalizeLabel(name);
  const list = current || [];
  if (list.some((d) => normalizeLabel(d) === key)) {
    return list.filter((d) => normalizeLabel(d) !== key);
  }
  return [...list, name];
}

function readMemberPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Seleccione una imagen válida.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagen inválida.'));
      img.onload = () => {
        const max = 360;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function TimelineItem({ when, title, detail, actorName = '', tone = 'neutral' }) {
  const actor = String(actorName || '').trim();
  return (
    <div className={`mp-timeline-item tone-${tone}`}>
      <div className="mp-timeline-when">{when}</div>
      <div>
        <div className="mp-timeline-title">{title}</div>
        {detail ? <div className="mp-timeline-detail">{detail}</div> : null}
        {actor ? (
          <div className="mp-timeline-actor-line">
            Registró: <strong className="mp-timeline-actor">{actor}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function applyRegularidadForm(person, form) {
  const year = Number(String(todayISODateAR()).slice(0, 4));
  const withStart = upsertRegularidad(person || {}, {
    year,
    term: 'start',
    present: Boolean(form?.regularidadStart),
  });
  return upsertRegularidad(withStart, {
    year,
    term: 'end',
    present: Boolean(form?.regularidadEnd),
  });
}

/** Perfil institucional completo del socio titular. */
export default function MemberProfilePanel({
  member,
  members = [],
  onBack,
  onOpenMember = null,
  backLabel = 'Padrón',
  formatCurrency,
  journalEntries = [],
  entryLogs = [],
  reservations = [],
  claims = [],
  messages = [],
  updateMember = null,
  setMembers = null,
  /** false = solo cobro (caja); true = editar ficha / grupo familiar. */
  canEditMember = true,
  addJournalEntry = null,
  onAccountEntry = null,
  guestPasses = [],
  setGuestPasses = null,
  selfService = false,
  showCurrentAccounts = true,
  tierCatalog,
  disciplineCatalog = [],
  onSendMessage,
  accessinCobranzas = [],
  poolSettings = DEFAULT_POOL_SETTINGS,
  paymentPlans = [],
  paymentTolerance = 1000,
}) {
  const { roles, role, user } = useAuth();
  const actorId = user?.id || null;
  const actorName = user?.fullName || user?.email || 'Usuario';
  const canVoid = canVoidDuesPayment({ roles, role });
  const canRemoveSurcharge = canRemoveDuesSurcharge({ roles, role });
  const [section, setSection] = useState('ficha');
  const [editForm, setEditForm] = useState(null);
  const [editMsg, setEditMsg] = useState('');
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectFlash, setCollectFlash] = useState('');
  const [cardMember, setCardMember] = useState(null);
  const [familyEdit, setFamilyEdit] = useState(null);
  const [familyEditMsg, setFamilyEditMsg] = useState('');
  const [householdPayments, setHouseholdPayments] = useState([]);
  const [householdExtras, setHouseholdExtras] = useState([]);
  const [householdReady, setHouseholdReady] = useState(false);
  const [householdEpoch, setHouseholdEpoch] = useState(0);
  const setMembersRef = useRef(setMembers);
  setMembersRef.current = setMembers;
  const [searchParams, setSearchParams] = useSearchParams();
  const { version: cobrosSnapshotVersion } = useSnapshots(
    selfService ? [] : ['accessinCobranzas', 'accessinDetailedCurrentAccounts']
  );
  const hideCurrentAccount = selfService && !showCurrentAccounts;
  const allowEdit = canEditMember && Boolean(updateMember || setMembers);
  const visibleSections = SECTIONS.filter((s) => {
    if (s.memberOnly && !selfService) return false;
    if (hideCurrentAccount && s.id === 'movimientos') return false;
    if (!allowEdit && s.id === 'editar') return false;
    return true;
  });
  const canCollect = !selfService && Boolean(setMembers || updateMember);
  const disciplineOptions = useMemo(() => {
    const fromCatalog = getDisciplineOptions(disciplineCatalog);
    return fromCatalog.length ? fromCatalog : DISCIPLINE_OPTIONS;
  }, [disciplineCatalog]);

  useEffect(() => {
    if (selfService || !member || searchParams.get('cobrar') !== '1') return undefined;
    if (canCollect && !isDuesExemptMember(member) && !isFamilyDependent(member)) {
      setCollectOpen(true);
    }
    setSearchParams((prev) => {
      if (prev.get('cobrar') !== '1') return prev;
      const next = new URLSearchParams(prev);
      next.delete('cobrar');
      return next;
    }, { replace: true });
    return undefined;
  }, [member?.memberId, selfService, searchParams, setSearchParams, canCollect]);

  useEffect(() => {
    if (!member || searchParams.get('editar') !== '1') return undefined;
    if (!allowEdit) return undefined;
    setSection('editar');
    setEditForm(editFormFromMember(member, disciplineOptions));
    setEditMsg('');
    setSearchParams((prev) => {
      if (prev.get('editar') !== '1') return prev;
      const next = new URLSearchParams(prev);
      next.delete('editar');
      return next;
    }, { replace: true });
    return undefined;
  }, [member?.memberId, allowEdit, searchParams, setSearchParams, disciplineOptions]);

  /** Grupo familiar solo desde Supabase (titular + integrantes). Sin padrón local. */
  useEffect(() => {
    if (!member) return undefined;
    const principal = familyPrincipalOf(member) || memberNumberOf(member);
    if (!principal) {
      setHouseholdExtras([]);
      setHouseholdReady(true);
      return undefined;
    }
    let cancelled = false;
    setHouseholdReady(false);
    setHouseholdExtras([]);

    (async () => {
      try {
        if (typeof repos.listHouseholdByPrincipal !== 'function') {
          if (!cancelled) {
            setHouseholdExtras([]);
            setHouseholdReady(true);
          }
          return;
        }
        const rows = await repos.listHouseholdByPrincipal(principal);
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setHouseholdExtras(list);
        const push = setMembersRef.current;
        if (list.length && typeof push === 'function') {
          push((prev) => attachHouseholdToMembers(
            applyMemberListRefresh(prev || [], list, { done: false }),
          ));
        }
      } catch {
        if (!cancelled) setHouseholdExtras([]);
      } finally {
        if (!cancelled) setHouseholdReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [member?.memberId, householdEpoch]);

  const householdPrincipal = familyPrincipalOf(member) || memberNumberOf(member);

  const familyGroup = useMemo(() => {
    const titular = householdExtras.find((row) => memberNumberOf(row) === householdPrincipal)
      || householdExtras.find((row) => !isFamilyDependent(row))
      || null;
    const titularId = memberNumberOf(titular) || householdPrincipal;
    // El RPC ya acota al hogar: todos los que no son el titular son integrantes.
    const dependents = householdExtras.filter((row) => memberNumberOf(row) !== titularId);
    return {
      titular,
      members: dependents.map((row) => householdMemberAsAdherent(row)),
    };
  }, [householdExtras, householdPrincipal]);

  const familyRows = useMemo(() => {
    if (!householdReady) return [];
    if (!householdExtras.length) return [];
    const titular = familyGroup.titular;
    const titularRow = titular
      ? [householdMemberAsAdherent(titular, 'Titular')]
      : [];
    return uniqueFamilyMembers([
      ...titularRow,
      ...(familyGroup.members || []),
    ]);
  }, [householdReady, householdExtras.length, familyGroup.titular, familyGroup.members]);

  const familySource = householdExtras;
  const canEditFamily = !selfService && allowEdit;
  const tiers = useMemo(() => getActiveTiers(tierCatalog), [tierCatalog]);
  const defaultFamilyTier = useMemo(() => {
    const fromGroup = familyRows.find((row) => row.relationship !== 'Titular')?.tier;
    if (fromGroup) return fromGroup;
    const fam = tiers.find((t) => /grupo.?familiar/i.test(`${t.id} ${t.name}`));
    return fam?.id || member?.tier || tiers[0]?.id || '';
  }, [familyRows, tiers, member?.tier]);

  const openAddFamily = () => {
    setFamilyEditMsg('');
    setFamilyEdit({
      isNew: true,
      source: null,
      adherentId: null,
      form: {
        name: '',
        documentNumber: '',
        birthDate: '',
        phone: '',
        email: '',
        tier: defaultFamilyTier,
        disciplines: [],
        photo: '',
        relationship: 'Grupo familiar',
        memberId: allocateNextMemberNumber(members),
        regularidadStart: false,
        regularidadEnd: false,
      },
    });
  };

  const persistNewFamilyMember = async (form) => {
    const host = familyGroup.titular || member;
    const principalId = familyPrincipalOf(host) || memberNumberOf(host);
    const requested = String(form.memberId || '').replace(/\D/g, '');
    let memberId = requested || allocateNextMemberNumber(members);
    if (!requested && typeof repos.nextClubMemberNumber === 'function') {
      try {
        memberId = await repos.nextClubMemberNumber(members);
      } catch {
        /* correlativo local solo sin nube */
      }
    }
    if (isSupabaseConfigured && typeof repos.getMemberByNumber === 'function') {
      try {
        const existing = await repos.getMemberByNumber(memberId);
        if (existing) return 'Ya existe un socio con esa credencial.';
      } catch {
        /* si falla el lookup, el upsert de abajo responde */
      }
    } else if (findMemberByNumber(members, memberId)) {
      return 'Ya existe un socio con esa credencial.';
    }
    const groupName = host?.familyGroupName || member?.familyGroupName || `Grupo ${principalId}`;
    const principalNum = Number.parseInt(principalId, 10);
    const familyPrincipalNumber = Number.isFinite(principalNum) ? principalNum : principalId;
    const withCerts = applyRegularidadForm({}, form);
    const newMember = {
      name: String(form.name || '').trim(),
      memberId,
      documentType: 'DNI',
      documentNumber: form.documentNumber || '',
      birthDate: form.birthDate || '',
      phone: form.phone || '',
      email: form.email || '',
      address: host?.address || member?.address || '',
      city: host?.city || member?.city || '',
      province: host?.province || member?.province || '',
      postalCode: host?.postalCode || member?.postalCode || '',
      tier: form.tier || defaultFamilyTier,
      disciplines: form.disciplines || [],
      photo: form.photo || '',
      relationship: form.relationship || 'Grupo familiar',
      status: 'active',
      joinDate: todayISODateAR(),
      outstandingBalance: 0,
      yearsActive: 0,
      paymentMethod: host?.paymentMethod || member?.paymentMethod || '',
      familyPrincipalNumber,
      familyGroupName: groupName,
      adherents: [],
      regularidadCertificates: withCerts.regularidadCertificates,
      meta: collectMemberMeta({
        familyPrincipalNumber,
        familyGroupName: groupName,
        regularidadCertificates: withCerts.regularidadCertificates,
      }),
    };

    if (isSupabaseConfigured) {
      if (typeof repos.upsertMember !== 'function') {
        return 'No hay conexión con la base para guardar el integrante.';
      }
      let saved;
      try {
        saved = await repos.upsertMember(newMember);
      } catch (err) {
        return err?.message || 'No se pudo guardar el integrante en la base.';
      }
      if (host && !familyPrincipalOf(host) && typeof updateMember === 'function') {
        await updateMember({
          ...host,
          familyPrincipalNumber,
          familyGroupName: groupName,
          updatedAt: new Date().toISOString(),
        });
      }
      if (typeof setMembers === 'function' && saved) {
        setMembers((prev) => {
          const id = memberNumberOf(saved);
          const without = (prev || []).filter((row) => memberNumberOf(row) !== id);
          return [saved, ...without];
        });
      }
      return null;
    }

    if (setMembers) {
      setMembers((prev) => [newMember, ...(prev || [])]);
    } else if (updateMember) {
      updateMember({
        ...host,
        adherents: [
          ...(host.adherents || []),
          {
            id: `adh-${Date.now()}`,
            name: newMember.name,
            relationship: newMember.relationship,
            documentNumber: newMember.documentNumber,
            birthDate: newMember.birthDate,
            phone: newMember.phone,
            email: newMember.email,
            tier: newMember.tier,
            disciplines: newMember.disciplines,
            photo: newMember.photo,
            status: 'active',
            outstandingBalance: 0,
            regularidadCertificates: withCerts.regularidadCertificates,
          },
        ],
        updatedAt: new Date().toISOString(),
      });
    }
    if (host && !familyPrincipalOf(host) && updateMember) {
      updateMember({
        ...host,
        familyPrincipalNumber,
        familyGroupName: groupName,
        updatedAt: new Date().toISOString(),
      });
    }
    return null;
  };

  const movements = useMemo(() => {
    if (!member) return [];
    return (journalEntries || [])
      .filter((entry) => journalEntryBelongsToMember(entry, member) && !isDuesCollectionJournal(entry))
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [journalEntries, member]);

  const entries = useMemo(() => {
    if (!member) return [];
    return (entryLogs || [])
      .filter((e) => e.memberId === member.memberId)
      .slice()
      .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  }, [entryLogs, member]);

  const bookings = useMemo(() => {
    if (!member) return [];
    return (reservations || [])
      .filter((r) => r.memberId === member.memberId || r.memberName === member.name)
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [reservations, member]);

  const memberClaims = useMemo(() => {
    if (!member) return [];
    return (claims || []).filter((c) => c.memberId === member.memberId);
  }, [claims, member]);

  const memberMessages = useMemo(() => {
    if (!member) return [];
    return (messages || []).filter(
      (m) => m.recipientId === member.memberId || m.senderId === member.memberId
    );
  }, [messages, member]);

  const householdNumbers = useMemo(() => {
    const nums = new Set();
    const add = (value) => {
      const n = String(value || '').replace(/\D/g, '');
      if (!n) return;
      nums.add(n);
      nums.add(String(Number(n)));
      if (n.length < 6) nums.add(n.padStart(5, '0'));
      if (n.length < 6) nums.add(n.padStart(6, '0'));
    };
    add(member?.memberId);
    add(familyPrincipalOf(member));
    add(memberNumberOf(familyGroup.titular));
    (familyRows || []).forEach((row) => add(row.memberId));
    return [...nums];
  }, [member, familyGroup.titular, familyRows]);

  const householdKey = householdNumbers.join('|');
  useEffect(() => {
    const numbers = householdKey ? householdKey.split('|') : [];
    if (selfService || !numbers.length) {
      setHouseholdPayments([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      numbers.map((n) => repos.getMemberByNumber(n, { withPayments: true }).catch(() => null))
    ).then((rows) => {
      if (cancelled) return;
      setHouseholdPayments(rows.flatMap((m) => m?.paymentHistory || []));
    });
    return () => { cancelled = true; };
  }, [selfService, householdKey]);

  const timeline = useMemo(() => {
    if (!member) return [];
    const items = [];
    const tierName = getTierDisplayName(member.tier, tierCatalog);

    const joinIso = effectiveJoinDate(member);
    const altaActor = String(
      member.meta?.altaActorName
      || member.altaActorName
      || member.meta?.registeredByName
      || '',
    ).trim();
    items.push({
      when: joinIso ? formatShortDate(joinIso) : 'Alta',
      title: 'Alta de socio titular',
      detail: joinIso
        ? `Categoría ${tierName} · Credencial ${member.memberId}`
        : `Categoría ${tierName} · Credencial ${member.memberId} · fecha de ingreso sin dato`,
      actorName: altaActor,
      tone: 'ok',
      sort: joinIso || '1970-01-01',
    });

    movements.forEach((e) => {
      const amount = (e.lines || []).find((l) => l.type === 'debit')?.amount;
      items.push({
        when: formatShortDate(e.date),
        title: e.description,
        detail: amount != null ? formatCurrency(amount) : null,
        actorName: e.createdByName || e.recordedByName || '',
        tone: 'neutral',
        sort: e.date,
      });
    });

    const seenCobros = new Set();
    const pushCobro = (p) => {
      const key = `${String(p.date || '').slice(0, 10)}|${Number(p.amount) || 0}`;
      if (seenCobros.has(key)) return;
      seenCobros.add(key);
      items.push({
        when: formatPaymentWhen(p),
        title: p.concept || `Cobro · ${duesMethodLabel(p.method, p.bankName)}`,
        detail: [
          formatCurrency(p.amount),
          duesMethodLabel(p.method, p.bankName),
          p.receiptNumber || p.receipt || p.receiptId,
          p.receiptName ? `Comp. ${p.receiptName}` : null,
        ].filter(Boolean).join(' · '),
        actorName: String(p.recordedByName || '').trim(),
        tone: 'ok',
        sort: paymentWhenStamp(p) || p.date || '',
      });
    };
    (member.paymentHistory || []).forEach(pushCobro);
    householdPayments.forEach(pushCobro);
    const paymentsByDayAmount = new Map();
    [...(member.paymentHistory || []), ...householdPayments].forEach((p) => {
      const key = `${String(p.date || '').slice(0, 10)}|${Number(p.amount) || 0}`;
      if (p.time || p.paidAt || p.createdAt || p.recordedByName) paymentsByDayAmount.set(key, p);
    });
    const liveCobranzas = accessinCobranzas.length
      ? accessinCobranzas
      : cobranzasSeed().ACCESSIN_COBRANZAS;
    filterAccessinCobranzas(liveCobranzas, {
      memberNumbers: householdNumbers,
    }).forEach((row) => {
      const isCuota = row.type === 'Cuotas' || /cuota/i.test(String(row.concept || ''));
      if (!isCuota) return;
      const key = `${String(row.date || '').slice(0, 10)}|${Number(row.amount) || 0}`;
      const timed = paymentsByDayAmount.get(key);
      pushCobro({
        date: row.date,
        amount: row.amount,
        method: row.paymentMethod,
        bankName: row.bankName,
        concept: row.concept || 'Cobro de cuota',
        receiptNumber: row.receiptId,
        time: row.time || timed?.time || '',
        paidAt: row.paidAt || timed?.paidAt || null,
        createdAt: row.createdAt || timed?.createdAt || null,
        recordedByName: timed?.recordedByName || '',
        recordedBy: timed?.recordedBy || null,
      });
    });
    householdNumbers.forEach((n) => {
      buildDetailedCcAccountEntries(n)
        .filter((e) => e.type === 'pago')
        .forEach((e) => {
          const key = `${String(e.date || '').slice(0, 10)}|${Math.abs(Number(e.value) || 0)}`;
          const timed = paymentsByDayAmount.get(key);
          pushCobro({
            date: e.date,
            amount: Math.abs(Number(e.value) || 0),
            concept: e.description ? `Cobro de cuota · ${e.description}` : 'Cobro de cuota',
            method: (e.paymentMethods || [])[0]?.method || '',
            receiptNumber: e.accessinId ? String(e.accessinId) : '',
            recordedByName: timed?.recordedByName || e.recordedByName || '',
            recordedBy: timed?.recordedBy || e.recordedBy || null,
          });
        });
    });

    entries.forEach((e) => {
      items.push({
        when: `${formatShortDate(e.date)} ${e.time || ''}`.trim(),
        title: e.status === 'granted' ? 'Ingreso al club autorizado' : 'Ingreso denegado',
        detail: e.notes || e.role,
        actorName: e.operator || '',
        tone: e.status === 'granted' ? 'ok' : 'danger',
        sort: `${e.date}T${e.time || '00:00'}`,
      });
    });

    bookings.forEach((r) => {
      items.push({
        when: formatShortDate(r.date),
        title: `Reserva · ${r.facilityName || r.facilityId}`,
        detail: `${r.time || ''} · ${r.status}`,
        actorName: r.recordedByName || '',
        tone: r.status === 'confirmed' ? 'ok' : 'warn',
        sort: `${r.date}T${r.time || '00:00'}`,
      });
    });

    memberClaims.forEach((c) => {
      items.push({
        when: formatShortDate(c.date),
        title: `Reclamo · ${c.title || c.subject || 'Sin asunto'}`,
        detail: [c.status, c.assignedStaff ? `Asignado: ${c.assignedStaff}` : null].filter(Boolean).join(' · '),
        actorName: c.recordedByName || c.createdByName || c.assignedStaff || '',
        tone: c.status === 'resolved' ? 'ok' : 'warn',
        sort: c.date,
      });
    });

    const history = member.meta?.lifecycleHistory || member.lifecycleHistory || [];
    history.forEach((h) => {
      const titles = {
        suspend: 'Suspensión de cuenta',
        activate: 'Reactivación de cuenta',
        delete: 'Baja del padrón',
      };
      const at = h.at || '';
      items.push({
        when: at ? formatInstantAR(at) : '—',
        title: titles[h.action] || `Cambio de estado (${h.action})`,
        detail: [h.reason, h.detail].filter(Boolean).join(' · ') || null,
        actorName: h.actorName || '',
        tone: h.action === 'activate' ? 'ok' : 'danger',
        sort: at || '1970-01-01',
      });
    });

    const profileEdits = member.meta?.profileEditHistory || member.profileEditHistory || [];
    profileEdits.forEach((h) => {
      const at = h.at || '';
      const fieldBits = (h.changes || []).slice(0, 4).map((c) => (
        `${c.label}: ${c.from} → ${c.to}`
      ));
      const extra = (h.changes || []).length > 4
        ? `+${(h.changes || []).length - 4} más`
        : null;
      items.push({
        when: at ? formatDateTimeAR(at.slice(0, 10), at.slice(11, 16)) || formatShortDate(at.slice(0, 10)) : '—',
        title: h.source === 'portal' ? 'Edición desde el portal' : 'Edición de ficha',
        detail: [fieldBits.join(' · ') || 'Datos actualizados', extra].filter(Boolean).join(' · '),
        actorName: h.actorName || '',
        tone: 'ok',
        sort: at || '1970-01-01',
      });
    });

    if (member.meta?.portalProvisionedAt) {
      const at = member.meta.portalProvisionedAt;
      items.push({
        when: formatDateTimeAR(at.slice(0, 10), at.slice(11, 16)) || formatShortDate(at.slice(0, 10)),
        title: 'Acceso portal generado',
        detail: member.meta.portalUsername ? `usuario ${member.meta.portalUsername}` : null,
        actorName: member.meta.portalProvisionedBy || '',
        tone: 'ok',
        sort: at,
      });
    }

    return items.sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
  }, [member, movements, entries, bookings, memberClaims, formatCurrency, tierCatalog, accessinCobranzas, householdNumbers, householdPayments, cobrosSnapshotVersion]);

  if (!member) {
    return (
      <div className="glass-card fade-in member-profile">
        <Empty text="Socio no encontrado." />
        <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginTop: '1rem' }}>
          Volver al padrón
        </button>
      </div>
    );
  }

  const handleConfirmCollect = async (payload) => {
    if (payload?.alreadyApplied) {
      if (member.memberId) {
        repos.getMemberByNumber(member.memberId, { withPayments: true })
          .then((fresh) => { if (fresh) updateMember?.(fresh); })
          .catch(() => {});
      }
      setCollectOpen(false);
      setSection('movimientos');
      setCollectFlash('Pago de Mercado Pago acreditado en la cuenta.');
      window.setTimeout(() => setCollectFlash(''), 5000);
      return;
    }
    const result = recordDuesCollection(member, { ...payload, members });
    const saved = await persistDuesCollection(result, {
      setMembers,
      updateMember,
      addJournalEntry,
      onAccountEntry,
    });
    void deliverPaymentReceipt({
      member: saved?.member || result.member,
      payment: saved?.payment || result.payment,
      onSendMessage,
      kind: 'cuota',
    });
    setCollectOpen(false);
    setSection('movimientos');
    setCollectFlash(
      `Cobro registrado · ${duesMethodLabel(payload.method, payload.bankName)} · ${formatCurrency((saved?.payment || result.payment).amount)}`
    );
    window.setTimeout(() => setCollectFlash(''), 5000);
  };

  const status = STATUS_COPY[member.status] || STATUS_COPY.pending;
  const appAccess = memberAppAccess(member);
  const duesExempt = isDuesExemptMember(member);
  const duesStanding = memberDuesStandingSummary(member);
  const balance = duesStanding.clear ? 0 : duesStanding.totalDebt;
  const hasDebt = !duesStanding.clear && balance > 0;
  const quota = quotaHeadline(member);
  const poolPay = piletaPayAccess(member, { settings: poolSettings, members });
  const tierName = getTierDisplayName(member.tier, tierCatalog);
  const age = ageFromBirth(member.birthDate);
  const tenure = membershipTenureLabel(member);
  const dueFact = memberDueFact(member);
  const childStanding = isFamilyDependent(member)
    ? familyChildStanding(member)
    : { kind: 'ok', age: null, label: null };
  const vitalicioOffer = shouldOfferVitalicio(member);
  const pendingBaja = isPendingBaja(member);
  const debitFailed = String(member?.mpAdhesion || member?.mercadoPagoAdhesion || member?.meta?.mpAdhesion || '').toLowerCase() === 'rejected'
    || Boolean(member?.meta?.lastDebitFailedAt);
  const joinIso = effectiveJoinDate(member);
  const joinLabel = joinIso
    ? (member.joinTime
      ? formatDateTimeAR(joinIso, member.joinTime)
      : formatShortDate(joinIso))
    : null;
  const initials = (member.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const phoneHref = member.phone
    ? `https://wa.me/${String(member.phone).replace(/\D/g, '')}`
    : null;
  const mailHref = member.email ? `mailto:${member.email}` : null;
  const addressLine = [
    member.address,
    [member.city, member.province].filter(Boolean).join(', '),
    member.postalCode ? `CP ${member.postalCode}` : null,
  ].filter(Boolean).join(' · ');
  const doc = documentParts(member.documentType, member.documentNumber);

  return (
    <div className="glass-card fade-in member-profile">
      <header className="mp-hero">
        <div className="mp-hero-main">
          <button type="button" className="btn btn-secondary btn-sm mp-back" onClick={onBack}>
            <ArrowLeft size={14} /> {backLabel}
          </button>

          <div className="mp-identity">
            <div
              className="mp-avatar"
              style={{ '--tier-ring': tierBadgeStyle(member.tier, tierCatalog).borderColor || 'var(--primary-gold)' }}
            >
              {(section === 'editar' && editForm?.photo) || member.photo ? (
                <img src={(section === 'editar' && editForm?.photo) || member.photo} alt="" />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="mp-identity-copy">
              <p className="mp-kicker">Ficha del socio</p>
              <h3 className="serif-font mp-name">{member.name}</h3>
              <div className="mp-meta-row">
                <span className="mp-cred">Credencial {member.memberId}</span>
                <span className="mp-tier-pill" style={tierBadgeStyle(member.tier, tierCatalog)}>
                  {tierName}
                </span>
                <span className={`mp-status mp-status--${status.tone}`} title={status.hint}>
                  <span className="mp-status-dot" aria-hidden />
                  {status.label}
                </span>
                <span
                  className={`mp-status mp-status--${appAccess.hasAccess ? 'ok' : 'warn'}`}
                  title={appAccess.hint}
                >
                  <span className="mp-status-dot" aria-hidden />
                  {appAccess.label}
                </span>
              </div>
              {tenure ? <p className="mp-tenure">{tenure}</p> : null}
            </div>
          </div>
        </div>

        <aside
          className={`mp-balance ${hasDebt ? 'has-debt' : quota.kind === 'clear' ? 'is-clear' : 'is-off'}`}
          aria-label="Estado de cuota y pileta"
        >
          <div className="mp-balance-label">
            {hideCurrentAccount ? 'Estado de cuenta' : (hasDebt ? 'Deuda de cuota' : 'Estado de cuota')}
            {selfService ? null : <CurrentAccountCutNote members={members} />}
          </div>
          <div className="mp-balance-value">
            {!hasDebt
              ? (duesStanding.kind === 'credit'
                ? duesStandingDisplayAmount(duesStanding, formatCurrency)
                : (duesStanding.title || quota.title || 'Al día'))
              : hideCurrentAccount
                ? 'En administración'
                : duesStandingDisplayAmount(duesStanding, formatCurrency)}
          </div>
          <div className="mp-balance-hint">
            {!hasDebt
              ? (duesStanding.kind === 'credit'
                ? (duesStandingDisplayHint(duesStanding, formatCurrency) || 'Se descuenta en el próximo cobro')
                : (duesStanding.hint || quota.hint || 'Sin deuda de cuota'))
              : hideCurrentAccount
                ? 'Consultá el detalle en administración'
                : (duesStandingDisplayHint(duesStanding, formatCurrency)
                  || (!dueFact.value
                    ? 'Pendiente de cobro'
                    : (dueFact.overdue
                      ? `Vencida desde ${dueFact.value}`
                      : (dueFact.label === 'Vence hoy'
                        ? `Vence hoy · ${dueFact.value}`
                        : `Próximo vencimiento ${dueFact.value}`))))}
          </div>
          <p className={`mp-balance-pool ${poolPay.canPay ? 'is-ok' : 'is-no'}`}>
            {poolPay.label}
            <span>{poolPay.detail}</span>
          </p>
          {canCollect && (hasDebt || quota.billing) ? (
            <button
              type="button"
              className="btn btn-primary btn-sm mp-collect-btn"
              onClick={() => setCollectOpen(true)}
            >
              <Banknote size={14} aria-hidden /> Cobrar
            </button>
          ) : null}
          {collectFlash ? <p className="mp-collect-flash">{collectFlash}</p> : null}
        </aside>
      </header>

      {(pendingBaja || vitalicioOffer || debitFailed || (childStanding.kind === 'leave')) ? (
        <div className="mp-ops-notes">
          {pendingBaja ? (
            <p className="mp-ops-note">
              Baja programada el {member.bajaFecha || member.meta?.bajaFecha}. La nota es con un mes de anticipación: el mes en curso se cobra.
            </p>
          ) : null}
          {vitalicioOffer ? (
            <p className="mp-ops-note is-warn">
              Este socio llegó para pasar a vitalicio. Avisarle y cambiar la categoría.
            </p>
          ) : null}
          {debitFailed ? (
            <p className="mp-ops-note is-warn">
              {selfService
                ? 'No pasó el débito automático de tu cuota. Entrá a Mi cuenta para regularizarlo.'
                : 'No pasó el débito de Mercado Pago. Hay que avisarle al socio.'}
            </p>
          ) : null}
          {childStanding.kind === 'leave' ? (
            <p className="mp-ops-note is-warn">{childStanding.label}</p>
          ) : null}
        </div>
      ) : null}

      <nav className="mp-nav section-chips" aria-label="Secciones del perfil">
        {visibleSections.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSection(s.id);
                if (s.id === 'editar' && member) {
                  setEditForm(editFormFromMember(member, disciplineOptions));
                  setEditMsg('');
                }
              }}
              className={`mp-nav-btn${active ? ' is-active' : ''}`}
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </nav>

      {/* Grupo familiar siempre visible: integrantes + tarjeta de cada uno */}
      <section className="mp-family-banner" aria-label="Grupo familiar">
        <div className="mp-family-toolbar">
          <p className="mp-section-lead">
            <Users size={14} aria-hidden />{' '}
            {member.familyGroupName || familyGroup.titular?.familyGroupName
              ? `${member.familyGroupName || familyGroup.titular?.familyGroupName} · `
              : 'Grupo familiar · '}
            {!householdReady
              ? 'cargando…'
              : `${familyRows.length} integrante${familyRows.length === 1 ? '' : 's'}`}
          </p>
          {canEditFamily ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={openAddFamily}>
              <Plus size={14} /> Agregar
            </button>
          ) : null}
        </div>
        {!householdReady ? (
          <p className="mp-family-loading" role="status" aria-live="polite">
            <Loader2 size={16} className="mp-family-loading-spin" />
            Cargando el grupo familiar desde la base…
          </p>
        ) : !familyRows.length ? (
          <p className="mp-fact-value muted" style={{ margin: 0 }}>Sin integrantes en el grupo familiar.</p>
        ) : (
          <div className="mp-family">
            {familyRows.map((adh) => {
              const selfId = memberNumberOf(member);
              const rowId = String(adh.memberId || '').replace(/\D/g, '');
              const isSelf = rowId && rowId === selfId;
              const source = findMemberByNumber(familySource, adh.memberId);
              return (
                <div key={rowId || adh.id || adh.name} className="mp-family-row">
                  <div className="mp-family-avatar">
                    {adh.photo ? (
                      <img src={adh.photo} alt="" />
                    ) : (
                      (adh.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                    )}
                  </div>
                  <div>
                    <strong>{adh.name}{isSelf ? ' · Vos' : ''}</strong>
                    <div className="mp-family-meta">
                      {adh.relationship}
                      {adh.memberId ? ` · Nº ${adh.memberId}` : ''}
                    </div>
                  </div>
                  <span className="mp-tier-pill" style={tierBadgeStyle(adh.tier, tierCatalog)}>
                    {getTierDisplayName(adh.tier, tierCatalog)}
                  </span>
                  <div className="mp-family-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setCardMember(source || familyCardMember(adh, member))}
                    >
                      <CreditCard size={13} /> Tarjeta
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mp-panel glass-panel">
        {section === 'ficha' && (
          <div className="mp-dossier">
            <section className="mp-sheet mp-sheet--id">
              <SheetHead index="01" title="Identidad" kicker="Documento y datos personales del padrón" />
              <div className="mp-id-spotlight">
                <div className={`mp-id-doc${doc.nro ? '' : ' is-empty'}`}>
                  <span className="mp-fact-label">Documento</span>
                  <span className="mp-id-kind">{doc.kind}</span>
                  <strong>{doc.nro || 'Sin documento'}</strong>
                </div>
                <div className={`mp-id-join${joinLabel ? '' : ' is-empty'}`}>
                  <span className="mp-fact-stamp" aria-hidden><Clock size={16} /></span>
                  <div>
                    <span className="mp-fact-label">Ingreso al club</span>
                    <strong>{joinLabel || 'Sin fecha'}</strong>
                    {tenure ? <span className="mp-fact-hint">{tenure}</span> : null}
                  </div>
                </div>
              </div>
              <div className="mp-ledger">
                <Fact
                  icon={Cake}
                  label="Nacimiento"
                  value={formatShortDate(member.birthDate)}
                  hint={age != null ? `${age} años` : null}
                />
                <Fact icon={User} label="Género" value={titleCase(member.gender)} />
                <Fact icon={Heart} label="Estado civil" value={titleCase(member.maritalStatus)} />
                <Fact icon={Flag} label="Nacionalidad" value={member.nationality || 'Argentina'} />
              </div>
            </section>

            <section className="mp-sheet mp-sheet--contact">
              <SheetHead index="02" title="Contacto y domicilio" kicker="Cómo ubicar al socio" />
              <div className="mp-contact-grid">
                <ContactRow icon={Phone} label="WhatsApp" value={member.phone} href={phoneHref} />
                <ContactRow icon={Phone} label="Tel. alternativo" value={member.phoneAlt} />
                <ContactRow icon={Mail} label="Email" value={member.email} href={mailHref} />
                <ContactRow icon={MapPin} label="Domicilio" value={addressLine || null} />
              </div>
            </section>

            <section className="mp-sheet mp-sheet--alert">
              <SheetHead index="03" title="Datos de emergencia" kicker="Grupo sanguíneo, obra social y contactos médicos" />
              <div className="mp-facts">
                <Fact icon={Heart} label="Grupo sanguíneo" value={member.bloodType || member.meta?.bloodType || null} />
                <Fact icon={ShieldCheck} label="Obra social" value={member.healthInsurance || member.meta?.healthInsurance || null} />
                <Fact
                  icon={AlertTriangle}
                  label="Contacto emergencia"
                  value={[member.emergencyContact, member.emergencyPhone].filter(Boolean).join(' · ') || null}
                />
                <Fact icon={Building2} label="Clínica de emergencia" value={member.emergencyClinic || member.meta?.emergencyClinic || null} />
              </div>
            </section>

            <section className="mp-sheet mp-sheet--dues">
              <SheetHead index="04" title="Membresía y cobranza" kicker="Categoría, cuota y datos de facturación" />
              <div className="mp-facts mp-facts--dues">
                <Fact icon={ShieldCheck} label="Categoría" value={tierName} hint={status.hint} />
                <Fact icon={ShieldCheck} label="Estado de cuenta" value={status.label} />
                <Fact
                  icon={CalendarClock}
                  label={dueFact.label}
                  value={dueFact.value}
                  hint={dueFact.hint}
                />
                <Fact
                  icon={Banknote}
                  label="Medio de pago"
                  value={PAYMENT_LABELS[member.paymentMethod] || titleCase(member.paymentMethod)}
                />
                <Fact
                  icon={Banknote}
                  label="Débito Mercado Pago"
                  value={duesExempt
                    ? 'No aplica'
                    : (isMpAdhered(member)
                      ? 'Adherido (día 10)'
                      : (debitFailed ? 'Falló el último cobro' : 'Sin adhesión'))}
                  hint="Se gestiona en Mi cuenta, no en la ficha."
                />
                <Fact icon={Building2} label="Facturar a" value={member.billingName || member.name} />
                <Fact icon={IdCard} label="CUIT / CUIL" value={member.cuitCuil} />
                <Fact
                  icon={FileText}
                  label="Condición IVA"
                  value={TAX_LABELS[member.taxCondition] || titleCase(member.taxCondition)}
                />
              </div>
              <div className="mp-disciplines">
                <div className="mp-fact-label">Disciplinas</div>
                {(member.disciplines || []).length ? (
                  <div className="mp-chips">
                    {member.disciplines.map((d) => (
                      <span key={d} className="mp-chip">{d}</span>
                    ))}
                  </div>
                ) : (
                  <p className="mp-fact-value muted">Sin disciplinas cargadas</p>
                )}
              </div>
            </section>

            {member.notes ? (
              <section className="mp-sheet mp-sheet--notes mp-notes">
                <SheetHead index="05" title="Observaciones" />
                <p>{member.notes}</p>
              </section>
            ) : null}
          </div>
        )}

        {section === 'tarjeta' && (
          <div className="mp-card-wrap">
            <VirtualCard member={member} />
            <p className="mp-card-hint">
              {isFamilyDependent(member)
                ? 'Tu credencial de socio familiar. Tocá para agrandarla o descargarla.'
                : 'Tocá la credencial para agrandarla o descargala en PDF.'}
            </p>
          </div>
        )}

        {section === 'editar' && editForm && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!updateMember) return;
              const sports = canonDisciplineList(editForm.disciplines || [], disciplineOptions);
              let updated = applyMemberProfileUpdate(member, {
                ...editForm,
                preferredSports: sports,
                disciplines: sports,
              });
              if (!selfService) {
                if (editForm.name?.trim()) updated.name = editForm.name.trim();
                updated.documentNumber = editForm.documentNumber || '';
                updated.birthDate = editForm.birthDate || '';
                if (editForm.tier) updated.tier = editForm.tier;
              }
              if (isDuesExemptMember(updated) || dbMemberIsDuesExempt(updated.tier, updated.meta)) {
                updated.notifyDues = false;
              }
              updated.recordScope = 'full';
              updated = withProfileEditTrace(member, updated, {
                actorId,
                actorName,
                source: selfService ? 'portal' : 'panel',
              });
              const wasExempt = dbMemberIsDuesExempt(member.tier, member.meta);
              const willExempt = dbMemberIsDuesExempt(updated.tier, updated.meta);
              if (willExempt && !wasExempt) {
                const reason = window.prompt('Motivo de la exención (mínimo 8 caracteres)');
                if (!reason || reason.trim().length < 8) {
                  setEditMsg('Falta el motivo de la exención (mínimo 8 caracteres).');
                  return;
                }
                updated = { ...updated, exemptionReason: reason.trim() };
              }
              const saved = await updateMember(updated);
              if (!saved) {
                setEditMsg('No se pudo guardar.');
                return;
              }
              setEditMsg(saved.meta?.lastProfileEdit
                ? `Guardado · ${saved.meta.lastProfileEdit.actorName || actorName}`
                : 'Datos actualizados correctamente.');
            }}
            className="mp-edit-form"
          >
            {(!selfService ? [
              ['name', 'Nombre completo'],
              ['documentNumber', 'Documento'],
              ['birthDate', 'Nacimiento'],
            ] : []).concat([
              ['phone', 'WhatsApp'],
              ['phoneAlt', 'Tel. alternativo'],
              ['email', 'Email'],
              ['address', 'Domicilio'],
              ['city', 'Localidad'],
              ['province', 'Provincia'],
              ['postalCode', 'CP'],
              ['emergencyContact', 'Contacto emergencia'],
              ['emergencyPhone', 'Tel. emergencia'],
            ]).map(([key, label]) => (
              <div
                key={key}
                className="mp-edit-field"
                style={{ gridColumn: key === 'address' ? '1 / -1' : undefined }}
              >
                <label className="form-label">{label}</label>
                <input
                  className="form-input"
                  type={key === 'birthDate' ? 'date' : key === 'email' ? 'email' : 'text'}
                  value={editForm[key] || ''}
                  onChange={(ev) => setEditForm((curr) => ({ ...curr, [key]: ev.target.value }))}
                />
              </div>
            ))}
            <div className="mp-edit-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label">Disciplinas</span>
              <div className="mp-family-chips">
                {[
                  ...disciplineOptions,
                  ...(editForm.disciplines || []).filter(
                    (d) => !disciplineOptions.some((opt) => normalizeLabel(opt) === normalizeLabel(d))
                  ),
                ].map((d) => {
                  const active = isDisciplineSelected(editForm.disciplines, d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`mp-family-chip${active ? ' is-on' : ''}`}
                      onClick={() => setEditForm((curr) => ({
                        ...curr,
                        disciplines: toggleDiscipline(curr.disciplines, d),
                      }))}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mp-edit-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label">Foto</span>
              <div className="mp-family-photo">
                <div className="mp-family-avatar" style={{ width: 76, height: 76, borderRadius: 14 }}>
                  {editForm.photo ? <img src={editForm.photo} alt="" /> : <Camera size={20} />}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    {editForm.photo ? 'Cambiar foto' : 'Subir del ordenador'}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={async (ev) => {
                        const file = ev.target.files?.[0];
                        ev.target.value = '';
                        if (!file) return;
                        try {
                          const photo = await readMemberPhoto(file);
                          setEditForm((curr) => ({ ...curr, photo }));
                          setEditMsg('');
                        } catch {
                          setEditMsg('No se pudo leer la imagen.');
                        }
                      }}
                    />
                  </label>
                  {editForm.photo ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditForm((curr) => ({ ...curr, photo: '' }))}
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {!selfService ? (
              <div className="mp-edit-field">
                <label className="form-label">Categoría</label>
                <select
                  className="form-input"
                  value={editForm.tier || ''}
                  onChange={(ev) => setEditForm((curr) => ({ ...curr, tier: ev.target.value }))}
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="mp-edit-notices">
              {[
                !isDuesExemptMember({ ...member, ...editForm }) ? ['notifyDues', 'Avisos de cuota'] : null,
                ['notifyReservations', 'Avisos de reservas'],
                ['notifyEvents', 'Avisos de eventos'],
              ].filter(Boolean).map(([key, label]) => (
                <label key={key} className="mp-edit-check">
                  <input
                    type="checkbox"
                    checked={Boolean(editForm[key])}
                    onChange={(ev) => setEditForm({ ...editForm, [key]: ev.target.checked })}
                  />
                  <Bell size={13} /> {label}
                </label>
              ))}
            </div>
            <div className="mp-edit-actions">
              <button type="submit" className="btn btn-primary" disabled={!updateMember}>Guardar cambios</button>
              {editMsg && <span className="mp-edit-ok">{editMsg}</span>}
            </div>
          </form>
        )}

        {section === 'invitados' && selfService && setGuestPasses && (
          <GuestPassPanel
            member={member}
            guestPasses={guestPasses}
            setGuestPasses={setGuestPasses}
          />
        )}

        {section === 'docs' && selfService && (
          <div className="mp-docs">
            <p className="mp-section-lead">
              Subí documentación para revisión de Secretaría.
            </p>
            {DOCUMENT_TYPES.map((doc) => {
              const existing = (member.documents || []).find((d) => d.type === doc.id);
              return (
                <div key={doc.id} className="mp-doc-row">
                  <div>
                    <strong>{doc.label}</strong>
                    <div className="mp-doc-meta">
                      {existing
                        ? `${existing.fileName} · ${existing.status === 'pending_review' ? 'En revisión' : existing.status}`
                        : 'Sin archivo'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!updateMember}
                    onClick={() => {
                      if (!updateMember) return;
                      updateMember(upsertMemberDocument(member, {
                        type: doc.id,
                        fileName: `${doc.id}-${member.memberId}.pdf`,
                        note: 'Carga desde portal socio',
                      }));
                    }}
                  >
                    {existing ? 'Reemplazar' : 'Cargar'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {section === 'familia' && (
          <div>
            <div className="mp-family-toolbar">
              <p className="mp-section-lead">
                {member.familyGroupName || familyGroup.titular?.familyGroupName
                  ? `${member.familyGroupName || familyGroup.titular?.familyGroupName} · `
                  : ''}
                {!householdReady
                  ? 'cargando grupo…'
                  : `${familyRows.length} integrante${familyRows.length === 1 ? '' : 's'}`}
              </p>
              {canEditFamily ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openAddFamily}>
                  <Plus size={14} /> Agregar integrante
                </button>
              ) : null}
            </div>
            {!householdReady ? (
              <p className="mp-family-loading" role="status" aria-live="polite">
                <Loader2 size={16} className="mp-family-loading-spin" />
                Cargando el grupo familiar desde la base…
              </p>
            ) : !familyRows.length ? (
              <Empty text="Sin integrantes en el grupo familiar." />
            ) : (
              <div className="mp-family">
                {familyRows.map((adh) => {
                  const selfId = memberNumberOf(member);
                  const rowId = String(adh.memberId || '').replace(/\D/g, '');
                  const isSelf = rowId && rowId === selfId;
                  const canOpen = Boolean(onOpenMember && adh.memberId && !isSelf);
                  const source = findMemberByNumber(familySource, adh.memberId);
                  return (
                    <div
                      key={rowId || adh.id || adh.name}
                      className={`mp-family-row${canOpen ? ' is-clickable' : ''}`}
                      role={canOpen ? 'button' : undefined}
                      tabIndex={canOpen ? 0 : undefined}
                      onClick={canOpen ? () => onOpenMember(adh.memberId) : undefined}
                      onKeyDown={canOpen ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenMember(adh.memberId);
                        }
                      } : undefined}
                    >
                      <div className="mp-family-avatar">
                        {adh.photo ? (
                          <img src={adh.photo} alt="" />
                        ) : (
                          (adh.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                        )}
                      </div>
                      <div>
                        <strong>{adh.name}</strong>
                        <div className="mp-family-meta">
                          {adh.relationship}
                          {adh.memberId ? ` · Nº ${adh.memberId}` : ''}
                          {' · '}
                          {(adh.disciplines || []).join(', ') || 'Sin disciplina'}
                          {adh.relationship !== 'Titular' && familyChildStanding(source || adh).label ? (
                            <span className="mp-family-standing">
                              {familyChildStanding(source || adh).label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span className="mp-tier-pill" style={tierBadgeStyle(adh.tier, tierCatalog)}>
                        {getTierDisplayName(adh.tier, tierCatalog)}
                      </span>
                      <div className="mp-family-actions">
                        {canEditFamily ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              const person = source || adh;
                              setFamilyEditMsg('');
                              setFamilyEdit({
                                source,
                                adherentId: adh.id || adh.memberId,
                                form: {
                                  name: person.name || '',
                                  documentNumber: source?.documentNumber || '',
                                  birthDate: source?.birthDate || '',
                                  phone: source?.phone || '',
                                  email: source?.email || '',
                                  tier: source?.tier || adh.tier || '',
                                  disciplines: canonDisciplineList(
                                    source?.disciplines || adh.disciplines || [],
                                    disciplineOptions
                                  ),
                                  photo: source?.photo || adh.photo || '',
                                  relationship: adh.relationship || source?.relationship || 'Grupo familiar',
                                  regularidadStart: regularidadOf(person, Number(String(todayISODateAR()).slice(0, 4))).start,
                                  regularidadEnd: regularidadOf(person, Number(String(todayISODateAR()).slice(0, 4))).end,
                                },
                              });
                            }}
                          >
                            <Pencil size={13} /> Editar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCardMember(source || familyCardMember(adh, member));
                          }}
                        >
                          <CreditCard size={13} /> Tarjeta
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {section === 'movimientos' && (
          <div>
            {(member.paymentHistory || []).length === 0 && movements.length === 0 ? (
              <Empty text="Sin movimientos contables vinculados a este socio." />
            ) : (
              <>
                {(member.paymentHistory || []).map((p) => (
                  <div key={p.id || `${p.date}-${p.amount}`} className="mp-list-row">
                    <span className="mp-list-when">{formatPaymentWhen(p)}</span>
                    <span className="mp-list-main">
                      {p.concept || `Cobro · ${duesMethodLabel(p.method, p.bankName)}`}
                      {p.status === 'void' ? (
                        <div className="mp-list-sub">
                          Anulado
                          {p.voidedByName || (p.voidedBy && !/^[0-9a-f-]{36}$/i.test(String(p.voidedBy)))
                            ? ` · ${p.voidedByName || p.voidedBy}`
                            : ''}
                          {p.voidReason ? ` · ${p.voidReason}` : ''}
                        </div>
                      ) : p.surcharge > 0 ? (
                        <div className="mp-list-sub">Cuota {formatCurrency(p.quota)} · Recargo {formatCurrency(p.surcharge)}</div>
                      ) : p.removedSurcharge > 0 ? (
                        <div className="mp-list-sub">Recargo borrado{p.surchargeRemovedBy ? ` · ${p.surchargeRemovedBy}` : ''}</div>
                      ) : null}
                      {Number(p.creditApplied) > 0.01 ? (
                        <div className="mp-list-sub">Saldo a favor imputado {formatCurrency(p.creditApplied)}</div>
                      ) : null}
                      {Number(p.creditLeftover) > 0.01 ? (
                        <div className="mp-list-sub">Saldo a favor {formatCurrency(p.creditLeftover)}</div>
                      ) : null}
                      {p.imputations?.length ? (
                        <div className="mp-list-sub">
                          {p.imputations.map((row) => (
                            `${imputationPeriodLabel(row.dueOn)}: cuota ${formatCurrency(row.capital)}`
                            + (row.surcharge > 0 ? ` · recargo ${formatCurrency(row.surcharge)}` : '')
                            + (row.surchargeOpen > 0 ? ` · queda recargo ${formatCurrency(row.surchargeOpen)}` : '')
                          )).join(' · ')}
                        </div>
                      ) : null}
                      {p.receiptName || p.receiptPath ? (
                        <div className="mp-list-sub">
                          Comprobante: {p.receiptName || 'adjunto'}
                          {p.receiptPath ? (
                            <>
                              {' · '}
                              <button
                                type="button"
                                className="link-button"
                                style={{ background: 'none', border: 0, padding: 0, color: 'var(--text-gold)', cursor: 'pointer', textDecoration: 'underline' }}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const url = await signedDuesReceiptUrl(p.receiptPath);
                                  if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                  else setCollectFlash('No se pudo abrir el comprobante.');
                                }}
                              >
                                Abrir
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </span>
                    <strong className="mp-list-amount" style={p.status === 'void' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                      {formatCurrency(p.amount)}
                    </strong>
                    {canCollect && p.status !== 'void' && p.id && canRemoveSurcharge && p.surcharge > 0 ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          if (!window.confirm('¿Borrar el recargo de este cobro? El importe cobrado queda y el recargo pasa a saldo a favor.')) return;
                          const reason = window.prompt('Motivo para quitar el recargo (mínimo 8 caracteres)') || '';
                          if (reason.trim().length < 8) {
                            setCollectFlash('Falta el motivo para quitar el recargo (mínimo 8 caracteres).');
                            window.setTimeout(() => setCollectFlash(''), 5000);
                            return;
                          }
                          try {
                            const result = removeDuesSurcharge(member, p.id, {
                              removedBy: user?.name || 'Administración',
                              reason: reason.trim(),
                            });
                            await persistDuesCollection(result, {
                              setMembers,
                              updateMember,
                              addJournalEntry,
                              onAccountEntry,
                            });
                            setCollectFlash(`Recargo borrado · ${formatCurrency(p.surcharge)}`);
                            window.setTimeout(() => setCollectFlash(''), 5000);
                          } catch (err) {
                            setCollectFlash(err.message || 'No se pudo borrar el recargo.');
                            window.setTimeout(() => setCollectFlash(''), 5000);
                          }
                        }}
                      >
                        Borrar recargo
                      </button>
                    ) : null}
                    {canCollect && p.status !== 'void' && p.id && canVoid ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          const reason = window.prompt('Motivo de la anulación (mínimo 8 caracteres)');
                          if (reason == null) return;
                          if (reason.trim().length < 8) {
                            setCollectFlash('Falta el motivo de la anulación (mínimo 8 caracteres).');
                            window.setTimeout(() => setCollectFlash(''), 5000);
                            return;
                          }
                          try {
                            const result = voidMemberDuesPayment(member, p.id, {
                              voidedBy: user?.fullName || user?.name || 'Caja',
                              voidedById: user?.id || null,
                              reason,
                            });
                            await persistDuesVoid(result, {
                              setMembers,
                              updateMember,
                              addJournalEntry,
                              onAccountEntry,
                            });
                            if (typeof onSendMessage === 'function') {
                              try {
                                const { duesVoidedReceiptMessage } = await import('../../domain/members/duesPaymentNotice');
                                await onSendMessage(duesVoidedReceiptMessage({
                                  member: result.member,
                                  payment: result.payment,
                                  reason,
                                }));
                              } catch {
                                /* aviso al socio: best-effort */
                              }
                            }
                            setCollectFlash(`Cobro anulado · ${formatCurrency(p.amount)}`);
                            window.setTimeout(() => setCollectFlash(''), 5000);
                          } catch (err) {
                            setCollectFlash(err.message || 'No se pudo anular.');
                            window.setTimeout(() => setCollectFlash(''), 5000);
                          }
                        }}
                      >
                        Anular
                      </button>
                    ) : null}
                  </div>
                ))}
                {movements.map((e) => {
                  const amount = (e.lines || []).find((l) => l.type === 'debit')?.amount;
                  return (
                    <div key={e.id} className="mp-list-row">
                      <span className="mp-list-when">{formatShortDate(e.date)}</span>
                      <span className="mp-list-main">{e.description}</span>
                      <strong className="mp-list-amount">
                        {amount != null ? formatCurrency(amount) : '—'}
                      </strong>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {section === 'entradas' && (
          <div>
            {entries.length === 0 ? (
              <Empty text="Sin registros de ingreso por QR / portería." />
            ) : (
              entries.map((e) => (
                <div key={e.id} className="mp-list-row">
                  <span className="mp-list-when">{formatShortDate(e.date)} {e.time}</span>
                  <span className="mp-list-main muted">{e.notes || e.role}</span>
                  <strong className={e.status === 'granted' ? 'tone-ok' : 'tone-danger'}>
                    {e.status === 'granted' ? 'Ingreso OK' : 'Denegado'}
                  </strong>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'asistencia' && (
          <div>
            <p className="mp-section-lead">
              Reservas e instalaciones usadas por el socio.
            </p>
            {bookings.length === 0 ? (
              <Empty text="Sin reservas registradas." />
            ) : (
              bookings.map((r) => (
                <div key={r.id} className="mp-list-row">
                  <span className="mp-list-when">{formatShortDate(r.date)} {r.time}</span>
                  <span className="mp-list-main">
                    <strong>{r.facilityName}</strong>
                    {r.guestNames && (
                      <div className="mp-list-sub">Invitados: {r.guestNames}</div>
                    )}
                  </span>
                  <span className={r.status === 'confirmed' ? 'tone-ok' : 'tone-warn'}>
                    {r.status === 'confirmed' ? 'Confirmada' : titleCase(r.status)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'reclamos' && (
          <div>
            {memberClaims.length === 0 ? (
              <Empty text="Sin reclamos asociados." />
            ) : (
              memberClaims.map((c) => (
                <div key={c.id} className="mp-claim-row">
                  <div className="mp-claim-top">
                    <strong>{c.title}</strong>
                    <span>{formatShortDate(c.date)}</span>
                  </div>
                  <div className="mp-claim-body">{c.description || c.detail}</div>
                  <div className="mp-claim-status">Estado: {titleCase(c.status)}</div>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'mensajes' && (
          <div>
            {memberMessages.length === 0 ? (
              <Empty text="Sin mensajes vinculados a este socio." />
            ) : (
              memberMessages.map((m) => (
                <div key={m.id} className="mp-claim-row">
                  <div className="mp-claim-top">
                    <strong>{m.subject}</strong>
                    <span>{formatShortDate(m.date)}</span>
                  </div>
                  <div className="mp-list-sub">
                    De: {m.sender} → {m.recipientId === member.memberId ? 'Este socio' : m.recipientId}
                  </div>
                  <div className="mp-claim-body">{m.content}</div>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'trazabilidad' && (
          <div>
            <p className="mp-section-lead">
              Línea de tiempo de lo registrado en esta app: alta, cobros, comprobantes, ingresos, reservas, reclamos, suspensiones, bajas y accesos portal. En cada ítem figura quién lo registró (desde esta app en adelante).
            </p>
            {timeline.length === 0 ? (
              <Empty text="Sin eventos de trazabilidad." />
            ) : (
              timeline.map((item, idx) => (
                <TimelineItem
                  key={`${item.sort}-${idx}`}
                  when={item.when}
                  title={item.title}
                  detail={item.detail}
                  actorName={item.actorName}
                  tone={item.tone}
                />
              ))
            )}
          </div>
        )}
      </div>

      {collectOpen ? (
        <CollectDuesModal
          member={member}
          members={members}
          formatCurrency={formatCurrency}
          onClose={() => setCollectOpen(false)}
          onConfirm={handleConfirmCollect}
          paymentPlans={paymentPlans}
          paymentTolerance={paymentTolerance}
        />
      ) : null}

      {cardMember ? (
        <ModalDialog
          onClose={() => setCardMember(null)}
          labelledBy="family-card-title"
          contentClassName="modal-content glass-panel"
          contentStyle={{
            width: '90%',
            maxWidth: 460,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            padding: '1.25rem',
          }}
        >
          <div className="mp-family-modal-head">
            <div>
              <h4 id="family-card-title" className="serif-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-gold)' }}>
                Tarjeta virtual
              </h4>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {cardMember.name}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCardMember(null)}>
              <X size={14} /> Cerrar
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <VirtualCard member={cardMember} />
          </div>
        </ModalDialog>
      ) : null}

      {familyEdit ? (
        <ModalDialog
          onClose={() => setFamilyEdit(null)}
          labelledBy="family-edit-title"
          contentClassName="modal-content glass-panel"
          contentStyle={{
            width: '92%',
            maxWidth: 560,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            padding: '1.25rem',
          }}
        >
          <div className="mp-family-modal-head">
            <h4 id="family-edit-title" className="serif-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-gold)' }}>
              {familyEdit.isNew ? 'Agregar integrante' : 'Editar integrante'}
            </h4>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFamilyEdit(null)}>
              <X size={14} /> Cerrar
            </button>
          </div>
          <form
            className="mp-edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!updateMember) return;
              const form = familyEdit.form;
              const name = String(form.name || '').trim();
              if (!name) {
                setFamilyEditMsg('El nombre es obligatorio.');
                return;
              }
              void (async () => {
                if (familyEdit.isNew) {
                  const error = await persistNewFamilyMember({ ...form, name });
                  if (error) {
                    setFamilyEditMsg(error);
                    return;
                  }
                  setFamilyEdit(null);
                  setHouseholdEpoch((n) => n + 1);
                  return;
                }
                if (!familyEdit.source) {
                  setFamilyEditMsg('Ese integrante no está en el padrón de la base. Agregalo al grupo familiar.');
                  return;
                }
                const nextPerson = withProfileEditTrace(
                  familyEdit.source,
                  applyRegularidadForm({
                    ...familyEdit.source,
                    name,
                    documentNumber: form.documentNumber || '',
                    birthDate: form.birthDate || '',
                    phone: form.phone || '',
                    email: form.email || '',
                    tier: form.tier || familyEdit.source.tier,
                    disciplines: form.disciplines || [],
                    photo: form.photo || '',
                    relationship: form.relationship || familyEdit.source.relationship,
                    updatedAt: new Date().toISOString(),
                  }, form),
                  { actorId, actorName, source: 'familia' },
                );
                const saved = await updateMember(nextPerson);
                if (isSupabaseConfigured && !saved) {
                  setFamilyEditMsg('No se pudo guardar el integrante en la base.');
                  return;
                }
                setFamilyEdit(null);
                setHouseholdEpoch((n) => n + 1);
              })();
            }}
          >
            <div className="mp-edit-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label">Foto</span>
              <div className="mp-family-photo">
                <div className="mp-family-avatar" style={{ width: 64, height: 64, borderRadius: 12 }}>
                  {familyEdit.form.photo ? <img src={familyEdit.form.photo} alt="" /> : <Camera size={18} />}
                </div>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  {familyEdit.form.photo ? 'Cambiar foto' : 'Subir foto'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (ev) => {
                      const file = ev.target.files?.[0];
                      ev.target.value = '';
                      if (!file) return;
                      try {
                        const photo = await readMemberPhoto(file);
                        setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, photo } } : curr);
                      } catch {
                        setFamilyEditMsg('No se pudo leer la imagen.');
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            {familyEdit.isNew ? (
              <div className="mp-edit-field">
                <label className="form-label">Credencial</label>
                <input
                  className="form-input"
                  value={familyEdit.form.memberId || ''}
                  onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, memberId: ev.target.value } } : curr)}
                />
              </div>
            ) : null}
            <div className="mp-edit-field" style={{ gridColumn: familyEdit.isNew ? undefined : '1 / -1' }}>
              <label className="form-label">Nombre completo</label>
              <input
                className="form-input"
                value={familyEdit.form.name}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, name: ev.target.value } } : curr)}
              />
            </div>
            <div className="mp-edit-field">
              <label className="form-label">Vínculo</label>
              <select
                className="form-input"
                value={familyEdit.form.relationship}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, relationship: ev.target.value } } : curr)}
              >
                {FAMILY_RELATIONSHIPS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div className="mp-edit-field">
              <label className="form-label">Documento</label>
              <input
                className="form-input"
                value={familyEdit.form.documentNumber}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, documentNumber: ev.target.value } } : curr)}
              />
            </div>
            <div className="mp-edit-field">
              <label className="form-label">Nacimiento</label>
              <input
                type="date"
                className="form-input"
                value={familyEdit.form.birthDate}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, birthDate: ev.target.value } } : curr)}
              />
            </div>
            <div className="mp-edit-field">
              <label className="form-label">WhatsApp</label>
              <input
                className="form-input"
                value={familyEdit.form.phone}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, phone: ev.target.value } } : curr)}
              />
            </div>
            <div className="mp-edit-field">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={familyEdit.form.email}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, email: ev.target.value } } : curr)}
              />
            </div>
            <div className="mp-edit-field">
              <label className="form-label">Categoría</label>
              <select
                className="form-input"
                value={familyEdit.form.tier}
                onChange={(ev) => setFamilyEdit((curr) => curr ? { ...curr, form: { ...curr.form, tier: ev.target.value } } : curr)}
              >
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="mp-edit-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label">Certificado de regularidad {String(todayISODateAR()).slice(0, 4)}</span>
              <label className="mp-family-cert">
                <input
                  type="checkbox"
                  checked={Boolean(familyEdit.form.regularidadStart)}
                  onChange={(ev) => setFamilyEdit((curr) => curr
                    ? { ...curr, form: { ...curr.form, regularidadStart: ev.target.checked } }
                    : curr)}
                />
                Inicio de año
              </label>
              <label className="mp-family-cert">
                <input
                  type="checkbox"
                  checked={Boolean(familyEdit.form.regularidadEnd)}
                  onChange={(ev) => setFamilyEdit((curr) => curr
                    ? { ...curr, form: { ...curr.form, regularidadEnd: ev.target.checked } }
                    : curr)}
                />
                Fin de año
              </label>
            </div>
            <div className="mp-edit-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label">Disciplinas</span>
              <div className="mp-family-chips">
                {[
                  ...disciplineOptions,
                  ...(familyEdit.form.disciplines || []).filter(
                    (d) => !disciplineOptions.some((opt) => normalizeLabel(opt) === normalizeLabel(d))
                  ),
                ].map((d) => {
                  const active = isDisciplineSelected(familyEdit.form.disciplines, d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`mp-family-chip${active ? ' is-on' : ''}`}
                      onClick={() => setFamilyEdit((curr) => {
                        if (!curr) return curr;
                        return {
                          ...curr,
                          form: {
                            ...curr.form,
                            disciplines: toggleDiscipline(curr.form.disciplines, d),
                          },
                        };
                      })}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mp-edit-actions">
              <button type="submit" className="btn btn-primary" disabled={!updateMember && !setMembers}>
                {familyEdit.isNew ? 'Agregar al grupo' : 'Guardar'}
              </button>
              {familyEditMsg ? <span className="mp-edit-ok" style={{ color: '#f87171' }}>{familyEditMsg}</span> : null}
            </div>
          </form>
        </ModalDialog>
      ) : null}
    </div>
  );
}
