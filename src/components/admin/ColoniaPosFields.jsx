import { useEffect, useMemo, useState } from 'react';
import { quoteColoniaPos } from '../../domain/colonia/coloniaPayments';
import { activePaymentPlans } from '../../domain/system/paymentPlans';

function money(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

/** Mismo bloque de Pago POS que el cobro de cuotas: plan, modalidad y cupón. */
export default function ColoniaPosFields({
  amount = 0,
  plans = [],
  disabled = false,
  sessionRef,
}) {
  const list = useMemo(() => activePaymentPlans(plans), [plans]);
  const [planId, setPlanId] = useState('');
  const [percent, setPercent] = useState('');
  const [fixed, setFixed] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!planId && list[0]) setPlanId(list[0].id);
  }, [list, planId]);

  const selected = list.find((plan) => plan.id === planId) || null;
  const preview = useMemo(() => {
    if (!selected) return null;
    return quoteColoniaPos({
      amount,
      plans: list,
      planId,
      percent,
      fixedAmount: fixed,
      confirmed: true,
    });
  }, [amount, list, planId, percent, fixed, selected]);

  if (sessionRef) {
    sessionRef.current = {
      plans: list,
      planId,
      percent,
      fixed,
      confirmed,
    };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
        La cuota entra en <strong style={{ color: 'var(--text-gold)' }}>Caja General</strong>.
        La financiación del cupón, si el plan es modalidad A, queda en Tarjetas a cobrar.
      </p>
      <div
        style={{
          padding: '0.85rem',
          borderRadius: 10,
          border: '1px solid var(--border-glass)',
          background: 'rgba(255,255,255,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem',
        }}
      >
        <strong style={{ color: 'var(--text-gold)', fontSize: '0.85rem' }}>Financiación con tarjeta</strong>
        {list.length ? (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Plan POS *</label>
            <select
              className="form-input"
              value={planId}
              disabled={disabled}
              onChange={(e) => {
                setPlanId(e.target.value);
                setPercent('');
                setFixed('');
                setConfirmed(false);
              }}
            >
              {list.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.label}
                  {plan.installments > 1 ? ` · ${plan.installments} cuotas` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            No hay planes activos. El superadmin los carga en Configuración.
          </p>
        )}
        {selected ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Modalidad del plan:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {selected.financingMode === 'club_keeps' ? 'A · club percibe financiación' : 'B · emisor retiene'}
            </strong>
            {' '}(no la cambia el operador de caja).
          </p>
        ) : null}
        {(selected?.installments || 1) > 1
          && (selected.allowOperatorOverride
            || (selected.financingPercent == null && selected.financingFixed == null)) ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label">% financiación / intereses</span>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                disabled={disabled}
                value={percent}
                placeholder={selected.financingPercent != null ? String(selected.financingPercent) : '0'}
                onChange={(e) => {
                  setPercent(e.target.value);
                  if (e.target.value !== '') setFixed('');
                  setConfirmed(false);
                }}
              />
            </label>
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label">Importe fijo</span>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                disabled={disabled}
                value={fixed}
                placeholder={selected.financingFixed != null ? String(selected.financingFixed) : '0'}
                onChange={(e) => {
                  setFixed(e.target.value);
                  if (e.target.value !== '') setPercent('');
                  setConfirmed(false);
                }}
              />
            </label>
          </div>
        ) : null}
        {(selected?.installments || 1) > 1
          && !selected.allowOperatorOverride
          && selected.financingPercent == null
          && selected.financingFixed == null ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Cargá el % o el importe de intereses del cupón. El capital de Colonia no cambia.
          </p>
        ) : null}
        {preview?.quote ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
            <div>Capital imputado a Colonia: <strong style={{ color: 'var(--text-primary)' }}>{money(preview.quote.base)}</strong></div>
            <div>Financiación tarjeta: <strong style={{ color: 'var(--text-primary)' }}>{money(preview.quote.financingAmount)}</strong></div>
            <div>Total cupón: <strong style={{ color: 'var(--emerald-accent)' }}>{money(preview.quote.voucherTotal)}</strong></div>
            {preview.quote.installments > 1 ? (
              <div>
                Cuota tarjeta est. ({preview.quote.installments}):{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{money(preview.quote.installmentAmount)}</strong>
              </div>
            ) : null}
          </div>
        ) : null}
        {preview?.quote?.financingAmount > 0.009 ? (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Confirmo el total del cupón {money(preview.quote.voucherTotal)}
              {' '}(capital de Colonia + financiación de tarjeta).
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
