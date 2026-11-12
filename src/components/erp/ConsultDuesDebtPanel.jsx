import { useMemo, useState } from 'react';
import { ArrowLeft, Download, Search, AlertTriangle } from 'lucide-react';
import { appMonthlyDebtForMember } from '../../domain/accounting/appMonthlyDebts';
import { filterMembersForBalances } from '../../domain/accounting/memberBalances';
import { downloadDuesDebtPdf } from '../../domain/accounting/exportDuesDebtPdf';
import { memberNumberOf } from '../../domain/members/households';
import { isDuesExemptMember } from '../../domain/members/dues';

function formatMoney(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function padNro(value) {
  const raw = String(value || '').replace(/\D/g, '');
  if (!raw) return '—';
  return raw.padStart(5, '0');
}

export default function ConsultDuesDebtPanel({
  members = [],
  accountEntries = [],
  onBack,
  formatCurrency = formatMoney,
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => members.find((m) => String(m.memberId || '') === String(selectedId)) || null,
    [members, selectedId],
  );

  const suggestions = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    if (selected) {
      const label = `${padNro(memberNumberOf(selected) || selected.memberId)} · ${selected.name || ''}`.trim();
      if (q === label) return [];
    }
    return filterMembersForBalances(members, { query: q, status: 'all' }).slice(0, 12);
  }, [members, query, selected]);

  const debt = useMemo(() => {
    if (!selected || isDuesExemptMember(selected)) return null;
    const nro = memberNumberOf(selected);
    const entries = (accountEntries || []).filter((row) => {
      const id = String(row?.memberNumber || row?.memberId || '');
      return id && (id === String(nro) || id === String(selected.memberId));
    });
    return appMonthlyDebtForMember(selected, { today: new Date(), entries });
  }, [selected, accountEntries]);

  const pick = (row) => {
    setSelectedId(String(row.memberId || ''));
    setQuery(`${padNro(memberNumberOf(row) || row.memberId)} · ${row.name || ''}`.trim());
    setError('');
  };

  const download = async () => {
    if (!selected) {
      setError('Buscá y elegí un socio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await downloadDuesDebtPdf({ member: selected, debt, asOf: new Date() });
    } catch (err) {
      setError(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  const months = debt?.months || [];
  const total = Number(debt?.totalDebt) || 0;
  const clear = !debt || total <= 0.009;
  const exempt = selected ? isDuesExemptMember(selected) : false;

  return (
    <div className="fade-in cuotas-panel consult-dues-debt-panel">
      <div className="cuotas-toolbar cuotas-toolbar--local">
        {onBack ? (
          <button type="button" className="cuotas-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden />
            Volver
          </button>
        ) : null}
      </div>

      <header className="consult-debt-head">
        <div>
          <p className="consult-debt-kicker">Cuota social</p>
          <h3 className="consult-debt-title">Consultar deuda</h3>
          <p className="consult-debt-meta">
            Buscá un socio y descargá el PDF con el capital de cada mes y los intereses (recargo 10 %).
          </p>
        </div>
        <span className={`consult-debt-seal${clear || exempt ? '' : ' is-debt'}`}>
          {exempt ? 'Exento' : (clear ? 'Al día' : 'Con deuda')}
        </span>
      </header>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <section className="consult-debt-search supplier-pay-import-block">
        <label className="consult-debt-search-label" htmlFor="consult-debt-q">
          <Search size={15} aria-hidden />
          Buscar socio
        </label>
        <input
          id="consult-debt-q"
          className="form-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId('');
            setError('');
          }}
          placeholder="Nº de socio o nombre"
          autoComplete="off"
        />
        {suggestions.length > 0 ? (
          <ul className="consult-debt-suggest">
            {suggestions.map((row) => {
              const nro = padNro(memberNumberOf(row) || row.memberId);
              return (
                <li key={row.memberId || nro}>
                  <button type="button" onClick={() => pick(row)}>
                    <strong>{nro}</strong>
                    <span>{row.name}</span>
                    <em>{formatCurrency(row.outstandingBalance || 0)}</em>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {selected ? (
        <section className="consult-debt-result supplier-pay-import-block">
          <div className="consult-debt-result-head">
            <div>
              <h4>
                {padNro(memberNumberOf(selected) || selected.memberId)}
                {' · '}
                {selected.name}
              </h4>
              <p>
                {debt?.socialFee || selected.tier || '—'}
                {debt?.standing ? ` · ${debt.standing}` : null}
                {exempt ? ' · No abona cuota' : null}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => { void download(); }}
            >
              <Download size={15} aria-hidden />
              {busy ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>

          {exempt ? (
            <p className="consult-debt-empty">
              Vitalicio, fundador o comisión: no genera deuda de cuota social.
            </p>
          ) : clear ? (
            <p className="consult-debt-empty">Sin deuda de cuota social al día de hoy.</p>
          ) : (
            <>
              <div className="consult-debt-kpis">
                <div>
                  <span>Capital</span>
                  <strong>{formatCurrency(debt.capital)}</strong>
                </div>
                <div>
                  <span>Intereses</span>
                  <strong>{formatCurrency(debt.interest)}</strong>
                </div>
                {Number(debt.unallocated) > 0.009 ? (
                  <div>
                    <span>Sin imputar</span>
                    <strong>{formatCurrency(debt.unallocated)}</strong>
                  </div>
                ) : null}
                <div className="is-total">
                  <span>Total</span>
                  <strong>{formatCurrency(debt.totalDebt)}</strong>
                </div>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Capital</th>
                      <th>Intereses</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                          Sin desglose mes a mes: el saldo queda sin imputar.
                        </td>
                      </tr>
                    ) : months.map((row) => {
                      const sub = (Number(row.capital) || 0) + (Number(row.interest) || 0);
                      return (
                        <tr key={row.periodKey || row.periodLabel}>
                          <td>{row.periodLabel}</td>
                          <td className="tabular-nums">{formatCurrency(row.capital)}</td>
                          <td className="tabular-nums">{formatCurrency(row.interest)}</td>
                          <td className="tabular-nums" style={{ fontWeight: 700 }}>{formatCurrency(sub)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="consult-debt-note">
                <AlertTriangle size={14} aria-hidden />
                Intereses = recargo del 10 % de cada mes vencido (desde el día 11). Solo cuota social.
              </p>
            </>
          )}
        </section>
      ) : (
        <p className="consult-debt-hint">Escribí el número o el nombre del socio para ver la deuda.</p>
      )}
    </div>
  );
}
