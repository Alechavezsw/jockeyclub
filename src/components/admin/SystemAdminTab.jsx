import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings, UserRound, UserPlus, Plus, Check, X, Loader2, Shield, Camera, Trash2,
  RefreshCw, Copy, Eye, EyeOff, Pencil,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import { uploadProfilePhoto } from '../../data/storage';
import { ROLE_LABELS, PORTAL_ROLE_OPTIONS, TITLE_ROLE_OPTIONS, canManageProfiles, primaryRoleFromList } from '../../domain/auth/roles';
import {
  buildCredentials,
  generatePassword,
  generateUsername,
  loginEmailFromUsername,
  LOGIN_DOMAIN,
  usernameFromEmail,
} from '../../domain/auth/credentials';
import { useAuth } from '../../context/AuthContext';
const ROLE_OPTIONS = PORTAL_ROLE_OPTIONS;

const DOC_TYPES = ['Arg-DNI', 'Pasaporte', 'CUIL', 'Otro'];
const GENDERS = ['Masculino', 'Femenino', 'Otro', 'Prefiero no decir'];
const BLOOD_TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const AUTHZ_BADGE_LIMIT = 3;

const STATUS_LABEL = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  withdrawn: 'Retirada',
};

const emptyAppForm = () => ({
  fullName: '',
  email: '',
  phone: '',
  documentNumber: '',
  notes: '',
  requestedTier: '',
});

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
    roles: [{ roleKey: 'member', label: 'Socio', kind: 'system' }],
    prismaId: '',
    authorizations: [],
    identifiers: [],
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
    'profile.update': 'Actualización',
    'profile.reset_password': 'Contraseña regenerada',
  };
  return map[action] || action;
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

function authzCode(auth) {
  const kind = String(auth.kind || '').toLowerCase();
  if (kind === 'admin') return 'A';
  if (kind === 'gate_operator' || kind === 'gate') {
    return auth.expiresAt ? `O (VENC: ${auth.expiresAt})` : 'O';
  }
  if (kind === 'admin_employee' || kind === 'employee_admin') return 'EA';
  if (kind === 'hr') return 'RRHH';
  const title = String(auth.title || auth.roleLabel || kind || '?');
  return title.slice(0, 2).toUpperCase();
}

function identifierCode(row) {
  const type = String(row.idType || '').toUpperCase();
  const id = String(row.identifier || '').trim();
  if (!id) return null;
  if (type.includes('ST') || type.includes('TITULAR') || type.includes('SOCIO')) {
    return `ST (${id})`;
  }
  if (type.includes('EA') || type.includes('EMPLE')) return `EA (${id})`;
  const short = type.replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'ID';
  return `${short} (${id})`;
}

