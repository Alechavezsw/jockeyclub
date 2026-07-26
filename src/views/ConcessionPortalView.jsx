import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Store, CalendarDays, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  findConcessionByPortalCode,
  CONCESSION_TYPES,
  DOC_TYPES,
  getConcessionExpiryStatus,
  missingRequiredDocuments,
  checklistProgress,
} from '../domain/concessions/concessions';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Portal de solo lectura para el concesionario (código en URL).
 */
export default function ConcessionPortalView({ code: codeProp, concessions = [], canonPayments = [] }) {
  const { code: codeParam } = useParams();
  const code = codeProp || codeParam || '';
  const concession = useMemo(
    () => findConcessionByPortalCode(concessions, code),
    [concessions, code]
  );

  if (!concession) {
    return (
      <div className="fade-in conc-portal-page">
        <div className="glass-card conc-portal-card">
          <AlertTriangle size={28} color="#f59e0b" />
          <h1>Código no válido</h1>
          <p>No encontramos una concesión con el código <code>{code}</code>.</p>
        </div>
      </div>
    );
  }

  const expiry = getConcessionExpiryStatus(concession);
  const missing = missingRequiredDocuments(concession);
  const progress = checklistProgress(concession);
  const payments = canonPayments
    .filter((p) => p.concessionId === concession.id)
    .slice(0, 12);

  return (
    <div className="fade-in conc-portal-page">
      <header className="conc-portal-hero">
        <Store size={22} />
        <div>
          <p>Portal del concesionario · Jockey Club San Juan</p>
          <h1>{concession.name}</h1>
          <span>{concession.concessionaire}</span>
        </div>
      </header>

      <div className="conc-portal-grid">
        <article className="glass-card conc-portal-card">
          <h2><CalendarDays size={16} /> Contrato</h2>
          <p><strong>Tipo:</strong> {CONCESSION_TYPES[concession.type] || concession.type}</p>
          <p><strong>Vigencia:</strong> {formatDate(concession.startDate)} → {formatDate(concession.endDate)}</p>
          <p><strong>Estado:</strong> {expiry.label}</p>
          <p><strong>Canon mensual:</strong> {formatCurrency(concession.monthlyFee)}</p>
          {(expiry.status === 'expiring' || expiry.status === 'expired') && (
            <div className={`conc-deadline ${expiry.status === 'expired' ? 'is-bad' : 'is-warn'}`}>
              <AlertTriangle size={14} />
              {expiry.status === 'expired'
                ? 'Tu contrato está vencido. Contactá a administración.'
                : `Tu contrato vence en ${expiry.daysLeft} día(s).`}
            </div>
          )}
        </article>

        <article className="glass-card conc-portal-card">
          <h2><FileText size={16} /> Documentación</h2>
          {missing.length > 0 ? (
            <p className="conc-error">Pendiente: {missing.map((t) => DOC_TYPES[t] || t).join(', ')}</p>
          ) : (
            <p style={{ color: 'var(--emerald-accent)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <CheckCircle2 size={16} /> Documentación requerida completa
            </p>
          )}
          <ul className="conc-pay-list">
            {(concession.documents || []).map((d) => (
              <li key={d.id}>
                <span>{DOC_TYPES[d.type] || d.type}</span>
                <strong>{d.name || '—'}</strong>
              </li>
            ))}
          </ul>
          <p className="conc-notes">Checklist interno del club: {progress.done}/{progress.total}</p>
        </article>

        <article className="glass-card conc-portal-card">
          <h2>Últimos pagos de canon</h2>
          <ul className="conc-pay-list">
            {payments.length === 0 && <li className="conc-empty">Sin pagos registrados aún.</li>}
            {payments.map((p) => (
              <li key={p.id}>
                <span>{p.period}</span>
                <strong>{formatCurrency(p.amount)}</strong>
                <em>{p.date}</em>
              </li>
            ))}
          </ul>
          <p className="conc-notes">
            Para consultas: administración del club · código <code>{concession.portalCode}</code>
          </p>
        </article>
      </div>
    </div>
  );
}
