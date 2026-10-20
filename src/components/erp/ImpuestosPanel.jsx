import { useEffect, useMemo, useState } from 'react';
import { Receipt, Scale, LayoutDashboard } from 'lucide-react';
import { getPostableAccounts, accountLabel } from '../../domain/accounting/chartOfAccounts';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  DEFAULT_FISCAL_PROFILE,
  FISCAL_CONDITIONS,
  IVA_ALIQUOTS,
  PAYMENT_TERMS,
  RECEIPT_LETTERS,
  VOUCHER_BOOKS,
  buildLiveImpuestos,
  createComprobante,
  currentTaxPeriod,
  liquidatePeriod,
  voucherTotals,
} from '../../domain/accounting/impuestos';
import { todayISODateAR } from '../../lib/arDate';

const VIEWS = [
  { id: 'tablero', label: 'Tablero', icon: LayoutDashboard },
  { id: 'comprobantes', label: 'Comprobantes', icon: Receipt },
  { id: 'liquidar', label: 'Liquidar', icon: Scale },
];

function emptyLine() {
  return { detail: '', quantity: 1, unitPrice: '', bonusPercent: 0, aliquotId: 'exento' };
}

function formatIsoDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  if (!y || !m || !d) return iso || '—';
  return `${d}/${m}/${y}`;
}

