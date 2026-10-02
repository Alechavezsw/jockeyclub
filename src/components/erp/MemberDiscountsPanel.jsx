import { useEffect, useMemo, useState } from 'react';
import { Percent, Search } from 'lucide-react';
import { softDeleteDiscount, upsertDiscount } from '../../domain/accounting/discounts';
import {
  formatMemberDiscountRange,
  formatMemberDiscountValue,
  listMemberDiscounts,
  MEMBER_DISCOUNT_SCOPES,
  memberDiscountsSeed,
  memberDiscountsSummary,
} from '../../domain/accounting/memberDiscounts';
import { deactivateDiscountRule, listDiscountRules, upsertDiscountRule } from '../../data/repos';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';
import DiscountsBonusesPanel from './DiscountsBonusesPanel';

export default function MemberDiscountsPanel({ members = [] }) {
  const [rules, setRules] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listDiscountRules()
      .then((rows) => {
        if (!cancelled) setRules(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message || 'No se pudieron leer los descuentos.');
      });
    return () => { cancelled = true; };
  }, []);

  const onUpsert = async (payload) => {
    const existing = (rules || []).find((row) => row.id === payload.id);
    const saved = await upsertDiscountRule({
      ...payload,
      ruleKey: existing?.ruleKey,
      accessinId: existing?.accessinId ?? null,
      source: existing?.source || 'manual',
    });
    setRules((prev) => upsertDiscount(prev || [], saved).map((row) => (
      row.id === saved.id
        ? { ...row, ruleKey: saved.ruleKey, accessinId: saved.accessinId, source: saved.source }
        : row
    )));
  };

  const onDelete = async (id) => {
    await deactivateDiscountRule(id);
    setRules((prev) => softDeleteDiscount(prev || [], id));
  };

  if (rules) {
    return (
      <DiscountsBonusesPanel
        items={rules}
        members={members}
        onUpsert={onUpsert}
        onDelete={onDelete}
        discountsOnly
      />
    );
  }

  if (loadError) {
    return (
      <SnapshotGate names={['accessinMemberDiscounts']}>
        <MemberDiscountsContent />
      </SnapshotGate>
    );
  }

  return <p className="mb-folio-meta">Cargando descuentos extras…</p>;
}

function MemberDiscountsContent({ onOpenMember }) {
  const seed = useSnapshotSeed(['accessinMemberDiscounts'], memberDiscountsSeed);
  const items = seed.ACCESSIN_MEMBER_DISCOUNTS;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [status, setStatus] = useState('all');

  const summary = useMemo(
    () => memberDiscountsSummary(seed.ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT, items),
    [seed, items],
  );
  const rows = useMemo(
    () => listMemberDiscounts({ query, scope, status, items }),
    [query, scope, status, items],
  );

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Descuentos extras</h3>
          <p className="mb-folio-meta">
            Corte al {summary.asOfLabel || '—'}.
            {summary.sourceFile ? ` ${summary.sourceFile.replace(/^LILA\s*[-–]\s*/i, '')}` : ''}
          </p>
        </div>
        <span className="mb-folio-seal">{summary.count.toLocaleString('es-AR')} reglas</span>
      </header>

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi">
          <dt>Socios</dt>
          <dd>{summary.uniqueMembers.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-net">
          <dt>Vigentes</dt>
          <dd>{summary.activeCount.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Vencidos</dt>
          <dd>{summary.expiredCount.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Por socio</dt>
          <dd>{(summary.byScope.member || 0).toLocaleString('es-AR')}</dd>
          <p>Categoría {(summary.byScope.fee_category || 0).toLocaleString('es-AR')}</p>
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
              placeholder="Socio, DNI, grupo o descripción"
            />
          </span>
        </label>
        <label>
          <span className="form-label">Alcance</span>
          <select className="form-input" value={scope} onChange={(e) => setScope(e.target.value)}>
            {MEMBER_DISCOUNT_SCOPES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="form-label">Estado</span>
          <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos</option>
            <option value="active">Vigente</option>
            <option value="expired">Vencido</option>
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
              <th>Alcance</th>
              <th>Descripción</th>
              <th>Cuota</th>
              <th>Valor</th>
              <th>Vigencia</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="mb-folio-empty">No hay descuentos con este filtro.</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {onOpenMember ? (
                    <button type="button" className="cash-lila-card-btn" onClick={() => onOpenMember(row.memberNumber)}>
                      <Percent size={13} aria-hidden="true" />
                      {' '}
                      {row.memberNumber} · {row.memberName}
                    </button>
                  ) : `${row.memberNumber} · ${row.memberName}`}
                </td>
                <td>{row.familyGroup || '—'}</td>
                <td>{row.scopeLabel || '—'}</td>
                <td>{row.description || '—'}</td>
                <td>{row.feeConcept || '—'}</td>
                <td style={{ fontWeight: 700 }}>{formatMemberDiscountValue(row)}</td>
                <td>{formatMemberDiscountRange(row)}</td>
                <td style={{ color: row.isActive ? 'var(--emerald-accent)' : 'var(--danger-accent)', fontWeight: 700 }}>
                  {row.status || (row.isActive ? 'Vigente' : 'Vencido')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
