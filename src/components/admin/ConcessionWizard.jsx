import { useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronLeft, ChevronRight, Upload, FileText, KeyRound, Link2,
} from 'lucide-react';
import {
  CONCESSION_TYPES,
  CONCESSION_SPACES,
  CHECKLIST_ITEMS,
  DOC_TYPES,
  REQUIRED_DOC_TYPES,
  ONBOARDING_STEPS,
  createConcession,
  missingRequiredDocuments,
} from '../../domain/concessions/concessions';
import { isSupabaseConfigured } from '../../lib/supabase';
import { uploadConcessionDocument, validateConcessionDocFile } from '../../data/storage';

const EMPTY_FORM = {
  name: '',
  type: 'tienda',
  concessionaire: '',
  concessionaireNumber: '',
  cuit: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  location: '',
  spaceId: 'space-proshop',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  noticeDays: '30',
  monthlyFee: '',
  revenueSharePct: '0',
  deposit: '',
  autoRenew: false,
  notes: '',
  statusManual: 'active',
};

/**
 * Alta de concesión por pasos: datos → vigencia → documentos (subida inmediata) → cierre.
 */
export default function ConcessionWizard({
  concessions = [],
  saveConcession,
  addDocToConcession,
  toggleConcessionChecklist,
  findSpaceOverlap,
  onCancel,
  onDone,
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingType, setUploadingType] = useState(null);

  const missing = useMemo(
    () => (draft ? missingRequiredDocuments(draft) : [...REQUIRED_DOC_TYPES]),
    [draft]
  );

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const validateDatos = () => {
    if (!form.name.trim()) throw new Error('Indicá el nombre de la concesión.');
    if (!form.concessionaire.trim()) throw new Error('Indicá el nombre del concesionario.');
    if (!form.concessionaireNumber.trim()) throw new Error('Indicá el número del concesionario.');
    if (!form.spaceId) throw new Error('Elegí el espacio del club.');
  };

  const validateVigencia = () => {
    if (!form.endDate) throw new Error('Indicá la fecha de vencimiento.');
    if (form.startDate && form.endDate < form.startDate) {
      throw new Error('El vencimiento no puede ser anterior al inicio.');
    }
    if (typeof findSpaceOverlap === 'function') {
      const overlap = findSpaceOverlap(concessions, {
        spaceId: form.spaceId,
        startDate: form.startDate,
        endDate: form.endDate,
        excludeId: draft?.id,
      });
      if (overlap) {
        throw new Error(`El espacio ya está ocupado por «${overlap.name}» en ese período.`);
      }
    }
  };

  const persistDraft = async () => {
    validateDatos();
    validateVigencia();
    if (!saveConcession) throw new Error('Guardado no disponible.');

    const payload = createConcession({
      ...form,
      ...(draft?.id ? { id: draft.id } : {}),
      portalCode: draft?.portalCode,
      checklist: draft?.checklist,
      documents: draft?.documents || [],
      noticeDays: Number(form.noticeDays) || 30,
      monthlyFee: Number(form.monthlyFee) || 0,
      revenueSharePct: Number(form.revenueSharePct) || 0,
      deposit: Number(form.deposit) || 0,
    });

    const isDbId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(draft?.id || '')
    );
    const toSave = isDbId
      ? {
        ...payload,
        id: draft.id,
        portalCode: draft.portalCode,
        documents: draft.documents || [],
        checklist: draft.checklist,
      }
      : payload;

    const saved = await saveConcession(toSave);
    setDraft(saved);
    return saved;
  };

  const goNext = async () => {
    setError('');
    setBusy(true);
    try {
      if (step === 0) {
        validateDatos();
        setStep(1);
      } else if (step === 1) {
        await persistDraft();
        setStep(2);
      } else if (step === 2) {
        if (missing.length > 0) {
          throw new Error(`Subí los documentos obligatorios: ${missing.map((t) => DOC_TYPES[t]).join(', ')}.`);
        }
        setStep(3);
      } else {
        onDone?.(draft);
      }
    } catch (err) {
      setError(err?.message || 'No se pudo continuar.');
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setError('');
    setStep((s) => Math.max(0, s - 1));
  };

  const uploadDoc = async (type, file) => {
    if (!draft?.id) {
      setError('Primero guardá vigencia (paso anterior).');
      return;
    }
    setError('');
    setUploadingType(type);
    try {
      validateConcessionDocFile(file);
      if (!isSupabaseConfigured) {
        throw new Error('Para subir archivos necesitás Supabase configurado.');
      }
      const uploaded = await uploadConcessionDocument(file, {
        concessionId: draft.id,
        type,
      });
      const saved = await addDocToConcession(draft.id, {
        type,
        name: uploaded.name,
        url: uploaded.url,
        path: uploaded.path,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
        note: `${DOC_TYPES[type]} subido en el alta`,
      }, draft);
      if (CHECKLIST_ITEMS.some((i) => i.id === type) && toggleConcessionChecklist) {
        toggleConcessionChecklist(draft.id, type, true);
      }
      setDraft(saved || {
        ...draft,
        documents: [
          ...(draft.documents || []),
          {
            id: `doc-${Date.now()}`,
            type,
            name: uploaded.name,
            url: uploaded.url,
            path: uploaded.path,
          },
        ],
      });
    } catch (err) {
      setError(err?.message || 'No se pudo subir el documento.');
    } finally {
      setUploadingType(null);
    }
  };

  const docsByType = (type) => (draft?.documents || []).filter((d) => d.type === type);

  return (
    <div className="glass-card conc-wizard">
      <div className="conc-wizard-head">
        <div>
          <h3>Alta de concesión (por pasos)</h3>
          <p>Paso a paso: datos del concesionario (con número), vigencia, documentos y cierre.</p>
        </div>
        <ol className="conc-wizard-steps" aria-label="Pasos del alta">
          {ONBOARDING_STEPS.map((s, idx) => (
            <li
              key={s.id}
              className={[
                idx === step ? 'is-current' : '',
                idx < step ? 'is-done' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="conc-wizard-step-num">
                {idx < step ? <CheckCircle2 size={14} /> : idx + 1}
              </span>
              <span className="conc-wizard-step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="conc-wizard-desc">{ONBOARDING_STEPS[step]?.description}</p>

      {step === 0 && (
        <div className="conc-form-grid">
          <div>
            <label className="form-label">Nombre del local / concesión *</label>
            <input className="form-input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Ej: Proveeduría" />
          </div>
          <div>
            <label className="form-label">Tipo</label>
            <select className="form-input" value={form.type} onChange={(e) => setField('type', e.target.value)}>
              {Object.entries(CONCESSION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Espacio del club *</label>
            <select className="form-input" value={form.spaceId} onChange={(e) => setField('spaceId', e.target.value)}>
              {CONCESSION_SPACES.map((s) => (
                <option key={s.id} value={s.id}>{s.area} · {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Nombre del concesionario *</label>
            <input
              className="form-input"
              value={form.concessionaire}
              onChange={(e) => setField('concessionaire', e.target.value)}
              placeholder="Razón social o titular"
            />
          </div>
          <div>
            <label className="form-label">Nº del concesionario *</label>
            <input
              className="form-input"
              value={form.concessionaireNumber}
              onChange={(e) => setField('concessionaireNumber', e.target.value)}
              placeholder="Legajo / código interno"
              required
            />
          </div>
          <div>
            <label className="form-label">Teléfono del concesionario</label>
            <input
              className="form-input"
              value={form.contactPhone}
              onChange={(e) => setField('contactPhone', e.target.value)}
              placeholder="+54 9 264…"
              inputMode="tel"
            />
          </div>
          <div>
            <label className="form-label">CUIT</label>
            <input className="form-input" value={form.cuit} onChange={(e) => setField('cuit', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Persona de contacto</label>
            <input className="form-input" value={form.contactName} onChange={(e) => setField('contactName', e.target.value)} placeholder="Nombre" />
          </div>
          <div>
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={form.contactEmail} onChange={(e) => setField('contactEmail', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Ubicación / nota física</label>
            <input className="form-input" value={form.location} onChange={(e) => setField('location', e.target.value)} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="conc-form-grid">
          <div>
            <label className="form-label">Inicio</label>
            <input type="date" className="form-input" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Vencimiento *</label>
            <input type="date" className="form-input" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Aviso (días)</label>
            <input type="number" min="1" className="form-input" value={form.noticeDays} onChange={(e) => setField('noticeDays', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Canon mensual</label>
            <input type="number" min="0" className="form-input" value={form.monthlyFee} onChange={(e) => setField('monthlyFee', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Depósito / garantía</label>
            <input type="number" min="0" className="form-input" value={form.deposit} onChange={(e) => setField('deposit', e.target.value)} />
          </div>
          <div>
            <label className="form-label">% participación</label>
            <input type="number" min="0" max="100" className="form-input" value={form.revenueSharePct} onChange={(e) => setField('revenueSharePct', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Notas</label>
            <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="conc-doc-steps">
          {!draft?.id && (
            <p className="conc-notes">Se creará el contrato al entrar a este paso. Volvé atrás si falta algún dato.</p>
          )}
          {REQUIRED_DOC_TYPES.map((type, idx) => {
            const files = docsByType(type);
            const done = files.length > 0;
            return (
              <article key={type} className={`conc-doc-card${done ? ' is-done' : ''}`}>
                <header>
                  <span className="conc-doc-card-step">Paso {idx + 1}</span>
                  <h4>{DOC_TYPES[type]}</h4>
                  <span className={`conc-badge ${done ? 'is-ok' : 'is-warn'}`}>
                    {done ? 'Cargado' : 'Pendiente'}
                  </span>
                </header>
                <p>PDF o foto · máx. 10 MB</p>
                <label className="conc-doc-upload">
                  <Upload size={14} />
                  {uploadingType === type ? 'Subiendo…' : done ? 'Reemplazar / agregar otro' : 'Elegir archivo y subir'}
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={Boolean(uploadingType) || busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void uploadDoc(type, file);
                    }}
                  />
                </label>
                {files.length > 0 && (
                  <ul className="conc-doc-file-list">
                    {files.map((d) => (
                      <li key={d.id}>
                        <FileText size={14} />
                        <strong>{d.name || DOC_TYPES[type]}</strong>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer">Ver archivo</a>
                        ) : (
                          <em>Sin enlace</em>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}

      {step === 3 && draft && (
        <div className="conc-wizard-close">
          <div className="conc-portal-box">
            <p><KeyRound size={16} /> Portal del concesionario</p>
            <code className="conc-portal-code">{draft.portalCode || '—'}</code>
            <p className="conc-notes">
              <Link2 size={12} style={{ display: 'inline' }} />{' '}
              <a href={`/concesionario/${draft.portalCode}`} target="_blank" rel="noreferrer">
                /concesionario/{draft.portalCode}
              </a>
            </p>
          </div>
          <ul className="conc-check-list">
            {CHECKLIST_ITEMS.filter((i) => i.phase !== 'exit').map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(draft.checklist?.[item.id])}
                    onChange={(e) => {
                      toggleConcessionChecklist?.(draft.id, item.id, e.target.checked);
                      setDraft((d) => ({
                        ...d,
                        checklist: { ...(d.checklist || {}), [item.id]: e.target.checked },
                      }));
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="conc-error" role="alert">{error}</p>}

      <div className="conc-wizard-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={step === 0 ? onCancel : goBack} disabled={busy || Boolean(uploadingType)}>
          {step === 0 ? 'Cancelar' : <><ChevronLeft size={14} /> Atrás</>}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void goNext()} disabled={busy || Boolean(uploadingType)}>
          {busy ? 'Guardando…' : step === 3 ? 'Finalizar' : <>Siguiente <ChevronRight size={14} /></>}
        </button>
      </div>
    </div>
  );
}