function profileAuthzBadges(profile) {
  const fromAuth = (profile.authorizations || []).map((a) => ({
    key: `a-${a.id || a.kind}-${a.title}`,
    code: authzCode(a),
    title: a.title || a.roleLabel || a.kind,
  }));
  const fromIds = (profile.identifiers || [])
    .map((row) => {
      const code = identifierCode(row);
      if (!code) return null;
      return { key: `i-${row.id || row.idType}-${row.identifier}`, code, title: row.idType };
    })
    .filter(Boolean);
  return [...fromAuth, ...fromIds];
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`sys-user-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function AuthzBadges({ profile }) {
  const [expanded, setExpanded] = useState(false);
  const badges = profileAuthzBadges(profile);
  if (!badges.length) {
    return <span className="ops-muted">—</span>;
  }
  const visible = expanded ? badges : badges.slice(0, AUTHZ_BADGE_LIMIT);
  const hidden = badges.length - AUTHZ_BADGE_LIMIT;
  return (
    <div className="sys-authz-badges">
      {visible.map((b) => (
        <span key={b.key} className="sys-authz-badge" title={b.title}>
          {b.code}
        </span>
      ))}
      {!expanded && hidden > 0 ? (
        <button type="button" className="sys-authz-more" onClick={() => setExpanded(true)}>
          VER +
        </button>
      ) : null}
      {expanded && badges.length > AUTHZ_BADGE_LIMIT ? (
        <button type="button" className="sys-authz-more" onClick={() => setExpanded(false)}>
          VER −
        </button>
      ) : null}
    </div>
  );
}

/**
 * Administración del sistema: usuarios del portal y solicitudes de alta de socio.
 */
export default function SystemAdminTab({
  membershipApplications = [],
  setMembershipApplications,
  registeredUsersCount = 0,
  setRegisteredUsersCount,
  userRole = 'admin',
}) {
  const { roles: sessionRoles } = useAuth();
  const canEditProfiles = canManageProfiles(sessionRoles?.length ? sessionRoles : userRole);
  const [profiles, setProfiles] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState('');
  const [appFilter, setAppFilter] = useState('pending');
  const [historyProfileId, setHistoryProfileId] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showAppForm, setShowAppForm] = useState(false);
  const [appForm, setAppForm] = useState(emptyAppForm);
  const [savingApp, setSavingApp] = useState(false);

  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [savingUser, setSavingUser] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lastCreatedCreds, setLastCreatedCreds] = useState(null);
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
        const list = await repos.listProfiles();
        if (!cancelled) {
          setProfiles(list);
          setRegisteredUsersCount?.(list.length);
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

  const pendingCount = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending').length,
    [membershipApplications]
  );

  const filteredApps = useMemo(() => {
    const list = membershipApplications || [];
    if (appFilter === 'all') return list;
    return list.filter((a) => a.status === appFilter);
  }, [membershipApplications, appFilter]);

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

  const openNewUser = () => {
    if (!canEditProfiles) {
      setFlash('Solo el superadministrador puede crear o modificar perfiles.');
      return;
    }
    setUserForm(emptyUserForm());
    setShowUserForm(true);
  };

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const uploaded = await uploadProfilePhoto(file, { profileId: 'new' });
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
    if (password.length < 6) {
      setFlash('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setSavingUser(true);
    try {
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
        prismaId: userForm.prismaId.trim(),
        role: primaryRoleFromList(userForm.roles),
        roles: userForm.roles,
        authorizations: userForm.authorizations,
        identifiers: userForm.identifiers.filter((i) => i.idType && i.identifier),
      });
      setProfiles((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      setRegisteredUsersCount?.((n) => Number(n || 0) + 1);
      setLastCreatedCreds({ username, email, password });
      setUserForm(emptyUserForm());
      setShowUserForm(false);
      setFlash(`Usuario creado. Login: ${email}`);
    } catch (err) {
      setFlash(err.message || 'No se pudo crear el usuario.');
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
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, ...saved } : p)));
      setFlash('Roles actualizados (cambio registrado).');
    } catch (err) {
      setFlash(err.message || 'No se pudieron actualizar los roles.');
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (profileId) => {
    setHistoryProfileId(profileId);
    setHistoryLoading(true);
    try {
      const rows = await repos.listProfileAudit(profileId);
      setHistoryRows(rows);
    } catch (err) {
      setFlash(err.message || 'No se pudo cargar el historial.');
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
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

  const reviewApp = async (app, status) => {
    setBusyId(app.id);
    try {
      const saved = await repos.upsertMembershipApplication({
        ...app,
        status,
        reviewedAt: new Date().toISOString(),
      });
      setMembershipApplications?.((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = list.findIndex((x) => x.id === saved.id);
        if (idx < 0) return [saved, ...list];
        const next = [...list];
        next[idx] = saved;
        return next;
      });
      setFlash(status === 'approved' ? 'Solicitud aprobada.' : 'Solicitud rechazada.');
    } catch (err) {
      setFlash(err.message || 'No se pudo actualizar la solicitud.');
    } finally {
      setBusyId(null);
    }
  };

  const createApp = async (e) => {
    e.preventDefault();
    if (!appForm.fullName.trim()) return;
    setSavingApp(true);
    try {
      const saved = await repos.upsertMembershipApplication({
        fullName: appForm.fullName.trim(),
        email: appForm.email.trim(),
        phone: appForm.phone.trim(),
        documentNumber: appForm.documentNumber.trim(),
        notes: appForm.notes.trim(),
        requestedTier: appForm.requestedTier.trim(),
        status: 'pending',
      });
      setMembershipApplications?.((prev) => [saved, ...(Array.isArray(prev) ? prev : [])]);
      setAppForm(emptyAppForm());
      setShowAppForm(false);
      setAppFilter('pending');
      setFlash('Solicitud registrada en la base de datos.');
    } catch (err) {
      setFlash(err.message || 'No se pudo crear la solicitud.');
    } finally {
      setSavingApp(false);
    }
  };

  return (
    <div className="fade-in sys-admin">
      <header className="sys-admin-head">
        <div>
          <p className="sys-admin-eyebrow">
            <Settings size={14} aria-hidden="true" /> Administración
          </p>
          <h2 className="serif-font" style={{ margin: '0.15rem 0 0.35rem', fontSize: '1.45rem' }}>
            Usuarios y altas
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 520 }}>
            Alta de usuarios del portal con ficha completa. Todo persiste en la base de datos.
          </p>
        </div>
        <div className="sys-admin-kpis">
          <div>
            <b>{registeredUsersCount || profiles.length}</b>
            <span>Usuarios</span>
          </div>
          <div>
            <b>{pendingCount}</b>
            <span>Solicitudes</span>
          </div>
        </div>
      </header>

      {flash && (
        <p className="sys-admin-flash" role="status">{flash}</p>
      )}

      <section className="glass-card sys-admin-card">
        <header className="sys-admin-card-head">
          <UserRound size={16} color="var(--primary-gold)" />
          <h3>Usuarios registrados</h3>
          <div className="sys-admin-card-actions">
            {canEditProfiles ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openNewUser}>
                <Plus size={14} /> Agregar usuario
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
          <form className="sys-user-form" onSubmit={submitUser}>
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
              <Field label="Nombre">
                <input
                  className="form-input"
                  required
                  value={userForm.firstName}
                  onChange={(e) => refreshUsernameFromIdentity({ firstName: e.target.value })}
                />
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
                        email: loginEmailFromUsername(username),
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
                    required
                    minLength={6}
                    autoComplete="new-password"
                    type={userForm.passwordVisible ? 'text' : 'password'}
                    value={userForm.password}
                    onChange={(e) => setUF('password', e.target.value)}
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
                  <button type="button" className="btn btn-secondary btn-sm" title="Copiar contraseña" onClick={() => copyText(userForm.password, 'Contraseña')}>
                    <Copy size={14} />
                  </button>
                </div>
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
                <h4>Débitos automáticos</h4>
              </div>
              <Field label="Prisma">
                <input
                  className="form-input"
                  value={userForm.prismaId}
                  onChange={(e) => setUF('prismaId', e.target.value)}
                  placeholder="Identificador PRISMA"
                />
              </Field>
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
                {savingUser ? 'Creando…' : 'Crear usuario'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setShowUserForm(false); setUserForm(emptyUserForm()); }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {loadingUsers ? (
          <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} /> Cargando perfiles…
          </p>
        ) : usersError ? (
          <p className="ops-muted" style={{ color: '#fca5a5' }}>{usersError}</p>
        ) : profiles.length === 0 ? (
          <p className="ops-muted">Todavía no hay usuarios en profiles.</p>
        ) : (
          <div className="sys-admin-table-wrap">
            <table className="admin-table sys-admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre / Documento</th>
                  <th>Email</th>
                  <th>Usuario</th>
                  <th>Autorizaciones</th>
                  <th>Roles</th>
                  <th>Estado</th>
                  <th>Funciones</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
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
                        <div className="sys-user-name-doc">
                          <strong>{displayName(p)}</strong>
                          <span>
                            {p.documentNumber
                              ? `${p.documentType || 'Arg-DNI'} ${p.documentNumber}`
                              : 'Sin documento'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="sys-user-email-cell">
                      <span>{p.contactEmail || p.email || '—'}</span>
                      {p.contactEmail && p.email && p.contactEmail !== p.email ? (
                        <small>Login: {p.email}</small>
                      ) : null}
                    </td>
                    <td className="sys-user-login-cell">
                      <code>{profileUsername(p)}</code>
                    </td>
                    <td>
                      <AuthzBadges profile={p} />
                    </td>
                    <td>
                      <div className="sys-role-chips is-compact">
                        {(p.roles?.length ? p.roles : [{ roleKey: p.role, label: ROLE_LABELS[p.role] || p.role }]).map((r) => (
                          <span key={`${p.id}-${r.roleKey}`} className={`sys-role-chip is-static${r.kind === 'title' ? ' is-title' : ''}`}>
                            {r.publicId ? `#${r.publicId} · ` : ''}{r.label || ROLE_LABELS[r.roleKey] || r.roleKey}
                          </span>
                        ))}
                      </div>
                      {canEditProfiles && (
                        <details className="sys-role-edit">
                          <summary>Editar roles</summary>
                          <div className="sys-role-chips">
                            {ROLE_OPTIONS.map((r) => {
                              const on = roleChipsSelected(p.roles?.length ? p.roles : [{ roleKey: p.role }], r);
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  className={`sys-role-chip${on ? ' is-on' : ''}`}
                                  disabled={busyId === p.id}
                                  onClick={() => {
                                    const base = p.roles?.length ? p.roles : [{ roleKey: p.role, label: ROLE_LABELS[p.role] || p.role, kind: 'system' }];
                                    updateRoles(p.id, toggleRoleInList(base, {
                                      roleKey: r,
                                      label: ROLE_LABELS[r] || r,
                                      kind: 'system',
                                    }));
                                  }}
                                >
                                  {ROLE_LABELS[r] || r}
                                </button>
                              );
                            })}
                          </div>
                          <div className="sys-role-chips" style={{ marginTop: 6 }}>
                            {TITLE_ROLE_OPTIONS.map((t) => {
                              const on = roleChipsSelected(p.roles || [], t.key);
                              return (
                                <button
                                  key={t.key}
                                  type="button"
                                  className={`sys-role-chip is-title${on ? ' is-on' : ''}`}
                                  disabled={busyId === p.id}
                                  onClick={() => {
                                    const base = p.roles?.length ? p.roles : [{ roleKey: p.role, label: ROLE_LABELS[p.role] || p.role, kind: 'system' }];
                                    updateRoles(p.id, toggleRoleInList(base, {
                                      roleKey: t.key,
                                      label: t.label,
                                      kind: 'title',
                                    }));
                                  }}
                                >
                                  {t.label}
                                </button>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </td>
                    <td>
                      <span className={`sys-admin-pill${p.isActive ? ' is-on' : ''}`}>
                        {p.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <div className="sys-admin-app-actions sys-user-functions">
                        <button
                          type="button"
                          className="sys-fn-btn"
                          title="Historial"
                          onClick={() => openHistory(p.id)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={!canEditProfiles || busyId === p.id}
                          onClick={() => toggleActive(p)}
                        >
                          {p.isActive ? 'Desactivar' : 'Activar'}
                        </button>
                        {canEditProfiles && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busyId === p.id}
                            title="Regenerar contraseña"
                            onClick={() => resetExistingPassword(p)}
                          >
                            <RefreshCw size={14} /> Clave
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyProfileId && (
          <div className="sys-history">
            <header className="sys-admin-card-head" style={{ marginTop: '1rem' }}>
              <Shield size={16} color="var(--primary-gold)" />
              <h3>Historial de cambios</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setHistoryProfileId(null); setHistoryRows([]); }}>
                Cerrar
              </button>
            </header>
            {historyLoading ? (
              <p className="ops-muted">Cargando trazas…</p>
            ) : historyRows.length === 0 ? (
              <p className="ops-muted">Sin cambios registrados todavía.</p>
            ) : (
              <ul className="sys-history-list">
                {historyRows.map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{formatAuditAction(row.action)}</strong>
                      <span className="ops-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                        {row.createdAt ? new Date(row.createdAt).toLocaleString('es-AR') : '—'}
                      </span>
                    </div>
                    <pre className="sys-history-payload">{JSON.stringify(row.payload, null, 2)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="glass-card sys-admin-card">
        <header className="sys-admin-card-head">
          <UserPlus size={16} color="var(--primary-gold)" />
          <h3>Solicitudes de socio</h3>
          <div className="sys-admin-card-actions">
            <select
              className="form-input"
              style={{ width: 'auto', padding: '0.35rem 0.55rem', fontSize: '0.8rem' }}
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            >
              <option value="pending">Pendientes</option>
              <option value="approved">Aprobadas</option>
              <option value="rejected">Rechazadas</option>
              <option value="all">Todas</option>
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAppForm((v) => !v)}>
              <Plus size={14} /> Nueva
            </button>
          </div>
        </header>

        {showAppForm && (
          <form className="sys-admin-form" onSubmit={createApp}>
            <div className="sys-admin-form-grid">
              <label>
                Nombre completo
                <input
                  className="form-input"
                  required
                  value={appForm.fullName}
                  onChange={(e) => setAppForm((f) => ({ ...f, fullName: e.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  className="form-input"
                  type="email"
                  value={appForm.email}
                  onChange={(e) => setAppForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label>
                Teléfono
                <input
                  className="form-input"
                  value={appForm.phone}
                  onChange={(e) => setAppForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              <label>
                Documento
                <input
                  className="form-input"
                  value={appForm.documentNumber}
                  onChange={(e) => setAppForm((f) => ({ ...f, documentNumber: e.target.value }))}
                />
              </label>
              <label>
                Categoría solicitada
                <input
                  className="form-input"
                  placeholder="Gold, Platinum…"
                  value={appForm.requestedTier}
                  onChange={(e) => setAppForm((f) => ({ ...f, requestedTier: e.target.value }))}
                />
              </label>
              <label className="sys-admin-form-span">
                Notas
                <input
                  className="form-input"
                  value={appForm.notes}
                  onChange={(e) => setAppForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingApp}>
                {savingApp ? 'Guardando…' : 'Registrar solicitud'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAppForm(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {filteredApps.length === 0 ? (
          <p className="ops-muted" style={{ marginTop: showAppForm ? '1rem' : 0 }}>
            No hay solicitudes {appFilter === 'all' ? '' : STATUS_LABEL[appFilter]?.toLowerCase() || ''} en la base.
          </p>
        ) : (
          <ul className="sys-admin-app-list">
            {filteredApps.map((app) => (
              <li key={app.id}>
                <div>
                  <strong>{app.fullName}</strong>
                  <span className="ops-muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                    {[app.email, app.phone, app.documentNumber].filter(Boolean).join(' · ') || 'Sin contacto'}
                    {app.requestedTier ? ` · ${app.requestedTier}` : ''}
                  </span>
                  {app.notes && (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {app.notes}
                    </span>
                  )}
                </div>
                <div className="sys-admin-app-meta">
                  <span className={`sys-admin-pill${app.status === 'pending' ? ' is-warn' : app.status === 'approved' ? ' is-on' : ''}`}>
                    <Shield size={11} /> {STATUS_LABEL[app.status] || app.status}
                  </span>
                  {app.status === 'pending' && (
                    <div className="sys-admin-app-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyId === app.id}
                        onClick={() => reviewApp(app, 'approved')}
                        title="Aprobar"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyId === app.id}
                        onClick={() => reviewApp(app, 'rejected')}
                        title="Rechazar"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
