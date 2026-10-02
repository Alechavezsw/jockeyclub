import { useState } from 'react';
import { Eye, FileSpreadsheet, Trash2 } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  MEMBER_PAYMENT_ORDER_STATUS,
  canDeleteMemberPaymentOrder,
  filterMemberPaymentOrders,
  formatPaymentOrderDate,
  memberPaymentOrderStatusLabel,
  pageMemberPaymentOrders,
  sortMemberPaymentOrders,
} from '../../domain/accounting/memberPaymentOrders';

const STATUS_CLASS = {
  pending: 'is-pending',
  processing: 'is-processing',
  imputed: 'is-imputed',
  failed: 'is-failed',
  expired: 'is-expired',
  cancelled: 'is-cancelled',
};

function StatusMark({ status }) {
  return (
    <span className={`po-status ${STATUS_CLASS[status] || ''}`}>
      {memberPaymentOrderStatusLabel(status)}
    </span>
  );
}

function PaymentBreakdown({ payment }) {
  return (
    <div className="po-payment">
      <table className="admin-table cash-lila-table">
        <thead>
          <tr>
            <th>PAGO #{payment.lilaPaymentId}</th>
            <th colSpan={2}>{payment.memberNumber} — {payment.memberName}</th>
            <th className="po-num">Imputado: {formatCurrency(payment.imputedAmount)}</th>
          </tr>
          <tr>
            <th>Tipo</th>
            <th>Cuota / deuda</th>
            <th>Concepto</th>
            <th className="po-num">Monto</th>
          </tr>
        </thead>
        <tbody>
          {(payment.lines || []).length === 0 && (
            <tr><td colSpan={4}>Sin desglose.</td></tr>
          )}
          {(payment.lines || []).map((line) => (
            <tr key={line.id || `${line.position}-${line.concept}`}>
              <td>{line.lineType || '—'}</td>
              <td>{line.debtLabel || '—'}</td>
              <td>{line.concept || '—'}</td>
              <td className="po-num">{formatCurrency(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PaymentOrdersPanel({ items = [], onDelete, setMembers }) {
  const [status, setStatus] = useState('');
  const [responsible, setResponsible] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filtered = sortMemberPaymentOrders(filterMemberPaymentOrders(items, {
    status,
    responsible,
    memberNumber,
  }));
  const view = pageMemberPaymentOrders(filtered, page);
  const open = items.find((order) => order.id === openId && order.orderKind === 'member') || null;

  const changeFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    setError('');
    try {
      const effect = await onDelete?.(pendingDelete);
      if (effect?.reversesBalance && effect.memberNumber && typeof setMembers === 'function') {
        setMembers((prev) => (prev || []).map((member) => {
          const id = String(member.memberId || member.memberNumber || '').replace(/\D/g, '').replace(/^0+/, '');
          if (id !== effect.memberNumber) return member;
          const next = Math.max(0, (Number(member.outstandingBalance) || 0) + effect.amount);
          return { ...member, outstandingBalance: next };
        }));
      }
      setPendingDelete(null);
      if (openId === pendingDelete.id) setOpenId(null);
    } catch (err) {
      setError(err?.message || 'No se pudo eliminar la orden.');
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <div className="fade-in cash-lila-panel po-panel">
        <header className="po-detail-head">
          <h4 className="serif-font po-title">
            ORDEN DE PAGO #{open.number} — {open.responsible} — {formatPaymentOrderDate(open.date)}
          </h4>
        </header>
        <section className="po-card">
          <h5 className="po-legend">Información de la orden</h5>
          <div className="po-fields">
            <label className="po-field">
              <span>Responsable</span>
              <input className="form-input" value={open.responsible || ''} disabled />
            </label>
            <label className="po-field">
              <span>Medio de pago</span>
              <input className="form-input" value={open.paymentMethod || ''} disabled />
            </label>
            <label className="po-field">
              <span>Total</span>
              <input className="form-input" value={formatCurrency(open.amount)} disabled />
            </label>
            <div className="po-field">
              <span>Estado</span>
              <StatusMark status={open.status} />
            </div>
          </div>
        </section>
        <section className="po-card">
          <h5 className="po-legend">Pagos imputados y su desglose</h5>
          {(open.payments || []).length === 0 && <p className="po-empty">Esta orden no tiene pagos imputados.</p>}
          {(open.payments || []).map((payment) => (
            <PaymentBreakdown key={payment.id || payment.lilaPaymentId} payment={payment} />
          ))}
        </section>
        {error && <p className="po-error">{error}</p>}
        <div className="po-detail-actions">
          {canDeleteMemberPaymentOrder(open) && (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setPendingDelete(open)}>
              <Trash2 size={14} /> Eliminar
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOpenId(null); setError(''); }}>
            Volver
          </button>
        </div>
        <DeleteDialog
          order={pendingDelete}
          busy={busy}
          onClose={() => { if (!busy) setPendingDelete(null); }}
          onConfirm={confirmDelete}
        />
      </div>
    );
  }

  return (
    <div className="fade-in cash-lila-panel po-panel">
      <header className="po-head">
        <div>
          <h4 className="serif-font po-title">
            <FileSpreadsheet size={18} /> Órdenes de pago
          </h4>
          <p className="po-sub">Cobros de socios, con el medio, el estado y la cuota imputada.</p>
        </div>
        <p className="po-count">{filtered.length.toLocaleString('es-AR')} órdenes</p>
      </header>

      <form className="po-filters" onSubmit={(event) => event.preventDefault()}>
        <label className="po-field">
          <span>Estado</span>
          <select className="form-input" value={status} onChange={changeFilter(setStatus)}>
            <option value="">Todos</option>
            {Object.entries(MEMBER_PAYMENT_ORDER_STATUS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="po-field">
          <span>Responsable</span>
          <input className="form-input" value={responsible} onChange={changeFilter(setResponsible)} />
        </label>
        <label className="po-field">
          <span>N° de socio</span>
          <input className="form-input" inputMode="numeric" value={memberNumber} onChange={changeFilter(setMemberNumber)} />
        </label>
      </form>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>N° socio</th>
              <th>Responsable</th>
              <th>Medio</th>
              <th className="po-num">Total</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.rows.length === 0 && (
              <tr><td colSpan={8}>No hay órdenes con esos filtros.</td></tr>
            )}
            {view.rows.map((order) => (
              <tr key={order.id}>
                <td><strong>{order.number}</strong></td>
                <td>{formatPaymentOrderDate(order.date)}</td>
                <td>{order.memberNumber}</td>
                <td>{order.responsible}</td>
                <td>{order.paymentMethod || '—'}</td>
                <td className="po-num">{formatCurrency(order.amount)}</td>
                <td><StatusMark status={order.status} /></td>
                <td>
                  <div className="cash-lila-row-actions">
                    <button type="button" className="cash-lila-icon-btn is-view" title="Ver" aria-label={`Ver orden ${order.number}`} onClick={() => setOpenId(order.id)}>
                      <Eye size={14} />
                    </button>
                    {canDeleteMemberPaymentOrder(order) && (
                      <button type="button" className="cash-lila-icon-btn is-del" title="Eliminar" aria-label={`Eliminar orden ${order.number}`} onClick={() => setPendingDelete(order)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.pages > 1 && (
        <div className="po-pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
            Anterior
          </button>
          <span>{view.page} / {view.pages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>
            Siguiente
          </button>
        </div>
      )}

      {error && <p className="po-error">{error}</p>}
      <DeleteDialog
        order={pendingDelete}
        busy={busy}
        onClose={() => { if (!busy) setPendingDelete(null); }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function DeleteDialog({ order, busy, onClose, onConfirm }) {
  return (
    <ModalDialog open={Boolean(order)} onClose={onClose} labelledBy="po-delete-title" describedBy="po-delete-body">
      <h4 id="po-delete-title" className="serif-font" style={{ marginTop: 0 }}>
        Eliminar orden de pago {order ? `#${order.number}` : ''}
      </h4>
      <div id="po-delete-body">
        <p>Estás por eliminar esta orden de pago. Esto es lo que va a pasar:</p>
        <ul>
          {order?.status === 'imputed' ? (
            <li>La orden estaba imputada: se revierte el pago y la cuota vuelve a quedar impaga.</li>
          ) : (
            <li>La orden no llegó a imputarse: no se toca la cuenta corriente, solo se archiva.</li>
          )}
          <li>Deja de figurar en el listado y queda guardada por si hay que recuperarla.</li>
        </ul>
      </div>
      <div className="po-detail-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
          {busy ? 'Eliminando…' : 'Sí, eliminar'}
        </button>
      </div>
    </ModalDialog>
  );
}
