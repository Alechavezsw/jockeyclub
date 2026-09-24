import React, { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Plus, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2, Users, UserPlus, X, CreditCard, Camera, FileDown, FileSpreadsheet, Pencil, KeyRound } from 'lucide-react';
import { duesAmountForHousehold, duesAmountForTier, nextDuesDueDate, pinDuesDueDate, quotaHeadline, toWhatsAppPhone } from '../../domain/members/dues';
import { persistDuesCollection, recordDuesCollection } from '../../domain/members/memberPayments';
import { exportMembersExcel } from '../../domain/members/exportMembersExcel';
import { exportMembersPdf } from '../../domain/members/exportMembersPdf';
import { DISCIPLINE_OPTIONS } from '../../domain/sports/disciplines';
import { getActiveTiers, getTierOptionLabel, getTierDisplayName, splitTierDisplayName, tierChipVars } from '../../domain/members/tiers';
import {
  buildLifecycleMeta,
  collectMemberMeta,
  memberHasSocietasApp,
  reasonLabel as lifecycleReasonLabel,
} from '../../domain/members/memberAdminActions';
import { attachHouseholdToMembers, assignDistinctStatColors, buildPadronHouseholdStats, familyGroupMatchesQuery, isFamilyDependent, isTitularMember, listFamilyGroups, mergeMembersById, rankMemberSearchHit, resolveFamilyForDisplay } from '../../domain/members/households';
import { portalLoginFromEmail } from '../../domain/auth/credentials';
import {
  buildAccessInvite,
  markAccessApproved,
  applyJoinApplicationToMember,
  markApplicationApproved,
  matchMemberForAccessRequest,
  portalLoginUrl,
} from '../../domain/members/selfService';
import { memberMoveKey, membershipMovesSeed, uniqueBajas } from '../../domain/members/membershipMoves';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import VirtualCard from '../VirtualCard';
import CollectDuesModal from './CollectDuesModal';
import ModalDialog from '../ModalDialog';
import FoldableSection from './FoldableSection';
import FamilyGroupsPadron from './FamilyGroupsPadron';
import MemberTiersPanel from './MemberTiersPanel';
import MembershipMovesSection from './MembershipMovesSection';
import MemberRequestsSection from './MemberRequestsSection';
import { MemberLifecycleModal, MemberCredentialsModal } from './MemberAdminModals';
import { nowTimeAR, todayISODateAR } from '../../lib/arDate';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import { useAuth } from '../../context/AuthContext';

function emptyMemberForm() {
  const joinDate = todayISODateAR();
  return {
    name: '',
    photo: '',
    documentType: 'DNI',
    documentNumber: '',
    birthDate: '',
    gender: '',
    maritalStatus: '',
    nationality: 'Argentina',
    email: '',
    phone: '+549264',
    phoneAlt: '',
    address: '',
    city: 'San Juan',
    province: 'San Juan',
    postalCode: '',
    tier: 'socio_individual',
    status: 'active',
    joinDate,
    joinTime: nowTimeAR(),
    nextDueDate: nextDuesDueDate(joinDate),
    paymentMethod: 'transferencia',
    billingName: '',
    cuitCuil: '',
    taxCondition: 'consumidor_final',
    disciplines: [],
    emergencyContact: '',
    emergencyPhone: '',
    bloodType: '',
    healthInsurance: '',
    emergencyClinic: '',
    notes: '',
    chargeFirstDues: true,
    familyGroup: [],
  };
}

const EMPTY_FAMILY_MEMBER = {
  name: '',
  photo: '',
  relationship: 'Cónyuge',
  documentNumber: '',
  birthDate: '',
  tier: 'socio_individual',
  disciplines: [],
};

/** Lee y comprime una foto a data URL (máx. ~360px) para ficha / credencial. */
function readPhotoFile(file) {
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
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function PhotoPicker({ value, onChange, label = 'Foto', size = 88 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          border: '1px solid var(--border-glass)',
          background: 'rgba(255,255,255,0.03)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? (
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Camera size={22} color="var(--text-muted)" />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="form-label" style={{ margin: 0 }}>{label}</span>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content' }}>
          <Camera size={13} /> {value ? 'Cambiar foto' : 'Subir foto'}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                onChange(await readPhotoFile(file));
              } catch {
                /* ignore invalid */
              }
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onChange('')}
            style={{ width: 'fit-content', color: '#f87171' }}
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}

const RELATIONSHIP_OPTIONS = [
  'Cónyuge', 'Hijo/a', 'Padre/Madre', 'Hermano/a', 'Nieto/a', 'Otro',
];

const MEMBERS_PAGE_SIZE = 50;
const PADRON_FIXED_CARD_COLORS = {
  activos: '#CA390C',
  familia: '#096755',
  altas: '#0b7a55',
  bajas: '#c23b3b',
};
const PADRON_RESERVED_COLORS = [
  PADRON_FIXED_CARD_COLORS.activos,
  PADRON_FIXED_CARD_COLORS.familia,
  PADRON_FIXED_CARD_COLORS.altas,
  PADRON_FIXED_CARD_COLORS.bajas,
];

function memberStatusTone(status) {
  if (status === 'inactive') return { text: '● Baja', color: '#c23b3b' };
  if (status === 'suspended') return { text: '○ Cuenta Suspendida', color: '#c9a227' };
  return { text: '● Cuenta Habilitada', color: 'var(--emerald-accent)' };
}

function memberInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function WhatsAppIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function MemberWhatsAppLink({ phone, name }) {
  const digits = toWhatsAppPhone(phone);
  if (!digits) return <span>Sin registrar</span>;
  return (
    <span className="members-padron-contact">
      <span className="members-padron-phone-n">{phone}</span>
      <a
        className="members-wa-btn"
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`WhatsApp ${name || phone}`}
        aria-label={`Abrir WhatsApp de ${name || phone}`}
        onClick={(e) => e.stopPropagation()}
      >
        <WhatsAppIcon size={13} />
      </a>
    </span>
  );
}

function TierChip({ tier, catalog, compact = false }) {
  const name = getTierDisplayName(tier, catalog);
  const { main, sub } = splitTierDisplayName(name);
  return (
    <span
      className={`tier-chip${compact ? ' is-compact' : ''}`}
      style={tierChipVars(tier, catalog)}
      title={name}
    >
      <span className="tier-chip-main">{main}</span>
      {sub ? <span className="tier-chip-sub">{sub}</span> : null}
    </span>
  );
}

function PadronStatCard({ label, value, color, active, onClick }) {
  return (
    <button
      type="button"
      className={`members-stat-card${active ? ' is-on' : ''}`}
      onClick={onClick}
      style={color ? { '--stat-accent': color } : undefined}
      aria-pressed={active}
      title={label}
    >
      <b>{Number(value || 0).toLocaleString('es-AR')}</b>
      <span>{label}</span>
    </button>
  );
}

