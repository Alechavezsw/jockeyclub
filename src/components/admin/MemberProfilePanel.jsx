import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, User, CreditCard, Users, Wallet, DoorOpen, CalendarDays,
  MessageSquare, ClipboardList, Activity, Phone, Mail, MapPin,
  Pencil, FileText, Ticket, Bell, IdCard, Cake, Heart, Flag, Clock,
  ShieldCheck, CalendarClock, Banknote, Building2, AlertTriangle,
  Camera, X, Plus,
} from 'lucide-react';
import VirtualCard from '../VirtualCard';
import GuestPassPanel from '../GuestPassPanel';
import CollectDuesModal from './CollectDuesModal';
import ModalDialog from '../ModalDialog';
import { formatShortDate, quotaHeadline } from '../../domain/members/dues';
import { formatDateTimeAR, todayISODateAR } from '../../lib/arDate';
import { collectMemberMeta, memberHasSocietasApp } from '../../domain/members/memberAdminActions';
import { getActiveTiers, getTierDisplayName, tierBadgeStyle } from '../../domain/members/tiers';
import { DISCIPLINE_OPTIONS, getDisciplineOptions, normalizeLabel } from '../../domain/sports/disciplines';
import {
  allocateNextMemberNumber,
  familyPrincipalOf,
  householdMemberAsAdherent,
  isFamilyDependent,
  memberNumberOf,
  resolveFamilyForDisplay,
} from '../../domain/members/households';
import {
  applyMemberProfileUpdate,
  upsertMemberDocument,
  DOCUMENT_TYPES,
} from '../../domain/members/profileEdit';
import { duesMethodLabel, persistDuesCollection, recordDuesCollection } from '../../domain/members/memberPayments';

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
  debito: 'Débito automático',
  debito_automatico: 'Débito automático',
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

