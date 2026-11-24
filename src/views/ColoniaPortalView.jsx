import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Baby,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Wallet,
} from 'lucide-react';
import { repos } from '../data/bootstrap';
import { isSupabaseConfigured } from '../lib/supabase';
import { COLONIA_SEASON_2026_2027, COLONIA_MP_ENABLED } from '../domain/colonia/coloniaConstants';
import {
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
  inscriptionAmount,
  planAmountFor,
} from '../domain/colonia/coloniaTariffs';
import {
  buildPortalEnrollmentPayload,
  coloniaEnrollmentBalance,
  coloniaPortalHeroCopy,
  coloniaStatusLabel,
  portalEnabledPlans,
  validatePortalEnrollmentWizard,
} from '../domain/colonia/coloniaPortal';
import { todayISODateAR } from '../lib/arDate';

function money(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

const STEPS = [
  'Alumno',
  'Datos',
  'Responsable',
  'Emergencia',
  'Retiro',
  'Remera',
  'Actividad',
  'Plan',
  'Importes',
  'Confirmar',
];

const EMPTY_STUDENT = {
  fullName: '',
  documentNumber: '',
  birthDate: '',
  memberKind: 'socio',
  memberNumber: '',
  memberUuid: null,
  shirtSize: '',
};
const EMPTY_GUARDIAN = {
  fullName: '',
  documentNumber: '',
  relationship: 'Padre/Madre',
  phone: '',
  email: '',
  emergencyContact: '',
  authorizedPickup: '',
};

/**
 * Mi cuenta → Colonia. Autogestión del socio; backend colonia_* compartido.
 */
export default function ColoniaPortalView({
  member,
  household: householdProp = [],
  setCurrentView,
}) {
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState([]);
  const [tariffs, setTariffs] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [household, setHousehold] = useState(householdProp || []);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState('home'); // home | enroll | account
  const [step, setStep] = useState(1);
  const [student, setStudent] = useState(EMPTY_STUDENT);
  const [guardian, setGuardian] = useState(EMPTY_GUARDIAN);
  const [planKey, setPlanKey] = useState('cuota');
  const [busy, setBusy] = useState(false);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState(null);
  const [charges, setCharges] = useState([]);
  const [payments, setPayments] = useState([]);
  const [transferRef, setTransferRef] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  const season = seasons[0] || null;
  const seasonView = season
    ? {
      ...COLONIA_SEASON_2026_2027,
      ...season,
      enrollmentOpensOn: season.enrollment_opens_on,
      enrollmentClosesOn: season.enrollment_closes_on,
      activitiesStartOn: season.activities_start_on,
      ageMin: season.age_min,
      ageMax: season.age_max,
      promotionPeriodicity: season.promotion_periodicity,
      name: season.name,
    }
    : COLONIA_SEASON_2026_2027;

  const hero = useMemo(
    () => coloniaPortalHeroCopy(seasonView, tariffs),
    [seasonView, tariffs],
  );
  const plans = portalEnabledPlans(seasonView);
  const todayIso = todayISODateAR();

  const eligibleKids = useMemo(() => {
    return (household || []).filter((h) => {
      const birth = h.birthDate || h.birth_date;
      if (!birth) return true;
      const y = Number(String(birth).slice(0, 4));
      const age = (seasonView.activitiesStartOn || '2026-11-30').slice(0, 4) - y;
      return age >= (seasonView.ageMin || 3) && age <= (seasonView.ageMax || 15);
    });
  }, [household, seasonView]);

  useEffect(() => {
    if (!isSupabaseConfigured || !member?.id) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const seasonsRows = await repos.listColoniaSeasons();
        if (cancelled) return;
        setSeasons(seasonsRows || []);
        const sid = seasonsRows?.[0]?.id;
        const principal = String(member.memberId || member.member_number || '').replace(/\D/g, '');
        const householdPromise = principal && typeof repos.listHouseholdByPrincipal === 'function'
          ? repos.listHouseholdByPrincipal(principal).catch(() => householdProp || [])
          : Promise.resolve(householdProp || []);
        if (sid) {
          const [t, listed, house] = await Promise.all([
            repos.listColoniaTariffs(sid).catch(() => []),
            repos.coloniaListForMember(member.id),
            householdPromise,
          ]);
          if (cancelled) return;
          setTariffs(t || []);
          setEnrollments(listed?.enrollments || []);
          setHousehold(Array.isArray(house) ? house : []);
        } else {
          const house = await householdPromise;
          if (!cancelled) setHousehold(Array.isArray(house) ? house : []);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'No se pudo cargar Colonia.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [member?.id]);

  useEffect(() => {
    if (member) {
      setGuardian((g) => ({
        ...g,
        fullName: g.fullName || member.name || member.fullName || '',
        phone: g.phone || member.phone || '',
        email: g.email || member.email || '',
        documentNumber: g.documentNumber || member.documentNumber || '',
      }));
      setStudent((s) => ({
        ...s,
        memberKind: 'socio',
        memberNumber: s.memberNumber || '',
      }));
    }
  }, [member]);

  const wizardCheck = useMemo(
    () => validatePortalEnrollmentWizard({
      step,
      student,
      guardian,
      planKey,
      season: seasonView,
      todayIso,
      authorized: true,
    }),
    [step, student, guardian, planKey, seasonView, todayIso],
  );

  const quote = useMemo(() => {
    const kind = student.memberKind || 'socio';
    const tariffs = COLONIA_OFFICIAL_TARIFFS_2026_2027;
    const inscription = inscriptionAmount(tariffs);
    const plan = planAmountFor(tariffs, kind, planKey) || 0;
    return {
      inscription: Number(inscription) || 0,
      plan: Number(plan) || 0,
      total: (Number(inscription) || 0) + (Number(plan) || 0),
    };
  }, [student.memberKind, planKey]);

  async function refreshList() {
    if (!member?.id) return;
    const listed = await repos.coloniaListForMember(member.id);
    setEnrollments(listed?.enrollments || []);
  }

  async function submitEnrollment() {
    if (!season?.id || !member?.id) return;
    const check = validatePortalEnrollmentWizard({
      step: 10,
      student,
      guardian,
      planKey,
      season: seasonView,
      todayIso,
      authorized: true,
    });
    if (!check.ok) {
      setError(check.errors[0]?.message || 'Revisá el formulario.');
      return;
    }
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const idem = `portal:${member.id}:${check.identityKey}:${season.id}:${planKey}`;
      const payload = buildPortalEnrollmentPayload({
        seasonId: season.id,
        student,
        guardian,
        planKey,
        memberId: member.id,
        idempotencyKey: idem,
      });
      const res = await repos.coloniaSubmitPortalEnrollment(payload);
      setMsg(res?.duplicate
        ? 'Ya tenías esta solicitud. Mostramos el estado actual.'
        : 'Solicitud enviada. Administración la revisará (pendiente de validación).');
      await refreshList();
      setMode('home');
      setStep(1);
    } catch (err) {
      setError(err?.message || 'No se pudo enviar la solicitud.');
    } finally {
      setBusy(false);
    }
  }

  async function openAccount(enrollmentId) {
    setSelectedEnrollmentId(enrollmentId);
    setMode('account');
    setCharges([]);
    setPayments([]);
    try {
      const [c, p] = await Promise.all([
        repos.listColoniaCharges(enrollmentId),
        repos.listColoniaPayments(enrollmentId),
      ]);
      setCharges(c || []);
      setPayments(p || []);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la cuenta de Colonia.');
    }
  }

  async function reportTransfer() {
    if (!selectedEnrollmentId) return;
    setBusy(true);
    setError('');
    try {
      await repos.coloniaReportPortalTransfer({
        enrollmentId: selectedEnrollmentId,
        amount: Number(transferAmount),
        externalReference: transferRef,
        idempotencyKey: `tr:${selectedEnrollmentId}:${transferRef}`,
      });
      setMsg('Transferencia informada. Queda pendiente de verificación en administración.');
      setTransferRef('');
      setTransferAmount('');
      await openAccount(selectedEnrollmentId);
      await refreshList();
    } catch (err) {
      setError(err?.message || 'No se pudo informar la transferencia.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="fade-in account-view">
        <p role="status"><Loader2 className="spin" size={18} /> Cargando Colonia…</p>
      </div>
    );
  }

  return (
    <div className="fade-in account-view colonia-portal">
      <header className="account-header">
        <button type="button" className="btn btn-ghost" onClick={() => {
          if (mode !== 'home') {
            setMode('home');
            return;
          }
          setCurrentView?.('payments');
        }}
        >
          <ArrowLeft size={18} /> Volver
        </button>
        <h1>Colonia de Verano</h1>
      </header>

      {error ? <p className="alert alert-danger" role="alert">{error}</p> : null}
      {msg ? <p className="alert alert-ok" role="status">{msg}</p> : null}

      {mode === 'home' ? (
        <>
          <section className="colonia-hero">
            <h2>{hero.title}</h2>
            <p>{hero.enrollmentWindow}</p>
            <p>{hero.start}</p>
            <p>{hero.ages}</p>
            <p>{hero.schedule}</p>
            <p>{hero.activities}</p>
            <p>{hero.inscriptionNote}</p>
            <p className="muted">Tarifas para socios según configuración vigente. Cuota social y Colonia son cuentas separadas.</p>
          </section>

          <section>
            <h3>Mis inscripciones</h3>
            {!enrollments.length ? (
              <p className="muted">Todavía no hay solicitudes de Colonia a tu nombre.</p>
            ) : (
              <ul className="colonia-enroll-list">
                {enrollments.map((row) => {
                  const bal = coloniaEnrollmentBalance(row);
                  return (
                    <li key={row.id}>
                      <div>
                        <strong>{row.student_name}</strong>
                        <div className="muted">
                          {coloniaStatusLabel(row.status)} · Plan {row.plan_key} · Saldo {money(bal.balance)}
                        </div>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAccount(row.id)}>
                        <Wallet size={14} /> Cuenta
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="colonia-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setMode('enroll');
                setStep(1);
                setError('');
              }}
            >
              <Baby size={16} /> Inscribir hijo / integrante
            </button>
          </div>

          <section className="colonia-pay-info">
            <h3>Medios de pago</h3>
            <ul>
              <li>Efectivo en administración</li>
              <li>Transferencia bancaria (informás comprobante; acredita al verificar)</li>
              <li>POSNET presencial en caja</li>
              <li>
                Mercado Pago Colonia:
                {' '}
                {COLONIA_MP_ENABLED ? 'habilitado' : 'próximamente (aún no activo)'}
              </li>
            </ul>
          </section>
        </>
      ) : null}

      {mode === 'enroll' ? (
        <section className="colonia-wizard">
          <p className="muted">Paso {step} de {STEPS.length}: {STEPS[step - 1]}</p>

          {step === 1 ? (
            <div>
              <label>Integrantes elegibles del grupo familiar</label>
              <select
                value={student.memberUuid || ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const kid = eligibleKids.find((k) => String(k.id) === id);
                  if (!kid) {
                    setStudent({ ...EMPTY_STUDENT, memberKind: 'socio' });
                    return;
                  }
                  setStudent({
                    fullName: kid.name || kid.full_name || '',
                    documentNumber: kid.documentNumber || '',
                    birthDate: (kid.birthDate || kid.birth_date || '').slice(0, 10),
                    memberKind: 'socio',
                    memberNumber: String(kid.memberId || '').replace(/\D/g, ''),
                    memberUuid: kid.id,
                    shirtSize: '',
                  });
                }}
              >
                <option value="">Elegí un integrante…</option>
                {eligibleKids.map((k) => (
                  <option key={k.id || k.memberId} value={k.id}>{k.name || k.full_name}</option>
                ))}
              </select>
              <p className="muted">
                Si el niño no figura en el grupo, podés cargarlo abajo. No modifica el padrón social;
                Administración verificará el vínculo.
              </p>
              <label>Nombre completo</label>
              <input
                value={student.fullName}
                onChange={(e) => setStudent({ ...student, fullName: e.target.value, memberUuid: null })}
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <label>Fecha de nacimiento</label>
              <input type="date" value={student.birthDate} onChange={(e) => setStudent({ ...student, birthDate: e.target.value })} />
              <label>Documento</label>
              <input value={student.documentNumber} onChange={(e) => setStudent({ ...student, documentNumber: e.target.value })} />
              <label>Nº de socio (si aplica)</label>
              <input value={student.memberNumber} onChange={(e) => setStudent({ ...student, memberNumber: e.target.value })} />
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <label>Responsable legal</label>
              <input value={guardian.fullName} onChange={(e) => setGuardian({ ...guardian, fullName: e.target.value })} />
              <label>Parentesco</label>
              <input value={guardian.relationship} onChange={(e) => setGuardian({ ...guardian, relationship: e.target.value })} />
              <label>Teléfono</label>
              <input value={guardian.phone} onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })} />
              <label>Email</label>
              <input value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} />
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <label>Contacto de emergencia</label>
              <textarea
                value={guardian.emergencyContact}
                onChange={(e) => setGuardian({ ...guardian, emergencyContact: e.target.value })}
                rows={3}
              />
            </div>
          ) : null}

          {step === 5 ? (
            <div>
              <label>Personas autorizadas a retirarlo</label>
              <textarea
                value={guardian.authorizedPickup}
                onChange={(e) => setGuardian({ ...guardian, authorizedPickup: e.target.value })}
                rows={3}
              />
            </div>
          ) : null}

          {step === 6 ? (
            <div>
              <label>Talle de remera</label>
              <select value={student.shirtSize} onChange={(e) => setStudent({ ...student, shirtSize: e.target.value })}>
                <option value="">Elegí…</option>
                {['4', '6', '8', '10', '12', '14', '16', 'S', 'M', 'L'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          ) : null}

          {step === 7 ? (
            <div>
              <p>La actividad incluye natación y recreación. Excursiones y campamentos requieren autorización específica posterior (no se dan por otorgadas con este formulario).</p>
            </div>
          ) : null}

          {step === 8 ? (
            <div>
              <label>Modalidad comercial</label>
              <select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
                {plans.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <p className="muted">Promociones de hermanos sin periodicidad definida no se ofrecen online.</p>
            </div>
          ) : null}

          {step === 9 ? (
            <div>
              <p>Inscripción: {money(quote.inscription)}</p>
              <p>Plan ({planKey}): {money(quote.plan)}</p>
              <p><strong>Total orientativo: {money(quote.total)}</strong></p>
              <p className="muted">Los cargos definitivos los confirma Administración. No afecta tu cuota social.</p>
            </div>
          ) : null}

          {step === 10 ? (
            <div>
              <p>Alumno: <strong>{student.fullName}</strong></p>
              <p>Responsable: <strong>{guardian.fullName}</strong></p>
              <p>Plan: <strong>{planKey}</strong> · {money(quote.total)}</p>
              {!wizardCheck.ok ? (
                <ul className="alert alert-danger">
                  {wizardCheck.errors.map((e) => <li key={e.code}>{e.message}</li>)}
                </ul>
              ) : (
                <p className="muted">Al confirmar, la solicitud queda pendiente de validación.</p>
              )}
            </div>
          ) : null}

          <div className="colonia-wizard-nav">
            {step > 1 ? (
              <button type="button" className="btn btn-secondary" onClick={() => setStep((s) => s - 1)}>Atrás</button>
            ) : null}
            {step < 10 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!wizardCheck.ok && step >= 3}
                onClick={() => setStep((s) => s + 1)}
              >
                Siguiente <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !wizardCheck.ok}
                onClick={submitEnrollment}
              >
                {busy ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
                {' '}
                Enviar solicitud
              </button>
            )}
          </div>
        </section>
      ) : null}

      {mode === 'account' ? (
        <section className="colonia-account">
          <h3>Cuenta Colonia</h3>
          <p className="muted">Independiente de la cuota social. Los saldos no se compensan entre sí.</p>
          <h4>Cargos</h4>
          <ul>
            {charges.map((c) => (
              <li key={c.id}>{c.concept} · {money(c.amount)} · {c.status}</li>
            ))}
            {!charges.length ? <li className="muted">Sin cargos aún</li> : null}
          </ul>
          <h4>Pagos</h4>
          <ul>
            {payments.map((p) => (
              <li key={p.id}>{p.method} · {money(p.amount)} · {p.status}</li>
            ))}
            {!payments.length ? <li className="muted">Sin pagos</li> : null}
          </ul>
          <h4>Informar transferencia</h4>
          <input placeholder="Referencia / Nº operación" value={transferRef} onChange={(e) => setTransferRef(e.target.value)} />
          <input placeholder="Importe" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={reportTransfer}>
            Enviar aviso (queda pendiente)
          </button>
        </section>
      ) : null}
    </div>
  );
}
