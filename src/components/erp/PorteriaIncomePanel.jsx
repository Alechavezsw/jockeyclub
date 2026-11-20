import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, ChevronLeft, ChevronRight, Download, Loader2,
} from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  createOtherIncome,
  isPorteriaIncomeItem,
  OTHER_INCOME_PAYMENT_METHODS,
  PORTERIA_TABLE_PAGE_SIZE,
  totalAmountHintFromNotes,
} from '../../domain/accounting/otherIncomes';
import { downloadPorteriaIncomeReceiptPdf } from '../../domain/accounting/exportPorteriaIncomeReceiptPdf';
import { repos } from '../../data/bootstrap';
import { formatInstantAR, todayAR } from '../../lib/arDate';

const KINDS = [
  { id: 'porteria', label: 'Portería', concept: 'Rendición portería' },
  { id: 'estacionamiento', label: 'Estacionamiento', concept: 'Rendición estacionamiento' },
];

const PAY_METHODS = [
  { id: 'efectivo', label: OTHER_INCOME_PAYMENT_METHODS.efectivo },
  { id: 'mercadopago', label: OTHER_INCOME_PAYMENT_METHODS.mercadopago },
];

function entryLabel(item) {
  const name = String(item?.renderedBy || item?.payerName || '').trim();
  const kind = /estacionamiento/i.test(String(item?.concept || ''))
    ? 'Rendición estacionamiento'
    : 'Rendición portería';
  return name ? `${kind} — rindió ${name}` : kind;
}

