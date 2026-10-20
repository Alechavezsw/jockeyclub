import { useEffect, useMemo, useState } from 'react';
import { Receipt, Search } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  buildLiveBonificaciones,
  formatBonificacionDate,
  listBonificaciones,
} from '../../domain/accounting/bonificaciones';
import { formatDiscountValue, formatValidity } from '../../domain/accounting/discounts';
import { setRuntimeDiscountRules } from '../../domain/accounting/discountApplication';
import { listDiscountRules } from '../../data/repos';

export default function BonificacionesPanel({ members = [] }) {
  const [rules, setRules] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    let cancelled = false;
    listDiscountRules()
      .then((rows) => {
        if (cancelled) return;
        setRules(rows);
        setRuntimeDiscountRules(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message || 'No se pudieron leer las bonificaciones.');
      });
    return () => { cancelled = true; };
  }, []);

  const book = useMemo(
    () => buildLiveBonificaciones(rules || [], members, { today }),
    [rules, members, today],
  );
  const rows = useMemo(
    () => listBonificaciones({ query, status, items: book.rows }),
    [query, status, book.rows],
  );
  const summary = book.summary;

  if (!rules && !loadError) {
    return <p className="mb-folio-meta">Cargando bonificaciones…</p>;
  }

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Bonificaciones</h3>
          <p className="mb-folio-meta">
            Quién recibe un descuento extra sobre la cuota viva al {summary.asOfLabel || 'hoy'}.
          </p>
        </div>
        <span className="mb-folio-seal">{summary.coveringCount.toLocaleString('es-AR')} vigentes</span>
      </header>

      {loadError ? <p className="mb-folio-status is-error" role="alert">{loadError}</p> : null}

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi is-net">
          <dt>Bajan este mes</dt>
          <dd>{formatCurrency(summary.waivedThisMonth)}</dd>
          <p>{summary.uniqueMembers.toLocaleString('es-AR')} socios</p>
        </div>
        <div className="mb-folio-kpi">
          <dt>Vigentes</dt>
          <dd>{summary.coveringCount.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Vencidas</dt>
          <dd>{summary.expiredCount.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Notas</dt>
          <dd>{summary.count.toLocaleString('es-AR')}</dd>
        </div>
      </dl>

      <div className="ar-filters">
        <label className="ld-search">
          <span className="form-label">Buscar</span>
          <span className="ld-search-field">
            <Search size={14} aria-hidden="true" />
            <input
              className="form-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Socio, grupo o concepto"
            />
          </span>
        </label>
        <label>
          <span className="form-label">Estado</span>
          <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todas</option>
            <option value="active">Vigente</option>
            <option value="expired">Vencida</option>
          </select>
        </label>
      </div>

      <p className="mb-folio-meta">{rows.length.toLocaleString('es-AR')} en este filtro</p>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Grupo</th>
              <th>Concepto</th>
              <th>Valor</th>
              <th>Este mes</th>
              <th>Vigencia</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="mb-folio-empty">No hay bonificaciones con este filtro.</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Receipt size={13} aria-hidden="true" />
                  {' '}
                  {row.memberNumber} · {row.memberName}
                </td>
                <td>{row.familyGroup || '—'}</td>
                <td>{row.concept || '—'}</td>
                <td style={{ fontWeight: 700 }}>{formatDiscountValue(row)}</td>
                <td style={{
                  fontWeight: 700,
                  color: row.waived > 0 ? 'var(--emerald-accent)' : undefined,
                }}
                >
                  {row.waived > 0 ? formatCurrency(row.waived) : '—'}
                </td>
                <td>
                  {formatValidity(row)}
                  {row.date ? (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Desde {formatBonificacionDate(row.date)}
                    </div>
                  ) : null}
                </td>
                <td style={{
                  color: row.covering ? 'var(--emerald-accent)' : 'var(--danger-accent)',
                  fontWeight: 700,
                }}
                >
                  {row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
