import { useEffect, useMemo, useState } from 'react';
import {
  GraduationCap, Plus, RefreshCw, Copy, Eye, EyeOff, Loader2, X, Check, Pencil,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import {
  ROLE_LABELS,
  canManageTeachers,
  hasRoleInList,
} from '../../domain/auth/roles';
import {
  buildCredentials,
  generatePassword,
  loginEmailFromUsername,
  LOGIN_DOMAIN,
} from '../../domain/auth/credentials';
import { useAuth } from '../../context/AuthContext';
import ModalDialog from '../ModalDialog';

function isTeacherProfile(profile) {
  if (!profile) return false;
  if (String(profile.role || '').toLowerCase() === 'teacher') return true;
  return hasRoleInList(profile.roles || [], 'teacher');
}

function emptyTeacherForm() {
  const creds = buildCredentials();
  return {
    firstName: '',
    lastName: '',
    phone: '',
    username: creds.username,
    password: creds.password,
    passwordVisible: true,
    disciplineIds: [],
  };
}

export default function TeachersTab({
  userRole,
  disciplineCatalog = [],
}) {
  const { user } = useAuth();
  const sessionRoles = user?.roles?.length ? user.roles : [userRole];
  const canEdit = canManageTeachers(sessionRoles);

  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyTeacherForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [lastCreds, setLastCreds] = useState(null);

  const activeDisciplines = useMemo(
    () => (disciplineCatalog || []).filter((d) => d.isActive !== false),
    [disciplineCatalog]
  );

  const disciplineName = (id) =>
    activeDisciplines.find((d) => d.id === id)?.name || id;

  const reload = async () => {
    if (!isSupabaseConfigured) {
      setTeachers([]);
      setError('Supabase no configurado: el alta de profesores requiere la nube.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await repos.listProfiles();
      setTeachers(list.filter(isTeacherProfile));
      setError('');
    } catch (err) {
      setError(err.message || 'No se pudieron cargar profesores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) => {
      const hay = [
        t.fullName,
        t.firstName,
        t.lastName,
        t.email,
        t.username,
        t.phone,
        ...(t.disciplineIds || []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [teachers, query]);

  const openCreate = () => {
    if (!canEdit) {
      setFlash('No tenés permiso para dar de alta profesores.');
      return;
    }
    setEditingId(null);
    setForm(emptyTeacherForm());
    setFormOpen(true);
  };

  const openEdit = (teacher) => {
    if (!canEdit) return;
    setEditingId(teacher.id);
    setForm({
      firstName: teacher.firstName || '',
      lastName: teacher.lastName || '',
      phone: teacher.phone || '',
      username: teacher.username || String(teacher.email || '').split('@')[0] || '',
      password: '',
      passwordVisible: false,
      disciplineIds: Array.isArray(teacher.disciplineIds) ? [...teacher.disciplineIds] : [],
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyTeacherForm());
  };

  const setF = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleDiscipline = (id) => {
    setForm((prev) => {
      const has = prev.disciplineIds.includes(id);
      return {
        ...prev,
        disciplineIds: has
          ? prev.disciplineIds.filter((x) => x !== id)
          : [...prev.disciplineIds, id],
      };
    });
  };

  const regeneratePassword = () => {
    setF('password', generatePassword());
    setF('passwordVisible', true);
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setFlash('Copiado al portapapeles.');
    } catch {
      setFlash('No se pudo copiar.');
    }
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canEdit) return;

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const username = String(form.username || '').trim().toLowerCase();
    const password = String(form.password || '');
    const email = loginEmailFromUsername(username);

    if (!firstName || !lastName) {
      setFlash('Nombre y apellido son obligatorios.');
      return;
    }
    if (!username) {
      setFlash('El usuario de acceso es obligatorio.');
      return;
    }
    if (!editingId && password.length < 6) {
      setFlash('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (editingId && password && password.length < 6) {
      setFlash('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (!form.disciplineIds.length) {
      setFlash('Elegí al menos una disciplina.');
      return;
    }

    setSaving(true);
    try {
      const roles = [{ roleKey: 'teacher', label: ROLE_LABELS.teacher, kind: 'system' }];
      if (editingId) {
        let saved = await repos.updateProfile(editingId, {
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          phone: form.phone.trim(),
          username,
          role: 'teacher',
          disciplineIds: form.disciplineIds,
        });
        saved = await repos.replaceProfileRoles(editingId, roles);
        if (password) {
          await repos.resetPortalUserPassword(editingId, password);
          setLastCreds({ username, email: saved.email || email, password });
        }
        await reload();
        closeForm();
        setFlash(password ? 'Profesor actualizado y contraseña regenerada.' : 'Profesor actualizado.');
      } else {
        const created = await repos.createPortalUser({
          firstName,
          lastName,
          email,
          username,
          password,
          phone: form.phone.trim(),
          role: 'teacher',
          roles,
          disciplineIds: form.disciplineIds,
        });
        // Asegurar disciplinas por si la edge vieja no las persistió
        if (created?.id) {
          await repos.updateProfile(created.id, { disciplineIds: form.disciplineIds }).catch(() => null);
        }
        setLastCreds({ username, email, password });
        await reload();
        closeForm();
        setFlash(`Profesor creado. Login: ${email}`);
      }
    } catch (err) {
      setFlash(err.message || 'No se pudo guardar el profesor.');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (teacher) => {
    if (!canEdit) return;
    const password = generatePassword();
    setBusyId(teacher.id);
    try {
      await repos.resetPortalUserPassword(teacher.id, password);
      const username = teacher.username || String(teacher.email || '').split('@')[0];
      setLastCreds({
        username,
        email: teacher.email || loginEmailFromUsername(username),
        password,
      });
      setFlash('Contraseña regenerada. Copiála ahora; no se vuelve a mostrar.');
    } catch (err) {
      setFlash(err.message || 'No se pudo regenerar la contraseña.');
    } finally {
      setBusyId('');
    }
  };

  const toggleActive = async (teacher) => {
    if (!canEdit) return;
    setBusyId(teacher.id);
    try {
      await repos.updateProfile(teacher.id, { isActive: !teacher.isActive });
      await reload();
      setFlash(teacher.isActive ? 'Profesor desactivado.' : 'Profesor reactivado.');
    } catch (err) {
      setFlash(err.message || 'No se pudo cambiar el estado.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="fade-in" style={{ display: 'grid', gap: '1rem' }}>
      <header className="glass-card" style={{ padding: '1.1rem 1.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <GraduationCap size={22} color="var(--primary-gold)" aria-hidden="true" />
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Profesores</h2>
            <p className="ops-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.82rem' }}>
              Alta de acceso al portal, disciplinas y contraseñas
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload} disabled={loading}>
            <RefreshCw size={14} /> Actualizar
          </button>
          {canEdit ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              <Plus size={14} /> Nuevo profesor
            </button>
          ) : null}
        </div>
      </header>

      {flash ? (
        <p className="conc-ok" role="status" style={{ margin: 0 }}>{flash}</p>
      ) : null}
      {error ? (
        <p className="conc-error" role="alert" style={{ margin: 0 }}>{error}</p>
      ) : null}

      {lastCreds ? (
        <article className="glass-card" style={{ padding: '1rem 1.15rem', borderColor: 'color-mix(in srgb, var(--emerald-accent) 35%, var(--border-glass))' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.65rem' }}>
            <strong>Credenciales de acceso</strong>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLastCreds(null)} aria-label="Cerrar">
              <X size={14} />
            </button>
          </header>
          <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.88rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="ops-muted">Usuario</span>
              <code>{lastCreds.username}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText(lastCreds.username)}><Copy size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="ops-muted">Email</span>
              <code>{lastCreds.email}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText(lastCreds.email)}><Copy size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="ops-muted">Contraseña</span>
              <code>{lastCreds.password}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText(lastCreds.password)}><Copy size={13} /></button>
            </div>
            <p className="ops-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              Dominio de login: @{LOGIN_DOMAIN}. Guardá la clave ahora; después no se puede ver.
            </p>
          </div>
        </article>
      ) : null}

      <div className="glass-card" style={{ padding: '0.85rem 1rem' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, usuario o disciplina…"
          aria-label="Buscar profesores"
          style={{ width: '100%', maxWidth: 420 }}
        />
      </div>

      {loading ? (
        <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Loader2 size={16} className="spin" /> Cargando profesores…
        </p>
      ) : filtered.length === 0 ? (
        <article className="glass-card" style={{ padding: '1.25rem' }}>
          <p style={{ margin: 0 }}>Todavía no hay profesores cargados.</p>
          {canEdit ? (
            <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: '0.85rem' }} onClick={openCreate}>
              <Plus size={14} /> Dar de alta el primero
            </button>
          ) : null}
        </article>
      ) : (
        <div className="glass-card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Profesor</th>
                <th>Acceso</th>
                <th>Disciplinas</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.fullName || `${t.lastName || ''} ${t.firstName || ''}`.trim() || '—'}</strong>
                    {t.phone ? <div className="ops-muted" style={{ fontSize: '0.75rem' }}>{t.phone}</div> : null}
                  </td>
                  <td>
                    <code style={{ fontSize: '0.78rem' }}>{t.username || t.email}</code>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {(t.disciplineIds || []).length
                        ? t.disciplineIds.map((id) => (
                          <span key={id} className="chip" style={{ fontSize: '0.72rem' }}>{disciplineName(id)}</span>
                        ))
                        : <span className="ops-muted">Sin asignar</span>}
                    </div>
                  </td>
                  <td>
                    <span style={{ color: t.isActive === false ? 'var(--danger-accent)' : 'var(--emerald-accent)', fontWeight: 700, fontSize: '0.78rem' }}>
                      {t.isActive === false ? 'Inactivo' : 'Activo'}
                    </span>
                  </td>
                  <td>
                    {canEdit ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(t)} disabled={busyId === t.id}>
                          <Pencil size={13} /> Editar
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => resetPassword(t)} disabled={busyId === t.id}>
                          {busyId === t.id ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                          Clave
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleActive(t)} disabled={busyId === t.id}>
                          {t.isActive === false ? 'Activar' : 'Baja'}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalDialog
        open={formOpen}
        onClose={closeForm}
        labelledBy="teacher-form-title"
        contentStyle={{ maxWidth: 560, width: '100%' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.85rem' }}>
          <h3 id="teacher-form-title" style={{ margin: 0 }}>
            {editingId ? 'Editar profesor' : 'Nuevo profesor'}
          </h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={closeForm} aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'grid', gap: '0.85rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label>
              Nombre
              <input value={form.firstName} onChange={(e) => setF('firstName', e.target.value)} required />
            </label>
            <label>
              Apellido
              <input value={form.lastName} onChange={(e) => setF('lastName', e.target.value)} required />
            </label>
          </div>
          <label>
            Teléfono
            <input value={form.phone} onChange={(e) => setF('phone', e.target.value)} />
          </label>
          <label>
            Usuario de acceso
            <input
              value={form.username}
              onChange={(e) => setF('username', e.target.value)}
              required
              autoComplete="off"
            />
            <small className="ops-muted">Login: {loginEmailFromUsername(form.username || 'usuario')}</small>
          </label>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
              <label htmlFor="teacher-password" style={{ margin: 0 }}>
                {editingId ? 'Nueva contraseña (opcional)' : 'Contraseña'}
              </label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={regeneratePassword}>
                <RefreshCw size={13} /> Generar
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
              <input
                id="teacher-password"
                type={form.passwordVisible ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setF('password', e.target.value)}
                required={!editingId}
                autoComplete="new-password"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setF('passwordVisible', !form.passwordVisible)}
                aria-label={form.passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {form.passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <fieldset style={{ border: '1px solid var(--border-glass)', borderRadius: 10, padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.35rem', fontSize: '0.82rem', fontWeight: 700 }}>Disciplinas</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              {activeDisciplines.map((d) => {
                const active = form.disciplineIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`chip${active ? ' is-active' : ''}`}
                    onClick={() => toggleDiscipline(d.id)}
                    style={{
                      border: `1px solid ${active ? (d.color || 'var(--primary-gold)') : 'var(--border-glass)'}`,
                      background: active ? `color-mix(in srgb, ${d.color || 'var(--primary-gold)'} 22%, transparent)` : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {active ? <Check size={12} /> : null} {d.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : null}
              {editingId ? 'Guardar' : 'Crear profesor'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
