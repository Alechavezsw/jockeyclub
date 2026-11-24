import { useMemo, useState } from 'react';
import { ArrowLeft, Baby, ShieldCheck } from 'lucide-react';
import { repos } from '../data/bootstrap';
import { isSupabaseConfigured } from '../lib/supabase';
import { assertExternalGuardianDraft, validateExternalEnrollmentDraft } from '../domain/colonia/coloniaExternal';
import { COLONIA_SEASON_2026_2027 } from '../domain/colonia/coloniaConstants';
import { todayISODateAR } from '../lib/arDate';
import { buildPortalEnrollmentPayload } from '../domain/colonia/coloniaPortal';

/**
 * Acceso externo Colonia (no socios).
 * Requiere sesión Auth verificada. No crea members ni membresía.
 */
export default function ColoniaExternalView({ setCurrentView, user }) {
  const [step, setStep] = useState('register');
  const [guardianForm, setGuardianForm] = useState({
    fullName: user?.fullName || user?.name || '',
    email: user?.email || '',
    phone: '',
    documentNumber: '',
  });
  const [student, setStudent] = useState({
    fullName: '',
    birthDate: '',
    documentNumber: '',
    memberKind: 'no_socio',
    shirtSize: '',
  });
  const [planKey, setPlanKey] = useState('cuota');
  const [guardian, setGuardian] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const registerCheck = useMemo(
    () => assertExternalGuardianDraft(guardianForm),
    [guardianForm],
  );

  async function registerGuardian() {
    if (!registerCheck.ok) {
      setError(registerCheck.errors[0]?.message || 'Revisá los datos.');
      return;
    }
    if (!isSupabaseConfigured) {
      setError('Colonia externa requiere cloud.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await repos.coloniaRegisterExternalGuardian(registerCheck.draft);
      setGuardian(res?.guardian || null);
      setMsg('Responsable registrado. Verificá el correo de tu cuenta Auth; no se crea ficha societaria.');
      setStep('verify');
    } catch (err) {
      setError(err?.message || 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }

  async function markVerified() {
    setBusy(true);
    setError('');
    try {
      const res = await repos.coloniaMarkExternalEmailVerified();
      setGuardian(res?.guardian || guardian);
      setMsg('Correo marcado como verificado para Colonia.');
      setStep('enroll');
    } catch (err) {
      setError(err?.message || 'No se pudo verificar.');
    } finally {
      setBusy(false);
    }
  }

  async function submitEnrollment() {
    const check = validateExternalEnrollmentDraft({
      student,
      guardian: guardian || guardianForm,
      planKey,
      season: COLONIA_SEASON_2026_2027,
      todayIso: todayISODateAR(),
      emailVerified: Boolean(guardian?.email_verified_at || guardian?.status === 'active'),
    });
    if (!check.ok) {
      setError(check.errors[0]?.message || 'Revisá la inscripción.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const seasons = await repos.listColoniaSeasons();
      const seasonId = seasons?.[0]?.id;
      if (!seasonId) throw new Error('No hay temporada publicada.');
      const payload = buildPortalEnrollmentPayload({
        seasonId,
        student: { ...student, memberKind: 'no_socio' },
        guardian: {
          fullName: guardianForm.fullName,
          phone: guardianForm.phone,
          email: guardianForm.email,
          documentNumber: guardianForm.documentNumber,
          emergencyContact: 'Pendiente',
          authorizedPickup: 'Pendiente',
        },
        planKey,
        memberId: null,
        idempotencyKey: `ext:${check.identityKey}`,
      });
      const res = await repos.coloniaSubmitExternalEnrollment({
        seasonId,
        student: payload.student,
        planKey,
        idempotencyKey: payload.idempotencyKey,
      });
      setMsg(res?.duplicate
        ? 'Ya existía esta solicitud externa.'
        : 'Solicitud externa registrada (sin membresía). Comunicaciones en dry-run. MP Colonia deshabilitado.');
      setStep('done');
    } catch (err) {
      setError(err?.message || 'No se pudo enviar la solicitud.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-in account-view colonia-portal">
      <header className="account-header">
        <button type="button" className="btn btn-ghost" onClick={() => setCurrentView?.('dashboard')}>
          <ArrowLeft size={18} /> Volver
        </button>
        <h1>Colonia · Acceso externo</h1>
      </header>
      <p className="muted">
        Para responsables que no son socios. No otorga membresía del club. Requiere cuenta verificada.
      </p>
      {error ? <p className="alert alert-danger" role="alert">{error}</p> : null}
      {msg ? <p className="alert alert-ok" role="status">{msg}</p> : null}

      {step === 'register' ? (
        <section className="colonia-wizard">
          <h2><ShieldCheck size={18} /> Responsable</h2>
          <label>Nombre</label>
          <input value={guardianForm.fullName} onChange={(e) => setGuardianForm({ ...guardianForm, fullName: e.target.value })} />
          <label>Email</label>
          <input value={guardianForm.email} onChange={(e) => setGuardianForm({ ...guardianForm, email: e.target.value })} />
          <label>Teléfono</label>
          <input value={guardianForm.phone} onChange={(e) => setGuardianForm({ ...guardianForm, phone: e.target.value })} />
          <label>Documento</label>
          <input value={guardianForm.documentNumber} onChange={(e) => setGuardianForm({ ...guardianForm, documentNumber: e.target.value })} />
          <button type="button" className="btn btn-primary" disabled={busy || !registerCheck.ok} onClick={registerGuardian}>
            Continuar
          </button>
        </section>
      ) : null}

      {step === 'verify' ? (
        <section className="colonia-wizard">
          <p>Confirmá la verificación del correo de tu sesión Auth y luego marcá aquí.</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={markVerified}>
            Ya verifiqué mi correo
          </button>
        </section>
      ) : null}

      {step === 'enroll' ? (
        <section className="colonia-wizard">
          <h2><Baby size={18} /> Alumno (no socio)</h2>
          <label>Nombre</label>
          <input value={student.fullName} onChange={(e) => setStudent({ ...student, fullName: e.target.value })} />
          <label>Nacimiento</label>
          <input type="date" value={student.birthDate} onChange={(e) => setStudent({ ...student, birthDate: e.target.value })} />
          <label>Documento</label>
          <input value={student.documentNumber} onChange={(e) => setStudent({ ...student, documentNumber: e.target.value })} />
          <label>Talle remera</label>
          <input value={student.shirtSize} onChange={(e) => setStudent({ ...student, shirtSize: e.target.value })} />
          <label>Plan</label>
          <select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
            <option value="cuota">Cuota</option>
            <option value="temporada">Temporada</option>
            <option value="hermano_4">4º hermano (solo inscripción)</option>
          </select>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submitEnrollment}>
            Enviar solicitud
          </button>
        </section>
      ) : null}

      {step === 'done' ? (
        <section className="colonia-wizard">
          <p>Listo. Administración revisará la solicitud. No se generaron cobros reales ni mails reales.</p>
        </section>
      ) : null}
    </div>
  );
}
