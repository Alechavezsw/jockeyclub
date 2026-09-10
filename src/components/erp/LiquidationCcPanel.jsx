import { useMemo, useState } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  ACCESSIN_LIQUIDATION_CC,
  ACCESSIN_LIQUIDATION_CC_SNAPSHOT,
  filterLiquidationCc,
  liquidationCcSummary,
} from '../../domain/accounting/liquidationCc';
import LilaSourceNote from './LilaSourceNote';

const PAGE_SIZE = 40;

export default function LiquidationCcPanel({
  items = ACCESSIN_LIQUIDATION_CC,
  snapshot = ACCESSIN_LIQUIDATION_CC_SNAPSHOT,
  onOpenMember,
}) {
  const [query, setQuery] = useState('');
  const [onlyLiquidation, setOnlyLiquidation] = useState(false);
  const [page, setPage] = useState(0);

  const summary = useMemo(() => liquidationCcSummary(items, snapshot), [items, snapshot]);
  const rows = useMemo(
    () => filterLiquidationCc(items, { query, onlyLiquidation }),
    [items, query, onlyLiquidation]
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        <h3 className="cuotas-title" style={{ margin: 0 }}>
          <FileSpreadsheet size={18} /> Detalle Cta. Cte. Liquidación
        </h3>
      </div>

      <p style={{ margin: '0 0 0.85rem', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
        Export LILA · {summary.fileName || 'Detalle Cta Cte Liquidación'} · {summary.periodLabel}
        {summary.generatedAt ? ` · Generado el ${summary.generatedAt}.` : '.'}
      </p>
      <LilaSourceNote
        asOf={summary.asOf}
        period={summary.periodLabel}
        extra="No es el mismo total que el Balance mensual ni el saldo operativo."
      />

      <div className="cash-lila-cards">
        <div className="cash-lila-card is-total">
          <div className="cash-lila-card-label">Liquidación</div>
          <div className="cash-lila-card-value">{formatCurrency(summary.liquidation)}</div>
          <div className="cash-lila-card-caption">{summary.withLiquidation.toLocaleString('es-AR')} socios</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Saldo anterior</div>
          <div className="cash-lila-card-value">{formatCurrency(summary.previousBalance)}</div>
          <div className="cash-lila-card-caption">{summary.withPrevious.toLocaleString('es-AR')} con saldo</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Sin recargos</div>
          <div className="cash-lila-card-value">{formatCurrency(summary.withoutSurcharge)}</div>
          <div className="cash-lila-card-caption">Otros {formatCurrency(summary.others)}</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Recargos</div>
          <div className="cash-lila-card-value">{formatCurrency(summary.surcharge)}</div>
          <div className="cash-lila-card-caption">Alt. {formatCurrency(summary.surchargeAlt)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center', margin: '1rem 0' }}>
        <label className="cash-lila-search">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Socio, DNI o nombre…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
          <input
            type="checkbox"
            checked={onlyLiquidation}
            onChange={(e) => { setOnlyLiquidation(e.target.checked); setPage(0); }}
          />
          Solo con liquidación
        </label>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          {rows.length.toLocaleString('es-AR')} de {summary.listedCount.toLocaleString('es-AR')} con movimiento
          {' · '}padrón LILA {summary.sourceCount.toLocaleString('es-AR')}
        </span>
      </div>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Nombre</th>
              <th style={{ textAlign: 'right' }}>Saldo ant.</th>
              <th style={{ textAlign: 'right' }}>Liquidación</th>
              <th style={{ textAlign: 'right' }}>Otros</th>
              <th style={{ textAlign: 'right' }}>Intereses</th>
              <th style={{ textAlign: 'right' }}>Sin recargos</th>
              <th style={{ textAlign: 'right' }}>Recargo</th>
              <th style={{ textAlign: 'right' }}>Recargo (2)</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                  No hay cuentas con este filtro.
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
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.previousBalance)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(row.liquidation)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.others)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.interests)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.withoutSurcharge)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.surcharge)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.surchargeAlt)}</td>
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
