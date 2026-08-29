import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, User, Shield, IdCard, Phone, Mail, MapPin, Heart,
  KeyRound, BadgeCheck, History, Loader2, Camera,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import { ROLE_LABELS } from '../../domain/auth/roles';
import { LOGIN_DOMAIN, usernameFromEmail } from '../../domain/auth/credentials';

const SECTIONS = [
  { id: 'ficha', label: 'Ficha', icon: User },
  { id: 'contacto', label: 'Contacto', icon: Phone },
  { id: 'emergencia', label: 'Emergencia', icon: Heart },
  { id: 'acceso', label: 'Acceso', icon: KeyRound },
  { id: 'autorizaciones', label: 'Autorizaciones', icon: BadgeCheck },
  { id: 'ids', label: 'Identificadores', icon: IdCard },
  { id: 'historial', label: 'Historial', icon: History },
];

function displayName(profile) {
  const last = String(profile?.lastName || '').trim();
  const first = String(profile?.firstName || '').trim();
  if (last || first) return [last, first].filter(Boolean).join(' ');
  return profile?.fullName || '—';
}

function Field({ label, value, icon: Icon }) {
  return (
    <div className="pup-field">
      <div className="pup-field-label">
        {Icon ? <Icon size={12} aria-hidden="true" /> : null}
        <span>{label}</span>
      </div>
      <div className="pup-field-value">{value || '—'}</div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="pup-empty">{text}</p>;
}

function formatAuditAction(action) {
  const map = {
    'profile.change': 'Cambio de ficha',
    'profile.create': 'Alta de perfil',
    'profile.update': 'Actualización',
    'profile.reset_password': 'Contraseña regenerada',
    'profile_role.grant': 'Rol otorgado',
    'profile_role.revoke': 'Rol revocado',
    'profile_role.update': 'Rol actualizado',
  };
  return map[action] || action;
}

/** Perfil completo de un usuario del portal (Administración → Usuarios). */
export default function PortalUserProfilePanel({ profileId, onBack, onEdit }) {
  const [section, setSection] = useState('ficha');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured) {
        setLoading(false);
        setError('Supabase no configurado.');
        return;
      }
      setLoading(true);
      try {
        const row = await repos.getProfile(profileId);
        if (!cancelled) {
          setProfile(row);
          setError(row ? '' : 'Usuario no encontrado.');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'No se pudo cargar el perfil');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (section !== 'historial' || !profileId || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const rows = await repos.listProfileAudit(profileId, { limit: 80 });
        if (!cancelled) setHistoryRows(rows);
      } catch {
        if (!cancelled) setHistoryRows([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section, profileId]);

  const username = useMemo(() => {
    if (!profile) return '—';
    return profile.username || usernameFromEmail(profile.email) || '—';
  }, [profile]);

  const roles = useMemo(() => {
    if (!profile) return [];
    return profile.roles?.length
      ? profile.roles
      : [{ roleKey: profile.role, label: ROLE_LABELS[profile.role] || profile.role, kind: 'system' }];
  }, [profile]);

  if (loading) {
    return (
      <div className="glass-card fade-in pup-profile" style={{ padding: '1.5rem' }}>
        <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <Loader2 size={16} /> Cargando perfil…
        </p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="glass-card fade-in pup-profile" style={{ padding: '1.5rem' }}>
        <Empty text={error || 'Usuario no encontrado.'} />
        <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginTop: '1rem' }}>
          Volver a Usuarios
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card fade-in pup-profile">
      <header className="pup-hero">
        <div className="pup-hero-main">
          <button type="button" className="btn btn-secondary btn-sm pup-back" onClick={onBack}>
            <ArrowLeft size={14} /> Usuarios
          </button>
          <div className="pup-identity">
            <div className="pup-avatar">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" />
              ) : (
                <Camera size={22} strokeWidth={1.5} />
              )}
            </div>
            <div className="pup-identity-copy">
              <p className="pup-kicker">Usuario del portal</p>
              <h3 className="serif-font pup-name">{displayName(profile)}</h3>
              <div className="pup-meta-row">
                <span className="pup-cred">
                  {profile.documentNumber
                    ? `${profile.documentType || 'Arg-DNI'} ${profile.documentNumber}`
                    : 'Sin documento'}
                </span>
                <span className={`sys-admin-pill${profile.isActive ? ' is-on' : ''}`}>
                  {profile.isActive ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="pup-hero-side">
          <div className="pup-role-stack">
            {roles.map((r) => (
              <span key={`${r.roleKey}-${r.publicId || ''}`} className={`sys-role-chip is-static${r.kind === 'title' ? ' is-title' : ''}`}>
                {r.publicId ? `#${r.publicId} · ` : ''}{r.label || ROLE_LABELS[r.roleKey] || r.roleKey}
              </span>
            ))}
          </div>
          {onEdit ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onEdit(profile)}>
              Editar ficha
            </button>
          ) : null}
        </div>
      </header>

      <nav className="pup-nav" aria-label="Secciones del perfil">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`pup-nav-btn${active ? ' is-active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <Icon size={14} /> {s.label}
            </button>
          );
        })}
      </nav>

      <div className="pup-body">
        {section === 'ficha' && (
          <div className="pup-grid">
            <Field label="Nombre" value={profile.firstName} />
            <Field label="Apellido" value={profile.lastName} />
            <Field label="Documento" value={profile.documentNumber ? `${profile.documentType || 'Arg-DNI'} ${profile.documentNumber}` : null} icon={IdCard} />
            <Field label="Género" value={profile.gender} />
            <Field label="Fecha de nacimiento" value={profile.birthDate} />
            <Field label="Prisma" value={profile.prismaId} />
            <Field
              label="Grupo familiar"
              value={profile.meta?.familyGroupLabel || (profile.meta?.familyGroup === false ? 'No' : null)}
            />
            <Field label="Alta en sistema" value={profile.createdAt ? new Date(profile.createdAt).toLocaleString('es-AR') : null} />
          </div>
        )}

        {section === 'contacto' && (
          <div className="pup-grid">
            <Field label="Domicilio" value={profile.address} icon={MapPin} />
            <Field label="Teléfono" value={profile.phone} icon={Phone} />
            <Field label="Email de contacto" value={profile.contactEmail} icon={Mail} />
            <Field label="Email de login" value={profile.email} icon={Mail} />
          </div>
        )}

        {section === 'emergencia' && (
          <div className="pup-grid">
            <Field label="Grupo sanguíneo" value={profile.bloodType} icon={Heart} />
            <Field label="Obra social" value={profile.healthInsurance} />
            <Field label="Número de emergencia" value={profile.emergencyPhone} icon={Phone} />
            <Field label="Clínica de emergencia" value={profile.emergencyClinic} />
          </div>
        )}

        {section === 'acceso' && (
          <div className="pup-grid">
            <Field label="Usuario" value={username} icon={KeyRound} />
            <Field label="Login" value={profile.email || `${username}@${LOGIN_DOMAIN}`} />
            <Field label="Rol primario" value={ROLE_LABELS[profile.role] || profile.role} icon={Shield} />
            <div className="pup-field pup-field-span">
              <div className="pup-field-label"><Shield size={12} /> Roles asignados</div>
              <div className="sys-role-chips" style={{ marginTop: 6 }}>
                {roles.map((r) => (
                  <span key={`acc-${r.roleKey}-${r.publicId || ''}`} className={`sys-role-chip is-static${r.kind === 'title' ? ' is-title' : ''}`}>
                    {r.publicId ? `#${r.publicId} · ` : ''}{r.label || ROLE_LABELS[r.roleKey] || r.roleKey}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 'autorizaciones' && (
          (profile.authorizations || []).length === 0 ? (
            <Empty text="Sin autorizaciones adicionales." />
          ) : (
            <ul className="pup-list">
              {(profile.authorizations || []).map((a) => (
                <li key={a.id || `${a.kind}-${a.title}`}>
                  <strong>{a.title || a.kind}</strong>
                  <span>
                    {[
                      a.roleLabel,
                      a.expiresAt ? `Vence ${a.expiresAt}` : 'Vigencia indefinida',
                      a.pin ? `PIN ${a.pin}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {section === 'ids' && (
          (profile.identifiers || []).length === 0 ? (
            <Empty text="Sin números de identificación cargados." />
          ) : (
            <div className="sys-id-table">
              <div className="sys-id-head">
                <span>Tipo</span>
                <span>Identificador</span>
              </div>
              {(profile.identifiers || []).map((row) => (
                <div className="sys-id-row" key={row.id || `${row.idType}-${row.identifier}`}>
                  <span>{row.idType}</span>
                  <span>{row.identifier}</span>
                </div>
              ))}
            </div>
          )
        )}

        {section === 'historial' && (
          historyLoading ? (
            <p className="ops-muted">Cargando trazas…</p>
          ) : historyRows.length === 0 ? (
            <Empty text="Sin cambios registrados todavía." />
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
          )
        )}
      </div>
    </div>
  );
}
