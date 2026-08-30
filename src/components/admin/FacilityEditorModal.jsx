import { useEffect, useMemo, useState } from 'react';
import {
  X, Save, Plus, Copy, Trash2, ChevronDown, ChevronUp, Upload,
} from 'lucide-react';
import ModalDialog from '../ModalDialog';
import {
  FACILITY_STATUS_OPTIONS,
  FACILITY_TYPE_OPTIONS,
  WEEK_DAYS,
  TIME_OPTIONS,
  normalizeFacilityConfig,
  applyFacilityEditorPatch,
} from '../../domain/reservations/facilityConfig';

const SECTIONS = [
  { id: 'datos', label: 'Datos del espacio' },
  { id: 'horarios', label: 'Horarios y precios' },
  { id: 'reglas', label: 'Reglas y restricciones' },
  { id: 'invitados', label: 'Invitados' },
  { id: 'contable', label: 'Información contable' },
  { id: 'terminos', label: 'Términos y condiciones' },
  { id: 'extras', label: 'Servicios adicionales' },
];

function Field({ label, hint, children }) {
  return (
    <label className="fac-edit-field">
      <span className="fac-edit-label">{label}</span>
      <div className="fac-edit-control">
        {children}
        {hint ? <small>{hint}</small> : null}
      </div>
    </label>
  );
}