function membershipTenure(member) {
  if (member?.joinDate) {
    const join = new Date(`${String(member.joinDate).slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(join.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - join.getFullYear();
      const m = now.getMonth() - join.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < join.getDate())) years -= 1;
      if (years <= 0) {
        let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
        if (now.getDate() < join.getDate()) months -= 1;
        if (months <= 0) return 'Recién ingresado';
        return months === 1 ? '1 mes en el club' : `${months} meses en el club`;
      }
      return years === 1 ? '1 año de antigüedad' : `${years} años de antigüedad`;
    }
  }
  const y = Number(member?.yearsActive);
  if (!Number.isFinite(y)) return null;
  return y === 1 ? '1 año de antigüedad' : `${y} años de antigüedad`;
}

function Fact({ icon: Icon, label, value, hint }) {
  if (value == null || value === '') {
    return (
      <div className="mp-fact is-empty">
        {Icon ? <Icon size={14} className="mp-fact-icon" aria-hidden /> : null}
        <div>
          <div className="mp-fact-label">{label}</div>
          <div className="mp-fact-value muted">Sin dato</div>
        </div>
      </div>
    );
  }
  return (
    <div className="mp-fact">
      {Icon ? <Icon size={14} className="mp-fact-icon" aria-hidden /> : null}
      <div>
        <div className="mp-fact-label">{label}</div>
        <div className="mp-fact-value">{value}</div>
        {hint ? <div className="mp-fact-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href }) {
  if (!value) {
    return (
      <div className="mp-contact-row is-empty">
        <Icon size={15} aria-hidden />
        <div>
          <span className="mp-contact-label">{label}</span>
          <span className="mp-contact-value muted">No cargado</span>
        </div>
      </div>
    );
  }
  const content = href ? (
    <a href={href} className="mp-contact-value link">{value}</a>
  ) : (
    <span className="mp-contact-value">{value}</span>
  );
  return (
    <div className="mp-contact-row">
      <Icon size={15} aria-hidden />
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

function TimelineItem({ when, title, detail, tone = 'neutral' }) {
  return (
    <div className={`mp-timeline-item tone-${tone}`}>
      <div className="mp-timeline-when">{when}</div>
      <div>
        <div className="mp-timeline-title">{title}</div>
        {detail && <div className="mp-timeline-detail">{detail}</div>}
      </div>
    </div>
  );
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
  addJournalEntry = null,
  onAccountEntry = null,
  guestPasses = [],
  setGuestPasses = null,
  selfService = false,
  tierCatalog,
  disciplineCatalog = [],
}) {
  const [section, setSection] = useState('ficha');
  const [editForm, setEditForm] = useState(null);
  const [editMsg, setEditMsg] = useState('');
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectFlash, setCollectFlash] = useState('');
  const [cardMember, setCardMember] = useState(null);
  const [familyEdit, setFamilyEdit] = useState(null);
  const [familyEditMsg, setFamilyEditMsg] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const visibleSections = SECTIONS.filter((s) => !s.memberOnly || selfService);
  const canCollect = !selfService && Boolean(setMembers || updateMember);
  const disciplineOptions = useMemo(() => {
    const fromCatalog = getDisciplineOptions(disciplineCatalog);
    return fromCatalog.length ? fromCatalog : DISCIPLINE_OPTIONS;
  }, [disciplineCatalog]);

  useEffect(() => {
    if (selfService || !member || searchParams.get('cobrar') !== '1') return undefined;
    setCollectOpen(true);
    setSearchParams((prev) => {
      if (prev.get('cobrar') !== '1') return prev;
      const next = new URLSearchParams(prev);
      next.delete('cobrar');
      return next;
    }, { replace: true });
    return undefined;
  }, [member?.memberId, selfService, searchParams, setSearchParams]);

  const familyGroup = useMemo(
    () => resolveFamilyForDisplay(member, members.length ? members : [member].filter(Boolean)),
    [member, members]
  );
  const familyRows = useMemo(() => {
    const list = [...(familyGroup.members || [])];
    const selfId = memberNumberOf(member);
    const already = list.some((row) => String(row.memberId || '').replace(/\D/g, '') === selfId);
    if (member && selfId && !already) {
      list.unshift(householdMemberAsAdherent(
        member,
        isFamilyDependent(member) ? 'Grupo familiar' : 'Titular',
      ));
    }
    return list;
  }, [familyGroup.members, member]);
  const canEditFamily = !selfService && Boolean(updateMember || setMembers);
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
      },
    });
  };

  const persistNewFamilyMember = (form) => {
    const host = familyGroup.titular || member;
    const principalId = familyPrincipalOf(host) || memberNumberOf(host);
    const requested = String(form.memberId || '').replace(/\D/g, '');
    const memberId = requested || allocateNextMemberNumber(members);
    if (findMemberByNumber(members, memberId)) {
      return 'Ya existe un socio con esa credencial.';
    }
    const groupName = host?.familyGroupName || member?.familyGroupName || `Grupo ${principalId}`;
    const principalNum = Number.parseInt(principalId, 10);
    const familyPrincipalNumber = Number.isFinite(principalNum) ? principalNum : principalId;
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
      meta: collectMemberMeta({
        familyPrincipalNumber,
        familyGroupName: groupName,
      }),
    };
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
    const idHint = member.memberId.slice(0, 6);
    const nameHint = member.name;
    return (journalEntries || [])
      .filter((e) => {
        const d = e.description || '';
        return e.memberId === member.memberId
          || d.includes(nameHint)
          || d.includes(idHint)
          || d.includes(member.memberId);
      })
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

  const timeline = useMemo(() => {
    if (!member) return [];
    const items = [];
    const tierName = getTierDisplayName(member.tier, tierCatalog);

    items.push({
      when: formatShortDate(member.joinDate) || 'Alta',
      title: 'Alta de socio titular',
      detail: `Categoría ${tierName} · Credencial ${member.memberId}`,
      tone: 'ok',
      sort: member.joinDate || '1970-01-01',
    });

    movements.forEach((e) => {
      const amount = (e.lines || []).find((l) => l.type === 'debit')?.amount;
      items.push({
        when: formatShortDate(e.date),
        title: e.description,
        detail: amount != null ? formatCurrency(amount) : null,
        tone: 'neutral',
        sort: e.date,
      });
    });

    (member.paymentHistory || []).forEach((p) => {
      items.push({
        when: formatShortDate(p.date),
        title: p.concept || `Cobro · ${duesMethodLabel(p.method, p.bankName)}`,
        detail: [
          formatCurrency(p.amount),
          duesMethodLabel(p.method, p.bankName),
          p.receiptNumber || p.receipt,
          p.receiptName ? `Comp. ${p.receiptName}` : null,
        ].filter(Boolean).join(' · '),
        tone: 'ok',
        sort: p.date || '',
      });
    });

    entries.forEach((e) => {
      items.push({
        when: `${formatShortDate(e.date)} ${e.time || ''}`.trim(),
        title: e.status === 'granted' ? 'Ingreso al club autorizado' : 'Ingreso denegado',
        detail: e.notes || e.role,
        tone: e.status === 'granted' ? 'ok' : 'danger',
        sort: `${e.date}T${e.time || '00:00'}`,
      });
    });

    bookings.forEach((r) => {
      items.push({
        when: formatShortDate(r.date),
        title: `Reserva · ${r.facilityName || r.facilityId}`,
        detail: `${r.time || ''} · ${r.status}`,
        tone: r.status === 'confirmed' ? 'ok' : 'warn',
        sort: `${r.date}T${r.time || '00:00'}`,
      });
    });

    memberClaims.forEach((c) => {
      items.push({
        when: formatShortDate(c.date),
        title: `Reclamo · ${c.title}`,
        detail: c.status,
        tone: c.status === 'resolved' ? 'ok' : 'warn',
        sort: c.date,
      });
    });

    const history = member.meta?.lifecycleHistory || [];
    history.forEach((h) => {
      const titles = {
        suspend: 'Suspensión de cuenta',
        activate: 'Reactivación de cuenta',
        delete: 'Baja del padrón',
      };
      const at = h.at || '';
      items.push({
        when: at ? formatDateTimeAR(at.slice(0, 10), at.slice(11, 16)) || formatShortDate(at.slice(0, 10)) : '—',
        title: titles[h.action] || `Cambio de estado (${h.action})`,
        detail: [h.reason, h.detail, h.actorName ? `por ${h.actorName}` : null].filter(Boolean).join(' · '),
        tone: h.action === 'activate' ? 'ok' : 'danger',
        sort: at || '1970-01-01',
      });
    });

    if (member.meta?.portalProvisionedAt) {
      const at = member.meta.portalProvisionedAt;
      items.push({
        when: formatDateTimeAR(at.slice(0, 10), at.slice(11, 16)) || formatShortDate(at.slice(0, 10)),
        title: 'Acceso portal generado',
        detail: [
          member.meta.portalUsername ? `usuario ${member.meta.portalUsername}` : null,
          member.meta.portalProvisionedBy ? `por ${member.meta.portalProvisionedBy}` : null,
        ].filter(Boolean).join(' · ') || null,
        tone: 'ok',
        sort: at,
      });
    }

    return items.sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
  }, [member, movements, entries, bookings, memberClaims, formatCurrency, tierCatalog]);

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

  const handleConfirmCollect = (payload) => {
    try {
      const result = recordDuesCollection(member, payload);
      persistDuesCollection(result, {
        setMembers,
        updateMember,
        addJournalEntry,
        onAccountEntry,
      });
      setCollectOpen(false);
      setSection('movimientos');
      setCollectFlash(
        `Cobro registrado · ${duesMethodLabel(payload.method, payload.bankName)} · ${formatCurrency(result.payment.amount)}`
      );
      window.setTimeout(() => setCollectFlash(''), 5000);
    } catch (err) {
      setCollectFlash(err.message || 'No se pudo registrar el cobro.');
      window.setTimeout(() => setCollectFlash(''), 5000);
    }
  };

  const status = STATUS_COPY[member.status] || STATUS_COPY.pending;
  const balance = Number(member.outstandingBalance) || 0;
  const hasDebt = balance > 0;
  const quota = quotaHeadline(member);
  const tierName = getTierDisplayName(member.tier, tierCatalog);
  const age = ageFromBirth(member.birthDate);
  const tenure = membershipTenure(member);
  const joinLabel = member.joinDate
    ? (member.joinTime
      ? formatDateTimeAR(member.joinDate, member.joinTime)
      : formatShortDate(member.joinDate))
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
                  className={`mp-status mp-status--${memberHasSocietasApp(member) ? 'ok' : 'warn'}`}
                  title={memberHasSocietasApp(member)
                    ? 'Ya tiene acceso a la app Societas'
                    : 'Todavía no tiene acceso a la app Societas'}
                >
                  <span className="mp-status-dot" aria-hidden />
                  {memberHasSocietasApp(member) ? 'App Societas' : 'Sin app'}
                </span>
              </div>
              {tenure ? <p className="mp-tenure">{tenure}</p> : null}
            </div>
          </div>
        </div>

        <aside
          className={`mp-balance ${hasDebt ? 'has-debt' : quota.kind === 'clear' ? 'is-clear' : 'is-off'}`}
          aria-label="Estado de cuota"
        >
          <div className="mp-balance-label">{hasDebt ? 'Saldo de cuota' : 'Estado de cuota'}</div>
          <div className="mp-balance-value">
            {hasDebt ? formatCurrency(balance) : quota.title}
          </div>
          <div className="mp-balance-hint">
            {quota.hint
              || (hasDebt
                ? (member.nextDueDate
                  ? `Venció / vence ${formatShortDate(member.nextDueDate)}`
                  : 'Pendiente de cobro')
                : (member.nextDueDate
                  ? `Próximo vencimiento ${formatShortDate(member.nextDueDate)}`
                  : 'Sin vencimiento cargado'))}
          </div>
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
                  setEditForm({
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
                    notifyDues: member.notifyDues !== false,
                    notifyReservations: member.notifyReservations !== false,
                    notifyEvents: member.notifyEvents !== false,
                  });
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

      <div className="mp-panel glass-panel">
        {section === 'ficha' && (
          <div className="mp-dossier">
            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Identidad</h5>
                <p>Documento y datos personales del padrón</p>
              </header>
              <div className="mp-facts">
                <Fact icon={IdCard} label="Documento" value={formatDocument(member.documentType, member.documentNumber)} />
                <Fact
                  icon={Cake}
                  label="Nacimiento"
                  value={formatShortDate(member.birthDate)}
                  hint={age != null ? `${age} años` : null}
                />
                <Fact icon={User} label="Género" value={titleCase(member.gender)} />
                <Fact icon={Heart} label="Estado civil" value={titleCase(member.maritalStatus)} />
                <Fact icon={Flag} label="Nacionalidad" value={member.nationality || 'Argentina'} />
                <Fact icon={Clock} label="Ingreso al club" value={joinLabel} />
              </div>
            </section>

            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Contacto y domicilio</h5>
                <p>Cómo ubicar al socio</p>
              </header>
              <div className="mp-contact-grid">
                <ContactRow icon={Phone} label="WhatsApp" value={member.phone} href={phoneHref} />
                <ContactRow icon={Phone} label="Tel. alternativo" value={member.phoneAlt} />
                <ContactRow icon={Mail} label="Email" value={member.email} href={mailHref} />
                <ContactRow icon={MapPin} label="Domicilio" value={addressLine || null} />
              </div>
            </section>

            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Datos de emergencia</h5>
                <p>Grupo sanguíneo, obra social y contactos médicos</p>
              </header>
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

            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Membresía y cobranza</h5>
                <p>Categoría, cuota y datos de facturación</p>
              </header>
              <div className="mp-facts">
                <Fact icon={ShieldCheck} label="Categoría" value={tierName} hint={status.hint} />
                <Fact icon={ShieldCheck} label="Estado de cuenta" value={status.label} />
                <Fact icon={CalendarClock} label="Próximo vencimiento" value={formatShortDate(member.nextDueDate)} />
                <Fact
                  icon={Banknote}
                  label="Medio de pago"
                  value={PAYMENT_LABELS[member.paymentMethod] || titleCase(member.paymentMethod)}
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
              <section className="mp-block mp-notes">
                <header className="mp-block-head">
                  <h5>Observaciones</h5>
                </header>
                <p>{member.notes}</p>
              </section>
            ) : null}
          </div>
        )}

        {section === 'tarjeta' && (
          <div className="mp-card-wrap">
            <VirtualCard member={member} />
            <p className="mp-card-hint">
              Tocá la credencial para agrandarla o descargala en PDF.
            </p>
          </div>
        )}

        {section === 'editar' && editForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!updateMember) return;
              const sports = canonDisciplineList(editForm.disciplines || [], disciplineOptions);
              const updated = applyMemberProfileUpdate(member, {
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
              updateMember(updated);
              setEditMsg('Datos actualizados correctamente.');
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
                ['notifyDues', 'Avisos de cuota'],
                ['notifyReservations', 'Avisos de reservas'],
                ['notifyEvents', 'Avisos de eventos'],
              ].map(([key, label]) => (
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
                {familyRows.length} integrante{familyRows.length === 1 ? '' : 's'}
              </p>
              {canEditFamily ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openAddFamily}>
                  <Plus size={14} /> Agregar integrante
                </button>
              ) : null}
            </div>
            {!familyRows.length ? (
              <Empty text="Sin integrantes en el grupo familiar." />
            ) : (
              <div className="mp-family">
                {familyRows.map((adh) => {
                  const selfId = memberNumberOf(member);
                  const rowId = String(adh.memberId || '').replace(/\D/g, '');
                  const isSelf = rowId && rowId === selfId;
                  const canOpen = Boolean(onOpenMember && adh.memberId && !isSelf);
                  const source = findMemberByNumber(members, adh.memberId);
                  return (
                    <div
                      key={adh.id || adh.memberId}
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
                    <span className="mp-list-when">{formatShortDate(p.date)}</span>
                    <span className="mp-list-main">
                      {p.concept || `Cobro · ${duesMethodLabel(p.method, p.bankName)}`}
                      {p.receiptName ? (
                        <div className="mp-list-sub">Comprobante: {p.receiptName}</div>
                      ) : null}
                    </span>
                    <strong className="mp-list-amount">
                      {formatCurrency(p.amount)}
                    </strong>
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
              Línea de tiempo: alta, cobros, comprobantes, ingresos, reservas, reclamos, suspensiones, bajas y accesos portal.
            </p>
            {timeline.length === 0 ? (
              <Empty text="Sin eventos de trazabilidad." />
            ) : (
              timeline.map((item, idx) => (
                <TimelineItem key={`${item.sort}-${idx}`} when={item.when} title={item.title} detail={item.detail} tone={item.tone} />
              ))
            )}
          </div>
        )}
      </div>

      {collectOpen ? (
        <CollectDuesModal
          member={member}
          formatCurrency={formatCurrency}
          onClose={() => setCollectOpen(false)}
          onConfirm={handleConfirmCollect}
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
              if (familyEdit.isNew) {
                const error = persistNewFamilyMember({ ...form, name });
                if (error) {
                  setFamilyEditMsg(error);
                  return;
                }
                setFamilyEdit(null);
                return;
              }
              if (familyEdit.source) {
                updateMember({
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
                });
              } else {
                const host = familyGroup.titular && memberNumberOf(familyGroup.titular) === memberNumberOf(member)
                  ? member
                  : (familyGroup.titular || member);
                const nextAdherents = (host.adherents || []).map((row) => (
                  String(row.id) === String(familyEdit.adherentId) || String(row.memberId) === String(familyEdit.adherentId)
                    ? {
                      ...row,
                      name,
                      relationship: form.relationship,
                      documentNumber: form.documentNumber,
                      birthDate: form.birthDate,
                      phone: form.phone,
                      email: form.email,
                      tier: form.tier,
                      disciplines: form.disciplines || [],
                      photo: form.photo,
                    }
                    : row
                ));
                updateMember({ ...host, adherents: nextAdherents, updatedAt: new Date().toISOString() });
              }
              setFamilyEdit(null);
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
