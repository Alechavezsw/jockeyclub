import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Baby,
  CalendarDays,
  ClipboardList,
  Users,
  Wallet,
} from 'lucide-react';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  COLONIA_ACTIVITY_KINDS,
  COLONIA_ATTENDANCE_STATUSES,
  COLONIA_PAYMENT_METHODS,
  COLONIA_PLAN_KEYS,
  COLONIA_SECTIONS,
  COLONIA_SEASON_2026_2027,
  coloniaMethodLabel,
} from '../../domain/colonia/coloniaConstants';
import { ageYearsOn } from '../../domain/colonia/coloniaAge';
import { validateEnrollmentDraft, enrollmentIdentityKey } from '../../domain/colonia/coloniaEnrollment';
import {
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
  evaluatePromotionCharge,
  inscriptionAmount,
  planAmountFor,
} from '../../domain/colonia/coloniaTariffs';
import {
  buildColoniaEnrollmentsCsv,
  buildColoniaReceipt,
  summarizeColoniaAccount,
} from '../../domain/colonia/coloniaLedger';
import {
  buildColoniaPaymentDraft,
  coloniaMercadoPagoAdapterSpec,
} from '../../domain/colonia/coloniaPayments';
import {
  canAccessColonia,
  canAttendColonia,
  canCollectColonia,
  canManageColoniaHealth,
  canViewColoniaFinance,
} from '../../domain/auth/roles';