export default function ImpuestosPanel({
  comprobantes = [],
  liquidaciones = [],
  perfilFiscal = DEFAULT_FISCAL_PROFILE,
  retenciones = [],
  expenses = [],
  otherIncomes = [],
  journalEntries = [],
  chartOfAccounts = [],
  onSavePerfil,
  onSaveComprobante,
  onVoidComprobante,
  onSaveLiquidacion,
  onPostLiquidacion,
  onPayLiquidacion,
}) {
  const [view, setView] = useState('tablero');
  const [profile, setProfile] = useState(() => ({ ...DEFAULT_FISCAL_PROFILE, ...perfilFiscal }));
  const [book, setBook] = useState('venta');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [postJournal, setPostJournal] = useState(true);
  const [period, setPeriod] = useState(() => currentTaxPeriod());
  const [kind, setKind] = useState('iva');
  const [form, setForm] = useState(() => ({
    letter: 'C',
    date: todayISODateAR(),
    counterpartyName: '',
    cuit: '',
    number: '',
    paymentTerm: 'contado',
    paymentAccountId: '',
    incomeAccountId: '',
    expenseAccountId: '',
    amount: '',
    taxKind: 'iva',
    lines: [emptyLine()],
  }));

  useEffect(() => {
    setProfile({
      ...DEFAULT_FISCAL_PROFILE,
      ...perfilFiscal,
      condition: perfilFiscal?.condition || DEFAULT_FISCAL_PROFILE.condition,
      jurisdiction: perfilFiscal?.jurisdiction || DEFAULT_FISCAL_PROFILE.jurisdiction,
      iibbPercent: perfilFiscal?.iibbPercent ?? DEFAULT_FISCAL_PROFILE.iibbPercent,
      pointOfSale: perfilFiscal?.pointOfSale || DEFAULT_FISCAL_PROFILE.pointOfSale,
    });
  }, [
    perfilFiscal?.condition,
    perfilFiscal?.jurisdiction,
    perfilFiscal?.iibbPercent,
    perfilFiscal?.pointOfSale,
  ]);

  const bookMeta = VOUCHER_BOOKS.find((item) => item.id === book);
  const incomeAccounts = getPostableAccounts(chartOfAccounts).filter((account) => account.accountType === 'income');
  const expenseAccounts = getPostableAccounts(chartOfAccounts).filter((account) => account.accountType === 'expense');
  const paymentAccounts = getPostableAccounts(chartOfAccounts).filter((account) => account.isCashAccount || account.code === '1.1.03');

  const live = useMemo(
    () => buildLiveImpuestos({
      vouchers: comprobantes,
      retenciones,
      expenses,
      otherIncomes,
      journalEntries,
      chartOfAccounts,
      profile,
      period,
    }),
    [comprobantes, retenciones, expenses, otherIncomes, journalEntries, chartOfAccounts, profile, period],
  );

  const visible = comprobantes.filter((row) => (
    row.book === book
    && row.status !== 'void'
    && (row.period || String(row.date || '').slice(0, 7)) === period
  ));
  const board = live.board;

  const saveProfile = async () => {
    setError('');
    try {
      await onSavePerfil?.({ ...profile, iibbPercent: Number(profile.iibbPercent) || 0 });
      setOk('Perfil fiscal guardado.');
    } catch (err) {
      setError(err.message || 'No se pudo guardar el perfil.');
    }
  };

  const submitVoucher = async (event) => {
    event.preventDefault();
    setError('');
    setOk('');
    try {
      const voucher = createComprobante({
        ...form,
        book,
        amount: form.amount === '' ? 0 : Number(form.amount),
        condition: profile.condition,
        iibbPercent: Number(profile.iibbPercent) || 0,
        pointOfSale: profile.pointOfSale,
      }, profile);
      await onSaveComprobante?.(voucher, { postJournal: postJournal && bookMeta?.lines });
      setOk('Comprobante registrado.');
      setForm((current) => ({
        ...current,
        counterpartyName: '',
        cuit: '',
        number: '',
        amount: '',
        date: todayISODateAR(),
        lines: [emptyLine()],
      }));
    } catch (err) {
      setError(err.message || 'No se pudo registrar el comprobante.');
    }
  };

  const liquidate = async () => {
    setError('');
    setOk('');
    try {
      const existing = liquidaciones.find((row) => row.period === period && row.kind === kind && row.status !== 'void');
      if (existing?.status === 'closed' || existing?.status === 'paid') {
        throw new Error('Esa liquidación ya está cerrada.');
      }
      const next = liquidatePeriod({
        period,
        kind,
        vouchers: live.vouchersForLiquidation,
        retenciones,
        profile,
      });
      await onSaveLiquidacion?.({ ...existing, ...next, id: existing?.id || next.id, status: 'open' });
      setOk(`Liquidación de ${kind.toUpperCase()} ${period} actualizada.`);
      setView('liquidar');
    } catch (err) {
      setError(err.message || 'No se pudo liquidar.');
    }
  };

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Impuestos</h3>
          <p className="mb-folio-meta">
            Posición de IVA e IIBB al {live.asOfLabel}. Gastos, otros ingresos y retenciones del mes entran solos.
            Las cuotas no se facturan. No presenta nada ante ARCA.
          </p>
        </div>
        <span className="mb-folio-seal">{live.periodLabel}</span>
      </header>

      <form
        onSubmit={(event) => { event.preventDefault(); saveProfile(); }}
        style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: '1rem' }}
      >
        <div>
          <label className="form-label">Condición</label>
          <select className="form-input" value={profile.condition} onChange={(event) => setProfile({ ...profile, condition: event.target.value })}>
            {FISCAL_CONDITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Jurisdicción IIBB</label>
          <input className="form-input" value={profile.jurisdiction || ''} onChange={(event) => setProfile({ ...profile, jurisdiction: event.target.value })} />
        </div>
        <div>
          <label className="form-label">Alícuota IIBB %</label>
          <input type="number" min="0" step="0.01" className="form-input" value={profile.iibbPercent} onChange={(event) => setProfile({ ...profile, iibbPercent: event.target.value })} />
        </div>
        <div>
          <label className="form-label">Punto de venta</label>
          <input className="form-input" value={profile.pointOfSale || ''} onChange={(event) => setProfile({ ...profile, pointOfSale: event.target.value })} />
        </div>
        <div>
          <label className="form-label">Período</label>
          <input type="month" className="form-input" value={period} onChange={(event) => setPeriod(event.target.value)} />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button type="submit" className="btn btn-secondary btn-sm">Guardar perfil</button>
        </div>
      </form>

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi is-net">
          <dt>IVA a pagar</dt>
          <dd>{formatCurrency(board?.iva?.aPagar || 0)}</dd>
          <p>{board?.iva?.aFavor ? `A favor ${formatCurrency(board.iva.aFavor)}` : profile.condition === 'exento' ? 'Exento' : 'Sin saldo'}</p>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>IIBB a pagar</dt>
          <dd>{formatCurrency(board?.iibb?.aPagar || 0)}</dd>
          <p>{Number(profile.iibbPercent) ? `${profile.iibbPercent} % ${profile.jurisdiction || ''}`.trim() : 'Alícuota 0 %'}</p>
        </div>
        <div className="mb-folio-kpi">
          <dt>Retenciones</dt>
          <dd>{formatCurrency(live.retencionesAmount)}</dd>
          <p>{live.retencionesCount.toLocaleString('es-AR')} en tesorería</p>
        </div>
        <div className="mb-folio-kpi">
          <dt>Cobros del mes</dt>
          <dd>{formatCurrency(live.cashIn)}</dd>
          <p>Egresos {formatCurrency(live.cashOut)}</p>
        </div>
      </dl>

      <div className="acct-treasury-hub" role="tablist" aria-label="Impuestos" style={{ marginTop: '1rem' }}>
        {VIEWS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`acct-treasury-hub-item${view === item.id ? ' is-active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <Icon size={14} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </div>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}
      {ok ? <p className="mb-folio-status" style={{ color: 'var(--emerald-accent)' }}>{ok}</p> : null}

      {view === 'tablero' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          <p className="mb-folio-meta">
            En {live.periodLabel} hay {formatCurrency(live.cashIn)} cobrados en tesorería
            {live.bookIncome ? ` y ${formatCurrency(live.bookIncome)} de ingresos del libro` : ''}.
            Las cuotas y los cobros no se facturan. Un comprobante registrado pisa el gasto o ingreso vivo del mismo origen.
          </p>
          <div className="table-responsive">
            <table className="admin-table cash-lila-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Contraparte</th>
                  <th>Concepto</th>
                  <th>IVA</th>
                  <th>IIBB</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {live.activity.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="mb-folio-empty">
                      No hay movimientos de {live.periodLabel} en el libro, ni retenciones o comprobantes.
                    </td>
                  </tr>
                ) : live.activity.map((row) => (
                  <tr key={row.id}>
                    <td>{row.origin === 'libro' || row.origin === 'cobro' || row.origin === 'egreso' ? live.periodLabel : formatIsoDate(row.date)}</td>
                    <td>{row.originLabel}</td>
                    <td>{row.party || '—'}</td>
                    <td>{row.concept || '—'}</td>
                    <td>{row.iva ? formatCurrency(row.iva) : '—'}</td>
                    <td>{row.iibb ? formatCurrency(row.iibb) : '—'}</td>
                    <td style={{ fontWeight: 700 }}>{formatCurrency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'comprobantes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {VOUCHER_BOOKS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`btn btn-sm ${book === item.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setBook(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={submitVoucher} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {bookMeta?.lines ? (
              <div>
                <label className="form-label">Tipo</label>
                <select className="form-input" value={form.letter} onChange={(event) => setForm({ ...form, letter: event.target.value })}>
                  {RECEIPT_LETTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
            ) : null}
            <div>
              <label className="form-label">Fecha</label>
              <input type="date" required className="form-input" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </div>
            <div>
              <label className="form-label">{book === 'compra' ? 'Proveedor' : 'Cliente / agente'}</label>
              <input required className="form-input" value={form.counterpartyName} onChange={(event) => setForm({ ...form, counterpartyName: event.target.value })} />
            </div>
            <div>
              <label className="form-label">Número</label>
              <input className="form-input" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
            </div>
            {bookMeta?.lines ? (
              <>
                <div>
                  <label className="form-label">Pago</label>
                  <select className="form-input" value={form.paymentTerm} onChange={(event) => setForm({ ...form, paymentTerm: event.target.value })}>
                    {PAYMENT_TERMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">{book === 'venta' ? 'Cuenta de ingreso' : 'Cuenta de gasto'}</label>
                  <select
                    className="form-input"
                    value={book === 'venta' ? form.incomeAccountId : form.expenseAccountId}
                    onChange={(event) => setForm(book === 'venta'
                      ? { ...form, incomeAccountId: event.target.value }
                      : { ...form, expenseAccountId: event.target.value })}
                  >
                    <option value="">Según plan</option>
                    {(book === 'venta' ? incomeAccounts : expenseAccounts).map((account) => (
                      <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Caja / banco</label>
                  <select className="form-input" value={form.paymentAccountId} onChange={(event) => setForm({ ...form, paymentAccountId: event.target.value })}>
                    <option value="">Caja general</option>
                    {paymentAccounts.map((account) => (
                      <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="form-label">Importe</label>
                  <input type="number" step="0.01" required className="form-input" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
                </div>
                <div>
                  <label className="form-label">Impuesto</label>
                  <select className="form-input" value={form.taxKind} onChange={(event) => setForm({ ...form, taxKind: event.target.value })}>
                    <option value="iva">IVA</option>
                    <option value="iibb">IIBB</option>
                    <option value="ganancias">Ganancias</option>
                    <option value="suss">SUSS</option>
                  </select>
                </div>
              </>
            )}
            {bookMeta?.lines ? form.lines.map((line, index) => (
              <div key={index} style={{ gridColumn: '1 / -1', display: 'grid', gap: '0.5rem', gridTemplateColumns: '2fr 0.6fr 1fr 1fr' }}>
                <input className="form-input" placeholder="Detalle" value={line.detail} onChange={(event) => {
                  const lines = [...form.lines];
                  lines[index] = { ...line, detail: event.target.value };
                  setForm({ ...form, lines });
                }} />
                <input type="number" min="0" step="0.01" className="form-input" placeholder="Cant." value={line.quantity} onChange={(event) => {
                  const lines = [...form.lines];
                  lines[index] = { ...line, quantity: event.target.value };
                  setForm({ ...form, lines });
                }} />
                <input type="number" min="0" step="0.01" className="form-input" placeholder="Precio" value={line.unitPrice} onChange={(event) => {
                  const lines = [...form.lines];
                  lines[index] = { ...line, unitPrice: event.target.value };
                  setForm({ ...form, lines });
                }} />
                <select className="form-input" value={line.aliquotId} onChange={(event) => {
                  const lines = [...form.lines];
                  lines[index] = { ...line, aliquotId: event.target.value };
                  setForm({ ...form, lines });
                }}>
                  {IVA_ALIQUOTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
            )) : null}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {bookMeta?.lines ? (
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={postJournal} onChange={(event) => setPostJournal(event.target.checked)} />
                  Contabilizar
                </label>
              ) : null}
              <button type="submit" className="btn btn-primary btn-sm">Registrar</button>
            </div>
          </form>

          <p className="mb-folio-meta">{visible.length.toLocaleString('es-AR')} registrados en {live.periodLabel}</p>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Contraparte</th>
                  <th>Número</th>
                  <th>Neto</th>
                  <th>IVA</th>
                  <th>IIBB</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={8} className="mb-folio-empty">No hay comprobantes registrados en este libro y período.</td></tr>
                ) : visible.map((row) => {
                  const totals = row.totals || voucherTotals(row, profile);
                  return (
                    <tr key={row.id}>
                      <td>{formatIsoDate(row.date)}</td>
                      <td>{row.counterpartyName}</td>
                      <td>{row.number || '—'}</td>
                      <td>{formatCurrency(totals.net)}</td>
                      <td>{formatCurrency(totals.iva)}</td>
                      <td>{formatCurrency(totals.iibb)}</td>
                      <td>{formatCurrency(totals.total)}</td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onVoidComprobante?.(row)}>Anular</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'liquidar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          <p className="mb-folio-meta">
            La liquidación usa comprobantes registrados más la actividad viva del período.
            Contabilizar pasa el débito y el crédito al saldo a pagar.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <div>
              <label className="form-label">Liquidación</label>
              <select className="form-input" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="iva">IVA</option>
                <option value="iibb">IIBB</option>
              </select>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={liquidate}>Liquidar {live.periodLabel}</button>
          </div>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Tipo</th>
                  <th>Débito</th>
                  <th>Crédito</th>
                  <th>A pagar</th>
                  <th>A favor</th>
                  <th>Ret. practicadas</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {liquidaciones.length === 0 ? (
                  <tr><td colSpan={9} className="mb-folio-empty">Todavía no hay una liquidación cerrada. Elegí IVA o IIBB y liquidá {live.periodLabel}.</td></tr>
                ) : liquidaciones.map((row) => (
                  <tr key={row.id}>
                    <td>{row.period}</td>
                    <td>{String(row.kind || '').toUpperCase()}</td>
                    <td>{formatCurrency(row.debito)}</td>
                    <td>{formatCurrency(row.credito)}</td>
                    <td>{formatCurrency(row.aPagar)}</td>
                    <td>{formatCurrency(row.aFavor)}</td>
                    <td>{formatCurrency(row.retencionesPracticadas)}</td>
                    <td>{row.status === 'paid' ? 'Pagada' : row.status === 'closed' ? 'Cerrada' : 'Abierta'}</td>
                    <td style={{ display: 'flex', gap: '0.35rem' }}>
                      {row.status === 'open' ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => {
                          setError('');
                          try { await onPostLiquidacion?.(row); setOk('Liquidación contabilizada.'); }
                          catch (err) { setError(err.message || 'No se pudo contabilizar.'); }
                        }}>Contabilizar</button>
                      ) : null}
                      {row.status !== 'paid' && row.aPagar > 0 && (row.kind === 'iibb' || row.status === 'closed') ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => {
                          setError('');
                          try { await onPayLiquidacion?.(row, form.paymentAccountId); setOk('Pago registrado en tesorería.'); }
                          catch (err) { setError(err.message || 'No se pudo registrar el pago.'); }
                        }}>Pagar</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
