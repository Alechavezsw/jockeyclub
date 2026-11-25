import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Wallet } from 'lucide-react';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  COLONIA_PAYMENT_METHODS,
  COLONIA_SEASON_2026_2027,
  coloniaMethodLabel,
} from '../../domain/colonia/coloniaConstants';
import {
  buildColoniaPaymentDraft,
  coloniaMercadoPagoAdapterSpec,
} from '../../domain/colonia/coloniaPayments';
import {
  coloniaSourceLabel,
  coloniaStatusLabel,
} from '../../domain/colonia/coloniaPortal';
import { summarizeColoniaAccount } from '../../domain/colonia/coloniaLedger';
import { canCollectColonia } from '../../domain/auth/roles';

function money(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

/**
 * Caja → Colonia. Cobros solo a colonia_payments (COA 4.1.06).
 * No usa registrar_cobro de cuota social.
 */
export default function ColoniaCashPanel({ roles = [], role, operatorName = '' }) {
  const canCollect = canCollectColonia({ roles, role });
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [charges, setCharges] = useState([]);
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [method, setMethod] = useState('efectivo');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [cardConfirmed, setCardConfirmed] = useState(false);

  const mpSpec = coloniaMercadoPagoAdapterSpec();
  const account = useMemo(
    () => summarizeColoniaAccount({ charges, payments }),
    [charges, payments],
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await repos.listColoniaSeasons();
        if (cancelled) return;
        setSeasons(rows || []);
        setSeasonId(rows?.[0]?.id || null);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'No se pudo cargar Colonia.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function runSearch(e) {
    e?.preventDefault?.();
    if (!seasonId || !query.trim()) return;
    setBusy(true);
    setError('');
    try {
      const rows = await repos.searchColoniaEnrollments({ seasonId, query });
      setResults(rows);
    } catch (err) {
      setError(err?.message || 'Búsqueda fallida.');
    } finally {
      setBusy(false);
    }
  }

  async function selectEnrollment(row) {
    setSelected(row);
    setMsg('');
    setError('');
    try {
      const [c, p] = await Promise.all([
        repos.listColoniaCharges(row.id),
        repos.listColoniaPayments(row.id),
      ]);
      setCharges(c || []);
      setPayments(p || []);
      setAmount(String(summarizeColoniaAccount({ charges: c || [], payments: p || [] }).balanceDue || ''));
    } catch (err) {
      setError(err?.message || 'No se pudo abrir la inscripción.');
    }
  }

  async function collect() {
    if (!selected || !canCollect) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const draft = buildColoniaPaymentDraft({
        enrollmentId: selected.id,
        seasonId: selected.season_id,
        studentId: selected.student_id,
        guardianId: selected.guardian_id,
        method,
        amount: Number(amount),
        operatorConfirmed: cardConfirmed,
        externalReference: ref,
        operatorName,
        idempotencyKey: `caja:${selected.id}:${method}:${amount}:${ref || 'x'}`,
      });
      const res = await repos.coloniaRecordPayment({
        enrollmentId: draft.enrollmentId,
        method: draft.method,
        amount: draft.amount,
        status: draft.status,
        externalReference: draft.externalReference,
        idempotencyKey: draft.idempotencyKey,
        operatorName,
      });
      setMsg(draft.status === 'confirmed'
        ? (res?.cash_movement_id
          ? `Pago Colonia acreditado (${coloniaMethodLabel(draft.method)}). Entró a la caja del día y al asiento. No imputa cuota social.`
          : `Pago Colonia acreditado (${coloniaMethodLabel(draft.method)}). Quedó el asiento de Colonia. No imputa cuota social.`)
        : `Pago Colonia pendiente (${coloniaMethodLabel(draft.method)}). Entra al asiento cuando se confirme. No imputa cuota social.`);
      await selectEnrollment(selected);
      if (res?.duplicate) setMsg((m) => `${m} Operación idempotente: no se duplicó.`);
    } catch (err) {
      setError(err?.message || err?.details?.[0]?.message || 'No se pudo cobrar.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending(paymentId) {
    setBusy(true);
    try {
      await repos.coloniaConfirmPayment(paymentId, operatorName);
      setMsg('Pago confirmado en Colonia.');
      if (selected) await selectEnrollment(selected);
    } catch (err) {
      setError(err?.message || 'No se pudo confirmar.');
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured) {
    return <p className="muted">Colonia requiere cloud.</p>;
  }

  return (
    <div className="colonia-cash-panel">
      <header>
        <h3><Wallet size={18} /> Colonia · Caja</h3>
        <p className="muted">
          Ingresos COA 4.1.06 · {COLONIA_SEASON_2026_2027.code}. Independiente de cuota social.
          Mercado Pago Colonia: {mpSpec.status}.
        </p>
      </header>

      {error ? <p className="alert alert-danger" role="alert">{error}</p> : null}
      {msg ? <p className="alert alert-ok" role="status">{msg}</p> : null}

      <form className="colonia-cash-search" onSubmit={runSearch}>
        <select value={seasonId || ''} onChange={(e) => setSeasonId(e.target.value)}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.name || s.code}</option>
          ))}
        </select>
        <input
          placeholder="Alumno, responsable, DNI o Nº socio"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
          {' '}
          Buscar
        </button>
      </form>

      <ul className="colonia-cash-results">
        {results.map((row) => (
          <li key={row.id}>
            <button type="button" className="btn btn-ghost" onClick={() => selectEnrollment(row)}>
              <strong>{row.student?.full_name}</strong>
              {' · '}
              {coloniaStatusLabel(row.status)}
              {' · '}
              {coloniaSourceLabel(row.source)}
              {' · '}
              Resp. {row.guardian?.full_name}
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="colonia-cash-detail">
          <h4>{selected.student?.full_name}</h4>
          <p className="muted">
            Plan {selected.plan_key} · {coloniaStatusLabel(selected.status)} · origen {coloniaSourceLabel(selected.source)}
          </p>
          <p>
            Cargos {money(account.totalContracted)} · Cobrado {money(account.totalCollected)} · Saldo {money(account.balanceDue)}
            {account.pendingConfirmation > 0 ? ` · Pendiente verificación ${money(account.pendingConfirmation)}` : ''}
          </p>

          {canCollect ? (
            <div className="colonia-cash-form">
              <label>Medio</label>
              <select value={method} onChange={(e) => { setMethod(e.target.value); setCardConfirmed(false); }}>
                {COLONIA_PAYMENT_METHODS.filter((m) => m.key !== 'mercadopago').map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <label>Importe</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} />
              <label>Referencia</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} />
              {(method === 'tarjeta' || method === 'pos' || method === 'debito') ? (
                <label>
                  <input type="checkbox" checked={cardConfirmed} onChange={(e) => setCardConfirmed(e.target.checked)} />
                  {' '}
                  Confirmo resultado de terminal/POS (no es pago online)
                </label>
              ) : null}
              <button type="button" className="btn btn-primary" disabled={busy} onClick={collect}>
                Registrar cobro Colonia
              </button>
            </div>
          ) : (
            <p className="muted">Tu rol no puede cobrar Colonia.</p>
          )}

          <h5>Pagos</h5>
          <ul>
            {payments.map((p) => (
              <li key={p.id}>
                {coloniaMethodLabel(p.method)} · {money(p.amount)} · {p.status}
                {p.status === 'pending' && canCollect && p.method !== 'mercadopago' ? (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => confirmPending(p.id)}>
                    Validar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
