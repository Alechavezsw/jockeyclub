import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import {
  DEFAULT_CLUB_SETTINGS,
  DEFAULT_DUES_SETTINGS,
  DEFAULT_MP_SETTINGS,
  DEFAULT_SYSTEM_RULES,
  mergeClubSettings,
  mergeDuesSettings,
  mergeMercadoPagoSettings,
  mergePoolSettings,
  mergeSystemRules,
  setRuntimeClubSettings,
  SETTINGS_KEYS,
} from '../../domain/system/clubSettings';
import { DEFAULT_POOL_SETTINGS } from '../../domain/pool/poolAccess';
import { SEASON_DUES_GATE_COPY } from '../../domain/pool/seasonDuesGate';
import { setRuntimeDueDay } from '../../domain/members/dues';
import { duesNoticeCalendar } from '../../domain/members/duesNotices';

function Field({ label, hint, children }) {
  return (
    <label className="sys-set-field">
      <span>{label}</span>
      {children}
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

function YesNo({ value, onChange }) {
  return (
    <select
      className="form-input"
      value={value ? 'si' : 'no'}
      onChange={(e) => onChange(e.target.value === 'si')}
    >
      <option value="si">Sí</option>
      <option value="no">No</option>
    </select>
  );
}

export default function SystemSettingsTab({
  clubSettings = DEFAULT_CLUB_SETTINGS,
  setClubSettings,
  duesSettings = DEFAULT_DUES_SETTINGS,
  setDuesSettings,
  poolSettings = DEFAULT_POOL_SETTINGS,
  setPoolSettings,
  isZondaActive = false,
  setIsZondaActive,
  systemRules = DEFAULT_SYSTEM_RULES,
  setSystemRules,
  goToTab,
}) {
  const club = mergeClubSettings(clubSettings);
  const dues = mergeDuesSettings(duesSettings);
  const noticeCal = duesNoticeCalendar(dues.dueDay, dues.noticeAdvanceDays);
  const pool = mergePoolSettings(poolSettings);
  const [clubDraft, setClubDraft] = useState(club);
  const [duesDraft, setDuesDraft] = useState(dues);
  const [poolDraft, setPoolDraft] = useState({
    memberDayFee: pool.memberDayFee,
    guestDayFee: pool.guestDayFee,
    medicalValidityDays: pool.medicalValidityDays,
    maxGuestsPerMember: pool.maxGuestsPerMember,
    seasonLabel: pool.seasonLabel,
    memberCanUploadMedical: pool.memberCanUploadMedical !== false,
    seasonBlocksUnpaidDues: pool.seasonBlocksUnpaidDues !== false,
  });
  const [rulesDraft, setRulesDraft] = useState(() => mergeSystemRules(systemRules));
  const [mpDraft, setMpDraft] = useState(DEFAULT_MP_SETTINGS);
  const [saving, setSaving] = useState('');
  const [note, setNote] = useState('');
  const [health, setHealth] = useState(null);

  useEffect(() => {
    setClubDraft(mergeClubSettings(clubSettings));
  }, [clubSettings]);

  useEffect(() => {
    setDuesDraft(mergeDuesSettings(duesSettings));
  }, [duesSettings]);

  useEffect(() => {
    const next = mergePoolSettings(poolSettings);
    setPoolDraft({
      memberDayFee: next.memberDayFee,
      guestDayFee: next.guestDayFee,
      medicalValidityDays: next.medicalValidityDays,
      maxGuestsPerMember: next.maxGuestsPerMember,
      seasonLabel: next.seasonLabel,
      memberCanUploadMedical: next.memberCanUploadMedical !== false,
      seasonBlocksUnpaidDues: next.seasonBlocksUnpaidDues !== false,
    });
  }, [poolSettings]);

  useEffect(() => {
    setRulesDraft(mergeSystemRules(systemRules));
  }, [systemRules]);

  useEffect(() => {
    let live = true;
    if (!isSupabaseConfigured) return undefined;
    repos.getSetting(SETTINGS_KEYS.mercadopago)
      .then((row) => { if (live) setMpDraft(mergeMercadoPagoSettings(row || {})); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    if (!isSupabaseConfigured) {
      setHealth({ ok: false, error: 'Sin URL de Supabase en este equipo.' });
      return undefined;
    }
    repos.healthCheck()
      .then((row) => { if (live) setHealth(row); })
      .catch((err) => { if (live) setHealth({ ok: false, error: err.message }); });
    return () => { live = false; };
  }, []);

  const persist = async (key, value) => {
    if (!isSupabaseConfigured) return;
    await repos.setSetting(key, value);
  };

  const saveClub = async () => {
    const next = mergeClubSettings(clubDraft);
    setSaving('club');
    setNote('');
    try {
      setClubSettings?.(next);
      setRuntimeClubSettings(next);
      await persist(SETTINGS_KEYS.club, next);
      setNote('Sede guardada en el libro.');
    } catch (err) {
      setNote(err.message || 'No se pudo guardar la sede.');
    } finally {
      setSaving('');
    }
  };

  const saveDues = async () => {
    const next = mergeDuesSettings(duesDraft);
    setSaving('dues');
    setNote('');
    try {
      setDuesSettings?.(next);
      setRuntimeDueDay(next.dueDay);
      await persist(SETTINGS_KEYS.dues, next);
      setNote(`El vencimiento quedó el día ${next.dueDay}. Avisos: ${next.noticeAdvanceDays} días antes, el ${next.dueDay} y el ${next.noticeMoraDay}.`);
    } catch (err) {
      setNote(err.message || 'No se pudo guardar el vencimiento.');
    } finally {
      setSaving('');
    }
  };

  const savePool = async () => {
    const next = mergePoolSettings({
      ...pool,
      memberDayFee: Math.max(0, Number(poolDraft.memberDayFee) || 0),
      guestDayFee: Math.max(0, Number(poolDraft.guestDayFee) || 0),
      medicalValidityDays: Math.max(1, Number(poolDraft.medicalValidityDays) || 365),
      maxGuestsPerMember: Math.max(0, Number(poolDraft.maxGuestsPerMember) || 0),
      seasonLabel: poolDraft.seasonLabel,
      memberCanUploadMedical: poolDraft.memberCanUploadMedical !== false,
      seasonBlocksUnpaidDues: poolDraft.seasonBlocksUnpaidDues !== false,
    });
    setSaving('pool');
    setNote('');
    try {
      setPoolSettings?.(next);
      await persist(SETTINGS_KEYS.pool, next);
      setNote('Canon de pileta guardado en el libro.');
    } catch (err) {
      setNote(err.message || 'No se pudo guardar la pileta.');
    } finally {
      setSaving('');
    }
  };

  const saveMp = async () => {
    const next = mergeMercadoPagoSettings(mpDraft);
    setSaving('mp');
    setNote('');
    try {
      await persist(SETTINGS_KEYS.mercadopago, next);
      setMpDraft(next);
      setNote(next.enabled
        ? 'Mercado Pago quedó prendido. El token vive en las secretas de Supabase.'
        : 'Mercado Pago quedó apagado.');
    } catch (err) {
      setNote(err.message || 'No se pudo guardar Mercado Pago.');
    } finally {
      setSaving('');
    }
  };

  const saveRules = async () => {
    const next = mergeSystemRules(rulesDraft);
    setSaving('rules');
    setNote('');
    try {
      setSystemRules?.(next);
      await persist(SETTINGS_KEYS.system, next);
      setNote('Reglas del club guardadas en el libro.');
    } catch (err) {
      setNote(err.message || 'No se pudieron guardar las reglas.');
    } finally {
      setSaving('');
    }
  };

  return (
    <section className="sys-set" aria-label="Configuración del sistema">
      <header className="sys-set-hero">
        <div>
          <p className="jev-desk-kicker">Sistema</p>
          <h2 className="jev-desk-name">Configuración</h2>
          <p className="jev-desk-sub">
            Lo que acá se guarda vive en el libro. Pileta, cuotas y el pie del portal leen estos valores.
          </p>
        </div>
        <p className={`sys-set-health${health?.ok ? ' is-ok' : ''}`}>
          {health == null ? 'Leyendo el libro…' : health.ok ? 'Libro conectado' : 'Libro no responde'}
        </p>
      </header>

      {note ? <p className="sys-set-note" role="status">{note}</p> : null}

      <div className="sys-set-board">
        <article className="sys-set-card is-wide">
          <header>
            <p>Sede</p>
            <b>Nombre, domicilio y CUIT. El pie del portal y el libre deuda leen esto.</b>
          </header>
          <div className="sys-set-grid">
            <Field label="Nombre">
              <input className="form-input" value={clubDraft.name} onChange={(e) => setClubDraft((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="Razón social">
              <input className="form-input" value={clubDraft.legalName} onChange={(e) => setClubDraft((p) => ({ ...p, legalName: e.target.value }))} />
            </Field>
            <Field label="Domicilio">
              <input className="form-input" value={clubDraft.address} onChange={(e) => setClubDraft((p) => ({ ...p, address: e.target.value }))} />
            </Field>
            <Field label="Ciudad">
              <input className="form-input" value={clubDraft.city} onChange={(e) => setClubDraft((p) => ({ ...p, city: e.target.value }))} />
            </Field>
            <Field label="Código postal">
              <input className="form-input" value={clubDraft.postalCode} onChange={(e) => setClubDraft((p) => ({ ...p, postalCode: e.target.value }))} />
            </Field>
            <Field label="CUIT">
              <input className="form-input" value={clubDraft.cuit} onChange={(e) => setClubDraft((p) => ({ ...p, cuit: e.target.value }))} />
            </Field>
            <Field label="Teléfono">
              <input className="form-input" value={clubDraft.phone} onChange={(e) => setClubDraft((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            <Field label="Correo">
              <input className="form-input" type="email" value={clubDraft.email} onChange={(e) => setClubDraft((p) => ({ ...p, email: e.target.value }))} />
            </Field>
          </div>
          <button type="button" className="jev-slip-go" onClick={saveClub} disabled={saving === 'club'}>
            {saving === 'club' ? 'Guardando…' : 'Guardar sede'}
          </button>
        </article>

        <article className="sys-set-card">
          <header>
            <p>Cuotas</p>
            <b>Vencimiento, tolerancia de pago y período de gracia de la credencial.</b>
          </header>
          <div className="sys-set-grid is-tight">
            <Field label="Vence el día" hint="Del 1 al 28. Hoy el club cobra el 10.">
              <input
                className="form-input"
                type="number"
                min={1}
                max={28}
                value={duesDraft.dueDay}
                onChange={(e) => setDuesDraft((p) => ({ ...p, dueDay: e.target.value }))}
              />
            </Field>
            <Field label="Tolerancia de pago" hint="Diferencia en pesos que no genera saldo.">
              <input
                className="form-input"
                type="number"
                min={0}
                value={duesDraft.paymentTolerance}
                onChange={(e) => setDuesDraft((p) => ({ ...p, paymentTolerance: e.target.value }))}
              />
            </Field>
            <Field label="Gracia de la credencial" hint="Días antes de mostrar deuda. 0 la muestra al instante.">
              <input
                className="form-input"
                type="number"
                min={0}
                value={duesDraft.gracePeriodDays}
                onChange={(e) => setDuesDraft((p) => ({ ...p, gracePeriodDays: e.target.value }))}
              />
            </Field>
            <Field label="Deuda máxima" hint="0 no limita el ingreso por deuda.">
              <input
                className="form-input"
                type="number"
                min={0}
                value={duesDraft.maxGroupDebt}
                onChange={(e) => setDuesDraft((p) => ({ ...p, maxGroupDebt: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Cuenta protegida hasta" hint="Hasta esta fecha no se reescriben movimientos ya cerrados.">
            <input
              className="form-input"
              type="date"
              value={duesDraft.accountProtectDate}
              onChange={(e) => setDuesDraft((p) => ({ ...p, accountProtectDate: e.target.value }))}
            />
          </Field>
          <label className="mp-edit-check" style={{ marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={duesDraft.showCurrentAccountsToMembers !== false}
              onChange={(e) => setDuesDraft((p) => ({ ...p, showCurrentAccountsToMembers: e.target.checked }))}
            />
            Los socios pueden ver su cuenta corriente
          </label>
          <div className="sys-set-actions">
            <button type="button" className="jev-slip-go" onClick={saveDues} disabled={saving === 'dues'}>
              {saving === 'dues' ? 'Guardando…' : 'Guardar vencimiento'}
            </button>
            {typeof goToTab === 'function' ? (
              <button type="button" className="btn btn-secondary" onClick={() => goToTab('dues')}>Ir a Cuotas</button>
            ) : null}
          </div>
        </article>

        <article className="sys-set-card is-wide">
          <header>
            <p>Regla de avisos</p>
            <b>
              Queda guardada en el libro. Mensaje interno y mail reales, con las consecuencias de mora.
            </b>
          </header>
          <ol className="sys-set-beats">
            <li>
              <b>{noticeCal.upcomingDay}</b>
              <span>
                Cinco días antes. Mensaje y mail: la cuota está por vencer y qué pasa si entra en mora.
              </span>
            </li>
            <li>
              <b>{noticeCal.dueDay}</b>
              <span>
                El día que vence. Mensaje y mail: hoy vence, sin recargo si se abona hoy.
              </span>
            </li>
            <li>
              <b>{noticeCal.moraDay}</b>
              <span>
                Después del vencimiento. Mensaje y mail: ya está en mora.
              </span>
            </li>
          </ol>
          <p className="sys-set-label">Consecuencias de mora</p>
          <ul className="sys-set-hint">
            {(dues.moraConsequences || []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>

        <article className="sys-set-card">
          <header>
            <p>Pileta</p>
            <b>Canon del día y reglas de la temporada. La caja de pileta usa estos números.</b>
          </header>
          <div className="sys-set-grid is-tight">
            <Field label="Canon socio">
              <input className="form-input" type="number" min={0} value={poolDraft.memberDayFee} onChange={(e) => setPoolDraft((p) => ({ ...p, memberDayFee: e.target.value }))} />
            </Field>
            <Field label="Canon invitado">
              <input className="form-input" type="number" min={0} value={poolDraft.guestDayFee} onChange={(e) => setPoolDraft((p) => ({ ...p, guestDayFee: e.target.value }))} />
            </Field>
            <Field label="Apto médico (días)">
              <input className="form-input" type="number" min={1} value={poolDraft.medicalValidityDays} onChange={(e) => setPoolDraft((p) => ({ ...p, medicalValidityDays: e.target.value }))} />
            </Field>
            <Field label="Invitados por socio">
              <input className="form-input" type="number" min={0} value={poolDraft.maxGuestsPerMember} onChange={(e) => setPoolDraft((p) => ({ ...p, maxGuestsPerMember: e.target.value }))} />
            </Field>
          </div>
          <Field label="Nombre de la temporada">
            <input className="form-input" value={poolDraft.seasonLabel} onChange={(e) => setPoolDraft((p) => ({ ...p, seasonLabel: e.target.value }))} />
          </Field>
          <Field label="El socio carga el apto médico" hint="Si está en No, solo lo carga administración.">
            <select
              className="form-input"
              value={poolDraft.memberCanUploadMedical ? 'si' : 'no'}
              onChange={(e) => setPoolDraft((p) => ({ ...p, memberCanUploadMedical: e.target.value === 'si' }))}
            >
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field
            label="Mora desde el 10 bloquea el ingreso"
            hint="En temporada (diciembre a marzo). Vale para sede y pileta."
          >
            <YesNo
              value={poolDraft.seasonBlocksUnpaidDues !== false}
              onChange={(on) => setPoolDraft((p) => ({ ...p, seasonBlocksUnpaidDues: on }))}
            />
          </Field>
          <p className="sys-set-hint">
            {SEASON_DUES_GATE_COPY.lead}
            {' '}
            {SEASON_DUES_GATE_COPY.mora}
          </p>
          <div className="sys-set-actions">
            <button type="button" className="jev-slip-go" onClick={savePool} disabled={saving === 'pool'}>
              {saving === 'pool' ? 'Guardando…' : 'Guardar pileta'}
            </button>
            {typeof goToTab === 'function' ? (
              <button type="button" className="btn btn-secondary" onClick={() => goToTab('pool')}>Ir a Pileta</button>
            ) : null}
          </div>
        </article>

        <article className="sys-set-card">
          <header>
            <p>Mercado Pago</p>
            <b>Tres productos: cobro online en el portal, QR en caja o pileta, y suscripción mensual. El access token no se guarda acá: va en las secretas de Supabase (MP_ACCESS_TOKEN), de la cuenta del club.</b>
          </header>
          <Field label="Cobros habilitados" hint="Si está en No, no se abre ni el checkout, ni el QR, ni la adhesión.">
            <YesNo value={mpDraft.enabled} onChange={(on) => setMpDraft((p) => ({ ...p, enabled: on }))} />
          </Field>
          <Field label="Caja QR" hint="Identificador de la caja en Mercado Pago (external_id). Se crea sola la primera vez.">
            <input
              className="form-input"
              value={mpDraft.posId}
              onChange={(e) => setMpDraft((p) => ({ ...p, posId: e.target.value }))}
            />
          </Field>
          <ul className="sys-set-hint">
            <li><strong>Online.</strong> Checkout Pro: el socio paga en Mi cuenta y vuelve a https://www.jockeyclubsj.com.ar/cuenta.</li>
            <li><strong>En el lugar.</strong> QR dinámico en caja y pileta. El socio escanea con la app.</li>
            <li><strong>Suscripción.</strong> Débito de la cuota del mes, el día 10. Vitalicio, fundador y comisión no se pueden adherir.</li>
          </ul>
          <p className="sys-set-hint">
            Token de la cuenta del club: secreta MP_ACCESS_TOKEN. Webhook: https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/mp-webhook
            (tópicos payment, merchant_order, order, subscription_preapproval y subscription_authorized_payment).
            Opcional: MP_WEBHOOK_SECRET para validar la firma.
          </p>
          <button type="button" className="jev-slip-go" onClick={saveMp} disabled={saving === 'mp'}>
            {saving === 'mp' ? 'Guardando…' : 'Guardar Mercado Pago'}
          </button>
        </article>

        <article className="sys-set-card is-wide">
          <header>
            <p>Reglas del club</p>
            <b>Tutores, comunicaciones, boleto de pago y teléfonos útiles, como están en la configuración de Lila.</b>
          </header>
          <div className="sys-set-grid is-tight">
            <Field label="Tutores por grupo" hint="Incluye al titular. 0 no limita.">
              <input
                className="form-input"
                type="number"
                min={0}
                value={rulesDraft.maxTutorsPerFamily}
                onChange={(e) => setRulesDraft((p) => ({ ...p, maxTutorsPerFamily: e.target.value }))}
              />
            </Field>
            <Field label="Recordatorio" hint="Días para recordar una comunicación.">
              <input
                className="form-input"
                type="number"
                min={0}
                value={rulesDraft.communicationsReminderDays}
                onChange={(e) => setRulesDraft((p) => ({ ...p, communicationsReminderDays: e.target.value }))}
              />
            </Field>
            <Field label="Portería autoriza pileta" hint="Si está en Sí, portería puede dejar pasar sin inscripción o apto.">
              <YesNo
                value={Boolean(rulesDraft.guardCanOverridePool || rulesDraft.guardOverrides?.length)}
                onChange={(on) => setRulesDraft((p) => ({
                  ...p,
                  guardCanOverridePool: on,
                  guardOverrides: on ? (p.guardOverrides?.length ? p.guardOverrides : ['pileta']) : [],
                }))}
              />
            </Field>
            <Field label="Titular en comunicaciones" hint="Si está en Sí, el titular entra en los avisos del grupo.">
              <YesNo
                value={rulesDraft.addTitularToCommunications !== false}
                onChange={(on) => setRulesDraft((p) => ({ ...p, addTitularToCommunications: on }))}
              />
            </Field>
            <Field label="Mostrar boleto de pago">
              <YesNo
                value={rulesDraft.showPaymentTicket !== false}
                onChange={(on) => setRulesDraft((p) => ({ ...p, showPaymentTicket: on }))}
              />
            </Field>
            <Field label="Nombre en el boleto">
              <YesNo
                value={rulesDraft.showMemberNameOnTicket !== false}
                onChange={(on) => setRulesDraft((p) => ({ ...p, showMemberNameOnTicket: on }))}
              />
            </Field>
            <Field label="Recargos en el boleto">
              <YesNo
                value={rulesDraft.showSurchargesOnTicket !== false}
                onChange={(on) => setRulesDraft((p) => ({ ...p, showSurchargesOnTicket: on }))}
              />
            </Field>
            <Field label="Avisos de pago con aprobación">
              <YesNo
                value={rulesDraft.paymentNoticesRequireApproval === true}
                onChange={(on) => setRulesDraft((p) => ({ ...p, paymentNoticesRequireApproval: on }))}
              />
            </Field>
            <Field label="Elegir débito familiar">
              <YesNo
                value={rulesDraft.allowFamilyDebitChoice === true}
                onChange={(on) => setRulesDraft((p) => ({ ...p, allowFamilyDebitChoice: on }))}
              />
            </Field>
          </div>

          <div className="sys-set-stack">
            <p className="sys-set-label">Teléfonos útiles</p>
            <div className="sys-set-rows">
              {(rulesDraft.usefulPhones || []).map((row, index) => (
                <div key={`phone-${index}`} className="sys-set-row">
                  <input
                    className="form-input"
                    placeholder="Nombre"
                    value={row.name}
                    onChange={(e) => setRulesDraft((p) => ({
                      ...p,
                      usefulPhones: (p.usefulPhones || []).map((item, i) => (
                        i === index ? { ...item, name: e.target.value } : item
                      )),
                    }))}
                  />
                  <input
                    className="form-input"
                    placeholder="Teléfono"
                    value={row.phone}
                    onChange={(e) => setRulesDraft((p) => ({
                      ...p,
                      usefulPhones: (p.usefulPhones || []).map((item, i) => (
                        i === index ? { ...item, phone: e.target.value } : item
                      )),
                    }))}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setRulesDraft((p) => ({
                      ...p,
                      usefulPhones: (p.usefulPhones || []).filter((_, i) => i !== index),
                    }))}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRulesDraft((p) => ({
                ...p,
                usefulPhones: [...(p.usefulPhones || []), { name: '', phone: '' }],
              }))}
            >
              Agregar teléfono
            </button>
          </div>

          <div className="sys-set-stack">
            <p className="sys-set-label">Motivos de comunicación</p>
            <em className="sys-set-hint">Cada motivo tiene su plazo de respuesta en días.</em>
            <div className="sys-set-rows">
              {(rulesDraft.communicationReasons || []).map((row, index) => (
                <div key={`reason-${index}`} className="sys-set-row is-reason">
                  <input
                    className="form-input"
                    placeholder="Motivo"
                    value={row.description}
                    onChange={(e) => setRulesDraft((p) => ({
                      ...p,
                      communicationReasons: (p.communicationReasons || []).map((item, i) => (
                        i === index ? { ...item, description: e.target.value } : item
                      )),
                    }))}
                  />
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    aria-label="Días de respuesta"
                    value={row.responseDays}
                    onChange={(e) => setRulesDraft((p) => ({
                      ...p,
                      communicationReasons: (p.communicationReasons || []).map((item, i) => (
                        i === index ? { ...item, responseDays: e.target.value } : item
                      )),
                    }))}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setRulesDraft((p) => ({
                      ...p,
                      communicationReasons: (p.communicationReasons || []).filter((_, i) => i !== index),
                    }))}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRulesDraft((p) => ({
                ...p,
                communicationReasons: [...(p.communicationReasons || []), { description: '', responseDays: 3 }],
              }))}
            >
              Agregar motivo
            </button>
          </div>

          <Field label="Categorías de gastos" hint="Una por línea. Las usa tesorería.">
            <textarea
              className="form-input"
              rows={7}
              value={(rulesDraft.expenseCategories || []).join('\n')}
              onChange={(e) => setRulesDraft((p) => ({
                ...p,
                expenseCategories: e.target.value.split('\n'),
              }))}
            />
          </Field>
          <button type="button" className="jev-slip-go" onClick={saveRules} disabled={saving === 'rules'}>
            {saving === 'rules' ? 'Guardando…' : 'Guardar reglas'}
          </button>
        </article>

        <article className="sys-set-card is-wide is-zonda">
          <header>
            <p>Zonda</p>
            <b>Si se declara, se cierran las canchas al aire libre y Alertas avisa.</b>
          </header>
          <div className="sys-set-zonda">
            <p>{isZondaActive ? 'Exterior suspendido.' : 'Sin alerta declarada.'}</p>
            <button
              type="button"
              className={`sys-set-switch${isZondaActive ? ' is-on' : ''}`}
              aria-pressed={isZondaActive}
              onClick={() => setIsZondaActive?.(!isZondaActive)}
            >
              {isZondaActive ? 'Desactivar' : 'Declarar Zonda'}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
