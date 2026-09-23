import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  UserRound, Plus, Check, X, Loader2, Camera, Trash2,
  RefreshCw, Copy, Eye, EyeOff, Pencil, History, Search, Power, MoreHorizontal,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import { uploadProfilePhoto } from '../../data/storage';
import { ROLE_LABELS, PORTAL_ROLE_OPTIONS, TITLE_ROLE_OPTIONS, canManageProfiles, hasSystemAdminRole, primaryRoleFromList, roleRank } from '../../domain/auth/roles';
import {
  buildCredentials,
  generatePassword,
  generateUsername,
  loginEmailFromUsername,
  LOGIN_DOMAIN,
  usernameFromEmail,
} from '../../domain/auth/credentials';
import { useAuth } from '../../context/AuthContext';
import { splitMemberName } from '../../domain/members/memberAdminActions';
import ModalDialog from '../ModalDialog';
const ROLE_OPTIONS = PORTAL_ROLE_OPTIONS;

const DOC_TYPES = ['Arg-DNI', 'Pasaporte', 'CUIL', 'Otro'];
const GENDERS = ['Masculino', 'Femenino', 'Otro', 'Prefiero no decir'];
const BLOOD_TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const emptyUserForm = () => {
  const creds = buildCredentials();
  return {
    avatarUrl: '',
    firstName: '',
    lastName: '',
    documentType: 'Arg-DNI',
    documentNumber: '',
    gender: '',
    birthDate: '',
    bloodType: '',
    healthInsurance: '',
    emergencyPhone: '',
    emergencyClinic: '',
    address: '',
    phone: '',
    contactEmail: '',
    username: creds.username,
    email: creds.email,
    password: creds.password,
    passwordVisible: true,
    credentialsLocked: false,
    roles: [{ roleKey: 'admin', label: 'Administrador', kind: 'system' }],
    authorizations: [],
    identifiers: [],
    linkedMemberId: '',
  };
}

function mapMemberDocType(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Arg-DNI';
  if (DOC_TYPES.includes(raw)) return raw;
  const upper = raw.toUpperCase();
  if (upper.includes('PASAPORTE') || upper === 'PASSPORT') return 'Pasaporte';
  if (upper.includes('CUIL') || upper.includes('CUIT')) return 'CUIL';
  if (upper.includes('DNI')) return 'Arg-DNI';
  return 'Otro';
}

function mapMemberGender(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (GENDERS.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (['m', 'masculino', 'male', 'hombre'].includes(lower)) return 'Masculino';
  if (['f', 'femenino', 'female', 'mujer'].includes(lower)) return 'Femenino';
  return 'Otro';
}

function ensureAdminAndMember(roles = []) {
  const next = [...(roles || [])];
  const add = (roleKey) => {
    if (!roleChipsSelected(next, roleKey)) {
      next.push({ roleKey, label: ROLE_LABELS[roleKey] || roleKey, kind: 'system' });
    }
  };
  add('admin');
  add('member');
  return next;
}

function ensureMemberIdentifier(identifiers = [], memberNumber) {
  const num = String(memberNumber || '').trim();
  if (!num) return identifiers || [];
  const list = [...(identifiers || [])];
  if (list.some((row) => String(row.identifier || '').trim() === num)) return list;
  return [...list, { idType: 'ST', identifier: num }];
}

function formFromProfile(profile) {
  const username = profile.username || usernameFromEmail(profile.email) || '';
  const roles = profile.roles?.length
    ? profile.roles.map((r) => ({
      roleKey: r.roleKey,
      label: r.label || ROLE_LABELS[r.roleKey] || r.roleKey,
      kind: r.kind || 'system',
    }))
    : [{ roleKey: profile.role || 'member', label: ROLE_LABELS[profile.role] || profile.role || 'Socio', kind: 'system' }];
  return {
    avatarUrl: profile.avatarUrl || '',
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    documentType: profile.documentType || 'Arg-DNI',
    documentNumber: profile.documentNumber || '',
    gender: profile.gender || '',
    birthDate: profile.birthDate || '',
    bloodType: profile.bloodType || '',
    healthInsurance: profile.healthInsurance || '',
    emergencyPhone: profile.emergencyPhone || '',
    emergencyClinic: profile.emergencyClinic || '',
    address: profile.address || '',
    phone: profile.phone || '',
    contactEmail: profile.contactEmail || '',
    username,
    email: profile.email || loginEmailFromUsername(username),
    password: '',
    passwordVisible: false,
    credentialsLocked: true,
    roles,
    authorizations: (profile.authorizations || []).map((a) => ({
      kind: a.kind || 'custom',
      title: a.title || '',
      roleLabel: a.roleLabel || '',
      expiresAt: a.expiresAt || '',
      pin: a.pin || '',
    })),
    identifiers: (profile.identifiers || []).map((i) => ({
      idType: i.idType || '',
      identifier: i.identifier || '',
    })),
    linkedMemberId: '',
  };
};

function roleChipsSelected(roles, key) {
  return (roles || []).some((r) => String(r.roleKey || r).toLowerCase() === String(key).toLowerCase());
}

function toggleRoleInList(roles, next) {
  const key = next.roleKey;
  const has = roleChipsSelected(roles, key);
  if (has) {
    const filtered = roles.filter((r) => String(r.roleKey).toLowerCase() !== key.toLowerCase());
    return filtered.length ? filtered : [{ roleKey: 'member', label: 'Socio', kind: 'system' }];
  }
  return [...roles, next];
}

function formatAuditAction(action) {
  const map = {
    'profile.change': 'Cambio de ficha',
    'profile.create': 'Alta de perfil',
    'profile_role.grant': 'Rol otorgado',
    'profile_role.revoke': 'Rol revocado',
    'profile_role.update': 'Rol actualizado',
    'profile_role.delete': 'Rol eliminado',
    'profile.update': 'Actualización de ficha',
    'profile.reset_password': 'Contraseña regenerada',
  };
  return map[action] || action;
}

function formatAuditSummary(row) {
  const p = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  if (row.action?.startsWith('profile_role.')) {
    const label = p.label || ROLE_LABELS[p.role_key] || p.role_key || 'rol';
    if (row.action === 'profile_role.grant') return `Se asignó «${label}»`;
    if (row.action === 'profile_role.revoke') return `Se revocó «${label}»`;
    if (row.action === 'profile_role.delete') return `Se eliminó «${label}»`;
    return `Se actualizó «${label}»`;
  }
  if (row.action === 'profile.reset_password') return 'Se regeneró la contraseña de acceso';
  if (row.action === 'profile.create') {
    return p.email ? `Alta con login ${p.email}` : 'Alta de usuario en el portal';
  }
  if (row.action === 'profile.update' || row.action === 'profile.change') {
    const keys = Object.keys(p).filter((k) => !['meta'].includes(k));
    if (!keys.length) return 'Se modificaron datos de la ficha';
    const labels = {
      firstName: 'nombre',
      lastName: 'apellido',
      fullName: 'nombre completo',
      phone: 'teléfono',
      avatarUrl: 'foto',
      documentType: 'tipo doc.',
      documentNumber: 'documento',
      gender: 'género',
      birthDate: 'nacimiento',
      bloodType: 'grupo sanguíneo',
      healthInsurance: 'obra social',
      emergencyPhone: 'emergencia',
      emergencyClinic: 'clínica',
      address: 'domicilio',
      prismaId: 'Prisma',
      role: 'rol primario',
      isActive: 'estado',
      username: 'usuario',
      contactEmail: 'email contacto',
      email: 'email',
    };
    const readable = keys.slice(0, 6).map((k) => labels[k] || k);
    const more = keys.length > 6 ? ` (+${keys.length - 6})` : '';
    return `Campos: ${readable.join(', ')}${more}`;
  }
  return 'Evento registrado en auditoría';
}

function displayName(profile) {
  const last = String(profile.lastName || '').trim();
  const first = String(profile.firstName || '').trim();
  if (last || first) return [last, first].filter(Boolean).join(' ');
  return profile.fullName || '—';
}

function profileListId(profile) {
  const ids = (profile.roles || []).map((r) => Number(r.publicId)).filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length) return String(Math.min(...ids));
  if (profile.prismaId) return String(profile.prismaId);
  return '—';
}

