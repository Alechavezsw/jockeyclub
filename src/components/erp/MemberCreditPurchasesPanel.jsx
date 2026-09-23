import { useMemo, useState } from 'react';
import { ArrowLeft, Search, Ticket } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import {
  creditPurchaseSummary,
  creditPurchasesSeed,
  filterCreditPurchases,
} from '../../domain/accounting/memberCreditPurchases';
import { filterMembersForBalances } from '../../domain/accounting/memberBalances';
import { memberNumberOf } from '../../domain/members/households';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

const PAGE_SIZE = 40;

export default function MemberCreditPurchasesPanel(props) {
  return (
    <SnapshotGate names={['accessinMemberCreditPurchases']}>
      <MemberCreditPurchasesContent {...props} />
    </SnapshotGate>
  );
}

function MemberCreditPurchasesContent({
  items = creditPurchasesSeed().ACCESSIN_CREDIT_PURCHASES,
  members = [],
  onBack,
  onOpenMember,
}) {
  const { ACCESSIN_CREDIT_PURCHASES_SNAPSHOT } = useSnapshotSeed(
    ['accessinMemberCreditPurchases'],
    creditPurchasesSeed,
  );
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [page, setPage] = useState(0);

  const summary = useMemo(() => creditPurchaseSummary(items), [items]);
  const statuses = useMemo(
    () => [...new Set((items || []).map((row) => row.status).filter(Boolean))].sort(),
    [items]
  );
  const methods = useMemo(
    () => [...new Set((items || []).map((row) => row.paymentMethod).filter(Boolean))].sort(),
    [items]
  );
  const rows = useMemo(() => {
    const purchases = filterCreditPurchases(items, { query, status, paymentMethod });
    if (purchases.length || !query.trim()) return purchases;
    return filterMembersForBalances(members, { query, status: 'all' }).slice(0, PAGE_SIZE).map((m) => ({
      id: `sin-compra-${memberNumberOf(m) || m.memberId}`,
      memberNumber: memberNumberOf(m) || m.memberId,
      memberName: m.name || '',
      withoutPurchase: true,
    }));
  }, [items, members, query, status, paymentMethod]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        {onBack ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={14} /> Volver
          </button>
        ) : null}
        <h3 className="cuotas-title" style={{ margin: 0 }}>
          <Ticket size={18} /> Créditos comprados por socios
        </h3>
      </div>

      <p style={{ margin: '0 0 0.85rem', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
        Export · {(ACCESSIN_CREDIT_PURCHASES_SNAPSHOT.fileName || 'Créditos comprados').replace(/^LILA\s*[-–]\s*/i, '')} · al{' '}
        {formatAccessinCashDate(summary.asOf)}.
      </p>
      <div className="cash-lila-cards">
        <div className="cash-lila-card is-total">
          <div className="cash-lila-card-label">Compras</div>
          <div className="cash-lila-card-value">{summary.count.toLocaleString('es-AR')}</div>
          <div className="cash-lila-card-caption">{summary.uniqueMembers} socios</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Importe total</div>
          <div className="cash-lila-card-value">{formatCurrency(summary.totalAmount)}</div>
          <div className="cash-lila-card-caption">{summary.credits} créditos</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Cobrado</div>
          <div className="cash-lila-card-value">{formatCurrency(summary.collectedAmount)}</div>
          <div className="cash-lila-card-caption">Diferencia {formatCurrency(summary.difference)}</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Pendientes</div>
          <div className="cash-lila-card-value">{summary.pending.toLocaleString('es-AR')}</div>
          <div className="cash-lila-card-caption">Con saldo sin cobrar</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center', margin: '1rem 0' }}>
        <label className="cash-lila-search member-credit-search">
          <Search size={16} aria-hidden />
          <input
            className="form-input"
            type="search"
            placeholder="Nombre, DNI, Nº de socio, combo o medio…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            autoComplete="off"
          />
        </label>
        {statuses.length > 0 ? (
          <select
            className="form-input"
            style={{ maxWidth: 180 }}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          >
            <option value="">Todos los estados</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        ) : null}
        {methods.length > 0 ? (
          <select
            className="form-input"
            style={{ maxWidth: 200 }}
            value={paymentMethod}
            onChange={(e) => { setPaymentMethod(e.target.value); setPage(0); }}
          >
            <option value="">Todos los medios</option>
            {methods.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Nombre</th>
              <th>Compra</th>
              <th>Combo</th>
              <th>Créditos</th>
              <th>Medio</th>
              <th>Importe</th>
              <th>Estado</th>
              <th>Cobrado</th>
              <th>Dif.</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ color: 'var(--text-muted)' }}>
                  {query.trim()
                    ? 'No se encontraron socios ni compras con esa búsqueda.'
                    : items.length === 0
                      ? 'El export del 9 de septiembre no tiene compras cargadas. Buscá un socio para consultar.'
                      : 'No hay compras con este filtro.'}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {onOpenMember ? (
                      <button type="button" className="cash-lila-card-btn" onClick={() => onOpenMember(row.memberNumber)}>
                        {row.memberNumber}
                      </button>
                    ) : row.memberNumber}
                  </td>
                  <td>{row.memberName || '—'}</td>
                  {row.withoutPurchase ? (
                    <td colSpan={8} style={{ color: 'var(--text-muted)' }}>Sin compras en el export</td>
                  ) : (
                    <>
                      <td>{formatAccessinCashDate(row.purchasedAt)}</td>
                      <td>{row.combo || '—'}</td>
                      <td>{row.credits || '—'}</td>
                      <td>{row.paymentMethod || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{formatCurrency(row.totalAmount)}</td>
                      <td>{row.status || '—'}</td>
                      <td>{formatCurrency(row.collectedAmount)}</td>
                      <td style={{ color: Number(row.difference) > 0 ? 'var(--danger, #ef4444)' : undefined }}>
                        {formatCurrency(row.difference)}
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE ? (
        <div className="cuotas-pager" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </button>
          <span>Hoja {safePage + 1} / {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
