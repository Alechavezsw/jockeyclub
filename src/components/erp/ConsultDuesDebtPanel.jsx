import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Search, AlertTriangle, Loader2 } from 'lucide-react';
import {
  duesStandingDisplayAmount,
} from '../../domain/accounting/appMonthlyDebts';
import { downloadDuesDebtPdf } from '../../domain/accounting/exportDuesDebtPdf';
import {
  memberMatchesDirectoryQuery,
  memberNumberOf,
  rankMemberSearchHit,
} from '../../domain/members/households';
import { isDuesExemptMember } from '../../domain/members/dues';
import {
  buildOperationalDuesStanding,
} from '../../domain/members/operationalDuesStanding';
import {
  PERIOD_STATUS,
  periodLedgerStatus,
  periodStatusLabel,
} from '../../domain/accounting/feeLedgerIntegrity';
import { isSupabaseConfigured } from '../../lib/supabase';
import * as repos from '../../data/repos';

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
  const [selected, setSelected] = useState(null);
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ledgerLines, setLedgerLines] = useState([]);

  useEffect(() => {
    if (typeof repos.invalidateMemberSearchCache === 'function') {
      repos.invalidateMemberSearchCache();
    }
  }, []);

  useEffect(() => {
    if (!selected || !isSupabaseConfigured || typeof repos.listFeeLedgerLinesByMemberNumber !== 'function') {
      setLedgerLines([]);
      return undefined;
    }
    let cancelled = false;
    const nro = memberNumberOf(selected) || selected.memberId;
    repos.listFeeLedgerLinesByMemberNumber(nro)
      .then((rows) => {
        if (!cancelled) setLedgerLines(rows || []);
      })
      .catch(() => {
        if (!cancelled) setLedgerLines([]);
      });
    return () => { cancelled = true; };
  }, [selected?.memberId, selected?.id]);

  useEffect(() => {
    if (selected) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    const needle = query.trim();
    const digits = needle.replace(/\D/g, '');
    const enough = needle.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      repos.searchMembersDirectory(needle, { limit: 14, signal: controller.signal })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteBusy(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, selected]);

  const suggestions = useMemo(() => {
    if (selected) return [];
    const q = query.trim();
    if (!q) return [];
    const local = (members || [])
      .filter((m) => memberMatchesDirectoryQuery(m, q))
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 14);
    const byId = new Map(local.map((m) => [String(m.memberId), m]));
    for (const row of remoteHits) {
      const id = String(row.memberId || '');
      if (id && !byId.has(id)) byId.set(id, row);
    }
    return [...byId.values()]
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 14);
  }, [members, query, remoteHits, selected]);

  const standing = useMemo(() => {
    if (!selected) return null;
    const nro = memberNumberOf(selected);
    const entries = (accountEntries || []).filter((row) => {
      const id = String(row?.memberNumber || row?.memberId || '');
      return id && (id === String(nro) || id === String(selected.memberId));
    });
    return buildOperationalDuesStanding(selected, {
      today: new Date(),
      entries,
      ledgerLines,
      payments: selected.paymentHistory || [],
    });
  }, [selected, accountEntries, ledgerLines]);
  const debt = standing?.debt || null;

  const ledgerByYm = useMemo(() => {
    const map = new Map();
    for (const line of ledgerLines || []) {
      const raw = String(line?.date || line?.lineDate || line?.periodYm || '').trim();
      const ym = /^\d{4}-\d{2}$/.test(raw)
        ? raw
        : (/^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 7) : '');
      if (ym && !map.has(ym)) map.set(ym, line);
    }
    return map;
  }, [ledgerLines]);

  const pick = (row) => {
    const fromPadron = (members || []).find((m) => String(m.memberId) === String(row.memberId));
    // Preferir la fila con saldo si el padrón en memoria vino vacío/desfasado.
    const remoteBal = Number(row?.outstandingBalance) || 0;
    const localBal = Number(fromPadron?.outstandingBalance) || 0;
    const full = fromPadron && localBal >= remoteBal
      ? { ...row, ...fromPadron }
      : { ...(fromPadron || {}), ...row };
    setSelected(full);
    setQuery(`${padNro(memberNumberOf(full) || full.memberId)} · ${full.name || ''}`.trim());
    setError('');
  };

  const clearPick = () => {
    setSelected(null);
    setQuery('');
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
      const bal = Number(selected.outstandingBalance) || 0;
      const pdfDebt = (standing && !standing.clear && standing.debt)
        || (bal > 0.009 && !isDuesExemptMember(selected)
          ? {
            memberNumber: memberNumberOf(selected),
            memberName: selected.name,
            dni: selected.documentNumber || selected.dni || '',
            socialFee: selected.tier || '',
            standing: 'Con saldo',
            capital: bal,
            interest: 0,
            unallocated: bal,
            totalDebt: bal,
            months: [],
          }
          : null);
      await downloadDuesDebtPdf({ member: selected, debt: pdfDebt, asOf: new Date() });
    } catch (err) {
      setError(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  const months = debt?.months || [];
  const debtTotal = Number(standing?.totalExigible) || 0;
  const balance = Number(selected?.outstandingBalance) || 0;
  const exempt = selected ? isDuesExemptMember(selected) : false;
  // Solo después de elegir socio. Sin selección no se inventa «Al día».
  const hasDebt = Boolean(selected) && !exempt && debtTotal > 0.009;
  const clear = Boolean(selected) && !exempt && !hasDebt && Boolean(standing?.clear);
  const historical = standing?.historical || null;
  const reviewMonths = historical?.periods || [];
  const sealLabel = !selected
    ? null
    : (exempt
      ? 'Exento'
      : (standing?.seal || (hasDebt ? 'Con deuda' : 'Al día')));
  const displayCapital = clear ? 0 : (Number(standing?.capitalExigible) || (debt ? Number(debt.capital) || 0 : balance));
  const displayInterest = clear ? 0 : (Number(standing?.interestExigible) || (debt ? Number(debt.interest) || 0 : 0));
  const displayTotal = clear ? 0 : (debtTotal > 0.009 ? debtTotal : Math.max(0, balance));

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
        {sealLabel ? (
          <span className={`consult-debt-seal${hasDebt ? ' is-debt' : ''}`}>
            {sealLabel}
          </span>
        ) : null}
      </header>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <section className="consult-debt-search supplier-pay-import-block">
        <label className="consult-debt-search-label" htmlFor="consult-debt-q">
          <Search size={15} aria-hidden />
          Buscar socio
          {remoteBusy ? <Loader2 size={14} className="spin" aria-label="Buscando…" /> : null}
        </label>
        <input
          id="consult-debt-q"
          className="form-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setError('');
          }}
          placeholder="Nº de socio o nombre"
          autoComplete="off"
        />
        {suggestions.length > 0 ? (
          <ul className="consult-debt-suggest">
            {suggestions.map((row) => {
              const nro = padNro(memberNumberOf(row) || row.memberId);
              const hitStanding = buildOperationalDuesStanding(row);
              return (
                <li key={row.memberId || nro}>
                  <button type="button" onClick={() => pick(row)}>
                    <strong>{nro}</strong>
                    <span>{row.name}</span>
                    <em>{duesStandingDisplayAmount(hitStanding, formatCurrency)}</em>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {!selected && query.trim().length >= 2 && !remoteBusy && suggestions.length === 0 ? (
          <p className="consult-debt-hint">No hay coincidencias para «{query.trim()}».</p>
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
            <div className="consult-debt-actions">
              <button type="button" className="btn btn-secondary consult-debt-action-btn" onClick={clearPick}>
                Cambiar socio
              </button>
              <button
                type="button"
                className="btn btn-primary consult-debt-action-btn"
                disabled={busy}
                onClick={() => { void download(); }}
              >
                <Download size={15} aria-hidden />
                {busy ? 'Generando…' : 'Descargar PDF'}
              </button>
            </div>
          </div>

          {exempt ? (
            <p className="consult-debt-empty">
              Vitalicio, fundador o comisión: no genera deuda de cuota social.
            </p>
          ) : clear ? (
            <>
              <div className="consult-debt-kpis">
                <div>
                  <span>Capital exigible</span>
                  <strong className="tabular-nums">{formatCurrency(0)}</strong>
                </div>
                <div>
                  <span>Intereses exigibles</span>
                  <strong className="tabular-nums">{formatCurrency(0)}</strong>
                </div>
                <div>
                  <span>Total exigible</span>
                  <strong className="tabular-nums">{formatCurrency(0)}</strong>
                </div>
              </div>
              <p className="consult-debt-empty">
                {standing?.kind === 'credit'
                  ? `Saldo a favor: ${formatCurrency(standing.creditBalance || standing.credit || 0)}.`
                  : 'Estado operativo: Al día. Sin deuda de cuota social exigible.'}
              </p>
              {reviewMonths.length ? (
                <div className="table-responsive" style={{ marginTop: '0.85rem' }}>
                  <h4 className="consult-debt-title" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
                    Conciliación histórica
                  </h4>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Pendiente auxiliar</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewMonths.map((row) => (
                        <tr key={row.periodYm || row.lineId}>
                          <td>{row.periodYm}</td>
                          <td className="tabular-nums">{formatCurrency(row.pending)}</td>
                          <td>{row.statusLabel || row.label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="consult-debt-note">
                    <AlertTriangle size={14} aria-hidden />
                    {historical?.note
                      || 'Pendiente de conciliación histórica. No es deuda exigible confirmada. Tesorería revisa el origen (Lila / Macro Click / débitos).'}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="consult-debt-kpis">
                <div>
                  <span>Capital</span>
                  <strong>{formatCurrency(displayCapital)}</strong>
                </div>
                <div>
                  <span>Intereses</span>
                  <strong>{formatCurrency(displayInterest)}</strong>
                </div>
                {debt && Number(debt.unallocated) > 0.009 ? (
                  <div>
                    <span>Sin imputar</span>
                    <strong>{formatCurrency(debt.unallocated)}</strong>
                  </div>
                ) : null}
                <div className="is-total">
                  <span>Total</span>
                  <strong>{formatCurrency(displayTotal)}</strong>
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
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                          {balance > 0.009
                            ? `Saldo de ficha ${formatCurrency(balance)} sin desglose mes a mes.`
                            : 'Sin desglose mes a mes: el saldo queda sin imputar.'}
                        </td>
                      </tr>
                    ) : months.map((row) => {
                      const sub = (Number(row.capital) || 0) + (Number(row.interest) || 0);
                      const ym = String(row.periodKey || row.dueOn || '').slice(0, 7)
                        || String(row.periodLabel || '').match(/(\d{4})-(\d{2})/)?.[0]
                        || '';
                      const line = ym ? ledgerByYm.get(ym) : null;
                      const status = line
                        ? periodLedgerStatus(selected, line, { payments: selected.paymentHistory || [] })
                        : PERIOD_STATUS.PENDIENTE;
                      return (
                        <tr key={row.periodKey || row.periodLabel}>
                          <td>{row.periodLabel}</td>
                          <td className="tabular-nums">{formatCurrency(row.capital)}</td>
                          <td className="tabular-nums">{formatCurrency(row.interest)}</td>
                          <td className="tabular-nums" style={{ fontWeight: 700 }}>{formatCurrency(sub)}</td>
                          <td>{periodStatusLabel(status)}</td>
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