/** Gestión de socios titulares y adherentes familiares. */
export default function MembersTab({
  members,
  setMembers,
  addJournalEntry,
  formatCurrency,
  onOpenProfile,
  disciplineOptions = DISCIPLINE_OPTIONS,
  tierCatalog = [],
  setTierCatalog,
  updateMember = null,
  onAccountEntry = null,
  membersCount = 0,
  membersLoading = false,
  membersProgress = { loaded: 0, total: 0 },
  membershipApplications = [],
  setMembershipApplications,
  portalAccessRequests = [],
  setPortalAccessRequests,
}) {
  const { user } = useAuth();
  const actorName = user?.fullName || user?.name || user?.email || '';
  const {
    SOCIETAS_MEMBERSHIP_ALTAS,
    SOCIETAS_MEMBERSHIP_BAJAS,
  } = useSnapshotSeed(['societasMembershipMoves'], membershipMovesSeed);
  const tiers = getActiveTiers(tierCatalog);
  const defaultTierId = tiers[0]?.id || 'socio_individual';
  const [tierFilter, setTierFilter] = useState('todos');
  const [quickFilter, setQuickFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteSearching, setRemoteSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(() => emptyMemberForm());
  const [formError, setFormError] = useState('');
  const [expandedMemberId, setExpandedMemberId] = useState(null);
  const [cardMember, setCardMember] = useState(null);
  const [collectMember, setCollectMember] = useState(null);
  const [lifecycleTarget, setLifecycleTarget] = useState(null); // { member, action }
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const [credsTarget, setCredsTarget] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [credsBusy, setCredsBusy] = useState(false);
  const [credsError, setCredsError] = useState('');
  const [credsResult, setCredsResult] = useState(null);
  const [credsSending, setCredsSending] = useState('');
  const [credsNotice, setCredsNotice] = useState('');
  const [actionFlash, setActionFlash] = useState('');
  const [pendingApplicationId, setPendingApplicationId] = useState(null);
  const [credsFromRequest, setCredsFromRequest] = useState(null);

  const [showAddAdherentId, setShowAddAdherentId] = useState(null);
  const [adhName, setAdhName] = useState('');
  const [adhPhoto, setAdhPhoto] = useState('');
  const [adhRelationship, setAdhRelationship] = useState('Hijo/a');
  const [adhTier, setAdhTier] = useState(defaultTierId);
  const [adhDisciplines, setAdhDisciplines] = useState([]);

  const duesPreview = useMemo(
    () => duesAmountForHousehold(form.tier, form.familyGroup),
    [form.tier, form.familyGroup]
  );
  const duesBreakdown = useMemo(() => {
    const titular = duesAmountForTier(form.tier);
    const family = form.familyGroup.map((row, i) => ({
      key: row.id || i,
      name: row.name?.trim() || `Familiar ${i + 1}`,
      amount: duesAmountForTier(row.tier || form.tier),
    }));
    return { titular, family, total: titular + family.reduce((s, f) => s + f.amount, 0) };
  }, [form.tier, form.familyGroup]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleDiscipline = (discipline) => {
    setForm((prev) => {
      const has = prev.disciplines.includes(discipline);
      return {
        ...prev,
        disciplines: has
          ? prev.disciplines.filter((d) => d !== discipline)
          : [...prev.disciplines, discipline],
      };
    });
  };

  const toggleFamilyDiscipline = (index, discipline) => {
    setForm((prev) => ({
      ...prev,
      familyGroup: prev.familyGroup.map((row, i) => {
        if (i !== index) return row;
        const current = row.disciplines || [];
        const has = current.includes(discipline);
        return {
          ...row,
          disciplines: has
            ? current.filter((d) => d !== discipline)
            : [...current, discipline],
        };
      }),
    }));
  };

  const addFamilyMember = () => {
    setForm((prev) => ({
      ...prev,
      familyGroup: [
        ...prev.familyGroup,
        {
          ...EMPTY_FAMILY_MEMBER,
          tier: prev.tier,
          disciplines: [],
          id: `tmp-${Date.now()}`,
        },
      ],
    }));
  };

  const updateFamilyMember = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      familyGroup: prev.familyGroup.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      ),
    }));
  };

  const removeFamilyMember = (index) => {
    setForm((prev) => ({
      ...prev,
      familyGroup: prev.familyGroup.filter((_, i) => i !== index),
    }));
  };

  const resetForm = () => {
    setForm(emptyMemberForm());
    setFormError('');
    setPendingApplicationId(null);
  };

  const persistApplication = async (next) => {
    if (typeof setMembershipApplications !== 'function') return;
    if (isSupabaseConfigured) {
      const saved = await repos.upsertMembershipApplication(next);
      setMembershipApplications((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      return;
    }
    setMembershipApplications((prev) => prev.map((a) => (a.id === next.id ? next : a)));
  };

  const persistAccessRequest = async (next) => {
    if (typeof setPortalAccessRequests !== 'function') return;
    if (isSupabaseConfigured) {
      const saved = await repos.upsertPortalAccessRequest(next);
      setPortalAccessRequests((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      return;
    }
    setPortalAccessRequests((prev) => prev.map((r) => (r.id === next.id ? next : r)));
  };

  const tierAccentById = useMemo(() => {
    const painted = assignDistinctStatColors(
      getActiveTiers(tierCatalog).map((t) => ({ id: t.id, color: t.color })),
      PADRON_RESERVED_COLORS,
    );
    return new Map(painted.map((t) => [String(t.id).toLowerCase(), t.color]));
  }, [tierCatalog]);
  const household = useMemo(() => {
    const stats = buildPadronHouseholdStats(members, {
      tierCatalog,
      reservedColors: PADRON_RESERVED_COLORS,
    });
    return {
      ...stats,
      byTier: stats.byTier.map((t) => ({
        ...t,
        color: tierAccentById.get(String(t.id).toLowerCase()) || t.color,
      })),
    };
  }, [members, tierCatalog, tierAccentById]);

  const moveIds = useMemo(() => ({
    altas: new Set(SOCIETAS_MEMBERSHIP_ALTAS.map((row) => memberMoveKey(row.memberId))),
    bajas: new Set(uniqueBajas(SOCIETAS_MEMBERSHIP_BAJAS).map((row) => memberMoveKey(row.memberId))),
  }), [SOCIETAS_MEMBERSHIP_ALTAS, SOCIETAS_MEMBERSHIP_BAJAS]);

  const searchDirectory = useMemo(
    () => mergeMembersById(members, remoteHits),
    [members, remoteHits],
  );

  useEffect(() => {
    const raw = searchQuery.trim();
    const digits = raw.replace(/\D/g, '');
    const enough = raw.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setRemoteSearching(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRemoteSearching(true);
      repos.searchMembersDirectory(raw, { limit: 40 })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!expandedMemberId || !isSupabaseConfigured || typeof setMembers !== 'function') return undefined;
    let cancelled = false;
    repos.getMemberByNumber(expandedMemberId, { withPayments: true })
      .then((full) => {
        if (cancelled || !full) return;
        setMembers((prev) => {
          const idx = (prev || []).findIndex((m) => String(m.memberId) === String(full.memberId));
          const current = idx >= 0 ? prev[idx] : null;
          if (current?.recordScope === 'full' && current.address) return prev;
          const hydrated = {
            ...current,
            ...full,
            adherents: (full.adherents && full.adherents.length)
              ? full.adherents
              : current?.adherents,
            recordScope: 'full',
          };
          if (idx < 0) return mergeMembersById(prev, [hydrated]);
          return prev.map((m, i) => (i === idx ? hydrated : m));
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expandedMemberId, setMembers]);

  const filteredMembers = useMemo(() => {
    const raw = searchQuery.trim();
    const q = raw.toLowerCase();
    const hits = searchDirectory.filter((m) => {
      const matchesSearch = !q
        || (m.name || '').toLowerCase().includes(q)
        || String(m.memberId || '').includes(raw)
        || (m.email || '').toLowerCase().includes(q)
        || (m.documentNumber || '').includes(raw)
        || (m.phone || '').includes(raw);
      if (!matchesSearch) return false;
      if (quickFilter === 'activos') {
        return isTitularMember(m) && (m.status || 'active') === 'active';
      }
      if (quickFilter === 'familia') {
        return isFamilyDependent(m);
      }
      if (quickFilter === 'altas') {
        return moveIds.altas.has(memberMoveKey(m.memberId));
      }
      if (quickFilter === 'bajas') {
        return moveIds.bajas.has(memberMoveKey(m.memberId)) || (m.status || '') === 'inactive';
      }
      const matchesTier = tierFilter === 'todos'
        || String(m.tier || '').toLowerCase() === String(tierFilter).toLowerCase();
      return matchesTier;
    });
    if (!q) return hits;
    return hits.toSorted((a, b) => {
      const rank = rankMemberSearchHit(a, raw) - rankMemberSearchHit(b, raw);
      if (rank !== 0) return rank;
      return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });
  }, [searchDirectory, searchQuery, tierFilter, quickFilter, moveIds]);

  const familyGroups = useMemo(() => listFamilyGroups(searchDirectory), [searchDirectory]);

  const filteredFamilies = useMemo(() => {
    const q = searchQuery.trim();
    return familyGroups.filter((group) => {
      if (q && !familyGroupMatchesQuery(group, q)) return false;
      if (quickFilter === 'activos') return (group.status || 'active') === 'active';
      if (quickFilter === 'familia') return true;
      if (quickFilter === 'altas') {
        return group.members.some((m) => moveIds.altas.has(memberMoveKey(m.memberId)));
      }
      if (quickFilter === 'bajas') {
        return group.members.some((m) => (
          moveIds.bajas.has(memberMoveKey(m.memberId)) || (m.status || '') === 'inactive'
        ));
      }
      if (tierFilter === 'todos') return true;
      const wanted = String(tierFilter).toLowerCase();
      return group.members.some((m) => String(m.tier || '').toLowerCase() === wanted);
    });
  }, [familyGroups, searchQuery, quickFilter, tierFilter, moveIds]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / MEMBERS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageMembers = useMemo(() => {
    const start = (safePage - 1) * MEMBERS_PAGE_SIZE;
    return filteredMembers.slice(start, start + MEMBERS_PAGE_SIZE);
  }, [filteredMembers, safePage]);

  useEffect(() => {
    setPage(1);
    setExpandedMemberId(null);
  }, [searchQuery, tierFilter, quickFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const loadPadronForExport = async () => {
    let list = members;
    const expected = Math.max(Number(membersCount) || 0, members.length);
    const incomplete = membersLoading || members.length === 0 || members.length < expected;
    if (isSupabaseConfigured && incomplete) {
      const fresh = await repos.listMembers();
      const withFamily = attachHouseholdToMembers(fresh || []);
      if (withFamily.length) list = withFamily;
    }
    return list;
  };

  const handleExportPadronPdf = async () => {
    if (exportingPdf || exportingExcel) return;
    setExportingPdf(true);
    try {
      await exportMembersPdf(await loadPadronForExport(), {
        formatCurrency,
        filterLabel: 'Padrón completo',
        tierCatalog,
      });
    } catch (err) {
      window.alert(err?.message || 'No se pudo generar el PDF del padrón.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportPadronExcel = async () => {
    if (exportingPdf || exportingExcel) return;
    setExportingExcel(true);
    try {
      await exportMembersExcel(await loadPadronForExport(), {
        filterLabel: 'Padrón completo',
        tierCatalog,
      });
    } catch (err) {
      window.alert(err?.message || 'No se pudo generar el Excel del padrón.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('El nombre completo es obligatorio.');
      return;
    }
    if (!form.phone.trim()) {
      setFormError('El teléfono WhatsApp es obligatorio.');
      return;
    }
    if (!form.disciplines.length) {
      setFormError('Seleccione al menos una disciplina (requisito de alta).');
      return;
    }
    if (form.documentNumber.trim() && members.some((m) => m.documentNumber === form.documentNumber.trim())) {
      setFormError('Ya existe un socio con ese documento.');
      return;
    }

    const incompleteFamily = form.familyGroup.some((f) => !f.name?.trim());
    if (incompleteFamily) {
      setFormError('Complete el nombre de todos los integrantes del grupo familiar, o elimínelos.');
      return;
    }
    const familyWithoutDiscipline = form.familyGroup.some((f) => !(f.disciplines || []).length);
    if (familyWithoutDiscipline) {
      setFormError('Cada integrante del grupo familiar debe tener al menos una disciplina.');
      return;
    }

    const randomNum = Math.floor(1000000000000000 + Math.random() * 9000000000000000);
    const firstDues = form.chargeFirstDues
      ? duesAmountForHousehold(form.tier, form.familyGroup)
      : 0;
    const joinDate = form.joinDate || todayISODateAR();
    const joinTime = form.joinTime || nowTimeAR();
    const nextDue = pinDuesDueDate(form.nextDueDate || nextDuesDueDate(joinDate));

    const adherents = form.familyGroup.map((f, idx) => ({
      id: `adh-${Date.now()}-${idx}`,
      name: f.name.trim(),
      photo: f.photo || '',
      relationship: f.relationship || 'Otro',
      documentNumber: (f.documentNumber || '').trim(),
      birthDate: f.birthDate || null,
      tier: f.tier || form.tier,
      disciplines: f.disciplines || [],
      outstandingBalance: 0,
      status: 'active',
    }));

    const newMember = {
      name: form.name.trim(),
      photo: form.photo || '',
      memberId: randomNum.toString(),
      documentType: form.documentType,
      documentNumber: form.documentNumber.trim(),
      birthDate: form.birthDate || null,
      gender: form.gender || null,
      maritalStatus: form.maritalStatus || null,
      nationality: form.nationality.trim() || 'Argentina',
      email: form.email.trim(),
      phone: form.phone.trim(),
      phoneAlt: form.phoneAlt.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      province: form.province.trim(),
      postalCode: form.postalCode.trim(),
      tier: form.tier,
      status: form.status,
      joinDate,
      joinTime,
      nextDueDate: nextDue,
      overdueSince: firstDues > 0 ? joinDate : null,
      paymentMethod: form.paymentMethod,
      billingName: form.billingName.trim() || form.name.trim(),
      cuitCuil: form.cuitCuil.trim(),
      taxCondition: form.taxCondition,
      disciplines: form.disciplines,
      emergencyContact: form.emergencyContact.trim(),
      emergencyPhone: form.emergencyPhone.trim(),
      bloodType: form.bloodType.trim(),
      healthInsurance: form.healthInsurance.trim(),
      emergencyClinic: form.emergencyClinic.trim(),
      notes: form.notes.trim(),
      outstandingBalance: firstDues,
      yearsActive: 1,
      adherents,
      meta: collectMemberMeta({
        bloodType: form.bloodType.trim(),
        healthInsurance: form.healthInsurance.trim(),
        emergencyClinic: form.emergencyClinic.trim(),
        joinTime,
      }),
    };

    setMembers([newMember, ...members]);
    if (pendingApplicationId) {
      const app = membershipApplications.find((a) => a.id === pendingApplicationId);
      if (app) {
        try {
          await deliverAccessFromRequest('alta', {
            ...app,
            fullName: newMember.name,
            email: newMember.email || app.email,
            phone: newMember.phone || app.phone,
            documentNumber: newMember.documentNumber || app.documentNumber,
          }, newMember);
        } catch {
          void persistApplication(markApplicationApproved(app, newMember));
        }
      }
    }
    resetForm();
    setShowAddForm(false);
  };

  const prefillFromApplication = (app) => {
    setForm({
      ...emptyMemberForm(),
      name: app.fullName || '',
      email: app.email || '',
      phone: app.phone || '+549264',
      documentType: app.documentType || 'DNI',
      documentNumber: app.documentNumber || '',
      birthDate: app.birthDate || '',
      address: app.address || '',
      city: app.city || 'San Juan',
      province: app.province || 'San Juan',
      tier: app.requestedTier || defaultTierId,
      notes: app.notes || '',
    });
    setPendingApplicationId(app.id);
    setFormError('');
    setShowAddForm(true);
  };

  const handleConfirmCollect = (payload) => {
    const member = collectMember;
    if (!member) return;
    try {
      persistDuesCollection(recordDuesCollection(member, payload), {
        setMembers,
        updateMember,
        addJournalEntry,
        onAccountEntry,
      });
      setCollectMember(null);
    } catch {
      /* el modal ya valida comprobante / importe */
    }
  };

  const persistMember = async (next) => {
    if (typeof updateMember === 'function') {
      await updateMember(next);
      return;
    }
    setMembers((prev) => prev.map((x) => (x.memberId === next.memberId ? next : x)));
  };

  const openLifecycle = (member, action) => {
    setLifecycleError('');
    setLifecycleTarget({ member, action });
  };

  const handleLifecycleConfirm = async (payload) => {
    if (payload?.error) {
      setLifecycleError(payload.error);
      return;
    }
    if (!lifecycleTarget?.member) return;
    const { member, action } = lifecycleTarget;
    setLifecycleBusy(true);
    setLifecycleError('');
    try {
      const nextStatus = action === 'activate' ? 'active' : action === 'suspend' ? 'suspended' : 'inactive';
      const nextMeta = buildLifecycleMeta(collectMemberMeta(member), {
        action,
        reasonId: payload.reasonId,
        reasonLabel: payload.reasonLabel || lifecycleReasonLabel(action, payload.reasonId),
        detail: payload.detail,
        actorName,
      });
      const next = {
        ...member,
        status: nextStatus,
        meta: nextMeta,
        bajaMotivo: nextMeta.bajaMotivo,
        bajaFecha: nextMeta.bajaFecha,
        bajaDetail: nextMeta.bajaDetail,
      };

      if (isSupabaseConfigured) {
        const saved = await repos.setMemberLifecycle(next, {
          status: nextStatus,
          action,
          reasonId: payload.reasonId,
          reasonLabel: payload.reasonLabel || lifecycleReasonLabel(action, payload.reasonId),
          detail: payload.detail,
          actorName,
        });
        await persistMember(saved || next);
      } else {
        await persistMember(next);
      }

      setActionFlash(
        action === 'delete'
          ? `Baja registrada: ${member.name}`
          : action === 'suspend'
            ? `Suspensión registrada: ${member.name}`
            : `Reactivación registrada: ${member.name}`,
      );
      setTimeout(() => setActionFlash(''), 3200);
      setLifecycleTarget(null);
    } catch (err) {
      setLifecycleError(err?.message || 'No se pudo guardar el cambio de estado.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  const openCredentials = (member) => {
    setCredsError('');
    setCredsNotice('');
    setCredsSending('');
    setCredsResult(null);
    setCredsTarget(member);
  };

  const savePortalAccess = async (creds) => {
    if (!credsTarget) throw new Error('No hay socio seleccionado.');
    const email = String(creds.email || credsTarget.email || '').trim().toLowerCase();
    const username = email;
    const password = String(creds.password || '');
    if (!email.includes('@') || password.length < 6) {
      throw new Error('El email del socio y una contraseña (mín. 6) son obligatorios.');
    }
    const ready = { username, password, email };

    if (credsResult?.creds?.email === email && credsResult?.creds?.password === password) {
      return credsResult.creds;
    }

    let profileId = credsTarget.profileId || null;
    if (isSupabaseConfigured) {
      const byEmail = await repos.portalProfileIdForLogin(email, credsTarget.id);
      if (byEmail) profileId = byEmail;
    }

    if (isSupabaseConfigured && profileId) {
      await repos.resetPortalUserPassword(profileId, password, email);
      const saved = await repos.linkMemberPortalAccess(
        credsTarget,
        profileId,
        ready,
        actorName,
      );
      putMemberInList(saved);
    } else if (isSupabaseConfigured) {
      const { member: saved, creds: out } = await repos.provisionMemberPortalAccess(
        credsTarget,
        ready,
        { actorName },
      );
      putMemberInList(saved);
      ready.username = out?.username || username;
      ready.email = out?.email || email;
      ready.password = out?.password || password;
    } else {
      const next = {
        ...credsTarget,
        email: credsTarget.email || email,
        meta: {
          ...collectMemberMeta(credsTarget),
          portalUsername: username,
          portalProvisionedAt: new Date().toISOString(),
          portalProvisionedBy: actorName || null,
        },
      };
      await persistMember(next);
    }
    if (credsFromRequest) {
      await persistAccessRequest(markAccessApproved(credsFromRequest, credsTarget));
      setCredsFromRequest(null);
    }
    setCredsResult({ creds: ready });
    setActionFlash(`Acceso generado para ${credsTarget.name}`);
    setTimeout(() => setActionFlash(''), 3200);
    return ready;
  };

  const handleCredentialsGenerate = async (creds) => {
    setCredsBusy(true);
    setCredsSending('');
    setCredsError('');
    setCredsNotice('');
    try {
      await savePortalAccess(creds);
    } catch (err) {
      setCredsError(err?.message || 'No se pudo crear el acceso.');
    } finally {
      setCredsBusy(false);
    }
  };

  const handleSendCredentialsEmail = async (creds) => {
    setCredsBusy(true);
    setCredsSending('email');
    setCredsError('');
    setCredsNotice('');
    try {
      const ready = await savePortalAccess(creds);
      if (!isSupabaseConfigured) {
        throw new Error('El mail sale por Resend cuando el portal está conectado.');
      }
      await repos.sendAccessInviteEmail({
        to: ready.email,
        name: credsTarget?.name,
        username: ready.username,
        loginEmail: ready.email,
        password: ready.password,
        portalUrl: portalLoginUrl(),
        logoUrl: typeof window !== 'undefined' && window.location.protocol === 'https:'
          ? `${window.location.origin}/logo-jockey-club.png`
          : '',
      });
      setCredsNotice(`Mail enviado por Resend a ${ready.email}.`);
    } catch (err) {
      setCredsError(err?.message || 'No se pudo enviar el mail.');
    } finally {
      setCredsBusy(false);
      setCredsSending('');
    }
  };

  const handleSendCredentialsWhatsApp = async (creds) => {
    const popup = window.open('', '_blank');
    setCredsBusy(true);
    setCredsSending('whatsapp');
    setCredsError('');
    setCredsNotice('');
    try {
      const ready = await savePortalAccess(creds);
      const invite = buildAccessInvite({
        name: credsTarget?.name,
        phone: credsTarget?.phone,
        contactEmail: ready.email,
        creds: ready,
        portalUrl: portalLoginUrl(),
      });
      if (!invite.whatsappUrl) {
        popup?.close();
        throw new Error('La ficha no tiene un celular válido para WhatsApp.');
      }
      if (popup) popup.location.href = invite.whatsappUrl;
      else window.open(invite.whatsappUrl, '_blank', 'noopener,noreferrer');
      setCredsNotice('WhatsApp abierto con las credenciales.');
    } catch (err) {
      popup?.close();
      setCredsError(err?.message || 'No se pudo abrir WhatsApp.');
    } finally {
      setCredsBusy(false);
      setCredsSending('');
    }
  };

  const putMemberInList = (next) => {
    setMembers((prev) => {
      const same = (x) => x.memberId === next.memberId || (next.id && x.id === next.id);
      if (prev.some(same)) return prev.map((x) => (same(x) ? { ...x, ...next } : x));
      return [next, ...prev];
    });
  };

  const deliverAccessFromRequest = async (kind, item, existingMember = null, onReady) => {
    const matched = existingMember || matchMemberForAccessRequest(members, {
      memberNumber: item.memberNumber,
      documentNumber: item.documentNumber,
    });
    let member = kind === 'alta'
      ? applyJoinApplicationToMember(item, matched)
      : matched;
    if (!member) {
      throw new Error('No hay ficha para vincular. Revisá DNI o Nº de socio.');
    }

    const creds = portalLoginFromEmail(item.email || member.email);
    if (!creds) {
      throw new Error('Falta el email del socio para crear el acceso.');
    }

    let profileId = member.profileId || null;
    if (isSupabaseConfigured) {
      const byEmail = await repos.portalProfileIdForLogin(creds.email, member.id);
      if (byEmail) profileId = byEmail;
    }

    if (profileId && isSupabaseConfigured) {
      await repos.resetPortalUserPassword(profileId, creds.password, creds.email);
      member = await repos.linkMemberPortalAccess(member, profileId, creds, actorName);
      putMemberInList(member);
    } else if (isSupabaseConfigured) {
      const { member: saved } = await repos.provisionMemberPortalAccess(member, creds, { actorName });
      member = saved;
      putMemberInList(member);
    } else {
      member = {
        ...member,
        meta: {
          ...collectMemberMeta(member),
          portalUsername: creds.username,
          portalProvisionedAt: new Date().toISOString(),
          portalProvisionedBy: actorName || null,
        },
      };
      putMemberInList(member);
    }

    if (kind === 'alta') {
      await persistApplication(markApplicationApproved(item, member));
    } else {
      await persistAccessRequest(markAccessApproved(item, member));
    }

    const invite = buildAccessInvite({
      name: member.name || item.fullName,
      phone: item.phone || member.phone,
      contactEmail: item.email || member.email,
      creds,
      portalUrl: portalLoginUrl(),
    });
    if (typeof onReady === 'function') onReady(invite);
    const to = invite.contactEmail;
    if (to && isSupabaseConfigured) {
      try {
        await repos.sendAccessInviteEmail({
          to,
          name: member.name || item.fullName,
          username: creds.username,
          loginEmail: creds.email,
          password: creds.password,
          portalUrl: invite.portalUrl,
          logoUrl: typeof window !== 'undefined' && window.location.protocol === 'https:'
            ? `${window.location.origin}/logo-jockey-club.png`
            : '',
        });
        invite.emailSent = true;
        invite.emailTo = to;
      } catch (err) {
        invite.emailSent = false;
        invite.emailError = err?.message || 'No se pudo enviar el mail.';
      }
    } else if (!to) {
      invite.emailSent = false;
      invite.emailError = 'Falta el email de contacto para enviar el acceso.';
    }
    return invite;
  };

  const handleAddAdherent = (memberId) => {
    if (!adhName.trim()) return;
    if (!adhDisciplines.length) return;
    const newAdherent = {
      id: `adh-${Date.now()}`,
      name: adhName.trim(),
      photo: adhPhoto || '',
      relationship: adhRelationship,
      tier: adhTier,
      disciplines: adhDisciplines,
      outstandingBalance: 0,
      status: 'active'
    };

    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: [...(m.adherents || []), newAdherent]
        };
      }
      return m;
    }));

    setAdhName('');
    setAdhPhoto('');
    setAdhDisciplines([]);
    setShowAddAdherentId(null);
  };

  const handleToggleAdherentStatus = (memberId, adherentId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: m.adherents.map(adh => {
            if (adh.id === adherentId) {
              return { ...adh, status: adh.status === 'active' ? 'suspended' : 'active' };
            }
            return adh;
          })
        };
      }
      return m;
    }));
  };

  const handleDeleteAdherent = (memberId, adherentId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: m.adherents.filter(adh => adh.id !== adherentId)
        };
      }
      return m;
    }));
  };

  const isSearching = Boolean(searchQuery.trim());

  return (
    <div className={`glass-card fade-in members-tab${isSearching ? ' is-searching' : ''}`}>
      {actionFlash ? (
        <p className="member-action-flash" role="status">{actionFlash}</p>
      ) : null}
      <div className="members-search-hero">
        <label className="members-search-label" htmlFor="members-search-input">
          Buscar en el padrón
        </label>
        <div className="members-search-field">
          <Search size={20} aria-hidden="true" className="members-search-icon" />
          <input
            id="members-search-input"
            type="search"
            placeholder="Nombre, Nº de socio, DNI, email o teléfono…"
            className="members-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
          />
          {searchQuery ? (
            <button
              type="button"
              className="members-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Limpiar búsqueda"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        {searchQuery.trim() ? (
          <p className="members-search-hint">
            {remoteSearching ? 'Buscando en el padrón… · ' : ''}
            {filteredMembers.length.toLocaleString('es-AR')} socio{filteredMembers.length === 1 ? '' : 's'}
            {filteredFamilies.length > 0
              ? ` · ${filteredFamilies.length.toLocaleString('es-AR')} familia${filteredFamilies.length === 1 ? '' : 's'}`
              : ''}
          </p>
        ) : (
          <p className="members-search-hint">
            {membersLoading && membersProgress?.total
              ? `Cargando padrón… ${membersProgress.loaded.toLocaleString('es-AR')} de ${membersProgress.total.toLocaleString('es-AR')}. Podés buscar igual.`
              : 'Escribí un nombre, DNI o Nº de socio. Primero aparecen los socios.'}
          </p>
        )}
      </div>

      <div className="members-stat-cards" aria-label="Resumen del padrón">
        <PadronStatCard
          label="Socios activos"
          value={household.titularesActivos}
          color={PADRON_FIXED_CARD_COLORS.activos}
          active={quickFilter === 'activos'}
          onClick={() => {
            setQuickFilter((cur) => (cur === 'activos' ? null : 'activos'));
            setTierFilter('todos');
          }}
        />
        <PadronStatCard
          label="Grupo familiar"
          value={household.integrantes}
          color={PADRON_FIXED_CARD_COLORS.familia}
          active={quickFilter === 'familia'}
          onClick={() => {
            setQuickFilter((cur) => (cur === 'familia' ? null : 'familia'));
            setTierFilter('todos');
          }}
        />
        <PadronStatCard
          label="Altas"
          value={SOCIETAS_MEMBERSHIP_ALTAS.length}
          color={PADRON_FIXED_CARD_COLORS.altas}
          active={quickFilter === 'altas'}
          onClick={() => {
            setQuickFilter((cur) => (cur === 'altas' ? null : 'altas'));
            setTierFilter('todos');
          }}
        />
        <PadronStatCard
          label="Bajas"
          value={uniqueBajas(SOCIETAS_MEMBERSHIP_BAJAS).length}
          color={PADRON_FIXED_CARD_COLORS.bajas}
          active={quickFilter === 'bajas'}
          onClick={() => {
            setQuickFilter((cur) => (cur === 'bajas' ? null : 'bajas'));
            setTierFilter('todos');
          }}
        />
        {household.byTier.map((tier) => (
          <PadronStatCard
            key={tier.id}
            label={tier.name}
            value={tier.count}
            color={tier.color}
            active={!quickFilter && String(tierFilter).toLowerCase() === String(tier.id).toLowerCase()}
            onClick={() => {
              const id = String(tier.id);
              setQuickFilter(null);
              setTierFilter((cur) => (String(cur).toLowerCase() === id.toLowerCase() ? 'todos' : id));
            }}
          />
        ))}
      </div>

      <MemberRequestsSection
        members={members}
        membershipApplications={membershipApplications}
        setMembershipApplications={setMembershipApplications}
        portalAccessRequests={portalAccessRequests}
        setPortalAccessRequests={setPortalAccessRequests}
        onOpenAccessCredentials={(member, request) => {
          setCredsFromRequest(request);
          openCredentials(member);
        }}
        onPrefillAlta={prefillFromApplication}
        onDeliverAccess={deliverAccessFromRequest}
      />

      <MembershipMovesSection />

      <div className="admin-filters members-toolbar">
        <div className="members-toolbar-filter">
          <Filter size={16} aria-hidden="true" />
          <select
            className="form-input"
            value={tierFilter}
            onChange={(e) => {
              setQuickFilter(null);
              setTierFilter(e.target.value);
            }}
            aria-label="Filtrar por categoría"
          >
            <option value="todos">Todas las categorías</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>{tier.name}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => { void handleExportPadronPdf(); }}
          className="btn btn-secondary"
          disabled={exportingPdf || exportingExcel}
          title="Exportar padrón completo del sistema a PDF"
        >
          <FileDown size={16} /> {exportingPdf ? 'Generando…' : 'Exportar PDF'}
        </button>

        <button
          type="button"
          onClick={() => { void handleExportPadronExcel(); }}
          className="btn btn-secondary"
          disabled={exportingPdf || exportingExcel}
          title="Exportar padrón completo del sistema a Excel"
        >
          <FileSpreadsheet size={16} /> {exportingExcel ? 'Generando…' : 'Exportar Excel'}
        </button>

        <button
          type="button"
          onClick={() => {
            if (showAddForm) {
              setShowAddForm(false);
              return;
            }
            resetForm();
            setShowAddForm(true);
          }}
          className="btn btn-emerald"
        >
          <Plus size={16} /> Registrar Socio
        </button>
      </div>

      <MemberTiersPanel
        catalog={tierCatalog}
        setCatalog={setTierCatalog}
        setMembers={setMembers}
        members={members}
        formatCurrency={formatCurrency}
        tierAccentById={tierAccentById}
      />

      {/* Formulario Alta de Socio — ficha completa */}
      {showAddForm && (
        <form
          onSubmit={handleAddMember}
          className="glass-panel fade-in"
          style={{
            padding: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.35rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h4 className="serif-font" style={{ fontSize: '1.25rem', margin: 0, color: 'var(--text-gold)' }}>
                Alta de socio titular
              </h4>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Complete la ficha institucional y, si corresponde, el grupo familiar. Los campos con * son obligatorios.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { resetForm(); setShowAddForm(false); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <X size={14} /> Cerrar
            </button>
          </div>

          {/* 1. Datos personales */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              1. Datos personales
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div style={{ gridColumn: '1 / -1', marginBottom: '0.25rem' }}>
                <PhotoPicker
                  value={form.photo}
                  onChange={(photo) => updateForm('photo', photo)}
                  label="Foto del titular (credencial)"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Nombre completo *</label>
                <input className="form-input" required value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="Apellido y nombres" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tipo documento</label>
                <select className="form-input" value={form.documentType} onChange={(e) => updateForm('documentType', e.target.value)}>
                  <option value="DNI">DNI</option>
                  <option value="Pasaporte">Pasaporte</option>
                  <option value="CUIT">CUIT</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">N° documento</label>
                <input className="form-input" value={form.documentNumber} onChange={(e) => updateForm('documentNumber', e.target.value)} placeholder="Sin puntos" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Fecha de nacimiento</label>
                <input type="date" className="form-input" value={form.birthDate} onChange={(e) => updateForm('birthDate', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Género</label>
                <select className="form-input" value={form.gender} onChange={(e) => updateForm('gender', e.target.value)}>
                  <option value="">—</option>
                  <option value="femenino">Femenino</option>
                  <option value="masculino">Masculino</option>
                  <option value="otro">Otro / Prefiere no decir</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estado civil</label>
                <select className="form-input" value={form.maritalStatus} onChange={(e) => updateForm('maritalStatus', e.target.value)}>
                  <option value="">—</option>
                  <option value="soltero">Soltero/a</option>
                  <option value="casado">Casado/a</option>
                  <option value="union">Unión convivencial</option>
                  <option value="divorciado">Divorciado/a</option>
                  <option value="viudo">Viudo/a</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nacionalidad</label>
                <input className="form-input" value={form.nationality} onChange={(e) => updateForm('nationality', e.target.value)} />
              </div>
            </div>
          </section>

          {/* 2. Contacto */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              2. Contacto y domicilio
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Email</label>
                <input type="email" className="form-input" value={form.email} onChange={(e) => updateForm('email', e.target.value)} placeholder="correo@ejemplo.com" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Celular WhatsApp *</label>
                <input className="form-input" required value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="+549264..." />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Teléfono alternativo</label>
                <input className="form-input" value={form.phoneAlt} onChange={(e) => updateForm('phoneAlt', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Domicilio</label>
                <input className="form-input" value={form.address} onChange={(e) => updateForm('address', e.target.value)} placeholder="Calle, número, barrio" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Localidad</label>
                <input className="form-input" value={form.city} onChange={(e) => updateForm('city', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Provincia</label>
                <input className="form-input" value={form.province} onChange={(e) => updateForm('province', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Código postal</label>
                <input className="form-input" value={form.postalCode} onChange={(e) => updateForm('postalCode', e.target.value)} />
              </div>
            </div>
          </section>

          {/* 3. Datos de emergencia */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              3. Datos de emergencia
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Grupo sanguíneo</label>
                <select className="form-input" value={form.bloodType} onChange={(e) => updateForm('bloodType', e.target.value)}>
                  <option value="">Indique el grupo sanguíneo</option>
                  <option value="A+">A+</option>
                  <option value="A-">A−</option>
                  <option value="B+">B+</option>
                  <option value="B-">B−</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB−</option>
                  <option value="O+">O+</option>
                  <option value="O-">O−</option>
                  <option value="Desconocido">Desconocido</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Obra social</label>
                <input
                  className="form-input"
                  value={form.healthInsurance}
                  onChange={(e) => updateForm('healthInsurance', e.target.value)}
                  placeholder="Indique la obra social"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Contacto de emergencia</label>
                <input
                  className="form-input"
                  value={form.emergencyContact}
                  onChange={(e) => updateForm('emergencyContact', e.target.value)}
                  placeholder="Nombre del contacto"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Número de emergencia</label>
                <input
                  className="form-input"
                  value={form.emergencyPhone}
                  onChange={(e) => updateForm('emergencyPhone', e.target.value)}
                  placeholder="Indique el número de emergencia"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Clínica de emergencia</label>
                <input
                  className="form-input"
                  value={form.emergencyClinic}
                  onChange={(e) => updateForm('emergencyClinic', e.target.value)}
                  placeholder="Indique la clínica de emergencia"
                />
              </div>
            </div>
          </section>

          {/* 4. Membresía */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              4. Membresía y disciplinas
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Categoría club *</label>
                <select className="form-input" value={form.tier} onChange={(e) => updateForm('tier', e.target.value)}>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>{getTierOptionLabel(t)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estado</label>
                <select className="form-input" value={form.status} onChange={(e) => updateForm('status', e.target.value)}>
                  <option value="active">Activo</option>
                  <option value="pending">Pendiente de aprobación</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Fecha de ingreso</label>
                <input
                  type="date"
                  className="form-input"
                  lang="es-AR"
                  value={form.joinDate}
                  onChange={(e) => {
                    const joinDate = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      joinDate,
                      nextDueDate: nextDuesDueDate(joinDate || todayISODateAR()),
                    }));
                  }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Hora (Argentina)</label>
                <input
                  type="time"
                  className="form-input"
                  lang="es-AR"
                  value={form.joinTime || ''}
                  onChange={(e) => updateForm('joinTime', e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Próximo vencimiento de cuota</label>
                <input
                  type="date"
                  className="form-input"
                  lang="es-AR"
                  value={form.nextDueDate}
                  onChange={(e) => updateForm('nextDueDate', pinDuesDueDate(e.target.value))}
                />
                <p className="form-hint">Todas las cuotas vencen el día 10 de cada mes.</p>
              </div>
            </div>
            <div style={{ marginTop: '0.85rem' }}>
              <label className="form-label">Disciplinas *</label>
              <p style={{ margin: '0.2rem 0 0.45rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Requisito de alta: indique al menos una disciplina en la que participará el titular.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginTop: 4 }}>
                {disciplineOptions.map((d) => {
                  const active = form.disciplines.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDiscipline(d)}
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: 20,
                        border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                        background: active ? 'rgba(var(--primary-gold-rgb),0.15)' : 'var(--bg-tertiary)',
                        color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 4. Facturación */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              5. Facturación y cobranza
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Razón social / facturación</label>
                <input className="form-input" value={form.billingName} onChange={(e) => updateForm('billingName', e.target.value)} placeholder="Si difiere del titular" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">CUIT / CUIL</label>
                <input className="form-input" value={form.cuitCuil} onChange={(e) => updateForm('cuitCuil', e.target.value)} placeholder="XX-XXXXXXXX-X" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Condición IVA</label>
                <select className="form-input" value={form.taxCondition} onChange={(e) => updateForm('taxCondition', e.target.value)}>
                  <option value="consumidor_final">Consumidor final</option>
                  <option value="monotributo">Monotributo</option>
                  <option value="ri">Responsable inscripto</option>
                  <option value="exento">Exento</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Medio de pago habitual</label>
                <select className="form-input" value={form.paymentMethod} onChange={(e) => updateForm('paymentMethod', e.target.value)}>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo en sede</option>
                  <option value="debito">Débito automático</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: '0.9rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.chargeFirstDues}
                  onChange={(e) => updateForm('chargeFirstDues', e.target.checked)}
                />
                Generar primera cuota al alta
                <strong style={{ color: 'var(--text-gold)' }}>({formatCurrency(duesPreview)})</strong>
              </label>
              {form.chargeFirstDues && (
                <div style={{
                  marginTop: '0.65rem',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 10,
                  border: '1px solid var(--border-glass)',
                  background: 'rgba(255,255,255,0.02)',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                    <span>Titular ({form.tier})</span>
                    <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(duesBreakdown.titular)}</span>
                  </div>
                  {duesBreakdown.family.map((f) => (
                    <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <span>+ {f.name}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(f.amount)}</span>
                    </div>
                  ))}
                  {form.familyGroup.length > 0 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: '1px solid var(--border-glass)',
                      fontWeight: 700,
                      color: 'var(--text-gold)',
                    }}>
                      <span>Total grupo familiar</span>
                      <span>{formatCurrency(duesBreakdown.total)}</span>
                    </div>
                  )}
                  {form.familyGroup.length === 0 && (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Al sumar integrantes del grupo familiar, la cuota se actualiza sola.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 5. Grupo familiar */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <div>
                <h5 style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                  6. Grupo familiar
                </h5>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Adherentes del titular (cónyuge, hijos, etc.). Opcional; también se pueden sumar después.
                  {form.chargeFirstDues && (
                    <> Cada integrante suma a la cuota: <strong style={{ color: 'var(--text-gold)' }}>{formatCurrency(duesPreview)}</strong></>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addFamilyMember}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Users size={14} /> Sumar integrante
              </button>
            </div>

            {form.familyGroup.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Sin integrantes. Use “Sumar integrante” para cargar el grupo familiar.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {form.familyGroup.map((row, index) => (
                  <div
                    key={row.id || index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '0.65rem',
                      padding: '0.85rem',
                      border: '1px solid var(--border-glass)',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ gridColumn: '1 / -1' }}>
                      <PhotoPicker
                        value={row.photo}
                        onChange={(photo) => updateFamilyMember(index, 'photo', photo)}
                        label="Foto del adherente"
                        size={72}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                      <label className="form-label">Nombre completo *</label>
                      <input
                        className="form-input"
                        value={row.name}
                        onChange={(e) => updateFamilyMember(index, 'name', e.target.value)}
                        placeholder="Apellido y nombres"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Vínculo</label>
                      <select
                        className="form-input"
                        value={row.relationship}
                        onChange={(e) => updateFamilyMember(index, 'relationship', e.target.value)}
                      >
                        {RELATIONSHIP_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">DNI</label>
                      <input
                        className="form-input"
                        value={row.documentNumber}
                        onChange={(e) => updateFamilyMember(index, 'documentNumber', e.target.value)}
                        placeholder="Sin puntos"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Nacimiento</label>
                      <input
                        type="date"
                        className="form-input"
                        value={row.birthDate}
                        onChange={(e) => updateFamilyMember(index, 'birthDate', e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Categoría</label>
                      <select
                        className="form-input"
                        value={row.tier}
                        onChange={(e) => updateFamilyMember(index, 'tier', e.target.value)}
                      >
                        {tiers.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                      <label className="form-label">Disciplinas *</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: 4 }}>
                        {disciplineOptions.map((d) => {
                          const active = (row.disciplines || []).includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleFamilyDiscipline(index, d)}
                              style={{
                                padding: '0.3rem 0.65rem',
                                borderRadius: 20,
                                border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                                background: active ? 'rgba(var(--primary-gold-rgb),0.15)' : 'var(--bg-tertiary)',
                                color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => removeFamilyMember(index)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#f87171' }}
                        aria-label="Quitar integrante"
                      >
                        <Trash2 size={14} /> Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. Notas */}
          <section>
            <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
              7. Observaciones
            </h5>
            <textarea
              className="form-input"
              rows={3}
              value={form.notes}
              onChange={(e) => updateForm('notes', e.target.value)}
              placeholder="Notas internas de secretaría, condiciones especiales, etc."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </section>

          {formError && (
            <p style={{ color: '#ef4444', margin: 0, fontSize: '0.88rem' }}>{formError}</p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setShowAddForm(false); }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-tan" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 180, justifyContent: 'center' }}>
              <UserPlus size={16} />
              {form.familyGroup.length > 0
                ? `Registrar socio + ${form.familyGroup.length} familiar${form.familyGroup.length > 1 ? 'es' : ''}`
                : 'Registrar socio'}
            </button>
          </div>
        </form>
      )}

      {/* Tabla de Socios */}
      <FoldableSection
        as="div"
        className="members-padron-results"
        id="members-padron-title"
        title="Padrón"
        subtitle={
          filteredMembers.length === 0
            ? 'Sin resultados'
            : `${((safePage - 1) * MEMBERS_PAGE_SIZE) + 1}–${Math.min(safePage * MEMBERS_PAGE_SIZE, filteredMembers.length)} de ${filteredMembers.length.toLocaleString('es-AR')}`
        }
        defaultOpen
        storageKey="padron"
        forceOpen={isSearching}
      >
      <div className="members-pager" aria-live="polite">
        <span>
          {filteredMembers.length === 0
            ? 'Sin resultados'
            : `${((safePage - 1) * MEMBERS_PAGE_SIZE) + 1}–${Math.min(safePage * MEMBERS_PAGE_SIZE, filteredMembers.length)} de ${filteredMembers.length.toLocaleString('es-AR')}`}
        </span>
        <div className="members-pager-controls">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Hoja anterior"
          >
            <ChevronLeft size={16} /> Anterior
          </button>
          <span className="members-pager-page">
            Hoja {safePage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Hoja siguiente"
          >
            Siguiente <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="table-responsive members-padron-wrap">
        <table className="admin-table members-padron-table">
          <thead>
            <tr>
              <th>Socio Titular</th>
              <th>Credencial ID</th>
              <th>Categoría</th>
              <th>Contacto</th>
              <th>Cuota / Saldo</th>
              <th className="members-padron-actions-h">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageMembers.map(m => (
              <React.Fragment key={m.memberId}>
                <tr className="members-padron-row">
                  <td data-label="Socio">
                    <div className="member-profile-cell">
                      <button
                        className="member-expand-btn"
                        onClick={() => {
                          const nextId = expandedMemberId === m.memberId ? null : m.memberId;
                          setExpandedMemberId(nextId);
                          if (
                            nextId
                            && isSupabaseConfigured
                            && m.id
                            && (!m.adherents || m.adherents.length === 0)
                            && setMembers
                          ) {
                            const fromPadron = resolveFamilyForDisplay(m, members).members
                              .filter((a) => a.fromPadron);
                            if (fromPadron.length) {
                              setMembers((prev) => prev.map((item) => (
                                item.memberId === m.memberId
                                  ? { ...item, adherents: fromPadron }
                                  : item
                              )));
                            } else {
                              repos.listMemberAdherents(m.id).then((adherents) => {
                                if (!adherents?.length) return;
                                setMembers((prev) => prev.map((item) => (
                                  item.memberId === m.memberId
                                    ? { ...item, adherents }
                                    : item
                                )));
                              }).catch(() => {});
                            }
                          }
                        }}
                        title="Grupo familiar"
                        type="button"
                      >
                        {expandedMemberId === m.memberId ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <button
                        type="button"
                        className="member-identity-btn"
                        onClick={() => onOpenProfile?.(m.memberId)}
                        title="Ver perfil del socio"
                      >
                        <div className="member-avatar" aria-hidden="true">
                          {m.photo ? (
                            <img src={m.photo} alt="" />
                          ) : (
                            <span>{memberInitials(m.name)}</span>
                          )}
                        </div>
                        <div className="member-identity-copy">
                          <strong>{m.name}</strong>
                          <span className="member-identity-meta" style={{ color: memberStatusTone(m.status).color }}>
                            {memberStatusTone(m.status).text}
                            <span>
                              · {memberHasSocietasApp(m) ? 'App Societas' : 'Sin app'} · Ver perfil
                            </span>
                          </span>
                        </div>
                      </button>
                    </div>
                  </td>
                  <td data-label="Credencial" className="members-padron-id">
                    {m.memberId.replace(/(\d{4})/g, '$1 ').trim()}
                  </td>
                  <td data-label="Categoría">
                    <TierChip tier={m.tier} catalog={tierCatalog} />
                  </td>
                  <td data-label="Contacto" className="members-padron-phone">
                    <MemberWhatsAppLink phone={m.phone} name={m.name} />
                  </td>
                  <td data-label="Cuota">
                    <span style={{
                      fontWeight: '600',
                      color: (Number(m.outstandingBalance) || 0) > 0
                        ? 'var(--warning-accent)'
                        : quotaHeadline(m).kind === 'clear'
                          ? 'var(--emerald-accent)'
                          : 'var(--text-secondary)'
                     }}>
                      {(Number(m.outstandingBalance) || 0) > 0
                        ? formatCurrency(m.outstandingBalance)
                        : quotaHeadline(m).title}
                    </span>
                  </td>
                  <td data-label="Acciones" className="members-padron-actions">
                    <div className="member-row-actions">
                      <button
                        type="button"
                        onClick={() => onOpenProfile?.(m.memberId)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.35rem 0.55rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        title="Editar ficha"
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => openCredentials(m)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.35rem 0.55rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        title="Generar usuario y contraseña"
                      >
                        <KeyRound size={12} /> Credenciales
                      </button>
                      <button
                        type="button"
                        onClick={() => setCardMember(m)}
                        className="btn btn-secondary btn-sm"
                        style={{
                          padding: '0.35rem 0.55rem',
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          borderColor: 'var(--primary-gold)',
                          color: 'var(--text-gold)',
                          background: 'rgba(var(--primary-gold-rgb),0.06)',
                        }}
                        title="Ver tarjeta virtual"
                      >
                        <CreditCard size={12} /> Tarjeta
                      </button>
                      {m.outstandingBalance > 0 && (
                        <button
                          type="button"
                          onClick={() => (
                            onOpenProfile
                              ? onOpenProfile(`${m.memberId}?cobrar=1`)
                              : setCollectMember(m)
                          )}
                          className="btn btn-secondary btn-sm"
                          style={{
                            borderColor: 'var(--emerald-accent)',
                            color: 'var(--emerald-accent)',
                            background: 'rgba(16, 185, 129, 0.03)',
                            padding: '0.35rem 0.55rem',
                            fontSize: '0.72rem',
                          }}
                          title="Cobrar Cuota Pendiente"
                        >
                          <Check size={12} /> Cobrar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openLifecycle(m, m.status === 'active' ? 'suspend' : 'activate')}
                        className="btn btn-danger btn-sm"
                        style={{
                          padding: '0.35rem 0.55rem',
                          fontSize: '0.72rem',
                          background: m.status === 'active' ? 'rgba(239, 68, 68, 0.03)' : 'rgba(16, 185, 129, 0.03)',
                          borderColor: m.status === 'active' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: m.status === 'active' ? 'var(--danger-accent)' : 'var(--emerald-accent)',
                        }}
                        title={m.status === 'active' ? 'Suspender con motivo' : 'Reactivar con motivo'}
                      >
                        {m.status === 'active' ? 'Suspender' : 'Activar'}
                      </button>
                      {m.status !== 'inactive' ? (
                        <button
                          type="button"
                          onClick={() => openLifecycle(m, 'delete')}
                          className="btn btn-danger btn-sm"
                          style={{
                            padding: '0.35rem 0.55rem',
                            fontSize: '0.72rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="Dar de baja con motivo (trazable)"
                        >
                          <Trash2 size={12} /> Eliminar
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>

                {/* Fila Expandida de Adherentes Familiares */}
                {expandedMemberId === m.memberId && (
                  <tr className="members-padron-family">
                    <td colSpan="6">
                      <div className="adherents-subtable-box">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.4rem' }}>
                          <h5 className="serif-font" style={{ fontSize: '1rem', color: 'var(--text-gold)', display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                            <Users size={14} /> Grupo Familiar de {m.name}
                          </h5>
                          <button
                            onClick={() => setShowAddAdherentId(showAddAdherentId === m.memberId ? null : m.memberId)}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                          >
                            <UserPlus size={12} /> Agregar Adherente
                          </button>
                        </div>

                        {/* Formulario de Adherente */}
                        {showAddAdherentId === m.memberId && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                            <PhotoPicker
                              value={adhPhoto}
                              onChange={setAdhPhoto}
                              label="Foto del adherente"
                              size={64}
                            />
                            <div className="adh-add-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 100px', gap: '0.75rem', alignItems: 'end' }}>
                              <style>{`@media (max-width: 700px) { .adh-add-grid { grid-template-columns: 1fr !important; } }`}</style>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Nombre Completo</label>
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  placeholder="Nombre del familiar"
                                  value={adhName}
                                  onChange={(e) => setAdhName(e.target.value)}
                                />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Parentesco</label>
                                <select
                                  className="form-input"
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  value={adhRelationship}
                                  onChange={(e) => setAdhRelationship(e.target.value)}
                                >
                                  {RELATIONSHIP_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                  <option value="Adherente Deportivo">Adherente Deportivo</option>
                                </select>
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Categoría</label>
                                <select
                                  className="form-input"
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  value={adhTier}
                                  onChange={(e) => setAdhTier(e.target.value)}
                                >
                                  {tiers.map((t) => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                              </div>
                              <button
                                onClick={() => handleAddAdherent(m.memberId)}
                                className="btn btn-primary btn-sm"
                                style={{ padding: '0.45rem', width: '100%', fontSize: '0.8rem' }}
                                disabled={!adhName.trim() || !adhDisciplines.length}
                              >
                                Cargar
                              </button>
                            </div>
                            <div>
                              <label className="form-label" style={{ fontSize: '0.7rem' }}>Disciplinas *</label>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: 4 }}>
                                {disciplineOptions.map((d) => {
                                  const active = adhDisciplines.includes(d);
                                  return (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() => setAdhDisciplines((prev) =>
                                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
                                      )}
                                      style={{
                                        padding: '0.25rem 0.55rem',
                                        borderRadius: 16,
                                        border: active ? '1px solid var(--primary-gold)' : '1px solid var(--border-glass)',
                                        background: active ? 'rgba(var(--primary-gold-rgb),0.15)' : 'var(--bg-tertiary)',
                                        color: active ? 'var(--text-gold)' : 'var(--text-secondary)',
                                        fontSize: '0.72rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                      }}
                                    >
                                      {d}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Listado de adherentes / grupo familiar del padrón */}
                        {(() => {
                          const family = resolveFamilyForDisplay(m, members).members;
                          if (!family.length) {
                            return (
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', margin: '0.5rem 0' }}>
                                No posee adherentes registrados actualmente.
                              </p>
                            );
                          }
                          return (
                          <div className="table-responsive">
                          <table className="admin-table" style={{ background: 'transparent' }}>
                            <thead>
                              <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Familiar</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Parentesco</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Disciplinas</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Nivel</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Estado Credencial</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.4rem', textAlign: 'right' }}>Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {family.map(adh => (
                                <tr key={adh.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: '50%',
                                        overflow: 'hidden',
                                        flexShrink: 0,
                                        background: 'rgba(var(--primary-gold-rgb),0.12)',
                                        border: '1px solid var(--border-glass)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.65rem',
                                        fontWeight: 700,
                                        color: 'var(--text-gold)',
                                      }}>
                                        {adh.photo ? (
                                          <img src={adh.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                          (adh.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                                        )}
                                      </div>
                                      <div>
                                        <strong>{adh.name}</strong>
                                        {adh.memberId ? (
                                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Nº {adh.memberId}</div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem', color: 'var(--text-secondary)' }}>{adh.relationship}</td>
                                  <td style={{ fontSize: '0.75rem', padding: '0.4rem', color: 'var(--text-secondary)' }}>
                                    {(adh.disciplines || []).length ? adh.disciplines.join(', ') : '—'}
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                    <TierChip tier={adh.tier} catalog={tierCatalog} compact />
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                    <span style={{ color: adh.status === 'active' ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                                      {adh.status === 'active' ? '● Activo' : '○ Suspendido'}
                                    </span>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', padding: '0.4rem', textAlign: 'right' }}>
                                    <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                                      {adh.fromPadron && adh.memberId ? (
                                        <button
                                          type="button"
                                          onClick={() => onOpenProfile?.(adh.memberId)}
                                          className="btn btn-secondary btn-sm"
                                          style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                                        >
                                          Ver ficha
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => handleToggleAdherentStatus(m.memberId, adh.id)}
                                            className="btn btn-secondary btn-sm"
                                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                                          >
                                            {adh.status === 'active' ? 'Suspender' : 'Habilitar'}
                                          </button>
                                          <button
                                            onClick={() => handleDeleteAdherent(m.memberId, adh.id)}
                                            className="btn btn-danger btn-sm"
                                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}
                                          >
                                            <Trash2 size={10} />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {filteredMembers.length > MEMBERS_PAGE_SIZE ? (
        <div className="members-pager members-pager--bottom" aria-live="polite">
          <span>
            {((safePage - 1) * MEMBERS_PAGE_SIZE) + 1}–{Math.min(safePage * MEMBERS_PAGE_SIZE, filteredMembers.length)} de {filteredMembers.length.toLocaleString('es-AR')}
          </span>
          <div className="members-pager-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              aria-label="Hoja anterior"
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <span className="members-pager-page">
              Hoja {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              aria-label="Hoja siguiente"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : null}
      </FoldableSection>

      <FamilyGroupsPadron
        groups={filteredFamilies}
        tierCatalog={tierCatalog}
        onOpenProfile={onOpenProfile}
      />

      {collectMember && (
        <CollectDuesModal
          member={collectMember}
          formatCurrency={formatCurrency}
          onClose={() => setCollectMember(null)}
          onConfirm={handleConfirmCollect}
        />
      )}

      {cardMember && (
        <ModalDialog
          onClose={() => setCardMember(null)}
          labelledBy="card-member-title"
          contentClassName="modal-content glass-panel"
          contentStyle={{
            width: '90%',
            maxWidth: 460,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            padding: '1.25rem',
          }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h4 id="card-member-title" className="serif-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-gold)' }}>
                  Tarjeta virtual
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {cardMember.name}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCardMember(null)}
                aria-label="Cerrar"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <X size={14} aria-hidden="true" /> Cerrar
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <VirtualCard member={cardMember} />
            </div>
        </ModalDialog>
      )}

      <MemberLifecycleModal
        key={lifecycleTarget ? `${lifecycleTarget.member.memberId}-${lifecycleTarget.action}` : 'closed'}
        open={Boolean(lifecycleTarget)}
        member={lifecycleTarget?.member}
        action={lifecycleTarget?.action}
        busy={lifecycleBusy}
        error={lifecycleError}
        onClose={() => {
          if (!lifecycleBusy) {
            setLifecycleTarget(null);
            setLifecycleError('');
          }
        }}
        onConfirm={handleLifecycleConfirm}
      />

      <MemberCredentialsModal
        key={credsTarget ? `creds-${credsTarget.memberId}` : 'creds-closed'}
        open={Boolean(credsTarget)}
        member={credsTarget}
        busy={credsBusy}
        error={credsError}
        result={credsResult}
        sending={credsSending}
        notice={credsNotice}
        onClose={() => {
          if (!credsBusy) {
            setCredsTarget(null);
            setCredsError('');
            setCredsResult(null);
            setCredsNotice('');
            setCredsSending('');
            setCredsFromRequest(null);
          }
        }}
        onGenerate={handleCredentialsGenerate}
        onSendWhatsApp={handleSendCredentialsWhatsApp}
        onSendEmail={handleSendCredentialsEmail}
      />
    </div>
  );
}
