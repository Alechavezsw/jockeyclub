import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  BookOpen,
  FileSpreadsheet,
  ListTree,
  Plus,
  Receipt,
  Search,
  Ticket,
  Upload,
  Wallet,
} from 'lucide-react';

const CONSULT = [
  { id: 'consult_debt', icon: AlertTriangle, label: 'Consultar deuda', hint: 'Cuota + intereses · PDF', tone: 'danger' },
  { id: 'balances', icon: Wallet, label: 'Saldos', hint: 'Cuentas de cada socio' },
  { id: 'detailed_cc', icon: ListTree, label: 'CC detalladas', hint: 'Cargos y pagos' },
  { id: 'payment_receipts', icon: Receipt, label: 'Comprobantes', hint: 'Descargar o reenviar' },
  { id: 'credit_purchases', icon: Ticket, label: 'Créditos comprados', hint: 'Compras a crédito' },
  { id: 'monthly_debts', icon: FileSpreadsheet, label: 'Deudas mes a mes', hint: 'Saldo por mes' },
  { id: 'accounts', icon: BookOpen, label: 'Cuentas contables', hint: 'Pendiente por categoría' },
];

const OPERATE = [
  { id: 'collect_dues', icon: Banknote, label: 'Cobrar cuota', hint: 'Buscar socio y cobrar', tone: 'emerald' },
  { id: 'import_collections', icon: Upload, label: 'Importar cobranzas', hint: 'Excel débitos + boleto', tone: 'emerald' },
  { id: 'impute_events', icon: Plus, label: 'Imputar eventos', hint: 'Alquiler a la cuenta', tone: 'emerald' },
  { id: 'mora', icon: Search, label: 'Control de mora', hint: 'Quién debe hoy', tone: 'warn' },
];

export function CuotasTool({ icon: Icon, label, hint, tone = 'gold', current = false, onClick }) {
  return (
    <button
      type="button"
      className={`cuotas-tool tone-${tone}${current ? ' is-current' : ''}`}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
    >
      <i className="cuotas-tool-icon" aria-hidden="true">
        <Icon size={17} strokeWidth={2.15} />
      </i>
      <span className="cuotas-tool-copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </button>
  );
}

export default function CuotasDeskToolbar({
  current = '',
  onGo,
  onBack,
  extraOperate = [],
  consultOnly = false,
  resumen = [],
  activeResumen = '',
  onResumen,
  children = null,
}) {
  const hasResumen = Array.isArray(resumen) && resumen.length > 0;

  return (
    <nav className="cuotas-toolbar" aria-label="Herramientas de cuotas">
      {onBack ? (
        <div className="cuotas-toolbar-head">
          <button type="button" className="cuotas-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            Volver
          </button>
        </div>
      ) : null}
      <div className="cuotas-desk">
        {hasResumen ? (
          <div className="cuotas-desk-band">
            <p className="cuotas-desk-label">Resumen</p>
            <div className="cuotas-actions">
              {resumen.map((tool) => (
                <CuotasTool
                  key={tool.id}
                  icon={tool.icon}
                  label={tool.label}
                  hint={tool.hint}
                  tone={tool.tone || 'gold'}
                  current={activeResumen === tool.id}
                  onClick={() => onResumen?.(tool.id)}
                />
              ))}
            </div>
            {children ? (
              <div className="cuotas-toolbar-panel-body">
                {children}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="cuotas-desk-band">
          <p className="cuotas-desk-label">Consultar</p>
          <div className="cuotas-actions">
            {CONSULT.map((tool) => (
              <CuotasTool
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                hint={tool.hint}
                tone={tool.tone || 'gold'}
                current={current === tool.id}
                onClick={() => onGo?.(tool.id)}
              />
            ))}
          </div>
        </div>
        {consultOnly ? null : (
        <div className="cuotas-desk-band">
          <p className="cuotas-desk-label">Operar</p>
          <div className="cuotas-actions">
            {OPERATE.map((tool) => (
              <CuotasTool
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                hint={tool.hint}
                tone={tool.tone}
                current={current === tool.id}
                onClick={() => onGo?.(tool.id)}
              />
            ))}
            {extraOperate.map((tool) => (
              <CuotasTool
                key={tool.id || tool.label}
                icon={tool.icon}
                label={tool.label}
                hint={tool.hint}
                tone={tool.tone || 'emerald'}
                current={current === tool.id}
                onClick={tool.onClick}
              />
            ))}
          </div>
        </div>
        )}
      </div>
      {!hasResumen && children ? (
        <div className="cuotas-toolbar-panels">
          {children}
        </div>
      ) : null}
    </nav>
  );
}
