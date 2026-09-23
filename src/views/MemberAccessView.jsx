import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { getActiveTiers, getTierOptionLabel } from '../domain/members/tiers';
import {
  ACCESS_REASONS,
  emptyJoinConflicts,
  hasJoinIdentityConflict,
  joinConflictMessage,
  joinFieldConflictHint,
  JoinIdentityTakenError,
} from '../domain/members/selfService';
import { repos } from '../data/bootstrap';
import { isSupabaseConfigured } from '../lib/supabase';

const TABS = [
  { id: 'alta', label: 'Quiero asociarme' },
  { id: 'acceso', label: 'Ya soy socio' },
];

const JOIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptyAccessForm() {
  return {
    fullName: '',
    documentNumber: '',
    memberNumber: '',
    phone: '+549264',
    email: '',
    reason: 'first_access',
    linkedMemberId: '',
  };
}

function emptyJoinForm() {
  return {
    fullName: '',
    documentType: 'DNI',
    documentNumber: '',
    email: '',
    phone: '+549264',
    birthDate: '',
    address: '',
    city: 'San Juan',
    province: 'San Juan',
    requestedTier: '',
    notes: '',
  };
}

export default function MemberAccessView() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tramite') === 'acceso' ? 'acceso' : 'alta';
  const [accessForm, setAccessForm] = useState(emptyAccessForm);
  const [joinForm, setJoinForm] = useState(emptyJoinForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [accessHits, setAccessHits] = useState([]);
  const [showSearchHint, setShowSearchHint] = useState(false);
  const [accessPicked, setAccessPicked] = useState(null);
  const [joinConflicts, setJoinConflicts] = useState(emptyJoinConflicts);
  const tiers = useMemo(() => getActiveTiers(), []);
  const joining = tab === 'alta';

  const setTab = (id) => {
    setDone(false);
    setError('');
    setAccessHits([]);
    setShowSearchHint(false);
    setAccessPicked(null);
    setJoinConflicts(emptyJoinConflicts());
    setParams(id === 'acceso' ? { tramite: 'acceso' } : { tramite: 'alta' }, { replace: true });
  };

  useEffect(() => {
    if (joining || accessPicked || done) {
      setAccessHits([]);
      setShowSearchHint(false);
      return undefined;
    }
    const raw = String(accessForm.fullName || '').trim();
    const digits = raw.replace(/\D/g, '');
    const enough = raw.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setAccessHits([]);
      setShowSearchHint(false);
      return undefined;
    }
    const cached = repos.peekMembersDirectory(raw, { limit: 8 });
    if (cached) {
      setAccessHits(cached);
      setShowSearchHint(false);
      return undefined;
    }
    let cancelled = false;
    const hintTimer = window.setTimeout(() => {
      if (!cancelled) setShowSearchHint(true);
    }, 280);
    const timer = window.setTimeout(() => {
      repos.searchMembersDirectory(raw, { limit: 8 })
        .then((rows) => {
          if (!cancelled) setAccessHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setAccessHits([]);
        })
        .finally(() => {
          if (!cancelled) setShowSearchHint(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(hintTimer);
    };
  }, [accessForm.fullName, joining, accessPicked, done]);

  useEffect(() => {
    if (!joining || done) return undefined;
    const fullName = String(joinForm.fullName || '').trim();
    const documentNumber = String(joinForm.documentNumber || '').replace(/\D/g, '');
    const phone = String(joinForm.phone || '').trim();
    const enough = fullName.length >= 5 || documentNumber.length >= 6 || phone.replace(/\D/g, '').length >= 8;
    if (!enough || !isSupabaseConfigured) {
      setJoinConflicts(emptyJoinConflicts());
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      repos.checkJoinIdentityTaken({ fullName, documentNumber, phone })
        .then((taken) => {
          if (!cancelled) setJoinConflicts(taken);
        })
        .catch(() => {
          if (!cancelled) setJoinConflicts(emptyJoinConflicts());
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [joining, done, joinForm.fullName, joinForm.documentNumber, joinForm.phone]);

  const pickAccessMember = (hit) => {
    if (!hit) return;
    setAccessHits([]);
    setShowSearchHint(false);
    setAccessPicked({ id: hit.id, memberId: hit.memberId, name: hit.name });
    setAccessForm((prev) => ({
      ...prev,
      fullName: hit.name || prev.fullName,
      documentNumber: String(hit.documentNumber || '').replace(/\D/g, '') || prev.documentNumber,
      memberNumber: hit.memberId || prev.memberNumber,
      email: hit.email || prev.email,
      phone: hit.phone || prev.phone,
      linkedMemberId: hit.id,
    }));
    const hydrate = hit.memberId
      ? repos.getMemberByNumber(hit.memberId)
      : repos.getMember(hit.id);
    hydrate.then((full) => {
      if (!full) return;
      setAccessForm((prev) => (
        prev.linkedMemberId !== full.id
          ? prev
          : {
            ...prev,
            fullName: full.name || prev.fullName,
            documentNumber: String(full.documentNumber || '').replace(/\D/g, '') || prev.documentNumber,
            memberNumber: full.memberId || prev.memberNumber,
            email: full.email || prev.email,
            phone: full.phone || prev.phone,
          }
      ));
    }).catch(() => {});
  };

  const submitAccess = async (e) => {
    e.preventDefault();
    setError('');
    if (!accessForm.fullName.trim() || !accessForm.documentNumber.trim() || !accessForm.phone.trim()) {
      setError('Completá nombre, DNI y celular.');
      return;
    }
    setSubmitting(true);
    try {
      await repos.submitPortalAccessRequest({
        fullName: accessForm.fullName.trim(),
        documentNumber: accessForm.documentNumber.trim(),
        memberNumber: accessForm.memberNumber.trim(),
        phone: accessForm.phone.trim(),
        email: accessForm.email.trim(),
        reason: accessForm.reason,
        memberDbId: accessForm.linkedMemberId || null,
      });
      setDone(true);
    } catch {
      setError('No se pudo enviar el pedido. Intentá de nuevo o acercate a secretaría.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitJoin = async (e) => {
    e.preventDefault();
    setError('');
    if (!joinForm.fullName.trim() || !joinForm.documentNumber.trim() || !joinForm.phone.trim() || !joinForm.email.trim()) {
      setError('Completá nombre, documento, celular y email.');
      return;
    }
    if (!JOIN_EMAIL_RE.test(joinForm.email.trim())) {
      setError('Ingresá un email válido. Ahí te llega la bienvenida.');
      return;
    }
    setSubmitting(true);
    try {
      const taken = await repos.checkJoinIdentityTaken({
        fullName: joinForm.fullName.trim(),
        documentNumber: joinForm.documentNumber.trim(),
        phone: joinForm.phone.trim(),
      });
      if (hasJoinIdentityConflict(taken)) {
        setJoinConflicts(taken);
        setError(joinConflictMessage(taken));
        return;
      }
      await repos.submitMembershipApplication({
        fullName: joinForm.fullName.trim(),
        documentType: joinForm.documentType,
        documentNumber: joinForm.documentNumber.trim(),
        email: joinForm.email.trim(),
        phone: joinForm.phone.trim(),
        birthDate: joinForm.birthDate || null,
        address: joinForm.address.trim(),
        city: joinForm.city.trim(),
        province: joinForm.province.trim(),
        requestedTier: joinForm.requestedTier || null,
        notes: joinForm.notes.trim(),
      });
      setDone(true);
    } catch (err) {
      if (err instanceof JoinIdentityTakenError) {
        setJoinConflicts(err.conflicts);
        setError(err.message);
        return;
      }
      setError('No se pudo enviar la solicitud. Intentá de nuevo o acercate a secretaría.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="join-page">
      <header className="join-hero">
        <img
          src="/logo-jockey-club.png?v=clavos-blancos"
          alt="Jockey Club San Juan"
          className="club-mark join-hero__logo"
          width={112}
          height={112}
        />
        <p className="join-hero__eyebrow">Sede Rivadavia · San Juan</p>
        <h1 className="join-hero__title">
          {joining ? 'Quiero asociarme' : 'Ya soy socio'}
        </h1>
        <p className="join-hero__lead">
          {joining
            ? 'Dejá tu solicitud. Te mandamos un mail de bienvenida. El usuario llega cuando secretaría te dé de alta.'
            : 'Pedí tu usuario. Secretaría verifica tu ficha y te entrega el acceso.'}
        </p>
      </header>

      <section className="join-card" aria-labelledby="join-card-title">
        <div className="join-tabs" role="tablist" aria-label="Tipo de trámite">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'is-on' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {done ? (
          <div className="join-done" role="status">
            <CheckCircle2 size={34} aria-hidden="true" />
            <h2 id="join-card-title">Pedido recibido</h2>
            <p>
              {joining
                ? 'Te mandamos un mail de bienvenida. Secretaría revisa tu solicitud y, cuando te den de alta, te llega otro mail con usuario y contraseña.'
                : 'Secretaría va a revisar los datos y te va a contactar. No te damos usuario ni contraseña por acá.'}
            </p>
            <button
              type="button"
              className="join-submit join-submit--ghost"
              onClick={() => {
                setDone(false);
                setAccessForm(emptyAccessForm());
                setJoinForm(emptyJoinForm());
                setAccessPicked(null);
                setAccessHits([]);
                setJoinConflicts(emptyJoinConflicts());
              }}
            >
              Cargar otro trámite
            </button>
          </div>
        ) : joining ? (
          <form onSubmit={submitJoin} className="join-form">
            <h2 id="join-card-title" className="join-form__title">Solicitud de ingreso</h2>

            <label className={`join-field${joinConflicts.fullName ? ' is-taken' : ''}`}>
              <span>Nombre y apellido *</span>
              <input
                required
                autoComplete="name"
                aria-invalid={joinConflicts.fullName}
                value={joinForm.fullName}
                onChange={(e) => setJoinForm((p) => ({ ...p, fullName: e.target.value }))}
              />
              {joinConflicts.fullName ? (
                <p className="join-field-error">{joinFieldConflictHint('fullName')} Si ya sos socio, pedí acceso.</p>
              ) : null}
            </label>

            <div className="join-grid">
              <label className="join-field">
                <span>Documento</span>
                <select
                  value={joinForm.documentType}
                  onChange={(e) => setJoinForm((p) => ({ ...p, documentType: e.target.value }))}
                >
                  <option value="DNI">DNI</option>
                  <option value="Pasaporte">Pasaporte</option>
                  <option value="CUIT">CUIT</option>
                  <option value="Otro">Otro</option>
                </select>
              </label>
              <label className={`join-field${joinConflicts.documentNumber ? ' is-taken' : ''}`}>
                <span>N° documento *</span>
                <input
                  required
                  inputMode="numeric"
                  placeholder="Sin puntos"
                  aria-invalid={joinConflicts.documentNumber}
                  value={joinForm.documentNumber}
                  onChange={(e) => setJoinForm((p) => ({ ...p, documentNumber: e.target.value }))}
                />
                {joinConflicts.documentNumber ? (
                  <p className="join-field-error">{joinFieldConflictHint('documentNumber')} Si ya sos socio, pedí acceso.</p>
                ) : null}
              </label>
            </div>

            <label className={`join-field${joinConflicts.phone ? ' is-taken' : ''}`}>
              <span>Celular WhatsApp *</span>
              <input
                required
                type="tel"
                autoComplete="tel"
                aria-invalid={joinConflicts.phone}
                value={joinForm.phone}
                onChange={(e) => setJoinForm((p) => ({ ...p, phone: e.target.value }))}
              />
              {joinConflicts.phone ? (
                <p className="join-field-error">{joinFieldConflictHint('phone')} Si ya sos socio, pedí acceso.</p>
              ) : null}
            </label>

            <label className="join-field">
              <span>Email *</span>
              <input
                required
                type="email"
                autoComplete="email"
                inputMode="email"
                value={joinForm.email}
                onChange={(e) => setJoinForm((p) => ({ ...p, email: e.target.value }))}
              />
              <p className="join-field-hint">Ahí te llega la bienvenida. El usuario y la contraseña van en un segundo mail, cuando te den de alta.</p>
            </label>

            <label className="join-field">
              <span>Fecha de nacimiento</span>
              <input
                type="date"
                lang="es-AR"
                value={joinForm.birthDate}
                onChange={(e) => setJoinForm((p) => ({ ...p, birthDate: e.target.value }))}
              />
            </label>

            <label className="join-field">
              <span>Domicilio</span>
              <input
                autoComplete="street-address"
                value={joinForm.address}
                onChange={(e) => setJoinForm((p) => ({ ...p, address: e.target.value }))}
              />
            </label>

            <div className="join-grid">
              <label className="join-field">
                <span>Ciudad</span>
                <input
                  value={joinForm.city}
                  onChange={(e) => setJoinForm((p) => ({ ...p, city: e.target.value }))}
                />
              </label>
              <label className="join-field">
                <span>Provincia</span>
                <input
                  value={joinForm.province}
                  onChange={(e) => setJoinForm((p) => ({ ...p, province: e.target.value }))}
                />
              </label>
            </div>

            <label className="join-field">
              <span>Categoría que te interesa</span>
              <select
                value={joinForm.requestedTier}
                onChange={(e) => setJoinForm((p) => ({ ...p, requestedTier: e.target.value }))}
              >
                <option value="">A definir con secretaría</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>{getTierOptionLabel(t.id, tiers)}</option>
                ))}
              </select>
            </label>

            <label className="join-field">
              <span>Comentario</span>
              <textarea
                rows={3}
                value={joinForm.notes}
                onChange={(e) => setJoinForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </label>

            {error ? <p className="join-error" role="alert">{error}</p> : null}
            {hasJoinIdentityConflict(joinConflicts) ? (
              <button type="button" className="join-submit join-submit--ghost" onClick={() => setTab('acceso')}>
                Ir a Ya soy socio
              </button>
            ) : null}
            <button
              type="submit"
              className="join-submit"
              disabled={submitting || hasJoinIdentityConflict(joinConflicts)}
            >
              {submitting ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitAccess} className="join-form">
            <h2 id="join-card-title" className="join-form__title">Acceso al portal</h2>

            <div className="join-field join-lookup">
              <span>Nombre y apellido *</span>
              <input
                required
                autoComplete="off"
                placeholder="Escribí para buscar tu ficha"
                value={accessForm.fullName}
                onChange={(e) => {
                  setAccessPicked(null);
                  setAccessForm((p) => ({
                    ...p,
                    fullName: e.target.value,
                    linkedMemberId: '',
                  }));
                }}
              />
              {showSearchHint ? <p className="join-lookup__hint">Buscando en el padrón…</p> : null}
              {accessPicked ? (
                <p className="join-lookup__picked">
                  Socio Nº {accessPicked.memberId || '—'}
                  {accessPicked.name ? ` · ${accessPicked.name}` : ''}
                  {' · el pedido llega a esa ficha'}
                </p>
              ) : null}
              {!accessPicked && accessHits.length > 0 ? (
                <ul className="join-lookup__list" role="listbox">
                  {accessHits.map((member) => (
                    <li key={member.id}>
                      <button type="button" onClick={() => pickAccessMember(member)}>
                        <strong>{member.name || 'Sin nombre'}</strong>
                        <span>
                          Nº {member.memberId || '—'}
                          {member.documentNumber ? ` · DNI ${member.documentNumber}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="join-grid">
              <label className="join-field">
                <span>DNI *</span>
                <input
                  required
                  inputMode="numeric"
                  placeholder="Sin puntos"
                  value={accessForm.documentNumber}
                  onChange={(e) => setAccessForm((p) => ({ ...p, documentNumber: e.target.value }))}
                />
              </label>
              <label className="join-field">
                <span>Nº de socio</span>
                <input
                  inputMode="numeric"
                  value={accessForm.memberNumber}
                  onChange={(e) => setAccessForm((p) => ({ ...p, memberNumber: e.target.value }))}
                />
              </label>
            </div>

            <label className="join-field">
              <span>Celular WhatsApp *</span>
              <input
                required
                type="tel"
                autoComplete="tel"
                value={accessForm.phone}
                onChange={(e) => setAccessForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </label>

            <label className="join-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={accessForm.email}
                onChange={(e) => setAccessForm((p) => ({ ...p, email: e.target.value }))}
              />
            </label>

            <label className="join-field">
              <span>Motivo</span>
              <select
                value={accessForm.reason}
                onChange={(e) => setAccessForm((p) => ({ ...p, reason: e.target.value }))}
              >
                {ACCESS_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>

            {error ? <p className="join-error" role="alert">{error}</p> : null}
            <button type="submit" className="join-submit" disabled={submitting}>
              {submitting ? 'Enviando…' : 'Enviar pedido'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
