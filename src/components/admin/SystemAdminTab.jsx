import { useEffect, useMemo, useState } from 'react';
import {
  Settings, UserRound, UserPlus, Plus, Check, X, Loader2, Shield,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import { ROLE_LABELS } from '../../domain/auth/roles';

const ROLE_OPTIONS = ['member', 'staff', 'cashier', 'accountant', 'admin'];

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

/**
 * Administración del sistema: usuarios del portal y solicitudes de alta de socio.
 */
export default function SystemAdminTab({
  membershipApplications = [],
  setMembershipApplications,
  registeredUsersCount = 0,
  setRegisteredUsersCount,
}) {
  const [profiles, setProfiles] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState('');
  const [appFilter, setAppFilter] = useState('pending');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyAppForm);
  const [savingApp, setSavingApp] = useState(false);

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
    const t = setTimeout(() => setFlash(''), 3200);
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

  const updateRole = async (profileId, role) => {
    setBusyId(profileId);
    try {
      const saved = await repos.updateProfile(profileId, { role });
      setProfiles((prev) => prev.map((p) => (p.id === profileId ? saved : p)));
      setFlash('Rol actualizado.');
    } catch (err) {
      setFlash(err.message || 'No se pudo cambiar el rol.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (profile) => {
    setBusyId(profile.id);
    try {
      const saved = await repos.updateProfile(profile.id, { isActive: !profile.isActive });
      setProfiles((prev) => prev.map((p) => (p.id === profile.id ? saved : p)));
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
    if (!form.fullName.trim()) return;
    setSavingApp(true);
    try {
      const saved = await repos.upsertMembershipApplication({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        documentNumber: form.documentNumber.trim(),
        notes: form.notes.trim(),
        requestedTier: form.requestedTier.trim(),
        status: 'pending',
      });
      setMembershipApplications?.((prev) => [saved, ...(Array.isArray(prev) ? prev : [])]);
      setForm(emptyAppForm());
      setShowForm(false);
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
            <Settings size={14} aria-hidden="true" /> Sistema
          </p>
          <h2 className="serif-font" style={{ margin: '0.15rem 0 0.35rem', fontSize: '1.45rem' }}>
            Administración del sistema
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 520 }}>
            Usuarios del portal y solicitudes de ingreso al padrón. Todo persiste en la base de datos.
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
        </header>
        {loadingUsers ? (
          <p className="ops-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} /> Cargando perfiles…
          </p>
        ) : usersError ? (
          <p className="ops-muted" style={{ color: '#fca5a5' }}>{usersError}</p>
        ) : profiles.length === 0 ? (
          <p className="ops-muted">Todavía no hay usuarios en `profiles`.</p>
        ) : (
          <div className="sys-admin-table-wrap">
            <table className="admin-table sys-admin-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <td>{p.fullName || '—'}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.email || '—'}</td>
                    <td>
                      <select
                        className="form-input"
                        style={{ minWidth: 130, padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        value={p.role}
                        disabled={busyId === p.id}
                        onChange={(e) => updateRole(p.id, e.target.value)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                        ))}
                        {!ROLE_OPTIONS.includes(p.role) && (
                          <option value={p.role}>{ROLE_LABELS[p.role] || p.role}</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <span className={`sys-admin-pill${p.isActive ? ' is-on' : ''}`}>
                        {p.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyId === p.id}
                        onClick={() => toggleActive(p)}
                      >
                        {p.isActive ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
              <Plus size={14} /> Nueva
            </button>
          </div>
        </header>

        {showForm && (
          <form className="sys-admin-form" onSubmit={createApp}>
            <div className="sys-admin-form-grid">
              <label>
                Nombre completo
                <input
                  className="form-input"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label>
                Teléfono
                <input
                  className="form-input"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              <label>
                Documento
                <input
                  className="form-input"
                  value={form.documentNumber}
                  onChange={(e) => setForm((f) => ({ ...f, documentNumber: e.target.value }))}
                />
              </label>
              <label>
                Categoría solicitada
                <input
                  className="form-input"
                  placeholder="Gold, Platinum…"
                  value={form.requestedTier}
                  onChange={(e) => setForm((f) => ({ ...f, requestedTier: e.target.value }))}
                />
              </label>
              <label className="sys-admin-form-span">
                Notas
                <input
                  className="form-input"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingApp}>
                {savingApp ? 'Guardando…' : 'Registrar solicitud'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {filteredApps.length === 0 ? (
          <p className="ops-muted" style={{ marginTop: showForm ? '1rem' : 0 }}>
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
