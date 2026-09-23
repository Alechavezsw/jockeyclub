import { Link } from 'react-router-dom';
import { ShieldAlert, UserRound } from 'lucide-react';
import { buildWhatsAppDuesUrl } from '../../domain/members/dues';

function WhatsAppLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

export default function OverdueDuesStrip({
  members = [],
  formatCurrency,
  loading = false,
  limit = 8,
  duesHref = '/panel/dues',
  onOpenAll,
}) {
  const list = (members || []).slice(0, limit);
  const extra = Math.max(0, (members || []).length - list.length);

  return (
    <section className="admin-overdue-strip" aria-label="Socios con cuota vencida">
      <header className="admin-overdue-strip-head">
        <ShieldAlert size={16} aria-hidden="true" />
        <h2>Cuotas vencidas</h2>
        <span className="admin-overdue-strip-count">
          {loading ? '…' : members.length}
        </span>
        {onOpenAll ? (
          <button type="button" className="admin-overdue-strip-all" onClick={onOpenAll}>
            Ver todas
          </button>
        ) : (
          <Link to={duesHref} className="admin-overdue-strip-all">
            Ver todas
          </Link>
        )}
      </header>

      {loading && list.length === 0 ? (
        <p className="ops-muted">Cargando socios en mora…</p>
      ) : list.length === 0 ? (
        <p className="ops-muted">Ningún socio con cuota vencida.</p>
      ) : (
        <ul className="admin-overdue-strip-list">
          {list.map((m) => {
            const wa = buildWhatsAppDuesUrl(m, formatCurrency);
            const id = m.memberId || m.id;
            const profileTo = `/panel/members/${encodeURIComponent(id)}`;
            return (
              <li key={m.id || id}>
                <div className="admin-overdue-strip-who">
                  <Link
                    to={profileTo}
                    className="admin-overdue-strip-name ops-ellipsis"
                    title={`Abrir ficha de ${m.name}`}
                  >
                    {m.name}
                  </Link>
                  <span className="tabular-nums">
                    {formatCurrency(m.amountDue)}
                    {m.daysOverdue != null ? ` · ${m.daysOverdue}d` : ''}
                    {id ? ` · Nº ${id}` : ''}
                  </span>
                </div>
                <div className="admin-overdue-strip-actions">
                  <Link
                    className="admin-overdue-btn"
                    to={profileTo}
                    title={`Ver perfil de ${m.name}`}
                  >
                    <UserRound size={14} aria-hidden="true" />
                    Perfil
                  </Link>
                  <Link
                    className="admin-overdue-btn"
                    to={`${profileTo}?cobrar=1`}
                    state={{ cobrar: true, memberId: id, member: m }}
                  >
                    Cobrar
                  </Link>
                  {wa ? (
                    <a
                      className="admin-overdue-btn admin-overdue-btn--wa"
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`WhatsApp ${m.phone}`}
                      aria-label={`WhatsApp a ${m.name}`}
                    >
                      <WhatsAppLogo size={18} />
                    </a>
                  ) : (
                    <span className="admin-overdue-btn admin-overdue-btn--wa is-disabled" aria-hidden="true">
                      <WhatsAppLogo size={18} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {extra > 0 ? (
        <p className="admin-overdue-strip-more">
          +{extra} socios más en mora
        </p>
      ) : null}
    </section>
  );
}
