import { useMemo, useState } from 'react';
import { Percent, Plus, Play, Trash2, X } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  INTEREST_PERIODS,
  INTEREST_RUN_STATUS,
  activeInterestGenerators,
  createInterestGenerator,
  interestRunsNewestFirst,
  periodLabel,
  runInterestGenerator,
  selectMembersForInterest,
} from '../../domain/accounting/interestGenerators';

const EMPTY_FORM = {
  identifier: '',
  duesDescription: '',
  period: 'manual',
  separateEntries: false,
  percentage: '0.0',
  includeMembers: '',
  excludeMembers: '',
  tolerance: '0.0',
  duesFrom: '',
  duesTo: '',
};

function Section({ title, children }) {
  return (
    <section className="ig-section">
      <h5 className="ig-section-title">{title}</h5>
      <div className="ig-section-body">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="ig-field">
      <label className="ig-field-label">{label}</label>
      {children}
      {hint ? <p className="ig-field-hint">{hint}</p> : null}
    </div>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

export default function InterestGeneratorPanel({
  generators = [],
  runs = [],
  members = [],
  onUpsertGenerator,
  onDeleteGenerator,
  onRunGenerator,
  onCancelRun,
}) {
  const [view, setView] = useState('list'); // list | form
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [runningId, setRunningId] = useState(null);

  const activeGens = useMemo(() => activeInterestGenerators(generators), [generators]);
  const runRows = useMemo(() => interestRunsNewestFirst(runs), [runs]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setError('');
    setOk('');
    setView('form');
  };

  const setF = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submitCreate = (e) => {
    e.preventDefault();
    setError('');
    try {
      const item = createInterestGenerator({
        ...form,
        separateEntries: form.separateEntries === true || form.separateEntries === 'true',
        percentage: Number(form.percentage),
        tolerance: Number(form.tolerance),
      });
      onUpsertGenerator?.(item);
      setOk(`Generador “${item.identifier}” creado.`);
      setView('list');
    } catch (err) {
      setError(err.message || 'No se pudo crear el generador.');
    }
  };

  const handleRun = (generator) => {
    setError('');
    setOk('');
    try {
      const preview = selectMembersForInterest(members, generator);
      if (!preview.length) {
        throw new Error('No hay socios con saldo elegible para este generador.');
      }
      const result = runInterestGenerator({
        generator,
        members,
        imputationDate: runDate,
      });
      onRunGenerator?.(result);
      setOk(
        `Se generaron ${result.run.entriesCreated} entradas · ${formatCurrency(result.run.totalAmount)}.`
      );
      setRunningId(null);
    } catch (err) {
      setError(err.message || 'No se pudo generar intereses.');
    }
  };

  if (view === 'form') {
    return (
      <div className="fade-in ig-panel">
        <div className="ig-panel-head">
          <h4 className="ig-panel-title">Crear un generador de intereses</h4>
        </div>

        <form className="ig-form" onSubmit={submitCreate}>
          <Section title="Identificación">
            <Field
              label="Identificador"
              hint="Nombre que sólo será visto por el administrador para poder identificar el generador"
            >
              <input
                className="form-input"
                value={form.identifier}
                onChange={(e) => setF('identifier', e.target.value)}
                required
              />
            </Field>
            <Field
              label="Descripción en cuotas"
              hint="Nombre que será visible en las cuentas corrientes. NOTA: Si se deja en blanco el sistema asignará una descripción por defecto"
            >
              <input
                className="form-input"
                value={form.duesDescription}
                onChange={(e) => setF('duesDescription', e.target.value)}
              />
            </Field>
          </Section>

          <Section title="¿En qué momento desea que se generen?">
            <Field label="Período" hint="Periodo en el que se aplican los intereses">
              <select
                className="form-input"
                value={form.period}
                onChange={(e) => setF('period', e.target.value)}
              >
                {INTEREST_PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="¿De qué forma desea que se generen?">
            <Field
              label="¿Generar entradas separadas?"
              hint="Al generarse los intereses se generará una entrada con el monto total de los intereses o una por cada entrada impaga"
            >
              <select
                className="form-input"
                value={form.separateEntries ? 'true' : 'false'}
                onChange={(e) => setF('separateEntries', e.target.value === 'true')}
              >
                <option value="false">No</option>
                <option value="true">Sí</option>
              </select>
            </Field>
            <Field label="Porcentaje" hint="Porcentaje que se aplicará al monto adeudado">
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.001"
                value={form.percentage}
                onChange={(e) => setF('percentage', e.target.value)}
              />
            </Field>
            <Field
              label="Socios"
              hint="Números de socio separados por coma. Vacío = todos los que deban."
            >
              <input
                className="form-input"
                value={form.includeMembers}
                onChange={(e) => setF('includeMembers', e.target.value)}
                placeholder="Ej. 10208, 10536"
              />
            </Field>
            <Field label="Excluir socios" hint="Números de socio a excluir, separados por coma">
              <input
                className="form-input"
                value={form.excludeMembers}
                onChange={(e) => setF('excludeMembers', e.target.value)}
                placeholder="Ej. 10001"
              />
            </Field>
          </Section>

          <Section title="¿Sobre qué conceptos desea que se contemplen?">
            <Field
              label="Tolerancia"
              hint="Falta de pago permitida en las cuotas para no generar intereses. Ejemplo: si la cuota es de $ 10000 y la tolerancia es $ 0,10, un pago de $ 9999,90 no genera interés."
            >
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={form.tolerance}
                onChange={(e) => setF('tolerance', e.target.value)}
              />
            </Field>
          </Section>

          <Section title="Opciones avanzadas">
            <Field
              label="Cuotas a partir del"
              hint="Se seleccionarán las entradas impagas a partir de la fecha seleccionada. NOTA: Si se deja en blanco, se tomarán las entradas desde el inicio de la actividad."
            >
              <div className="ig-date-row">
                <input
                  className="form-input"
                  type="date"
                  value={form.duesFrom}
                  onChange={(e) => setF('duesFrom', e.target.value)}
                />
                {form.duesFrom ? (
                  <button type="button" className="ig-clear-date" onClick={() => setF('duesFrom', '')} aria-label="Limpiar">
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </Field>
            <Field
              label="Cuotas hasta el"
              hint="Se seleccionarán las entradas impagas hasta la fecha seleccionada. NOTA: Si se deja en blanco, será siempre al día actual."
            >
              <div className="ig-date-row">
                <input
                  className="form-input"
                  type="date"
                  value={form.duesTo}
                  onChange={(e) => setF('duesTo', e.target.value)}
                />
                {form.duesTo ? (
                  <button type="button" className="ig-clear-date" onClick={() => setF('duesTo', '')} aria-label="Limpiar">
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </Field>
          </Section>

          {error ? <p className="ig-error">{error}</p> : null}

          <div className="ig-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>
              Volver
            </button>
            <button type="submit" className="btn cash-lila-purple-btn">
              Crear
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="fade-in ig-panel">
      <div className="ig-panel-head">
        <h4 className="ig-panel-title">
          <Percent size={18} /> Generador de intereses
        </h4>
        <button type="button" className="btn cash-lila-purple-btn" onClick={openCreate}>
          <Plus size={14} /> Intereses
        </button>
      </div>

      {error ? <p className="ig-error">{error}</p> : null}
      {ok ? <p className="ig-ok">{ok}</p> : null}

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Identificador</th>
              <th>Porcentaje</th>
              <th>Período</th>
              <th>Fecha de liquidación</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {activeGens.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  No se encontraron resultados
                </td>
              </tr>
            ) : (
              activeGens.map((g, idx) => (
                <tr key={g.id}>
                  <td>{idx + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{g.identifier}</div>
                    {g.duesDescription ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.duesDescription}</div>
                    ) : null}
                  </td>
                  <td>{Number(g.percentage).toFixed(3)} %</td>
                  <td>{periodLabel(g.period)}</td>
                  <td>{g.settlementDate || '—'}</td>
                  <td>
                    <div className="cash-lila-row-actions">
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-cc"
                        title="Generar ahora"
                        aria-label="Generar ahora"
                        onClick={() => setRunningId(g.id)}
                      >
                        <Play size={13} />
                      </button>
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-del"
                        title="Eliminar"
                        aria-label="Eliminar"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar generador “${g.identifier}”?`)) {
                            onDeleteGenerator?.(g.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {runningId ? (
        <div className="ig-run-box">
          <strong>Generar intereses</strong>
          <p className="ig-field-hint" style={{ marginTop: 0 }}>
            Fecha de imputación de las entradas creadas sobre saldos de cuotas.
          </p>
          <div className="ig-run-row">
            <input
              type="date"
              className="form-input"
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
            />
            <button
              type="button"
              className="btn cash-lila-purple-btn"
              onClick={() => {
                const gen = activeGens.find((g) => g.id === runningId);
                if (gen) handleRun(gen);
              }}
            >
              Confirmar generación
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setRunningId(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <h5 className="ig-history-title">Historial de generaciones</h5>
      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha imputación</th>
              <th>Creado el</th>
              <th>Generador de intereses</th>
              <th>Estado</th>
              <th>Entradas creadas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {runRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.78rem' }}>
                  No se han generado intereses anteriormente
                </td>
              </tr>
            ) : (
              runRows.map((r, idx) => (
                <tr key={r.id}>
                  <td>{idx + 1}</td>
                  <td>{r.imputationDate || '—'}</td>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>{r.generatorLabel}</td>
                  <td>{INTEREST_RUN_STATUS[r.status] || r.status}</td>
                  <td>
                    {r.entriesCreated}
                    {r.totalAmount != null ? (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                        ({formatCurrency(r.totalAmount)})
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {r.status === 'completed' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          if (window.confirm('¿Anular esta generación? Se revertirá el saldo imputado.')) {
                            onCancelRun?.(r.id);
                          }
                        }}
                      >
                        Anular
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
