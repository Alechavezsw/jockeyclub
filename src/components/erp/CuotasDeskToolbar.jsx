import {
  ArrowLeft,
  BookOpen,
  CalendarRange,
  FileSpreadsheet,
  ListTree,
  Plus,
  Search,
  Ticket,
  Upload,
  Wallet,
} from 'lucide-react';

const CONSULT = [
  { id: 'balances', icon: Wallet, label: 'Saldos / Socios', hint: 'Cuentas de cada socio' },
  { id: 'detailed_cc', icon: ListTree, label: 'CC detalladas', hint: 'Cargos y pagos' },
  { id: 'credit_purchases', icon: Ticket, label: 'Créditos comprados', hint: 'Compras a crédito' },
  { id: 'monthly_debts', icon: FileSpreadsheet, label: 'Deudas mes a mes', hint: 'Mora histórica' },
  { id: 'accounts', icon: BookOpen, label: 'Cuentas contables', hint: 'Plan de cuotas' },
];

const OPERATE = [
  { id: 'import_collections', icon: Upload, label: 'Importar cobranzas', hint: 'Cargar el Excel', tone: 'emerald' },
  { id: 'impute_events', icon: Plus, label: 'Imputar eventos', hint: 'Pasar a la cuenta', tone: 'emerald' },
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
}) {
  return (
    <nav className="cuotas-toolbar" aria-label="Herramientas de cuotas">
      <div className="cuotas-toolbar-head">
        {onBack ? (
          <button type="button" className="cuotas-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            Volver
          </button>
        ) : (
          <p className="cuotas-kicker">Caja</p>
        )}
        <h2 className="cuotas-title">
          <CalendarRange size={18} aria-hidden="true" />
          Cuotas
        </h2>
      </div>
      <div className="cuotas-desk">
        <div className="cuotas-desk-band">
          <p className="cuotas-desk-label">Consultar</p>
          <div className="cuotas-actions">
            {CONSULT.map((tool) => (
              <CuotasTool
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                hint={tool.hint}
                current={current === tool.id}
                onClick={() => onGo?.(tool.id)}
              />
            ))}
          </div>
        </div>
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
      </div>
    </nav>
  );
}
