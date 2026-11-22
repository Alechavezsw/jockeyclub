import { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Wallet,
} from 'lucide-react';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  buildSubscriptionRows,
  summarizeSubscriptionRows,
} from '../../domain/payments/subscriptions';

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

function padNro(value) {
  const raw = String(value || '').replace(/\D/g, '');
  if (!raw) return '—';
  return raw.padStart(5, '0');
}

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function statusTone(row) {
  if (row?.active) return 'is-ok';
  if (/pendiente/i.test(row?.statusLabel || '')) return 'is-wait';
  return 'is-off';
}

export default function SubscriptionsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pack, setPack] = useState({ adhesions: [], charges: [], members: [] });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [hideDuplicates, setHideDuplicates] = useState(true);

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
    () => buildSubscriptionRows(pack.adhesions, pack.charges, pack.members, { hideDuplicates }),
    [pack, hideDuplicates],
  );

  const filtered = useMemo(() => {
    const needle = fold(query);
    return rows.filter((row) => {
      if (filter === 'active' && !row.active) return false;
      if (filter === 'pending' && !/pendiente/i.test(row.statusLabel)) return false;
      if (filter === 'other' && (row.active || /pendiente/i.test(row.statusLabel))) return false;
      if (!needle) return true;
      const hay = fold([
        row.name,
        row.memberNumber,
        row.email,
        row.phone,
        row.tier,
        row.preapprovalId,
        row.concept,
      ].join(' '));
      return hay.includes(needle);
    });
  }, [rows, query, filter]);

  const summary = useMemo(() => summarizeSubscriptionRows(rows), [rows]);
  const rawDupes = useMemo(() => {
    const all = buildSubscriptionRows(pack.adhesions, pack.charges, pack.members, {
      hideDuplicates: false,
    });
    return all.filter((row) => row.duplicateOf).length;
  }, [pack]);

  return (
    <div className="fade-in subs-desk">
      <header className="subs-desk-head">
        <div>
          <p className="subs-desk-kicker">Mercado Pago · cuota social</p>
          <h1 className="subs-desk-title">Suscripciones</h1>
          <p className="subs-desk-meta">
            Débito automático del día 10: solo capital del mes, sin el 10&nbsp;% y sin atrasos.
            Al acreditar, entra en Caja y el recibo se manda solo.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => { void load(); }}
          disabled={loading}
        >
          <RefreshCw size={14} aria-hidden />
          Actualizar
        </button>
      </header>

      <section className="subs-desk-kpis" aria-label="Resumen de suscripciones">
        <article>
          <span><CheckCircle2 size={14} aria-hidden /> Activas</span>
          <strong>{summary.active}</strong>
          <em>{formatCurrency(summary.monthlyActive)} / mes</em>
        </article>
        <article>
          <span><Clock3 size={14} aria-hidden /> Pendientes</span>
          <strong>{summary.pending}</strong>
          <em>esperando autorización MP</em>
        </article>
        <article>
          <span><Wallet size={14} aria-hidden /> Con cobros</span>
          <strong>{summary.withCharges}</strong>
          <em>al menos un débito</em>
        </article>
        <article>
          <span><CreditCard size={14} aria-hidden /> En lista</span>
          <strong>{filtered.length}</strong>
          <em>{summary.total} sin filtro · día 10</em>
        </article>
      </section>

      <div className="subs-desk-toolbar">
        <label className="subs-desk-search">
          <Search size={15} aria-hidden />
          <input
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, Nº, mail o preapproval"
            autoComplete="off"
          />
        </label>
        <div className="subs-desk-tabs" role="tablist" aria-label="Filtrar por estado">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'pending', label: 'Pendientes' },
            { id: 'active', label: 'Activas' },
            { id: 'other', label: 'Otras' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={filter === tab.id ? 'is-on' : undefined}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="subs-desk-toggle">
          <input
            type="checkbox"
            checked={hideDuplicates}
            onChange={(e) => setHideDuplicates(e.target.checked)}
          />
          Ocultar repeticiones
          {rawDupes > 0 ? <em>{rawDupes} extra</em> : null}
        </label>
      </div>

      {error ? <p className="mp-box-err" role="alert">{error}</p> : null}

      {rawDupes > 0 && hideDuplicates ? (
        <p className="subs-desk-note" role="status">
          <AlertTriangle size={14} aria-hidden />
          Hay {rawDupes} adhesión{rawDupes === 1 ? '' : 'es'} repetida{rawDupes === 1 ? '' : 's'} del mismo socio.
          Se muestra solo la más reciente; desmarcá «Ocultar repeticiones» para verlas todas.
        </p>
      ) : null}

      {loading ? (
        <p className="ops-muted">Cargando suscripciones…</p>
      ) : filtered.length === 0 ? (
        <article className="glass-card subs-desk-empty">
          <p style={{ margin: 0 }}>
            {rows.length === 0
              ? 'Todavía no hay socios suscriptos al débito.'
              : 'Ninguna suscripción coincide con la búsqueda o el filtro.'}
          </p>
        </article>
      ) : (
        <div className="glass-card subs-desk-table-wrap">
          <table className="admin-table subs-desk-table">
            <thead>
              <tr>
                <th>Socio</th>
                <th>Cuota</th>
                <th>Estado</th>
                <th>Adhesión</th>
                <th>Último cobro</th>
                <th>MP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className={statusTone(row)}>
                  <td>
                    <div className="subs-desk-person">
                      <strong>{row.name || 'Socio'}</strong>
                      <span className="subs-desk-nro">Nº {padNro(row.memberNumber)}</span>
                      {row.tier ? <span className="subs-desk-chip">{row.tier}</span> : null}
                      {row.hasDuplicates ? (
                        <span className="subs-desk-chip is-warn">
                          {row.duplicateTotal} adhesiones
                        </span>
                      ) : null}
                      {row.duplicateOf ? (
                        <span className="subs-desk-chip is-warn">Repetida</span>
                      ) : null}
                    </div>
                    <div className="subs-desk-contacts">
                      {row.email || null}
                      {row.email && row.phone ? ' · ' : null}
                      {row.phone || null}
                      {!row.email && !row.phone ? 'Sin contacto en ficha' : null}
                    </div>
                    {Number(row.outstandingBalance) > 0.009 ? (
                      <div className="subs-desk-balance">
                        Ficha {formatCurrency(row.outstandingBalance)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <strong className="tabular-nums">{formatCurrency(row.amount)}</strong>
                    <div className="ops-muted" style={{ fontSize: '0.75rem' }}>capital · día 10</div>
                  </td>
                  <td>
                    <span className={`subs-desk-status ${statusTone(row)}`}>
                      {row.statusLabel}
                    </span>
                  </td>
                  <td>
                    <div>{formatWhen(row.since)}</div>
                    {row.concept ? (
                      <div className="ops-muted" style={{ fontSize: '0.72rem', maxWidth: 220 }}>
                        {row.concept}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {row.lastCharge ? (
                      <>
                        <strong className="tabular-nums">
                          {row.lastCharge.credited
                            ? formatCurrency(row.lastCharge.amount)
                            : row.lastCharge.statusLabel}
                        </strong>
                        <div className="ops-muted" style={{ fontSize: '0.75rem' }}>
                          {row.lastCharge.concept || formatWhen(row.lastCharge.at)}
                        </div>
                        {row.chargeCount > 1 ? (
                          <div className="ops-muted" style={{ fontSize: '0.72rem' }}>
                            {row.creditedCount}/{row.chargeCount} cobros
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="ops-muted">Sin débitos todavía</span>
                    )}
                  </td>
                  <td>
                    <code className="subs-desk-code">
                      {row.preapprovalShort || '—'}
                    </code>
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
