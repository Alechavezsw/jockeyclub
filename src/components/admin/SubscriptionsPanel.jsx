import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import { buildSubscriptionRows } from '../../domain/payments/subscriptions';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatWhen(value) {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export default function SubscriptionsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pack, setPack] = useState({ adhesions: [], charges: [], members: [] });

  const load = async () => {
    if (!isSupabaseConfigured) {
      setError('Las suscripciones se leen de Supabase.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setPack(await repos.listDuesSubscriptions());
    } catch (err) {
      setError(err?.message || 'No se pudieron cargar las suscripciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(
    () => buildSubscriptionRows(pack.adhesions, pack.charges, pack.members),
    [pack],
  );
  const activeCount = rows.filter((row) => row.active).length;

  return (
    <div className="fade-in" style={{ display: 'grid', gap: '1rem' }}>
      <header>
        <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>Suscripciones</h1>
        <p className="page-subtitle" style={{ margin: 0 }}>Débito automático de la cuota social</p>
      </header>
      <article className="glass-card" style={{ padding: '1.1rem 1.25rem' }}>
        <p style={{ margin: '0 0 0.35rem' }}>
          <strong>{activeCount}</strong> {activeCount === 1 ? 'suscripción activa' : 'suscripciones activas'}
          {' · '}{rows.length} en total
        </p>
        <p className="ops-muted" style={{ margin: 0, maxWidth: 760 }}>
          El débito del día 10 cobra la cuota de ese mes, sin el 10 % y sin los meses atrasados.
          Cuando Mercado Pago confirma, el dinero entra en Caja: débito en Mercado Pago y crédito en Cuotas Sociales.
          Baja el capital de la cuota, el recibo nombra el mes y se manda solo. La mora y la deuda anterior se cobran aparte.
        </p>
      </article>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void load(); }} disabled={loading}>
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {error ? <p className="mp-box-err" role="alert">{error}</p> : null}

      {loading ? (
        <p className="ops-muted">Cargando suscripciones…</p>
      ) : rows.length === 0 ? (
        <article className="glass-card" style={{ padding: '1.25rem' }}>
          <p style={{ margin: 0 }}>Todavía no hay socios suscriptos al débito.</p>
        </article>
      ) : (
        <div className="glass-card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Socio</th>
                <th>Nº</th>
                <th>Estado</th>
                <th>Cuota del débito</th>
                <th>Desde</th>
                <th>Último cobro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name || 'Socio'}</strong>
                    {row.email ? <div className="ops-muted" style={{ fontSize: '0.75rem' }}>{row.email}</div> : null}
                  </td>
                  <td>{row.memberNumber || '—'}</td>
                  <td>{row.statusLabel}</td>
                  <td>{formatCurrency(row.amount)} el día 10</td>
                  <td>{formatWhen(row.since)}</td>
                  <td>
                    {row.lastCharge
                      ? `${row.lastCharge.credited ? formatCurrency(row.lastCharge.amount) : row.lastCharge.statusLabel} · ${row.lastCharge.concept || formatWhen(row.lastCharge.at)}`
                      : 'Sin débitos todavía'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