function money(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EMPTY_STUDENT = {
  fullName: '',
  documentNumber: '',
  birthDate: '',
  memberKind: 'socio',
  memberNumber: '',
  shirtSize: '',
  notes: '',
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
 * Operación → Colonia. Módulo funcional; sin datos ficticios como estadísticas.
 */
export default function ColoniaTab({ roles = [], role }) {
  const canOperate = canAccessColonia({ roles, role });
  const canCollect = canCollectColonia({ roles, role });
  const canAttend = canAttendColonia({ roles, role });
  const canFinance = canViewColoniaFinance({ roles, role });
  const canHealth = canManageColoniaHealth({ roles, role });
  const [section, setSection] = useState('resumen');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [stats, setStats] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [selectedEnrollment, setSelectedEnrollment] = useState(null);
  const [charges, setCharges] = useState([]);
  const [payments, setPayments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activities, setActivities] = useState([]);
  const [siblingGroups, setSiblingGroups] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [cloudReady, setCloudReady] = useState(true);

  const [student, setStudent] = useState(EMPTY_STUDENT);
  const [guardian, setGuardian] = useState(EMPTY_GUARDIAN);
  const [planKey, setPlanKey] = useState(COLONIA_PLAN_KEYS.cuota);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [attendanceDay, setAttendanceDay] = useState(todayIso());
  const [attendanceStatus, setAttendanceStatus] = useState('presente');
  const [groupName, setGroupName] = useState('');
  const [activityKind, setActivityKind] = useState('natacion');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDate, setActivityDate] = useState('');
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [healthNotes, setHealthNotes] = useState('');
  const [healthAllergies, setHealthAllergies] = useState('');

  const visibleSections = useMemo(
    () => COLONIA_SECTIONS.filter((item) => {
      if (['cobranzas', 'reportes', 'configuracion', 'hermanos'].includes(item.key)) return canFinance;
      if (item.key === 'inscripciones') return canOperate && canFinance;
      if (item.key === 'asistencia') return canAttend;
      return canOperate;
    }),
    [canFinance, canAttend, canOperate],
  );
  const activeSection = visibleSections.some((s) => s.key === section)
    ? section
    : (visibleSections[0]?.key || 'asistencia');

  const season = useMemo(
    () => seasons.find((s) => s.id === seasonId) || null,
    [seasons, seasonId],
  );
  const seasonView = season || COLONIA_SEASON_2026_2027;
  const mpSpec = coloniaMercadoPagoAdapterSpec();

  const draftValidation = useMemo(() => validateEnrollmentDraft({
    student,
    guardian,
    season: {
      ...COLONIA_SEASON_2026_2027,
      promotionPeriodicity: season?.promotion_periodicity ?? null,
      activitiesStartOn: season?.activities_start_on || COLONIA_SEASON_2026_2027.activitiesStartOn,
      ageMin: season?.age_min ?? 3,
      ageMax: season?.age_max ?? 15,
      enrollmentOpensOn: season?.enrollment_opens_on || COLONIA_SEASON_2026_2027.enrollmentOpensOn,
      enrollmentClosesOn: season?.enrollment_closes_on || COLONIA_SEASON_2026_2027.enrollmentClosesOn,
    },
    planKey,
    memberKind: student.memberKind,
    siblingCount: 1,
    todayIso: todayIso(),
    existingKeys: enrollments.map((e) => enrollmentIdentityKey(e.student || e)).filter(Boolean),
  }), [student, guardian, planKey, season, enrollments]);

  const accountSummary = useMemo(
    () => summarizeColoniaAccount({ charges, payments }),
    [charges, payments],
  );

  useEffect(() => {
    if (!canOperate || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await repos.listColoniaSeasons();
        if (cancelled) return;
        setSeasons(rows);
        setSeasonId((prev) => prev || rows[0]?.id || null);
        setCloudReady(true);
      } catch (err) {
        if (cancelled) return;
        setCloudReady(err?.code !== 'COLONIA_RPC_MISSING');
        setMsg(err?.message || 'No se pudo cargar Colonia.');
      }
    })();
    return () => { cancelled = true; };
  }, [canOperate]);

  useEffect(() => {
    if (!seasonId || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const [st, en, gr, act, sib] = await Promise.all([
          canFinance ? repos.coloniaDashboardStats(seasonId).catch(() => null) : Promise.resolve(null),
          repos.listColoniaEnrollments(seasonId),
          repos.listColoniaGroups(seasonId).catch(() => []),
          repos.listColoniaActivities(seasonId).catch(() => []),
          canFinance ? repos.listColoniaSiblingGroups(seasonId).catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setStats(st);
        setEnrollments(en);
        setGroups(gr);
        setActivities(act);
        setSiblingGroups(sib);
      } catch (err) {
        if (!cancelled) setMsg(err?.message || 'Error al refrescar Colonia');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seasonId, canFinance]);

  async function saveHealth() {
    if (!selectedEnrollment?.student?.id || !canHealth) return;
    setBusy(true);
    try {
      await repos.coloniaUpsertStudentHealth({
        studentId: selectedEnrollment.student.id,
        healthNotes,
        allergies: healthAllergies,
      });
      setMsg('Datos de salud guardados (solo personal autorizado).');
    } catch (err) {
      setMsg(err?.message || 'No se pudo guardar salud.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshAccount(enrollmentId) {
    if (!enrollmentId || !canFinance) {
      setCharges([]);
      setPayments([]);
      return;
    }
    const [c, p] = await Promise.all([
      repos.listColoniaCharges(enrollmentId),
      repos.listColoniaPayments(enrollmentId),
    ]);
    setCharges(c);
    setPayments(p);
  }

  async function submitEnrollment() {
    setMsg('');
    if (!draftValidation.ok) {
      setMsg(draftValidation.errors[0]?.message || 'Revisá el formulario.');
      return;
    }
    if (!seasonId) {
      setMsg('Seleccioná una temporada publicada en la base.');
      return;
    }
    const promo = evaluatePromotionCharge({
      planKey,
      season: { promotionPeriodicity: season?.promotion_periodicity ?? null },
      siblingCount: 1,
      memberKinds: [student.memberKind],
    });
    if (!promo.ok) {
      setMsg(promo.errors[0]?.message || 'Plan no confirmable.');
      return;
    }
    setBusy(true);
    try {
      const g = await repos.upsertColoniaGuardian({
        full_name: guardian.fullName.trim(),
        document_number: guardian.documentNumber || null,
        relationship: guardian.relationship || null,
        phone: guardian.phone || null,
        email: guardian.email || null,
        emergency_contact: guardian.emergencyContact || null,
        authorized_pickup: guardian.authorizedPickup || null,
      });
      const s = await repos.upsertColoniaStudent({
        full_name: student.fullName.trim(),
        document_number: student.documentNumber || null,
        birth_date: student.birthDate,
        member_kind: student.memberKind,
        member_number: student.memberNumber || null,
        shirt_size: student.shirtSize || null,
        notes: student.notes || null,
        identity_key: draftValidation.identityKey,
      });
      const enrollment = await repos.createColoniaEnrollment({
        season_id: seasonId,
        student_id: s.id,
        guardian_id: g.id,
        plan_key: planKey,
        status: 'pendiente',
        observations: student.notes || null,
      });
      await repos.coloniaPostCharge({
        enrollmentId: enrollment.id,
        concept: 'colonia_inscripcion',
        planKey: 'inscripcion',
        amount: inscriptionAmount(COLONIA_OFFICIAL_TARIFFS_2026_2027),
        note: 'Inscripción (incluye remera)',
      });
      const planAmount = planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, planKey);
      if (planAmount != null && planAmount > 0) {
        await repos.coloniaPostCharge({
          enrollmentId: enrollment.id,
          concept: planKey === 'temporada' ? 'colonia_temporada' : 'colonia_cuota',
          planKey,
          amount: planAmount,
          note: `Plan ${planKey}`,
        });
      }
      setMsg('Inscripción registrada con cargos de Colonia (sin tocar cuota social).');
      setStudent(EMPTY_STUDENT);
      setGuardian(EMPTY_GUARDIAN);
      const en = await repos.listColoniaEnrollments(seasonId);
      setEnrollments(en);
      setSelectedEnrollment(enrollment);
      await refreshAccount(enrollment.id);
      setSection('cobranzas');
    } catch (err) {
      setMsg(err?.message || 'No se pudo inscribir.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment() {
    setMsg('');
    if (!selectedEnrollment?.id) {
      setMsg('Elegí una inscripción.');
      return;
    }
    if (!canCollect) {
      setMsg('Sin permiso de cobranza Colonia.');
      return;
    }
    setBusy(true);
    try {
      const draft = buildColoniaPaymentDraft({
        enrollmentId: selectedEnrollment.id,
        seasonId,
        method: payMethod,
        amount: payAmount,
        operatorConfirmed: cardConfirmed,
        externalReference: payRef,
        idempotencyKey: `colonia-${selectedEnrollment.id}-${payMethod}-${payAmount}-${payRef || 'x'}`,
      });
      const result = await repos.coloniaRecordPayment({
        enrollmentId: draft.enrollmentId,
        method: draft.method,
        amount: draft.amount,
        status: draft.status,
        externalReference: draft.externalReference,
        idempotencyKey: draft.idempotencyKey,
        operatorName: 'Mostrador Colonia',
      });
      const payment = result?.payment || result;
      if (draft.status === 'confirmed' && payment) {
        setReceiptPreview(buildColoniaReceipt({
          payment,
          student: selectedEnrollment?.student,
          guardian: selectedEnrollment?.guardian,
          season,
        }));
      }
      setMsg(result?.duplicate
        ? 'Pago duplicado (idempotencia): se reutilizó el registro existente.'
        : `Pago ${coloniaMethodLabel(draft.method)} registrado como ${draft.status}.`);
      setPayAmount('');
      setPayRef('');
      setCardConfirmed(false);
      await refreshAccount(selectedEnrollment.id);
      const st = await repos.coloniaDashboardStats(seasonId).catch(() => null);
      setStats(st);
    } catch (err) {
      setMsg(err?.details?.[0]?.message || err?.message || 'No se pudo cobrar.');
    } finally {
      setBusy(false);
    }
  }

  async function markAttendance(enrollmentId) {
    setMsg('');
    if (!canAttend) {
      setMsg('Sin permiso de asistencia Colonia.');
      return;
    }
    setBusy(true);
    try {
      await repos.coloniaUpsertAttendance({
        enrollmentId,
        day: attendanceDay,
        status: attendanceStatus,
        operatorName: 'Asistencia Colonia',
      });
      setMsg('Asistencia guardada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo guardar asistencia.');
    } finally {
      setBusy(false);
    }
  }

  async function savePromotionPeriodicity(value) {
    if (!seasonId) return;
    setBusy(true);
    try {
      const updated = await repos.updateColoniaSeason(seasonId, {
        promotion_periodicity: value || null,
      });
      setSeasons((prev) => prev.map((s) => (s.id === seasonId ? updated : s)));
      setMsg(value
        ? `Periodicidad de promociones: ${value === 'monthly' ? 'mensual' : 'temporada'}.`
        : 'Promociones vuelven a quedar bloqueadas hasta definir periodicidad.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo guardar la configuración.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelectedEnrollment() {
    if (!selectedEnrollment?.id) return;
    const reason = window.prompt('Motivo de cancelación (mín. 5 caracteres):', 'Cancelada por Administración');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setMsg('');
    try {
      await repos.coloniaCancelEnrollment(selectedEnrollment.id, reason.trim());
      const en = await repos.listColoniaEnrollments(seasonId);
      setEnrollments(en);
      setSelectedEnrollment(en.find((e) => e.id === selectedEnrollment.id) || null);
      setMsg('Inscripción cancelada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo cancelar.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPendingPayment(paymentId) {
    if (!canCollect) {
      setMsg('Sin permiso de cobranza Colonia.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const result = await repos.coloniaConfirmPayment(paymentId, 'Mostrador Colonia');
      const payment = result?.payment || result;
      setReceiptPreview(buildColoniaReceipt({
        payment,
        student: selectedEnrollment?.student,
        guardian: selectedEnrollment?.guardian,
        season,
      }));
      setMsg('Pago confirmado. Comprobante interno generado.');
      if (selectedEnrollment?.id) await refreshAccount(selectedEnrollment.id);
      const st = await repos.coloniaDashboardStats(seasonId).catch(() => null);
      setStats(st);
    } catch (err) {
      setMsg(err?.message || 'No se pudo confirmar el pago.');
    } finally {
      setBusy(false);
    }
  }

  async function voidSelectedCharge(chargeId) {
    const reason = window.prompt('Motivo de anulación (mín. 5 caracteres):');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setMsg('');
    try {
      await repos.coloniaVoidCharge(chargeId, reason.trim());
      setMsg('Cargo anulado.');
      if (selectedEnrollment?.id) await refreshAccount(selectedEnrollment.id);
    } catch (err) {
      setMsg(err?.message || 'No se pudo anular el cargo.');
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    if (!seasonId || !groupName.trim()) {
      setMsg('Indicá el nombre del grupo.');
      return;
    }
    setBusy(true);
    try {
      await repos.coloniaCreateGroup({ seasonId, name: groupName.trim() });
      setGroupName('');
      setGroups(await repos.listColoniaGroups(seasonId));
      setMsg('Grupo creado.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo crear el grupo.');
    } finally {
      setBusy(false);
    }
  }

  async function createActivity() {
    if (!seasonId || !activityTitle.trim()) {
      setMsg('Indicá el título de la actividad.');
      return;
    }
    setBusy(true);
    try {
      await repos.coloniaCreateActivity({
        seasonId,
        kind: activityKind,
        title: activityTitle.trim(),
        activityDate: activityDate || null,
      });
      setActivityTitle('');
      setActivities(await repos.listColoniaActivities(seasonId));
      setMsg('Actividad registrada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo crear la actividad.');
    } finally {
      setBusy(false);
    }
  }

  async function grantExcursionAuth(enrollmentId) {
    setBusy(true);
    try {
      await repos.coloniaSetAuthorization({
        enrollmentId,
        kind: 'excursion',
        granted: true,
        grantedByName: 'Operación Colonia',
      });
      setMsg('Autorización de excursión registrada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo registrar la autorización.');
    } finally {
      setBusy(false);
    }
  }

  function exportEnrollmentsCsv() {
    const csv = buildColoniaEnrollmentsCsv(enrollments);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colonia-inscriptos-${season?.code || 'temporada'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Reporte CSV descargado.');
  }

  if (!canOperate) {
    return (
      <div className="colonia-shell">
        <p className="colonia-banner warn">Sin permiso para Operación → Colonia.</p>
      </div>
    );
  }

  return (
    <div className="colonia-shell">
      <header className="colonia-head">
        <div>
          <p className="household-integrity-kicker">Operación · actividad adicional</p>
          <h2 className="serif-font">Colonia de Verano</h2>
          <p>
            Independiente de la cuota social. Temporada {seasonView.code || seasonView.name}.
            {' '}Horario {seasonView.schedule_hours || seasonView.scheduleHours || '09:00-13:00'}, lunes a viernes.
          </p>
        </div>
        <label className="colonia-field">
          <span>Temporada</span>
          <select
            value={seasonId || ''}
            onChange={(e) => setSeasonId(e.target.value || null)}
            disabled={!seasons.length}
          >
            {!seasons.length ? <option value="">Sin temporada en base</option> : null}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
        </label>
      </header>

      {!isSupabaseConfigured || !cloudReady ? (
        <p className="colonia-banner warn">
          <AlertTriangle size={16} /> La migración de Colonia aún no está publicada. El dominio y la UI están listos; no se inventan estadísticas.
        </p>
      ) : null}

      {msg ? <p className="colonia-banner">{msg}</p> : null}

      {!canFinance ? (
        <p className="colonia-banner warn">
          Vista de asistencia: sin acceso a cobranzas, tarifas ni reportes financieros.
        </p>
      ) : null}

      <nav className="colonia-nav" aria-label="Secciones Colonia">
        {visibleSections.map((item) => (
          <button
            key={item.key}
            type="button"
            className={activeSection === item.key ? 'is-active' : ''}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {activeSection === 'resumen' ? (
        <section className="colonia-panel">
          <h3><ClipboardList size={16} /> Resumen</h3>
          {!stats ? (
            <p className="muted">Sin datos cargados todavía (o migración pendiente).</p>
          ) : (
            <div className="colonia-kpi-grid">
              <article><span>Inscriptos</span><strong>{stats.enrolled ?? 0}</strong></article>
              <article><span>Confirmadas</span><strong>{stats.confirmed ?? 0}</strong></article>
              <article><span>Pendientes</span><strong>{stats.pending ?? 0}</strong></article>
              <article><span>Socios</span><strong>{stats.socio ?? 0}</strong></article>
              <article><span>No socios</span><strong>{stats.no_socio ?? 0}</strong></article>
              <article><span>Cargos</span><strong>{money(stats.charges_total)}</strong></article>
              <article><span>Cobradas</span><strong>{money(stats.payments_confirmed)}</strong></article>
              <article><span>Pend. confirmar</span><strong>{money(stats.payments_pending)}</strong></article>
              <article><span>Saldo Colonia</span><strong>{money(stats.balance_due)}</strong></article>
              <article><span>Asistencia hoy</span><strong>{stats.attendance_today ?? 0}</strong></article>
              <article><span>Grupos hermanos</span><strong>{stats.sibling_groups ?? 0}</strong></article>
            </div>
          )}
        </section>
      ) : null}

      {activeSection === 'inscripciones' ? (
        <section className="colonia-panel colonia-grid-2">
          <div>
            <h3><Baby size={16} /> Nueva inscripción</h3>
            <div className="colonia-form">
              <label><span>Nombre del alumno</span>
                <input value={student.fullName} onChange={(e) => setStudent({ ...student, fullName: e.target.value })} />
              </label>
              <label><span>DNI</span>
                <input value={student.documentNumber} onChange={(e) => setStudent({ ...student, documentNumber: e.target.value })} />
              </label>
              <label><span>Nacimiento</span>
                <input type="date" value={student.birthDate} onChange={(e) => setStudent({ ...student, birthDate: e.target.value })} />
              </label>
              <p className="muted">
                Edad al inicio: {student.birthDate
                  ? (ageYearsOn(student.birthDate, seasonView.activities_start_on || seasonView.activitiesStartOn) ?? '—')
                  : '—'} años
              </p>
              <label><span>Condición</span>
                <select value={student.memberKind} onChange={(e) => setStudent({ ...student, memberKind: e.target.value })}>
                  <option value="socio">Socio</option>
                  <option value="no_socio">No socio</option>
                </select>
              </label>
              {student.memberKind === 'socio' ? (
                <label><span>Nº socio (padrón)</span>
                  <input value={student.memberNumber} onChange={(e) => setStudent({ ...student, memberNumber: e.target.value })} />
                </label>
              ) : (
                <p className="muted">No socio: ficha solo de Colonia, sin alta en padrón.</p>
              )}
              <label><span>Talle remera</span>
                <input value={student.shirtSize} onChange={(e) => setStudent({ ...student, shirtSize: e.target.value })} />
              </label>
              <label><span>Plan</span>
                <select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
                  <option value="cuota">Cuota Colonia</option>
                  <option value="temporada">Temporada completa</option>
                  <option value="promo_2">Promoción 2 hermanos</option>
                  <option value="promo_3">Promoción 3 hermanos</option>
                  <option value="hermano_4">Cuarto hermano (solo inscripción)</option>
                </select>
              </label>
              <h4>Responsable</h4>
              <label><span>Nombre</span>
                <input value={guardian.fullName} onChange={(e) => setGuardian({ ...guardian, fullName: e.target.value })} />
              </label>
              <label><span>Teléfono</span>
                <input value={guardian.phone} onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })} />
              </label>
              <label><span>Email</span>
                <input value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} />
              </label>
              <label><span>Emergencia</span>
                <input value={guardian.emergencyContact} onChange={(e) => setGuardian({ ...guardian, emergencyContact: e.target.value })} />
              </label>
              <label><span>Autorizados a retirar</span>
                <input value={guardian.authorizedPickup} onChange={(e) => setGuardian({ ...guardian, authorizedPickup: e.target.value })} />
              </label>
              {!draftValidation.ok ? (
                <ul className="colonia-errors">
                  {draftValidation.errors.map((e) => <li key={e.code}>{e.message}</li>)}
                </ul>
              ) : null}
              {draftValidation.warnings.map((w) => (
                <p key={w.code} className="colonia-banner warn">{w.message}</p>
              ))}
              <button type="button" className="btn primary" disabled={busy || !draftValidation.ok} onClick={submitEnrollment}>
                Registrar inscripción
              </button>
            </div>
          </div>
          <div>
            <h3>Inscripciones ({enrollments.length})</h3>
            <ul className="colonia-list">
              {enrollments.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEnrollment(row);
                      refreshAccount(row.id);
                      setSection('alumnos');
                    }}
                  >
                    <strong>{row.student?.full_name || '—'}</strong>
                    <span>{row.status} · {row.plan_key} · {row.student?.member_kind}</span>
                  </button>
                </li>
              ))}
              {!enrollments.length ? <li className="muted">Sin inscripciones en esta temporada.</li> : null}
            </ul>
          </div>
        </section>
      ) : null}

      {activeSection === 'alumnos' ? (
        <section className="colonia-panel">
          <h3><Users size={16} /> Ficha del alumno</h3>
          {!selectedEnrollment ? (
            <p className="muted">Elegí un alumno desde Inscripciones.</p>
          ) : (
            <div className="colonia-ficha">
              <p><strong>{selectedEnrollment.student?.full_name}</strong></p>
              <p>DNI {selectedEnrollment.student?.document_number || '—'} · {selectedEnrollment.student?.member_kind}</p>
              <p>Plan {selectedEnrollment.plan_key} · Estado {selectedEnrollment.status}</p>
              <p>Responsable: {selectedEnrollment.guardian?.full_name || '—'} · {selectedEnrollment.guardian?.phone || ''}</p>
              <p className="muted">Cuenta Colonia — contratado {money(accountSummary.totalContracted)} · cobrado {money(accountSummary.totalCollected)} · saldo {money(accountSummary.balanceDue)}</p>
              {selectedEnrollment.student?.member_number ? (
                <p className="muted">Padrón Nº {selectedEnrollment.student.member_number} (navegación a ficha de socio sin mezclar cuentas).</p>
              ) : (
                <p className="muted">No socio: ficha solo Colonia (no ingresa al padrón institucional).</p>
              )}
              {selectedEnrollment.status !== 'cancelada' && canFinance ? (
                <button type="button" className="btn" disabled={busy} onClick={cancelSelectedEnrollment}>
                  Cancelar inscripción
                </button>
              ) : null}
              {canAttend ? (
                <button type="button" className="btn" disabled={busy} onClick={() => grantExcursionAuth(selectedEnrollment.id)}>
                  Autorizar excursión
                </button>
              ) : null}
              {canHealth ? (
                <div className="colonia-form">
                  <h4>Salud (restringido)</h4>
                  <label><span>Alergias</span>
                    <input value={healthAllergies} onChange={(e) => setHealthAllergies(e.target.value)} />
                  </label>
                  <label><span>Notas de salud</span>
                    <input value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} />
                  </label>
                  <button type="button" className="btn" disabled={busy} onClick={saveHealth}>
                    Guardar salud
                  </button>
                </div>
              ) : (
                <p className="muted">Datos de salud de menores: solo personal administrativo autorizado.</p>
              )}
            </div>
          )}
        </section>
      ) : null}

      {activeSection === 'hermanos' ? (
        <section className="colonia-panel">
          <h3>Hermanos y promociones</h3>
          <p className="muted">
            El grupo de hermanos de Colonia es distinto del grupo familiar del padrón.
            Periodicidad actual: {season?.promotion_periodicity || 'sin definir (promos bloqueadas)'}.
          </p>
          <ul className="colonia-list">
            {siblingGroups.map((g) => (
              <li key={g.id}><strong>{g.label || g.id}</strong> · promo {g.promotion_plan || '—'}</li>
            ))}
            {!siblingGroups.length ? <li className="muted">Sin grupos cargados.</li> : null}
          </ul>
        </section>
      ) : null}

      {activeSection === 'cobranzas' ? (
        <section className="colonia-panel colonia-grid-2">
          <div>
            <h3><Wallet size={16} /> Cobranza Colonia</h3>
            <p className="muted">Medios de Jockey Connect. Nunca imputa a cuota social ni tenis.</p>
            <label className="colonia-field"><span>Inscripción</span>
              <select
                value={selectedEnrollment?.id || ''}
                onChange={(e) => {
                  const row = enrollments.find((x) => x.id === e.target.value);
                  setSelectedEnrollment(row || null);
                  if (row) refreshAccount(row.id);
                }}
              >
                <option value="">Elegir…</option>
                {enrollments.map((row) => (
                  <option key={row.id} value={row.id}>{row.student?.full_name}</option>
                ))}
              </select>
            </label>
            <label className="colonia-field"><span>Medio</span>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {COLONIA_PAYMENT_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="colonia-field"><span>Importe</span>
              <input type="number" min="0" step="1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </label>
            <label className="colonia-field"><span>Referencia / comprobante</span>
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </label>
            {(payMethod === 'tarjeta' || payMethod === 'pos' || payMethod === 'debito') ? (
              <>
                <p className="colonia-banner warn">
                  Tarjeta/POSNET/débito no se acreditan solos: requieren confirmación verificable del resultado en terminal (autorización administrativa).
                </p>
                <label className="colonia-check">
                  <input type="checkbox" checked={cardConfirmed} onChange={(e) => setCardConfirmed(e.target.checked)} />
                  Confirmo resultado aprobado en terminal/POS
                </label>
              </>
            ) : null}
            {payMethod === 'transferencia' ? (
              <p className="colonia-banner warn">
                Transferencia queda pendiente hasta validación administrativa. No acredita el saldo Colonia hasta confirmar.
              </p>
            ) : null}
            {payMethod === 'mercadopago' ? (
              <p className="colonia-banner warn">
                Mercado Pago Colonia deshabilitado hasta webhook específico (kind={mpSpec.kind}). Estado: {mpSpec.status}.
              </p>
            ) : null}
            <button type="button" className="btn primary" disabled={busy || !canCollect} onClick={submitPayment}>
              Registrar cobro Colonia
            </button>
            <p className="muted">Saldo inscripción: {money(accountSummary.balanceDue)} · Pend. confirmar {money(accountSummary.pendingConfirmation)}</p>
          </div>
          <div>
            <h4>Cargos</h4>
            <ul className="colonia-list">
              {charges.map((c) => (
                <li key={c.id} className="colonia-row-actions">
                  <span>{c.concept} · {money(c.amount)} · {c.status}</span>
                  {c.status === 'posted' && canCollect ? (
                    <button type="button" className="btn" disabled={busy} onClick={() => voidSelectedCharge(c.id)}>
                      Anular
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <h4>Pagos</h4>
            <ul className="colonia-list">
              {payments.map((p) => {
                const receipt = p.status === 'confirmed'
                  ? buildColoniaReceipt({
                    payment: p,
                    student: selectedEnrollment?.student,
                    guardian: selectedEnrollment?.guardian,
                    season,
                  })
                  : null;
                return (
                  <li key={p.id} className="colonia-row-actions">
                    <span>
                      {coloniaMethodLabel(p.method)} · {money(p.amount)} · {p.status}
                      {receipt ? (
                        <span className="muted"> · op {receipt.operationId?.slice?.(0, 8) || '—'} · {receipt.fiscalNote}</span>
                      ) : null}
                    </span>
                    {p.status === 'pending' && canCollect && p.method !== 'mercadopago' ? (
                      <button type="button" className="btn" disabled={busy} onClick={() => confirmPendingPayment(p.id)}>
                        Confirmar
                      </button>
                    ) : null}
                    {receipt ? (
                      <button type="button" className="btn" onClick={() => setReceiptPreview(receipt)}>
                        Ver comprobante
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {receiptPreview ? (
              <div className="colonia-ficha">
                <h4>Comprobante interno</h4>
                <p>{receiptPreview.studentName} · Resp. {receiptPreview.guardianName}</p>
                <p>{receiptPreview.seasonName} · {receiptPreview.conceptLabel}</p>
                <p>{money(receiptPreview.amount)} · {receiptPreview.method} · {receiptPreview.paidAt || '—'}</p>
                <p className="muted">Op. {receiptPreview.operationId || receiptPreview.reference}</p>
                <p className="muted">{receiptPreview.fiscalNote}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeSection === 'asistencia' ? (
        <section className="colonia-panel">
          <h3><CalendarDays size={16} /> Asistencia</h3>
          {!canAttend ? (
            <p className="colonia-banner warn">Sin permiso de asistencia Colonia.</p>
          ) : null}
          <div className="colonia-form inline">
            <label><span>Día</span>
              <input type="date" value={attendanceDay} onChange={(e) => setAttendanceDay(e.target.value)} />
            </label>
            <label><span>Estado</span>
              <select value={attendanceStatus} onChange={(e) => setAttendanceStatus(e.target.value)}>
                {COLONIA_ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <ul className="colonia-list">
            {enrollments.filter((e) => e.status !== 'cancelada').map((row) => (
              <li key={row.id} className="colonia-row-actions">
                <span>{row.student?.full_name}</span>
                <button type="button" className="btn" disabled={busy || !canAttend} onClick={() => markAttendance(row.id)}>
                  Marcar
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">Un profesor puede marcar asistencia; no puede cobrar ni anular cargos.</p>
        </section>
      ) : null}

      {activeSection === 'grupos' ? (
        <section className="colonia-panel">
          <h3>Grupos</h3>
          <div className="colonia-form inline">
            <label><span>Nombre</span>
              <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ej. Grupo A 6-8" />
            </label>
            <button type="button" className="btn primary" disabled={busy || !canOperate} onClick={createGroup}>
              Crear grupo
            </button>
          </div>
          <ul className="colonia-list">
            {groups.map((g) => (
              <li key={g.id}>{g.name} · cupo {g.capacity ?? '—'} · {g.lead_name || 'sin responsable asignado'}</li>
            ))}
            {!groups.length ? <li className="muted">Sin grupos configurados.</li> : null}
          </ul>
        </section>
      ) : null}

      {activeSection === 'actividades' ? (
        <section className="colonia-panel">
          <h3>Actividades</h3>
          <div className="colonia-form">
            <label><span>Tipo</span>
              <select value={activityKind} onChange={(e) => setActivityKind(e.target.value)}>
                {COLONIA_ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label><span>Título</span>
              <input value={activityTitle} onChange={(e) => setActivityTitle(e.target.value)} />
            </label>
            <label><span>Fecha</span>
              <input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
            </label>
            <button type="button" className="btn primary" disabled={busy || !canOperate} onClick={createActivity}>
              Programar actividad
            </button>
          </div>
          <ul className="colonia-list">
            {activities.map((a) => (
              <li key={a.id}>{a.kind} · {a.title} · {a.activity_date || 'sin fecha'}</li>
            ))}
            {!activities.length ? <li className="muted">Sin actividades cargadas.</li> : null}
          </ul>
        </section>
      ) : null}

      {activeSection === 'reportes' ? (
        <section className="colonia-panel">
          <h3>Reportes</h3>
          <p className="muted">Datos reales de la temporada seleccionada. Deuda exclusiva Colonia (no cuota social).</p>
          <ul className="colonia-list">
            <li>Inscriptos: {enrollments.length}</li>
            <li>Socios / no socios: ver resumen</li>
            <li>Deuda exclusiva Colonia: {money(stats?.balance_due)}</li>
            <li>Ingresos confirmados: {money(stats?.payments_confirmed)}</li>
          </ul>
          <button type="button" className="btn primary" disabled={!enrollments.length} onClick={exportEnrollmentsCsv}>
            Exportar inscriptos CSV
          </button>
        </section>
      ) : null}

      {activeSection === 'configuracion' ? (
        <section className="colonia-panel">
          <h3>Configuración</h3>
          <p>Contactos: {(season?.contacts || COLONIA_SEASON_2026_2027.contacts).join(' · ')}</p>
          <p>Inscripciones: {seasonView.enrollment_opens_on || seasonView.enrollmentOpensOn} → {seasonView.enrollment_closes_on || seasonView.enrollmentClosesOn} (incluye cierre).</p>
          <p>Fin de temporada: {season?.activities_end_on || 'configurable (sin fecha publicada)'}</p>
          <label className="colonia-field">
            <span>Periodicidad promociones hermanos</span>
            <select
              value={season?.promotion_periodicity || ''}
              onChange={(e) => savePromotionPeriodicity(e.target.value || null)}
            >
              <option value="">Sin definir (bloquear promos)</option>
              <option value="monthly">Mensual</option>
              <option value="season">Temporada completa</option>
            </select>
          </label>
          <p className="muted">Inscripción fija: {money(inscriptionAmount())}. Tarifas versionadas por temporada; no recalculan cargos históricos.</p>
        </section>
      ) : null}
    </div>
  );
}
