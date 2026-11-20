import { Banknote, Landmark, QrCode, CreditCard, WalletCards } from 'lucide-react';

/** Mismos tiles que el cobro de cuotas (CollectDuesModal). */
export const POOL_METHOD_TILES = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote, hint: 'Caja General' },
  { id: 'transferencia', label: 'Transfer.', icon: Landmark, hint: 'Banco del club' },
  { id: 'tarjeta', label: 'Pago POS', icon: CreditCard, hint: 'Terminal + voucher' },
  { id: 'debito', label: 'Débito', icon: WalletCards, hint: 'Débito bancario' },
  { id: 'mercadopago', label: 'MP', icon: QrCode, hint: 'QR de mostrador' },
];

export function paymentMethodHint(methodId, methods = POOL_METHOD_TILES) {
  return methods.find((row) => row.id === methodId)?.hint || '';
}

/**
 * Selector de medio de pago unificado (misma estética que Caja / cuotas).
 */
export default function PaymentMethodTiles({
  methods = POOL_METHOD_TILES,
  value,
  onChange,
  ariaLabel = 'Método de pago',
  disabled = false,
}) {
  const active = methods.find((row) => row.id === value);
  return (
    <div className="pay-method-block">
      <div className="pay-method-head">
        <p className="pay-method-kicker">Método</p>
        <p className="pay-method-hint">{active?.hint || ''}</p>
      </div>
      <div className="collect-methods-grid" role="radiogroup" aria-label={ariaLabel}>
        {methods.map((m) => {
          const Icon = m.icon;
          const on = value === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={m.hint}
              disabled={disabled}
              className={`collect-method-tile${on ? ' is-on' : ''}`}
              onClick={() => onChange?.(m.id)}
            >
              <Icon size={15} aria-hidden="true" strokeWidth={2.1} />
              <span className="collect-method-tile__label">{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