function Section({ id, openId, setOpenId, label, children }) {
  const open = openId === id;
  return (
    <section className={`fac-edit-section${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="fac-edit-section-head"
        onClick={() => setOpenId(open ? null : id)}
        aria-expanded={open}
      >
        <span>{label}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? <div className="fac-edit-section-body">{children}</div> : null}
    </section>
  );
}

function yesNo(value, onChange) {
  return (
    <select className="form-input" value={value ? 'si' : 'no'} onChange={(e) => onChange(e.target.value === 'si')}>
      <option value="si">Sí</option>
      <option value="no">No</option>
    </select>
  );
}

/**
 * Editor de espacio (datos, horarios, reglas, invitados, contable, términos, extras).
 */
export default function FacilityEditorModal({
  facility,
  catalog = [],
  onClose,
  onSave,
}) {
  const [draft, setDraft] = useState(() => normalizeFacilityConfig(facility));
  const [openSection, setOpenSection] = useState('datos');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(normalizeFacilityConfig(facility));
    setOpenSection('datos');
    setError('');
  }, [facility?.id]);

  const linkedOptions = useMemo(
    () => (catalog || []).filter((f) => f.id !== draft.id),
    [catalog, draft.id]
  );

  const patch = (partial) => setDraft((prev) => ({ ...prev, ...partial }));
  const patchRules = (partial) => setDraft((prev) => ({ ...prev, rules: { ...prev.rules, ...partial } }));
  const patchGuests = (partial) => setDraft((prev) => ({ ...prev, guests: { ...prev.guests, ...partial } }));
  const patchAccounting = (partial) => setDraft((prev) => ({ ...prev, accounting: { ...prev.accounting, ...partial } }));
  const patchTerms = (partial) => setDraft((prev) => ({ ...prev, terms: { ...prev.terms, ...partial } }));
  const patchExtras = (partial) => setDraft((prev) => ({ ...prev, extras: { ...prev.extras, ...partial } }));

  const updateScheduleRow = (day, partial) => {
    setDraft((prev) => ({
      ...prev,
      weeklySchedule: prev.weeklySchedule.map((row) =>
        row.day === day ? { ...row, ...partial } : row
      ),
    }));
  };

  const copyScheduleRow = (day) => {
    const source = draft.weeklySchedule.find((r) => r.day === day);
    if (!source) return;
    setDraft((prev) => ({
      ...prev,
      weeklySchedule: prev.weeklySchedule.map((row) =>
        row.day === day
          ? row
          : { ...row, open: source.open, close: source.close, price: source.price, enabled: source.enabled }
      ),
    }));
  };

  const handleImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patch({ image: String(reader.result || '') });
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!String(draft.name || '').trim()) {
      setError('El nombre del espacio es obligatorio.');
      setOpenSection('datos');
      return;
    }
    onSave?.(applyFacilityEditorPatch(draft));
  };

  if (!facility) return null;

  return (
    <ModalDialog
      onClose={onClose}
      labelledBy="fac-edit-title"
      contentClassName="modal-content glass-panel fac-edit-modal"
      contentStyle={{
        width: 'min(96vw, 820px)',
        maxHeight: '92vh',
        overflow: 'auto',
        padding: '1.15rem 1.25rem 1.35rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
      }}
    >
      <header className="fac-edit-top">
        <div>
          <h3 id="fac-edit-title" className="serif-font">Editar espacio</h3>
          <p>{draft.name || facility.name}</p>
        </div>
        <div className="fac-edit-top-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={14} /> Cerrar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>
            <Save size={14} /> Guardar
          </button>
        </div>
      </header>

      {error ? <p className="conc-error" role="alert">{error}</p> : null}

      <div className="fac-edit-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={openSection === s.id ? 'is-active' : ''}
            onClick={() => setOpenSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Section id="datos" openId={openSection} setOpenId={setOpenSection} label="Datos del espacio">
        <Field label="Nombre" hint="Nombre identificatorio del lugar. Límite 80 caracteres.">
          <input
            className="form-input"
            maxLength={80}
            value={draft.name || ''}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="Estado" hint="Determina la disponibilidad para reservar.">
          <select className="form-input" value={draft.status} onChange={(e) => patch({ status: e.target.value })}>
            {FACILITY_STATUS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Tipo" hint="Tipo del espacio de reservas (agrupador).">
          <select className="form-input" value={draft.spaceType} onChange={(e) => patch({ spaceType: e.target.value })}>
            {FACILITY_TYPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Imagen personalizada" hint="Subí una imagen para mostrar en la app (recomendado ~426×199).">
          <label className="fac-edit-upload">
            <Upload size={14} /> Seleccionar archivo
            <input type="file" accept="image/*" hidden onChange={(e) => handleImage(e.target.files?.[0])} />
          </label>
          {draft.image ? (
            <img src={draft.image} alt="" className="fac-edit-preview" />
          ) : null}
        </Field>
        <Field label="URL directa (soporte)" hint="Opcional. URL pública de imagen.">
          <input
            className="form-input"
            value={draft.externalUrl || ''}
            onChange={(e) => patch({ externalUrl: e.target.value, image: e.target.value || draft.image })}
            placeholder="https://…"
          />
        </Field>
        <Field label="Espacio de reservas vinculado">
          <select
            className="form-input"
            value={draft.linkedFacilityId || ''}
            onChange={(e) => patch({ linkedFacilityId: e.target.value })}
          >
            <option value="">— Ninguno —</option>
            {linkedOptions.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </Field>
        <Field
          label="¿Validar el máximo de reservas como si fueran uno?"
          hint="Ambas configuraciones tienen que estar iguales para evitar confusiones."
        >
          {yesNo(draft.validateMaxAsOne, (v) => patch({ validateMaxAsOne: v }))}
        </Field>
        <Field label="Link externo">
          <input className="form-input" value={draft.externalLink || ''} onChange={(e) => patch({ externalLink: e.target.value })} />
        </Field>
        <Field label="Link externo (mensaje)">
          <input className="form-input" value={draft.externalLinkMsg || ''} onChange={(e) => patch({ externalLinkMsg: e.target.value })} />
        </Field>
        <Field label="Descripción">
          <textarea
            className="form-input"
            rows={3}
            value={draft.description || ''}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
        <Field label="Exterior / Interior">
          {yesNo(Boolean(draft.isOutdoor), (v) => patch({ isOutdoor: v }))}
          <small style={{ display: 'block', marginTop: 4 }}>
            {draft.isOutdoor ? 'Espacio exterior (afectado por Zonda)' : 'Espacio interior'}
          </small>
        </Field>
      </Section>

      <Section id="horarios" openId={openSection} setOpenId={setOpenSection} label="Horarios y precios">
        <div className="fac-sched-table">
          <div className="fac-sched-head">
            <span>Día</span>
            <span>Horario</span>
            <span>Precio</span>
            <span>Hab.</span>
            <span />
          </div>
          {WEEK_DAYS.map((d) => {
            const row = draft.weeklySchedule.find((r) => r.day === d.id) || {
              day: d.id, open: '08:00', close: '22:00', price: 0, enabled: true,
            };
            return (
              <div key={d.id} className="fac-sched-row">
                <span>{d.label}</span>
                <div className="fac-sched-times">
                  <select className="form-input" value={row.open} onChange={(e) => updateScheduleRow(d.id, { open: e.target.value })}>
                    {TIME_OPTIONS.map((t) => <option key={`o-${t}`} value={t}>{t}</option>)}
                  </select>
                  <span>–</span>
                  <select className="form-input" value={row.close} onChange={(e) => updateScheduleRow(d.id, { close: e.target.value })}>
                    {TIME_OPTIONS.map((t) => <option key={`c-${t}`} value={t}>{t}</option>)}
                  </select>
                </div>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  value={row.price}
                  onChange={(e) => updateScheduleRow(d.id, { price: Number(e.target.value) || 0 })}
                />
                <input
                  type="checkbox"
                  checked={Boolean(row.enabled)}
                  onChange={(e) => updateScheduleRow(d.id, { enabled: e.target.checked })}
                  aria-label={`Habilitar ${d.label}`}
                />
                <button type="button" className="btn btn-secondary btn-sm" title="Copiar a todos los días" onClick={() => copyScheduleRow(d.id)}>
                  <Copy size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <p className="fac-edit-hint">
          Configurá distintos días, horarios y precios. Deshabilitá una fila para no usarla sin borrarla.
        </p>
      </Section>

      <Section id="reglas" openId={openSection} setOpenId={setOpenSection} label="Reglas y restricciones">
        <Field label="Crear reserva en estado" hint="Con Pendiente, Secretaría debe aprobarla.">
          <select className="form-input" value={draft.rules.createStatus} onChange={(e) => patchRules({ createStatus: e.target.value })}>
            <option value="approved">Aprobado</option>
            <option value="pending">Pendiente</option>
          </select>
        </Field>
        <Field label="Reporte diario de eventos">
          <label className="fac-edit-check">
            <input type="checkbox" checked={Boolean(draft.rules.dailyReport)} onChange={(e) => patchRules({ dailyReport: e.target.checked })} />
            Incluir este espacio en el reporte diario
          </label>
        </Field>
        <Field label="Horario de envío" hint="Hora del día (0 a 23).">
          <input className="form-input" type="number" min={0} max={23} value={draft.rules.reportHour} onChange={(e) => patchRules({ reportHour: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Email alternativo de recepción">
          <input className="form-input" type="email" value={draft.rules.reportEmail || ''} onChange={(e) => patchRules({ reportEmail: e.target.value })} />
        </Field>
        <Field label="¿Permitir múltiples reservas en un mismo horario?">
          {yesNo(draft.rules.allowMultipleSameSlot, (v) => patchRules({ allowMultipleSameSlot: v }))}
        </Field>
        <Field label="Cantidad de reservas simultáneas permitidas">
          <input className="form-input" type="number" min={1} value={draft.rules.simultaneousMax} onChange={(e) => patchRules({ simultaneousMax: Number(e.target.value) || 1 })} />
        </Field>
        <Field label="Limitar a sólo una reserva aprobada">
          {yesNo(draft.rules.limitOneApproved, (v) => patchRules({ limitOneApproved: v }))}
        </Field>
        <Field label="¿Permitir reservas consecutivas?">
          {yesNo(draft.rules.allowConsecutive, (v) => patchRules({ allowConsecutive: v }))}
        </Field>
        <Field label="¿Prohibir más de una reserva pendiente?">
          {yesNo(draft.rules.forbidMultiplePending, (v) => patchRules({ forbidMultiplePending: v }))}
        </Field>
        <Field label="Duración del turno (horas)">
          <select className="form-input" value={String(draft.rules.slotDurationHours)} onChange={(e) => patchRules({ slotDurationHours: Number(e.target.value) })}>
            <option value="0.5">30 minutos</option>
            <option value="1">1 hora</option>
            <option value="1.5">1,5 horas</option>
            <option value="2">2 horas</option>
            <option value="3">3 horas</option>
            <option value="12">12 horas</option>
          </select>
        </Field>
        <Field label="¿Permitir reserva ampliada?">
          {yesNo(draft.rules.allowExtended, (v) => patchRules({ allowExtended: v }))}
        </Field>
        <Field label="Máximo de reservas en un día">
          <input className="form-input" type="number" min={0} value={draft.rules.maxPerDay} onChange={(e) => patchRules({ maxPerDay: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Máximo de reservas en una semana">
          <input className="form-input" type="number" min={0} value={draft.rules.maxPerWeek} onChange={(e) => patchRules({ maxPerWeek: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Máximo de reservas en un mes">
          <input className="form-input" type="number" min={0} value={draft.rules.maxPerMonth} onChange={(e) => patchRules({ maxPerMonth: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Bloqueo automático temporal (min)" hint="0 = no bloquea.">
          <input className="form-input" type="number" min={0} value={draft.rules.tempBlockMinutes} onChange={(e) => patchRules({ tempBlockMinutes: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Horas previas para reservar">
          <select className="form-input" value={draft.rules.hoursPrior} onChange={(e) => patchRules({ hoursPrior: Number(e.target.value) })}>
            {[0, 1, 2, 6, 12, 24, 48].map((h) => (
              <option key={h} value={h}>{h} {h === 1 ? 'hora' : 'horas'}</option>
            ))}
          </select>
        </Field>
        <Field label="Tiempo de anticipación máximo">
          <select className="form-input" value={draft.rules.advanceDays} onChange={(e) => patchRules({ advanceDays: Number(e.target.value) })}>
            {[7, 15, 30, 60, 90, 180].map((d) => (
              <option key={d} value={d}>{d} días</option>
            ))}
          </select>
        </Field>
        <Field label="Editar / cancelar reservas hasta">
          <select className="form-input" value={draft.rules.editUntilHours} onChange={(e) => patchRules({ editUntilHours: Number(e.target.value) })}>
            {[0, 2, 6, 12, 24, 48].map((h) => (
              <option key={h} value={h}>{h === 0 ? 'Hasta el inicio' : `Hasta ${h} h antes`}</option>
            ))}
          </select>
        </Field>
        <Field label="¿Mostrar fecha y hora de finalización?">
          {yesNo(draft.rules.showEndDateTime, (v) => patchRules({ showEndDateTime: v }))}
        </Field>
        <Field label="¿Mostrar horarios en el calendario?">
          {yesNo(draft.rules.showCalendarHours, (v) => patchRules({ showCalendarHours: v }))}
        </Field>
        <div className="fac-edit-blocks">
          <div className="fac-edit-blocks-head">
            <strong>Bloqueos en calendario</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => patchRules({
                calendarBlocks: [
                  ...(draft.rules.calendarBlocks || []),
                  { id: `blk-${Date.now()}`, start: '', end: '' },
                ],
              })}
            >
              <Plus size={13} /> Agregar bloqueo
            </button>
          </div>
          {(draft.rules.calendarBlocks || []).map((b) => (
            <div key={b.id} className="fac-edit-blocks-row">
              <input className="form-input" type="date" value={b.start || ''} onChange={(e) => patchRules({
                calendarBlocks: draft.rules.calendarBlocks.map((x) => x.id === b.id ? { ...x, start: e.target.value } : x),
              })} />
              <input className="form-input" type="date" value={b.end || ''} onChange={(e) => patchRules({
                calendarBlocks: draft.rules.calendarBlocks.map((x) => x.id === b.id ? { ...x, end: e.target.value } : x),
              })} />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => patchRules({
                  calendarBlocks: draft.rules.calendarBlocks.filter((x) => x.id !== b.id),
                })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section id="invitados" openId={openSection} setOpenId={setOpenSection} label="Invitados">
        <Field label="Capacidad" hint="Cantidad máxima de personas del lugar.">
          <input className="form-input" type="number" min={0} value={draft.guests.capacity} onChange={(e) => patchGuests({ capacity: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="¿Documento requerido para todos los invitados?">
          {yesNo(draft.guests.requireDocument, (v) => patchGuests({ requireDocument: v }))}
        </Field>
        <Field label="¿Restringir invitados a sólo socios?">
          {yesNo(draft.guests.onlyMembers, (v) => patchGuests({ onlyMembers: v }))}
        </Field>
        <Field label="Es posible editar los invitados">
          <select className="form-input" value={draft.guests.editUntil} onChange={(e) => patchGuests({ editUntil: e.target.value })}>
            <option value="before_start">Hasta antes del inicio</option>
            <option value="12h">Hasta 12 h antes</option>
            <option value="never">No editable</option>
          </select>
        </Field>
        <Field label="Cantidad mínima de invitados">
          <input className="form-input" type="number" min={0} value={draft.guests.minGuests} onChange={(e) => patchGuests({ minGuests: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Cantidad máxima de invitados" hint="0 = sin restricción.">
          <input className="form-input" type="number" min={0} value={draft.guests.maxGuests} onChange={(e) => patchGuests({ maxGuests: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="¿Permitir invitados por WhatsApp?">
          {yesNo(draft.guests.whatsappGuests, (v) => patchGuests({ whatsappGuests: v }))}
        </Field>
        <Field label="Máximo de reservas por invitado / día" hint="0 = sin tope.">
          <input className="form-input" type="number" min={0} value={draft.guests.maxReservationsPerGuest} onChange={(e) => patchGuests({ maxReservationsPerGuest: Number(e.target.value) || 0 })} />
        </Field>
      </Section>

      <Section id="contable" openId={openSection} setOpenId={setOpenSection} label="Información contable">
        <Field label="¿Multiplicar el precio en una reserva ampliada?">
          {yesNo(draft.accounting.multiplyExtendedPrice, (v) => patchAccounting({ multiplyExtendedPrice: v }))}
        </Field>
        <Field label="¿Imputar eventos automáticamente?">
          {yesNo(draft.accounting.autoCharge, (v) => patchAccounting({ autoCharge: v }))}
        </Field>
        <Field label="Botón de pago activo">
          {yesNo(draft.accounting.paymentButton, (v) => patchAccounting({ paymentButton: v }))}
        </Field>
        <Field label="Monto límite de deuda para reservar" hint="0 = sin control.">
          <input className="form-input" type="number" min={0} value={draft.accounting.debtLimit} onChange={(e) => patchAccounting({ debtLimit: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Antigüedad límite de deuda">
          <select className="form-input" value={draft.accounting.debtAgeDays} onChange={(e) => patchAccounting({ debtAgeDays: Number(e.target.value) })}>
            {[0, 15, 30, 60, 90].map((d) => (
              <option key={d} value={d}>{d === 0 ? 'Sin control' : `${d} días`}</option>
            ))}
          </select>
        </Field>
        <Field label="Métodos de pago" hint="Vacío = no se solicita forma de pago.">
          <input
            className="form-input"
            value={draft.accounting.paymentMethods || ''}
            onChange={(e) => patchAccounting({ paymentMethods: e.target.value })}
            placeholder="efectivo, mercadopago, transferencia"
          />
        </Field>
        <Field label="Tiempo de tolerancia MP (min)" hint="0 = pedir comprobante al instante.">
          <input className="form-input" type="number" min={0} value={draft.accounting.mpToleranceMinutes} onChange={(e) => patchAccounting({ mpToleranceMinutes: Number(e.target.value) || 0 })} />
        </Field>
        <div className="fac-edit-blocks">
          <div className="fac-edit-blocks-head">
            <strong>Opciones a Mercado Pago</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => patchAccounting({
                mpOptions: [...(draft.accounting.mpOptions || []), { id: `mp-${Date.now()}`, description: '', link: '' }],
              })}
            >
              <Plus size={13} /> Agregar opción
            </button>
          </div>
          {(draft.accounting.mpOptions || []).map((o) => (
            <div key={o.id} className="fac-edit-blocks-row">
              <input className="form-input" placeholder="Descripción" value={o.description || ''} onChange={(e) => patchAccounting({
                mpOptions: draft.accounting.mpOptions.map((x) => x.id === o.id ? { ...x, description: e.target.value } : x),
              })} />
              <input className="form-input" placeholder="Link" value={o.link || ''} onChange={(e) => patchAccounting({
                mpOptions: draft.accounting.mpOptions.map((x) => x.id === o.id ? { ...x, link: e.target.value } : x),
              })} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => patchAccounting({
                mpOptions: draft.accounting.mpOptions.filter((x) => x.id !== o.id),
              })}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section id="terminos" openId={openSection} setOpenId={setOpenSection} label="Términos y condiciones">
        <Field label="¿Reconfirmar términos y condiciones?">
          {yesNo(draft.terms.reconfirm, (v) => patchTerms({ reconfirm: v }))}
        </Field>
        <Field label="Términos y condiciones">
          <textarea
            className="form-input"
            rows={10}
            value={draft.terms.text || ''}
            onChange={(e) => patchTerms({ text: e.target.value })}
          />
        </Field>
      </Section>

      <Section id="extras" openId={openSection} setOpenId={setOpenSection} label="Servicios adicionales">
        <Field label="¿Particularidades obligatorias?">
          {yesNo(draft.extras.mandatoryParticularity, (v) => patchExtras({ mandatoryParticularity: v }))}
        </Field>
        <div className="fac-edit-blocks">
          <div className="fac-edit-blocks-head">
            <strong>Costos por servicios adicionales</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => patchExtras({
                services: [...(draft.extras.services || []), { id: `svc-${Date.now()}`, description: '', price: 0 }],
              })}
            >
              <Plus size={13} /> Agregar
            </button>
          </div>
          {(draft.extras.services || []).map((s) => (
            <div key={s.id} className="fac-edit-blocks-row">
              <input className="form-input" placeholder="Descripción" value={s.description || ''} onChange={(e) => patchExtras({
                services: draft.extras.services.map((x) => x.id === s.id ? { ...x, description: e.target.value } : x),
              })} />
              <input className="form-input" type="number" min={0} placeholder="Precio" value={s.price} onChange={(e) => patchExtras({
                services: draft.extras.services.map((x) => x.id === s.id ? { ...x, price: Number(e.target.value) || 0 } : x),
              })} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => patchExtras({
                services: draft.extras.services.filter((x) => x.id !== s.id),
              })}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <Field label="Error personalizado (combinaciones)">
          <input
            className="form-input"
            value={draft.extras.combinationError || ''}
            onChange={(e) => patchExtras({ combinationError: e.target.value })}
            placeholder="Mensaje al socio si una combinación no está permitida"
          />
        </Field>
      </Section>

      <footer className="fac-edit-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          <Save size={15} /> Guardar cambios
        </button>
      </footer>
    </ModalDialog>
  );
}