function profileUsername(profile) {
  return profile.username || usernameFromEmail(profile.email) || '—';
}

function normalizeSearch(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function profileSearchHaystack(profile) {
  const roles = (profile.roles || []).map((r) => [r.label, r.roleKey, r.publicId].filter(Boolean).join(' '));
  const authz = (profile.authorizations || []).map((a) => [a.kind, a.title, a.roleLabel, a.expiresAt].filter(Boolean).join(' '));
  const ids = (profile.identifiers || []).map((i) => `${i.idType || ''} ${i.identifier || ''}`);
  return normalizeSearch([
    displayName(profile),
    profile.fullName,
    profile.firstName,
    profile.lastName,
    profile.documentType,
    profile.documentNumber,
    profile.email,
    profile.contactEmail,
    profileUsername(profile),
    profileListId(profile),
    profile.prismaId,
    profile.role,
    ROLE_LABELS[profile.role],
    ...roles,
    ...authz,
    ...ids,
  ].filter(Boolean).join(' '));
}

function profileMatchesQuery(profile, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  return profileSearchHaystack(profile).includes(q);
}

function Field({ label, children, className = '', as: Tag = 'label' }) {
  return (
    <Tag className={`sys-user-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </Tag>
  );
}

function sortProfileRoles(roles = [], fallbackRole = 'member') {
  const list = roles?.length
    ? [...roles]
    : [{ roleKey: fallbackRole, label: ROLE_LABELS[fallbackRole] || fallbackRole, kind: 'system' }];
  return list.sort((a, b) => {
    const kindA = a.kind === 'title' ? 1 : 0;
    const kindB = b.kind === 'title' ? 1 : 0;
    if (kindA !== kindB) return kindA - kindB;
    return roleRank(b.roleKey) - roleRank(a.roleKey);
  });
}

function RolesCell({ profile, onOpenAll }) {
  const roles = sortProfileRoles(profile.roles, profile.role);
  const primaryKey = primaryRoleFromList(roles);
  const visible = roles.slice(0, 2);
  const extra = roles.length - visible.length;

  return (
    <div className="sys-roles-cell">
      <ul className="sys-roles-stack">
        {visible.map((r) => {
          const isPrimary = String(r.roleKey).toLowerCase() === String(primaryKey).toLowerCase() && r.kind !== 'title';
          const isTitle = r.kind === 'title';
          return (
            <li
              key={`${profile.id}-${r.roleKey}-${r.publicId || ''}`}
              className={[
                'sys-role-row',
                isPrimary ? 'is-primary' : '',
                isTitle ? 'is-title' : '',
              ].filter(Boolean).join(' ')}
              title={r.label || ROLE_LABELS[r.roleKey] || r.roleKey}
            >
              <span className="sys-role-label">{r.label || ROLE_LABELS[r.roleKey] || r.roleKey}</span>
            </li>
          );
        })}
      </ul>
      {extra > 0 ? (
        <button
          type="button"
          className="sys-roles-more"
          onClick={() => onOpenAll?.(profile)}
          title="Ver todos los roles"
        >
          +{extra}
        </button>
      ) : null}
    </div>
  );
}

function RowActionsMenu({
  profile,
  open,
  busy,
  canEdit,
  onToggle,
  onClose,
  onEdit,
  onHistory,
  onToggleActive,
  onResetPassword,
}) {
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open || !btnRef.current) return undefined;
    const place = () => {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (btnRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const run = (action) => {
    onClose();
    action(profile);
  };

  return (
    <div className="sys-user-functions">
      <button
        ref={btnRef}
        type="button"
        className={`sys-fn-btn is-more${open ? ' is-open' : ''}`}
        title="Acciones"
        aria-label="Abrir acciones"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={menuRef}
            className="sys-row-menu"
            role="menu"
            style={{ top: pos.top, right: pos.right }}
          >
            <button
              type="button"
              role="menuitem"
              disabled={!canEdit}
              onClick={() => run(onEdit)}
            >
              <Pencil size={14} />
              Editar ficha y roles
            </button>
            <button type="button" role="menuitem" onClick={() => run(onHistory)}>
              <History size={14} />
              Historial
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canEdit || busy}
              onClick={() => run(onToggleActive)}
            >
              <Power size={14} />
              {profile.isActive ? 'Desactivar' : 'Activar'}
            </button>
            {canEdit ? (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => run(onResetPassword)}
              >
                <RefreshCw size={14} />
                Regenerar clave
              </button>
            ) : null}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

/**
 * Administración del sistema: usuarios del portal.
 */
export default function SystemAdminTab({
  setRegisteredUsersCount,
  userRole = 'admin',
}) {
  const { roles: sessionRoles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canEditProfiles = canManageProfiles(sessionRoles?.length ? sessionRoles : userRole);
  const [profiles, setProfiles] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState('');
  const [historyProfileId, setHistoryProfileId] = useState(null);
  const [historyProfileName, setHistoryProfileName] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [savingUser, setSavingUser] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lastCreatedCreds, setLastCreatedCreds] = useState(null);
  const [rolesModalProfile, setRolesModalProfile] = useState(null);
  const [openActionsId, setOpenActionsId] = useState(null);
  const [memberHits, setMemberHits] = useState([]);
  const [memberSearchBusy, setMemberSearchBusy] = useState(false);
  const [memberPicked, setMemberPicked] = useState(null);
  const [pickingMember, setPickingMember] = useState(false);
  const photoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured) {
        setLoadingUsers(false);
        setUsersError('Supabase no configurado: los usuarios viven en la nube.');
        return;
      }
      setLoadingUsers(true);
      try {
        const list = await repos.listSystemAdminProfiles();
        if (!cancelled) {
          setProfiles(list);
          setUsersError('');
        }
      } catch (err) {
        if (!cancelled) setUsersError(err.message || 'No se pudieron cargar usuarios');
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setRegisteredUsersCount]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(''), 3600);
    return () => clearTimeout(t);
  }, [flash]);

  const adminProfiles = useMemo(
    () => (profiles || []).filter(hasSystemAdminRole),
    [profiles],
  );

  const filteredProfiles = useMemo(
    () => adminProfiles.filter((p) => profileMatchesQuery(p, userQuery)),
    [adminProfiles, userQuery],
  );

  const setUF = (key, value) => setUserForm((f) => ({ ...f, [key]: value }));

  const refreshUsernameFromIdentity = (patch = {}) => {
    setUserForm((f) => {
      if (f.credentialsLocked) return { ...f, ...patch };
      const next = { ...f, ...patch };
      const username = generateUsername({
        firstName: next.firstName,
        lastName: next.lastName,
        documentNumber: next.documentNumber,
      });
      return {
        ...next,
        username,
        email: loginEmailFromUsername(username),
      };
    });
  };

  const regenerateUsername = () => {
    setUserForm((f) => {
      const username = generateUsername({
        firstName: f.firstName,
        lastName: f.lastName,
        documentNumber: f.documentNumber,
      });
      return {
        ...f,
        username,
        email: loginEmailFromUsername(username),
        credentialsLocked: false,
      };
    });
  };

  const regeneratePassword = () => {
    setUserForm((f) => ({
      ...f,
      password: generatePassword(),
      passwordVisible: true,
    }));
  };

  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setFlash(`${label} copiado.`);
    } catch {
      setFlash(`No se pudo copiar ${label.toLowerCase()}.`);
    }
  };

  const resetMemberLookup = () => {
    setMemberHits([]);
    setMemberSearchBusy(false);
    setMemberPicked(null);
    setPickingMember(false);
  };

  const openNewUser = () => {
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede crear o modificar perfiles.');
      return;
    }
    setEditingUserId(null);
    setUserForm(emptyUserForm());
    resetMemberLookup();
    setShowUserForm(true);
  };

  const closeRowActions = () => setOpenActionsId(null);

  const openEditUser = (profile) => {
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede crear o modificar perfiles.');
      return;
    }
    setOpenActionsId(null);
    resetMemberLookup();
    setEditingUserId(profile.id);
    setUserForm(formFromProfile(profile));
    setShowUserForm(true);
    setHistoryProfileId(null);
  };

  const closeUserForm = () => {
    setShowUserForm(false);
    setEditingUserId(null);
    setUserForm(emptyUserForm());
    resetMemberLookup();
  };

  useEffect(() => {
    if (!showUserForm || editingUserId || memberPicked) {
      setMemberHits([]);
      setMemberSearchBusy(false);
      return undefined;
    }
    const raw = String(userForm.firstName || '').trim();
    const digits = raw.replace(/\D/g, '');
    const enough = raw.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setMemberHits([]);
      setMemberSearchBusy(false);
      return undefined;
    }
    let cancelled = false;
    setMemberSearchBusy(true);
    const timer = window.setTimeout(() => {
      repos.searchMembersDirectory(raw, { limit: 12 })
        .then((rows) => {
          if (!cancelled) setMemberHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setMemberHits([]);
        })
        .finally(() => {
          if (!cancelled) setMemberSearchBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userForm.firstName, showUserForm, editingUserId, memberPicked]);

  const applyMemberToNewForm = (member) => {
    const { firstName, lastName } = splitMemberName(member);
    const documentNumber = member.documentNumber || '';
    const username = generateUsername({ firstName, lastName, documentNumber });
    setUserForm((f) => ({
      ...f,
      firstName,
      lastName,
      documentType: mapMemberDocType(member.documentType),
      documentNumber,
      gender: mapMemberGender(member.gender),
      birthDate: String(member.birthDate || '').slice(0, 10),
      bloodType: member.bloodType && BLOOD_TYPES.includes(member.bloodType) ? member.bloodType : f.bloodType,
      healthInsurance: member.healthInsurance || f.healthInsurance,
      emergencyPhone: member.emergencyPhone || f.emergencyPhone,
      emergencyClinic: member.emergencyClinic || f.emergencyClinic,
      address: [member.address, member.city].filter(Boolean).join(', ') || f.address,
      phone: member.phone || f.phone,
      contactEmail: member.email || f.contactEmail,
      avatarUrl: member.photo || f.avatarUrl,
      linkedMemberId: member.id,
      roles: ensureAdminAndMember(f.roles),
      identifiers: ensureMemberIdentifier(f.identifiers, member.memberId),
      username,
      email: loginEmailFromUsername(username),
      credentialsLocked: false,
    }));
  };

  const pickMember = async (hit) => {
    if (!hit) return;
    setMemberHits([]);
    setMemberPicked({
      id: hit.id,
      memberId: hit.memberId,
      name: hit.name,
    });
    setPickingMember(true);
    try {
      let member = hit;
      try {
        const full = hit.memberId
          ? await repos.getMemberByNumber(hit.memberId)
          : await repos.getMember(hit.id);
        if (full) member = full;
      } catch {
        member = hit;
      }
      if (member.profileId) {
        try {
          const existing = await repos.getProfile(member.profileId);
          if (existing) {
            const next = formFromProfile(existing);
            setEditingUserId(existing.id);
            setUserForm({
              ...next,
              linkedMemberId: member.id,
              roles: ensureAdminAndMember(next.roles),
              identifiers: ensureMemberIdentifier(next.identifiers, member.memberId),
              avatarUrl: existing.avatarUrl || member.photo || '',
            });
            setFlash('Este socio ya tiene usuario. Revisá la ficha y sumá administrador si falta.');
            return;
          }
        } catch {
          /* alta nueva si el perfil no carga */
        }
      }
      applyMemberToNewForm(member);
      setFlash(`Ficha completada con el socio Nº ${member.memberId || '—'}.`);
    } catch (err) {
      setMemberPicked(null);
      setFlash(err.message || 'No se pudo cargar el socio.');
    } finally {
      setPickingMember(false);
    }
  };

  useEffect(() => {
    const editId = location.state?.editProfileId;
    if (!editId || !profiles.length || !canEditProfiles) return undefined;
    const target = profiles.find((p) => p.id === editId);
    if (!target) return undefined;
    openEditUser(target);
    navigate(location.pathname, { replace: true, state: {} });
    return undefined;
    // Intentionally one-shot when returning from profile "Editar"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.editProfileId, profiles, canEditProfiles]);

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const uploaded = await uploadProfilePhoto(file, { profileId: editingUserId || 'new' });
      setUF('avatarUrl', uploaded.url);
      setFlash('Foto cargada.');
    } catch (err) {
      setFlash(err.message || 'No se pudo cargar la foto.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const addAuthorization = (kind) => {
    if (kind === 'admin') {
      setUserForm((f) => ({
        ...f,
        authorizations: [
          ...f.authorizations,
          {
            kind: 'admin',
            title: 'Administrador',
            roleLabel: 'Superadministrador',
            expiresAt: '',
            pin: '',
          },
        ],
      }));
      return;
    }
    setUserForm((f) => ({
      ...f,
      authorizations: [
        ...f.authorizations,
        {
          kind: 'gate_operator',
          title: 'Operador de portería',
          roleLabel: '',
          expiresAt: '',
          pin: '',
        },
      ],
    }));
  };

  const updateAuthorization = (idx, patch) => {
    setUserForm((f) => ({
      ...f,
      authorizations: f.authorizations.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    }));
  };

  const removeAuthorization = (idx) => {
    setUserForm((f) => ({
      ...f,
      authorizations: f.authorizations.filter((_, i) => i !== idx),
    }));
  };

  const addIdentifier = () => {
    setUserForm((f) => ({
      ...f,
      identifiers: [...f.identifiers, { idType: '', identifier: '' }],
    }));
  };

  const updateIdentifier = (idx, patch) => {
    setUserForm((f) => ({
      ...f,
      identifiers: f.identifiers.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  };

  const removeIdentifier = (idx) => {
    setUserForm((f) => ({
      ...f,
      identifiers: f.identifiers.filter((_, i) => i !== idx),
    }));
  };

  const submitUser = async (e) => {
    e.preventDefault();
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede crear o modificar perfiles.');
      return;
    }
    const username = String(userForm.username || '').trim();
    const password = String(userForm.password || '');
    const email = loginEmailFromUsername(username);
    if (!username) {
      setFlash('El usuario es obligatorio.');
      return;
    }
    const isEdit = Boolean(editingUserId);
    if (!isEdit && password.length < 6) {
      setFlash('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (isEdit && password && password.length < 6) {
      setFlash('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setSavingUser(true);
    try {
      const roles = userForm.roles?.length
        ? userForm.roles
        : [{ roleKey: 'member', label: 'Socio', kind: 'system' }];
      const authorizations = userForm.authorizations;
      const identifiers = userForm.identifiers.filter((i) => i.idType && i.identifier);

      if (isEdit) {
        let saved = await repos.updateProfile(editingUserId, {
          firstName: userForm.firstName.trim(),
          lastName: userForm.lastName.trim(),
          fullName: [userForm.firstName.trim(), userForm.lastName.trim()].filter(Boolean).join(' '),
          phone: userForm.phone.trim(),
          contactEmail: userForm.contactEmail.trim() || null,
          username,
          avatarUrl: userForm.avatarUrl || null,
          documentType: userForm.documentType,
          documentNumber: userForm.documentNumber.trim(),
          gender: userForm.gender,
          birthDate: userForm.birthDate || null,
          bloodType: userForm.bloodType,
          healthInsurance: userForm.healthInsurance.trim(),
          emergencyPhone: userForm.emergencyPhone.trim(),
          emergencyClinic: userForm.emergencyClinic.trim(),
          address: userForm.address.trim(),
          role: primaryRoleFromList(roles),
        });
        saved = await repos.replaceProfileRoles(editingUserId, roles);
        await repos.replaceProfileAuthorizations(editingUserId, authorizations);
        await repos.replaceProfileIdentifiers(editingUserId, identifiers);
        if (userForm.linkedMemberId) {
          try {
            await repos.linkMemberProfile(userForm.linkedMemberId, editingUserId);
          } catch {
            /* no bloquear la edición si el vínculo falla */
          }
        }
        if (password) {
          await repos.resetPortalUserPassword(editingUserId, password);
          setLastCreatedCreds({ username, email: saved.email || email, password });
        }
        // Recargar ficha completa (authz/ids)
        const refreshed = await repos.listSystemAdminProfiles();
        setProfiles(refreshed);
        closeUserForm();
        setFlash(password ? 'Usuario actualizado y contraseña regenerada.' : 'Usuario actualizado.');
      } else {
        const created = await repos.createPortalUser({
          firstName: userForm.firstName.trim(),
          lastName: userForm.lastName.trim(),
          email,
          username,
          password,
          phone: userForm.phone.trim(),
          contactEmail: userForm.contactEmail.trim() || null,
          avatarUrl: userForm.avatarUrl || null,
          documentType: userForm.documentType,
          documentNumber: userForm.documentNumber.trim(),
          gender: userForm.gender,
          birthDate: userForm.birthDate || null,
          bloodType: userForm.bloodType,
          healthInsurance: userForm.healthInsurance.trim(),
          emergencyPhone: userForm.emergencyPhone.trim(),
          emergencyClinic: userForm.emergencyClinic.trim(),
          address: userForm.address.trim(),
          role: primaryRoleFromList(roles),
          roles,
          authorizations,
          identifiers,
        });
        if (userForm.linkedMemberId) {
          try {
            await repos.linkMemberProfile(userForm.linkedMemberId, created.id);
          } catch {
            /* el usuario ya existe; el vínculo se puede completar después */
          }
        }
        if (hasSystemAdminRole(created)) {
          setProfiles((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
        }
        setRegisteredUsersCount?.((n) => Number(n || 0) + 1);
        setLastCreatedCreds({ username, email, password });
        closeUserForm();
        setFlash(`Usuario creado. Login: ${email}`);
      }
    } catch (err) {
      setFlash(err.message || (editingUserId ? 'No se pudo actualizar el usuario.' : 'No se pudo crear el usuario.'));
    } finally {
      setSavingUser(false);
    }
  };

  const resetExistingPassword = async (profile) => {
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede modificar perfiles.');
      return;
    }
    const nextPassword = generatePassword();
    setBusyId(profile.id);
    try {
      await repos.resetPortalUserPassword(profile.id, nextPassword);
      setLastCreatedCreds({
        username: profile.username || String(profile.email || '').split('@')[0],
        email: profile.email,
        password: nextPassword,
      });
      setFlash(`Contraseña regenerada para ${profile.email}.`);
    } catch (err) {
      setFlash(err.message || 'No se pudo regenerar la contraseña.');
    } finally {
      setBusyId(null);
    }
  };

  const updateRoles = async (profileId, roles) => {
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede modificar perfiles.');
      return;
    }
    setBusyId(profileId);
    try {
      const saved = await repos.replaceProfileRoles(profileId, roles);
      setProfiles((prev) => {
        const next = { ...prev.find((p) => p.id === profileId), ...saved };
        if (!hasSystemAdminRole(next)) {
          return prev.filter((p) => p.id !== profileId);
        }
        return prev.map((p) => (p.id === profileId ? next : p));
      });
      setRolesModalProfile((prev) => (prev?.id === profileId ? { ...prev, ...saved } : prev));
      setFlash('Roles actualizados (cambio registrado).');
    } catch (err) {
      setFlash(err.message || 'No se pudieron actualizar los roles.');
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (profile) => {
    const profileId = typeof profile === 'string' ? profile : profile?.id;
    if (!profileId) return;
    const name = typeof profile === 'string'
      ? (profiles.find((p) => p.id === profileId)?.fullName
        || displayName(profiles.find((p) => p.id === profileId) || {})
        || 'Usuario')
      : displayName(profile);
    setHistoryProfileId(profileId);
    setHistoryProfileName(name || 'Usuario');
    setHistoryLoading(true);
    try {
      const rows = await repos.listProfileAudit(profileId, { limit: 100 });
      setHistoryRows(rows);
    } catch (err) {
      setFlash(err.message || 'No se pudo cargar el historial.');
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistory = () => {
    setHistoryProfileId(null);
    setHistoryProfileName('');
    setHistoryRows([]);
  };

  const toggleActive = async (profile) => {
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede modificar perfiles.');
      return;
    }
    setBusyId(profile.id);
    try {
      const saved = await repos.updateProfile(profile.id, { isActive: !profile.isActive });
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, ...saved } : p)));
      setFlash(saved.isActive ? 'Usuario activado.' : 'Usuario desactivado.');
    } catch (err) {
      setFlash(err.message || 'No se pudo cambiar el estado.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-in sys-admin">
      {flash && (
        <p className="sys-admin-flash" role="status">{flash}</p>
      )}

      <section className="glass-card sys-admin-card">
        <header className="sys-admin-card-head">
          <UserRound size={14} color="var(--primary-gold)" />
          <h3>Administradores <em>{adminProfiles.length}</em></h3>
          <div className="sys-user-search">
            <Search size={15} aria-hidden="true" />
            <input
              id="sys-user-search"
              type="search"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Buscar por nombre, DNI, email, usuario o #"
              aria-label="Buscar usuarios"
              autoComplete="off"
            />
            {userQuery ? (
              <button type="button" className="sys-user-search-clear" onClick={() => setUserQuery('')} aria-label="Limpiar búsqueda">
                <X size={13} />
              </button>
            ) : null}
          </div>
          <div className="sys-admin-card-actions">
            {canEditProfiles ? (
              <button type="button" className="btn btn-primary btn-sm sys-admin-add-btn" onClick={openNewUser}>
                <Plus size={13} /> Agregar
              </button>
            ) : (
              <span className="ops-muted" style={{ fontSize: '0.78rem' }}>
                Solo superadministrador puede modificar perfiles
              </span>
            )}
          </div>
        </header>

        {lastCreatedCreds && (
          <div className="sys-creds-banner" role="status">
            <div>
              <strong>Credenciales generadas</strong>
              <p>
                Usuario: <code>{lastCreatedCreds.username}</code>
                {' · '}
                Login: <code>{lastCreatedCreds.email}</code>
                {' · '}
                Contraseña: <code>{lastCreatedCreds.password}</code>
              </p>
            </div>
            <div className="sys-creds-banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText(lastCreatedCreds.password, 'Contraseña')}>
                Copiar clave
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLastCreatedCreds(null)}>
                Cerrar
              </button>
            </div>
          </div>
        )}

        {showUserForm && (
          <ModalDialog
            open={showUserForm}
            onClose={closeUserForm}
            labelledBy="sys-user-modal-title"
            contentClassName="modal-content glass-panel sys-user-modal"
            contentStyle={{
              width: 'min(960px, 96vw)',
              maxWidth: 960,
              maxHeight: 'min(92vh, 100%)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glass)',
              padding: 0,
            }}
          >
            <div className="modal-header sys-user-modal-header">
              <div>
                <h4 id="sys-user-modal-title" className="serif-font" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-gold)' }}>
                  {editingUserId ? 'Editar usuario' : 'Nuevo usuario'}
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {editingUserId
                    ? 'Actualizá la ficha, roles y autorizaciones.'
                    : 'Buscá un socio del padrón o completá la ficha a mano.'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={closeUserForm}
                aria-label="Cerrar"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <X size={14} aria-hidden="true" /> Cerrar
              </button>
            </div>
            <form className="sys-user-form sys-user-modal-body" onSubmit={submitUser}>
            <div className="sys-user-photo">
              <div className="sys-user-photo-frame">
                {userForm.avatarUrl ? (
                  <img src={userForm.avatarUrl} alt="Foto de perfil" />
                ) : (
                  <Camera size={28} strokeWidth={1.5} />
                )}
              </div>
              <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={uploadingPhoto}
                onClick={() => photoRef.current?.click()}
              >
                {uploadingPhoto ? 'Subiendo…' : 'Cargar foto'}
              </button>
            </div>

            <div className="sys-user-grid">
              <Field label="Nombre" as="div" className="sys-user-lookup">
                <div className="sys-user-lookup-box">
                  <div className="sys-user-lookup-input">
                    {!editingUserId ? <Search size={15} aria-hidden="true" /> : null}
                    <input
                      className="form-input"
                      required
                      autoComplete="off"
                      placeholder={editingUserId ? undefined : 'Buscar socio o escribir nombre'}
                      value={userForm.firstName}
                      disabled={pickingMember}
                      onChange={(e) => {
                        setMemberPicked(null);
                        refreshUsernameFromIdentity({ firstName: e.target.value, linkedMemberId: '' });
                      }}
                      aria-autocomplete={!editingUserId ? 'list' : undefined}
                      aria-expanded={!editingUserId && memberHits.length > 0}
                    />
                    {memberSearchBusy || pickingMember ? (
                      <Loader2 size={14} className="sys-user-lookup-spin" aria-hidden="true" />
                    ) : null}
                  </div>
                  {memberPicked ? (
                    <p className="sys-user-lookup-picked">
                      Socio Nº {memberPicked.memberId || '—'}
                      {memberPicked.name ? ` · ${memberPicked.name}` : ''}
                      <button
                        type="button"
                        onClick={() => {
                          setMemberPicked(null);
                          refreshUsernameFromIdentity({ linkedMemberId: '' });
                        }}
                      >
                        Quitar
                      </button>
                    </p>
                  ) : null}
                  {!editingUserId && memberHits.length > 0 ? (
                    <ul className="sys-user-lookup-list" role="listbox">
                      {memberHits.map((member) => (
                        <li key={member.id}>
                          <button type="button" onClick={() => pickMember(member)}>
                            <strong>{member.name || 'Sin nombre'}</strong>
                            <span>
                              Nº {member.memberId || '—'}
                              {member.documentNumber ? ` · DNI ${member.documentNumber}` : ''}
                              {member.profileId ? ' · ya tiene usuario' : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Field>
              <Field label="Apellido">
                <input
                  className="form-input"
                  required
                  value={userForm.lastName}
                  onChange={(e) => refreshUsernameFromIdentity({ lastName: e.target.value })}
                />
              </Field>
              <Field label="Documento" className="sys-user-doc">
                <div className="sys-user-doc-row">
                  <select className="form-input" value={userForm.documentType} onChange={(e) => setUF('documentType', e.target.value)}>
                    {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    className="form-input"
                    value={userForm.documentNumber}
                    onChange={(e) => refreshUsernameFromIdentity({ documentNumber: e.target.value })}
                    placeholder="Número"
                  />
                </div>
              </Field>
              <Field label="Género">
                <select className="form-input" value={userForm.gender} onChange={(e) => setUF('gender', e.target.value)}>
                  <option value="">Seleccionar</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label="Fecha de nacimiento">
                <input className="form-input" type="date" value={userForm.birthDate} onChange={(e) => setUF('birthDate', e.target.value)} />
              </Field>
              <Field label="Grupo sanguíneo">
                <select className="form-input" value={userForm.bloodType} onChange={(e) => setUF('bloodType', e.target.value)}>
                  <option value="">—</option>
                  {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Obra social">
                <input className="form-input" value={userForm.healthInsurance} onChange={(e) => setUF('healthInsurance', e.target.value)} />
              </Field>
              <Field label="Número de emergencia">
                <input className="form-input" value={userForm.emergencyPhone} onChange={(e) => setUF('emergencyPhone', e.target.value)} />
              </Field>
              <Field label="Clínica de emergencia">
                <input className="form-input" value={userForm.emergencyClinic} onChange={(e) => setUF('emergencyClinic', e.target.value)} placeholder="Indique la clínica de emergencia" />
              </Field>
              <Field label="Domicilio" className="sys-user-span2">
                <input className="form-input" value={userForm.address} onChange={(e) => setUF('address', e.target.value)} />
              </Field>
              <Field label="Teléfono de contacto">
                <input className="form-input" value={userForm.phone} onChange={(e) => setUF('phone', e.target.value)} />
              </Field>
              <Field label="Email de contacto">
                <input
                  className="form-input"
                  type="email"
                  value={userForm.contactEmail}
                  onChange={(e) => setUF('contactEmail', e.target.value)}
                  placeholder="opcional"
                />
              </Field>
              <Field label="Usuario (login)" className="sys-user-span2">
                <div className="sys-cred-row">
                  <input
                    className="form-input"
                    required
                    autoComplete="off"
                    value={userForm.username}
                    onChange={(e) => {
                      const username = e.target.value.trim().toLowerCase();
                      setUserForm((f) => ({
                        ...f,
                        username,
                        email: editingUserId ? f.email : loginEmailFromUsername(username),
                        credentialsLocked: true,
                      }));
                    }}
                  />
                  <span className="sys-cred-domain">@{LOGIN_DOMAIN}</span>
                  <button type="button" className="btn btn-secondary btn-sm" title="Regenerar usuario" onClick={regenerateUsername}>
                    <RefreshCw size={14} /> Regenerar
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" title="Copiar usuario" onClick={() => copyText(userForm.username, 'Usuario')}>
                    <Copy size={14} />
                  </button>
                </div>
                <p className="sys-help" style={{ margin: '0.35rem 0 0' }}>
                  Login: <code>{userForm.email || `…@${LOGIN_DOMAIN}`}</code>
                  {userForm.credentialsLocked ? ' · editado manualmente' : ' · se actualiza con nombre/DNI'}
                </p>
              </Field>
              <Field label="Contraseña" className="sys-user-span2">
                <div className="sys-cred-row">
                  <input
                    className="form-input"
                    required={!editingUserId}
                    minLength={editingUserId ? undefined : 6}
                    autoComplete="new-password"
                    type={userForm.passwordVisible ? 'text' : 'password'}
                    value={userForm.password}
                    onChange={(e) => setUF('password', e.target.value)}
                    placeholder={editingUserId ? 'Dejar vacío para no cambiar' : ''}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title={userForm.passwordVisible ? 'Ocultar' : 'Mostrar'}
                    onClick={() => setUF('passwordVisible', !userForm.passwordVisible)}
                  >
                    {userForm.passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" title="Regenerar contraseña" onClick={regeneratePassword}>
                    <RefreshCw size={14} /> Regenerar
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title="Copiar contraseña"
                    disabled={!userForm.password}
                    onClick={() => copyText(userForm.password, 'Contraseña')}
                  >
                    <Copy size={14} />
                  </button>
                </div>
                {editingUserId ? (
                  <p className="sys-help" style={{ margin: '0.35rem 0 0' }}>
                    Solo se actualiza la clave si escribís una nueva o usás Regenerar.
                  </p>
                ) : null}
              </Field>
              <Field label="Roles" className="sys-user-span2">
                <div className="sys-role-pick">
                  <p className="sys-help" style={{ margin: 0 }}>Sistema (acceso). Podés marcar varios a la vez.</p>
                  <div className="sys-role-chips">
                    {ROLE_OPTIONS.map((r) => {
                      const on = roleChipsSelected(userForm.roles, r);
                      return (
                        <button
                          key={r}
                          type="button"
                          className={`sys-role-chip${on ? ' is-on' : ''}`}
                          onClick={() => setUF('roles', toggleRoleInList(userForm.roles, {
                            roleKey: r,
                            label: ROLE_LABELS[r] || r,
                            kind: 'system',
                          }))}
                        >
                          {ROLE_LABELS[r] || r}
                        </button>
                      );
                    })}
                  </div>
                  <p className="sys-help" style={{ margin: '0.55rem 0 0' }}>Cargos / figuras del club (también acumulables).</p>
                  <div className="sys-role-chips">
                    {TITLE_ROLE_OPTIONS.map((t) => {
                      const on = roleChipsSelected(userForm.roles, t.key);
                      return (
                        <button
                          key={t.key}
                          type="button"
                          className={`sys-role-chip is-title${on ? ' is-on' : ''}`}
                          onClick={() => setUF('roles', toggleRoleInList(userForm.roles, {
                            roleKey: t.key,
                            label: t.label,
                            kind: 'title',
                          }))}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Field>
            </div>

            <div className="sys-user-section">
              <div className="sys-user-section-head">
                <h4>Autorizaciones</h4>
                <div className="sys-admin-card-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAuthorization('admin')}>+ Administrador</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAuthorization('gate')}>+ Operador portería</button>
                </div>
              </div>
              {userForm.authorizations.length === 0 ? (
                <p className="ops-muted" style={{ margin: 0 }}>Sin autorizaciones adicionales.</p>
              ) : (
                <ul className="sys-authz-list">
                  {userForm.authorizations.map((auth, idx) => (
                    <li key={`${auth.kind}-${idx}`} className="sys-authz-card">
                      <header>
                        <strong>{auth.title}</strong>
                        <button type="button" className="sys-danger-btn" onClick={() => removeAuthorization(idx)}>
                          Eliminar
                        </button>
                      </header>
                      <Field label="Fecha de vencimiento">
                        <input
                          className="form-input"
                          type="date"
                          value={auth.expiresAt || ''}
                          onChange={(e) => updateAuthorization(idx, { expiresAt: e.target.value })}
                        />
                      </Field>
                      <p className="sys-help">
                        Si no indica fecha de vencimiento, la autorización tendrá vigencia indefinida.
                      </p>
                      {auth.kind === 'admin' ? (
                        <Field label="Rol">
                          <select
                            className="form-input"
                            value={auth.roleLabel || 'Superadministrador'}
                            onChange={(e) => updateAuthorization(idx, { roleLabel: e.target.value })}
                          >
                            <option>Superadministrador</option>
                            <option>Administrador</option>
                          </select>
                        </Field>
                      ) : (
                        <>
                          <Field label="PIN">
                            <input
                              className="form-input"
                              value={auth.pin || ''}
                              maxLength={8}
                              onChange={(e) => updateAuthorization(idx, { pin: e.target.value })}
                              placeholder="1234"
                            />
                          </Field>
                          <p className="sys-help">
                            Se recomienda usar como PIN los últimos 4 dígitos del documento.
                          </p>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="sys-user-section">
              <div className="sys-user-section-head">
                <h4>Números de identificación</h4>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addIdentifier}>
                  <Plus size={14} /> Agregar
                </button>
              </div>
              {userForm.identifiers.length === 0 ? (
                <p className="ops-muted" style={{ margin: 0 }}>Sin identificadores.</p>
              ) : (
                <div className="sys-id-table">
                  <div className="sys-id-head">
                    <span>Tipo</span>
                    <span>Identificador</span>
                    <span>Acciones</span>
                  </div>
                  {userForm.identifiers.map((row, idx) => (
                    <div className="sys-id-row" key={`id-${idx}`}>
                      <input
                        className="form-input"
                        placeholder="Tipo"
                        value={row.idType}
                        onChange={(e) => updateIdentifier(idx, { idType: e.target.value })}
                      />
                      <input
                        className="form-input"
                        placeholder="Identificador"
                        value={row.identifier}
                        onChange={(e) => updateIdentifier(idx, { identifier: e.target.value })}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeIdentifier(idx)} aria-label="Quitar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sys-user-form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingUser}>
                {savingUser
                  ? (editingUserId ? 'Guardando…' : 'Creando…')
                  : (editingUserId ? 'Actualizar' : 'Crear usuario')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeUserForm}
              >
                Cancelar
              </button>
            </div>
            </form>
          </ModalDialog>
        )}

        {loadingUsers ? (
          <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} /> Cargando perfiles…
          </p>
        ) : usersError ? (
          <p className="ops-muted" style={{ color: '#fca5a5' }}>{usersError}</p>
        ) : adminProfiles.length === 0 ? (
          <p className="ops-muted">Todavía no hay administradores del sistema.</p>
        ) : filteredProfiles.length === 0 ? (
          <p className="ops-muted">
            Ningún usuario coincide con «{userQuery.trim()}».
          </p>
        ) : (
          <div className="sys-admin-table-wrap">
            {userQuery.trim() ? (
              <p className="sys-user-search-count">
                Encontrados {filteredProfiles.length} de {adminProfiles.length}
              </p>
            ) : null}
            <table className="admin-table sys-admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Acceso</th>
                  <th>Roles</th>
                  <th>Estado</th>
                  <th>Funciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((p) => (
                  <tr key={p.id}>
                    <td className="sys-user-id-cell">{profileListId(p)}</td>
                    <td>
                      <div className="sys-user-row-name">
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" className="sys-user-row-avatar" />
                        ) : (
                          <span className="sys-user-row-avatar is-empty">
                            <UserRound size={14} strokeWidth={1.75} />
                          </span>
                        )}
                        <button
                          type="button"
                          className="sys-user-name-btn"
                          onClick={() => navigate(`/panel/system/${p.id}`)}
                          title="Ver perfil"
                        >
                          <div className="sys-user-name-doc">
                            <strong>{displayName(p)}</strong>
                            <span>
                              {p.documentNumber
                                ? `${p.documentType || 'Arg-DNI'} ${p.documentNumber}`
                                : 'Sin documento'}
                            </span>
                          </div>
                        </button>
                      </div>
                    </td>
                    <td className="sys-user-access-cell">
                      <span title={p.contactEmail || p.email || ''}>{p.contactEmail || p.email || '—'}</span>
                      <code title={p.email || profileUsername(p)}>{profileUsername(p)}</code>
                    </td>
                    <td>
                      <RolesCell profile={p} onOpenAll={setRolesModalProfile} />
                    </td>
                    <td>
                      <span className={`sys-admin-pill${p.isActive ? ' is-on' : ''}`}>
                        {p.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <RowActionsMenu
                        profile={p}
                        open={openActionsId === p.id}
                        busy={busyId === p.id}
                        canEdit={canEditProfiles}
                        onToggle={() => setOpenActionsId((id) => (id === p.id ? null : p.id))}
                        onClose={closeRowActions}
                        onEdit={openEditUser}
                        onHistory={openHistory}
                        onToggleActive={toggleActive}
                        onResetPassword={resetExistingPassword}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyProfileId && (
          <ModalDialog
            open={Boolean(historyProfileId)}
            onClose={closeHistory}
            labelledBy="sys-trace-modal-title"
            contentClassName="modal-content glass-panel"
            contentStyle={{
              width: 'min(640px, 96vw)',
              maxWidth: 640,
              maxHeight: 'min(88vh, 100%)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glass)',
              padding: 0,
            }}
          >
            <div className="modal-header">
              <div>
                <h4 id="sys-trace-modal-title" className="serif-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-gold)' }}>
                  Trazabilidad
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Historial de cambios · {historyProfileName}
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeHistory}>
                <X size={14} /> Cerrar
              </button>
            </div>
            <div className="sys-trace-modal-body">
              {historyLoading ? (
                <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Loader2 size={14} /> Cargando trazas…
                </p>
              ) : historyRows.length === 0 ? (
                <p className="ops-muted">Sin cambios registrados todavía para este usuario.</p>
              ) : (
                <ol className="sys-trace-timeline">
                  {historyRows.map((row) => (
                    <li key={row.id}>
                      <div className="sys-trace-dot" aria-hidden="true" />
                      <div className="sys-trace-card">
                        <header>
                          <strong>{formatAuditAction(row.action)}</strong>
                          <time dateTime={row.createdAt || undefined}>
                            {row.createdAt ? new Date(row.createdAt).toLocaleString('es-AR') : '—'}
                          </time>
                        </header>
                        <p className="sys-trace-summary">{formatAuditSummary(row)}</p>
                        <p className="sys-trace-actor">
                          Por <span>{row.actorName || 'Sistema'}</span>
                        </p>
                        <details className="sys-trace-raw">
                          <summary>Detalle técnico</summary>
                          <pre>{JSON.stringify(row.payload, null, 2)}</pre>
                        </details>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </ModalDialog>
        )}

        {rolesModalProfile && (
          <ModalDialog
            open={Boolean(rolesModalProfile)}
            onClose={() => setRolesModalProfile(null)}
            labelledBy="sys-roles-modal-title"
            contentClassName="modal-content glass-panel"
            contentStyle={{
              width: 'min(520px, 94vw)',
              maxWidth: 520,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-glass)',
              padding: 0,
            }}
          >
            <div className="modal-header">
              <div>
                <h4 id="sys-roles-modal-title" className="serif-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-gold)' }}>
                  Roles de {displayName(rolesModalProfile)}
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Todos los roles asignados y los que se pueden sumar.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRolesModalProfile(null)}>
                <X size={14} /> Cerrar
              </button>
            </div>
            <div className="sys-roles-modal-body">
              <p className="sys-roles-modal-label">Asignados</p>
              <ul className="sys-roles-assigned">
                {sortProfileRoles(rolesModalProfile.roles, rolesModalProfile.role).map((r) => (
                  <li
                    key={`${rolesModalProfile.id}-${r.roleKey}-${r.publicId || ''}`}
                    className={`sys-role-row${r.kind === 'title' ? ' is-title' : ' is-primary'}`}
                  >
                    {r.publicId ? <span className="sys-role-id">#{r.publicId}</span> : null}
                    <span className="sys-role-label">{r.label || ROLE_LABELS[r.roleKey] || r.roleKey}</span>
                  </li>
                ))}
              </ul>
              <p className="sys-roles-modal-label">Acceso al sistema</p>
              <div className="sys-role-pick-grid">
                {ROLE_OPTIONS.map((r) => {
                  const on = roleChipsSelected(
                    rolesModalProfile.roles?.length ? rolesModalProfile.roles : [{ roleKey: rolesModalProfile.role }],
                    r
                  );
                  return (
                    <button
                      key={r}
                      type="button"
                      className={`sys-role-pick-btn${on ? ' is-on' : ''}`}
                      disabled={busyId === rolesModalProfile.id}
                      onClick={() => {
                        const base = rolesModalProfile.roles?.length
                          ? rolesModalProfile.roles
                          : [{ roleKey: rolesModalProfile.role, label: ROLE_LABELS[rolesModalProfile.role] || rolesModalProfile.role, kind: 'system' }];
                        updateRoles(rolesModalProfile.id, toggleRoleInList(base, {
                          roleKey: r,
                          label: ROLE_LABELS[r] || r,
                          kind: 'system',
                        }));
                      }}
                    >
                      <span>{ROLE_LABELS[r] || r}</span>
                      {on ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </div>
              <p className="sys-roles-modal-label">Cargos / figuras</p>
              <div className="sys-role-pick-grid">
                {TITLE_ROLE_OPTIONS.map((t) => {
                  const on = roleChipsSelected(rolesModalProfile.roles || [], t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className={`sys-role-pick-btn is-title${on ? ' is-on' : ''}`}
                      disabled={busyId === rolesModalProfile.id}
                      onClick={() => {
                        const base = rolesModalProfile.roles?.length
                          ? rolesModalProfile.roles
                          : [{ roleKey: rolesModalProfile.role, label: ROLE_LABELS[rolesModalProfile.role] || rolesModalProfile.role, kind: 'system' }];
                        updateRoles(rolesModalProfile.id, toggleRoleInList(base, {
                          roleKey: t.key,
                          label: t.label,
                          kind: 'title',
                        }));
                      }}
                    >
                      <span>{t.label}</span>
                      {on ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </ModalDialog>
        )}
      </section>
    </div>
  );
}