export default function PorteriaIncomePanel({
  items = [],
  onCreate,
  rendererId = '',
  rendererName = '',
  rendererIsPorter = false,
  receiverId = '',
  receiverName = '',
}) {
  const [date, setDate] = useState(todayAR);
  const [kind, setKind] = useState('porteria');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [amount, setAmount] = useState('');
  const [detail, setDetail] = useState('');
  const [bookNumber, setBookNumber] = useState('');
  const [porters, setPorters] = useState([]);
  const [porterId, setPorterId] = useState('');
  const [tablePage, setTablePage] = useState(0);
  const [loadingPorters, setLoadingPorters] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportingId, setExportingId] = useState('');

  const rows = useMemo(
    () => (items || []).filter(isPorteriaIncomeItem),
    [items],
  );
  const visibleRows = useMemo(() => {
    const scoped = (rendererIsPorter && rendererId)
      ? rows.filter((item) => {
        const id = String(item.renderedById || '').trim();
        if (id) return id === rendererId;
        return String(item.renderedBy || item.payerName || '').trim().toLowerCase()
          === String(rendererName || '').trim().toLowerCase();
      })
      : rows;
    return scoped.toSorted((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate) return byDate;
      return String(b.createdAt || b.id || '').localeCompare(String(a.createdAt || a.id || ''));
    });
  }, [rows, rendererIsPorter, rendererId, rendererName]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PORTERIA_TABLE_PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages - 1);
  const pageRows = visibleRows.slice(
    safePage * PORTERIA_TABLE_PAGE_SIZE,
    (safePage + 1) * PORTERIA_TABLE_PAGE_SIZE,
  );
  const pageFrom = visibleRows.length === 0 ? 0 : safePage * PORTERIA_TABLE_PAGE_SIZE + 1;
  const pageTo = Math.min(visibleRows.length, (safePage + 1) * PORTERIA_TABLE_PAGE_SIZE);

  useEffect(() => {
    setTablePage(0);
  }, [visibleRows.length]);

  useEffect(() => {
    let cancelled = false;
    setLoadingPorters(true);
    repos.listGateOperators()
      .then((list) => {
        if (cancelled) return;
        const next = Array.isArray(list) ? list : [];
        const selfName = String(rendererName || '').trim();
        const withSelf = rendererIsPorter && rendererId && selfName && !next.some((row) => row.id === rendererId)
          ? [...next, { id: rendererId, fullName: selfName }]
          : next;
        withSelf.sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
        setPorters(withSelf);
        setPorterId((current) => {
          if (current && withSelf.some((row) => row.id === current)) return current;
          if (rendererId && withSelf.some((row) => row.id === rendererId)) return rendererId;
          return withSelf.length === 1 ? withSelf[0].id : '';
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'No se pudieron cargar los porteros.');
      })
      .finally(() => {
        if (!cancelled) setLoadingPorters(false);
      });
    return () => { cancelled = true; };
  }, [rendererId, rendererName, rendererIsPorter]);

  const selectedPorter = porters.find((row) => row.id === porterId) || null;
  const whoReceives = String(receiverName || rendererName || '').trim();

  const exportReceipt = async (item) => {
    if (!item?.id) return;
    setError('');
    setExportingId(item.id);
    try {
      await downloadPorteriaIncomeReceiptPdf(item);
      setOk(`Recibo listo para enviar · ${formatCurrency(item.amount)}`);
    } catch (err) {
      setError(err?.message || 'No se pudo exportar el recibo.');
    } finally {
      setExportingId('');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setOk('');
    const name = String(selectedPorter?.fullName || '').trim();
    if (!selectedPorter || !name) {
      setError('Elegí el portero que rinde.');
      return;
    }
    const description = detail.trim();
    const book = bookNumber.trim();
    if (!description) {
      setError('Escribí la descripción.');
      return;
    }
    if (!book) {
      setError('Indicá el número de talonario.');
      return;
    }
    const entered = Number(amount);
    if (!(entered > 0)) {
      setError('Indicá el importe.');
      return;
    }
    const hinted = totalAmountHintFromNotes(description);
    if (hinted && Math.abs(hinted - entered) >= 1) {
      setError(
        `La descripción habla de un total de ${formatCurrency(hinted)} y el importe cargado es ${formatCurrency(entered)}. Igualalos antes de registrar.`,
      );
      return;
    }
    const preset = KINDS.find((item) => item.id === kind) || KINDS[0];
    const method = PAY_METHODS.some((item) => item.id === paymentMethod) ? paymentMethod : 'efectivo';
    setBusy(true);
    try {
      const income = createOtherIncome({
        date,
        payerType: 'manual',
        payerName: name,
        renderedBy: name,
        renderedById: selectedPorter.id,
        receivedBy: whoReceives,
        receivedById: String(receiverId || rendererId || '').trim(),
        concept: preset.concept,
        group: 'porteria',
        paymentMethod: method,
        amount: entered,
        notes: description,
        bookNumber: book,
      });
      if (typeof onCreate !== 'function') throw new Error('Guardado no disponible.');
      const saved = await onCreate(income);
      const receipt = saved && typeof saved === 'object' ? { ...income, ...saved } : income;
      setOk(`${preset.label} · ${income.paymentMethodLabel} · talonario ${book} · rindió ${name} · ${formatCurrency(income.amount)}`);
      setAmount('');
      setDetail('');
      setBookNumber('');
      setPaymentMethod('efectivo');
      try {
        await downloadPorteriaIncomeReceiptPdf(receipt);
      } catch {
        /* el cobro ya quedó; el PDF se puede bajar del listado */
      }
    } catch (err) {
      setError(err.message || 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in gate-income">
      <form className="glass-card gate-income-form" onSubmit={submit}>
        <div className="gate-income-head">
          <h4 className="serif-font gate-income-title">
            <Banknote size={18} aria-hidden="true" /> Ingresos de portería
          </h4>
          <p>
            Efectivo a caja · Mercado Pago a la cuenta MP. El asiento nombra al portero que rinde.
            Al registrar se descarga el recibo para enviárselo.
          </p>
        </div>

        <div className="gate-income-kinds" role="radiogroup" aria-label="Qué se rinde">
          {KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={kind === item.id}
              className={`gate-income-kind${kind === item.id ? ' is-on' : ''}`}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="gate-income-kinds" role="radiogroup" aria-label="Tipo de pago">
          {PAY_METHODS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={paymentMethod === item.id}
              className={`gate-income-kind${paymentMethod === item.id ? ' is-on' : ''}`}
              onClick={() => setPaymentMethod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="gate-income-field">
          <span>Fecha</span>
          <input
            type="date"
            className="form-input"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="gate-income-field">
          <span>Importe</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="form-input"
            required
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="gate-income-field">
          <span>Descripción</span>
          <input
            className="form-input"
            required
            value={detail}
            placeholder="Qué se está rindiendo"
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
        <label className="gate-income-field">
          <span>Nº de talonario</span>
          <input
            className="form-input"
            required
            value={bookNumber}
            inputMode="numeric"
            placeholder="145"
            onChange={(event) => setBookNumber(event.target.value)}
          />
        </label>
        <label className="gate-income-field">
          <span>Portero</span>
          <select
            className="form-input"
            required
            value={porterId}
            disabled={loadingPorters || porters.length === 0}
            onChange={(event) => setPorterId(event.target.value)}
          >
            <option value="">{loadingPorters ? 'Cargando porteros…' : 'Elegí el portero'}</option>
            {porters.map((porter) => (
              <option key={porter.id} value={porter.id}>{porter.fullName}</option>
            ))}
          </select>
        </label>

        {error ? <p className="gate-income-error" role="alert">{error}</p> : null}
        {ok ? <p className="gate-income-ok" role="status">{ok}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Registrando…' : 'Registrar rendición'}
        </button>
      </form>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Talonario</th>
              <th>Pago</th>
              <th>Descripción</th>
              <th>Entrada</th>
              <th>Importe</th>
              <th>Recibo</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7}>Todavía no hay rendiciones de portería.</td>
              </tr>
            ) : pageRows.map((item) => (
              <tr key={item.id}>
                <td>{formatInstantAR(item.date)}</td>
                <td className="tabular-nums">{item.bookNumber || '—'}</td>
                <td>{item.paymentMethodLabel || OTHER_INCOME_PAYMENT_METHODS[item.paymentMethod] || 'Efectivo'}</td>
                <td>{item.notes || '—'}</td>
                <td>{entryLabel(item)}</td>
                <td className="tabular-nums">{formatCurrency(item.amount)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary gate-income-receipt-btn"
                    disabled={exportingId === item.id}
                    title="Descargar recibo para el portero"
                    onClick={() => { void exportReceipt(item); }}
                  >
                    {exportingId === item.id
                      ? <Loader2 size={14} className="spin" aria-hidden="true" />
                      : <Download size={14} aria-hidden="true" />}
                    Recibo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visibleRows.length > 0 ? (
        <div className="gate-income-pager" aria-live="polite">
          <span className="gate-income-pager-meta">
            {pageFrom}–{pageTo} de {visibleRows.length}
          </span>
          <div className="gate-income-pager-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 0}
              aria-label="Hoja anterior"
              onClick={() => setTablePage((page) => Math.max(0, page - 1))}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Anterior
            </button>
            <span className="gate-income-pager-page">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= totalPages - 1}
              aria-label="Hoja siguiente"
              onClick={() => setTablePage((page) => Math.min(totalPages - 1, page + 1))}
            >
              Siguiente <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
