import { useMemo, useState } from 'react';
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import {
  collectionTennisPeriodChoices,
  duesTennisAbonoAmount,
  formatShortDate,
  memberHasTennisAbono,
  pinDuesDueDate,
  toWhatsAppPhone,
} from '../../domain/members/dues';
import { getTierDisplayName, splitTierDisplayName, tierChipVars } from '../../domain/members/tiers';
import {
  billingAccountMember,
  isFamilyDependent,
  isLiveMember,
  isTitularMember,
  memberMatchesDirectoryQuery,
  memberNumberOf,
} from '../../domain/members/households';
import { persistDuesCollection, recordTennisAbonoCollection } from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import CollectDuesModal from './CollectDuesModal';

const PAGE_SIZE = 25;

function WhatsAppIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function TennisBallIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.25" fill="currentColor" opacity="0.92" />
      <path
        d="M6.2 5.4c2.8 1.6 4.6 4.4 4.6 7.6s-1.8 6-4.6 7.6M17.8 5.4c-2.8 1.6-4.6 4.4-4.6 7.6s1.8 6 4.6 7.6"
        fill="none"
        stroke="rgba(20, 60, 40, 0.55)"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TierChip({ tier, catalog }) {
  const name = getTierDisplayName(tier, catalog);
  const { main, sub } = splitTierDisplayName(name);
  return (
    <span className="tier-chip is-compact" style={tierChipVars(tier, catalog)} title={name}>
      <span className="tier-chip-main">{main}</span>
      {sub ? <span className="tier-chip-sub">{sub}</span> : null}
    </span>
  );
}

function standingLabel(standing) {
  if (standing === 'mora') return 'Mora';
  if (standing === 'deuda') return 'Deuda';
  return 'Al día';
}

/**
 * Escritorio Tenis: padrón de abono tenis.
 * El cobro es independiente de la cuota social (sin 10 %), a la cuenta del titular.
 */
export default function TenisMembersPanel({
  members = [],
  membersLoading = false,
  setMembers,
  addJournalEntry,
  onAccountEntry,
  onSendMessage,
  formatCurrency,
  onOpenProfile,
  tierCatalog = [],
  paymentPlans = [],
  paymentTolerance = 1000,
}) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [collectTarget, setCollectTarget] = useState(null);
  const [flash, setFlash] = useState('');

  const tennisRows = useMemo(() => {
    const today = new Date();
    const list = members || [];
    return list
      .filter((m) => isLiveMember(m) && memberHasTennisAbono(m))
      .map((m) => {
        // Cuenta = titular del hogar (lista completa del padrón). Si falta, no tumbar la UI.
        const account = billingAccountMember(m, list) || m;
        const tennisAmount = Number(duesTennisAbonoAmount(m, today)) || 0;
        const balance = Math.max(0, Number(account.outstandingBalance) || 0);
        const dueIso = pinDuesDueDate(account.nextDueDate, account) || account.nextDueDate || null;
        const dependent = isFamilyDependent(m) || !isTitularMember(m);
        const tennisOpen = collectionTennisPeriodChoices(account, today, {
          monthlyAmount: tennisAmount,
        });
        return {
          ...m,
          tennisAmount,
          account,
          accountId: account.memberId || account.id,
          accountName: account.name || '',
          accountNumber: memberNumberOf(account) || '',
          balance,
          dueIso,
          role: dependent ? 'familiar' : 'titular',
          standing: balance > 0 ? 'deuda' : 'al_dia',
          tennisPending: tennisOpen.length > 0,
          tennisOpenAmount: tennisOpen.reduce((sum, row) => sum + (Number(row.capital) || 0), 0),
        };
      })
      .toSorted((a, b) => (Number(b.tennisPending) - Number(a.tennisPending))
        || (b.balance - a.balance)
        || String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  }, [members]);

  const titulares = useMemo(
    () => tennisRows.filter((m) => m.role === 'titular'),
    [tennisRows],
  );
  const familiares = useMemo(
    () => tennisRows.filter((m) => m.role === 'familiar'),
    [tennisRows],
  );
  const withDebt = useMemo(
    () => tennisRows.filter((m) => m.tennisPending || m.balance > 0),
    [tennisRows],
  );
  const monthTotal = useMemo(
    () => tennisRows.reduce((sum, m) => sum + (Number(m.tennisAmount) || 0), 0),
    [tennisRows],
  );
  const debtTotal = useMemo(
    () => withDebt.reduce((sum, m) => sum + (Number(m.balance) || 0), 0),
    [withDebt],
  );
  const accountsWithDebt = useMemo(() => {
    const seen = new Set();
    let n = 0;
    for (const row of withDebt) {
      const key = String(row.accountId || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      n += 1;
    }
    return n;
  }, [withDebt]);

  const filtered = useMemo(() => {
    let list = tennisRows;
    if (kindFilter === 'titular') list = titulares;
    else if (kindFilter === 'familiar') list = familiares;
    else if (kindFilter === 'debt') list = withDebt;
    const q = query.trim();
    if (q) {
      list = list.filter((m) => (
        memberMatchesDirectoryQuery(m, q)
        || memberMatchesDirectoryQuery(m.account, q)
      ));
    }
    return list;
  }, [tennisRows, titulares, familiares, withDebt, kindFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const canCollect = typeof setMembers === 'function';

  const setFilter = (next) => {
    setKindFilter((cur) => (cur === next && next !== 'all' ? 'all' : next));
    setPage(0);
  };

  const handleConfirmCollect = async (payload) => {
    if (!collectTarget?.account) return;
    const account = collectTarget.account;
    if (payload?.alreadyApplied) {
      setCollectTarget(null);
      setFlash(`Pago de Mercado Pago acreditado · ${account.name}`);
      window.setTimeout(() => setFlash(''), 5000);
      return;
    }
    const result = recordTennisAbonoCollection(account, {
      ...payload,
      members,
      monthlyAmount: collectTarget.tennisAmount,
    });
    const saved = await persistDuesCollection(result, {
      setMembers,
      addJournalEntry,
      onAccountEntry,
    });
    void deliverPaymentReceipt({
      member: saved?.member || result.member,
      payment: saved?.payment || result.payment,
      onSendMessage,
      kind: 'cuota',
    });
    setCollectTarget(null);
    setFlash(`Abono tenis · ${formatCurrency((saved?.payment || result.payment).amount)} · ${(saved?.member || result.member).name}`);
    window.setTimeout(() => setFlash(''), 5000);
  };

  return (
    <div className="fade-in glass-card tenis-desk">
      <header className="tenis-desk__hero">
        <div className="tenis-desk__hero-copy">
          <span className="tenis-desk__icon" aria-hidden="true">
            <TennisBallIcon size={20} />
          </span>
          <div>
            <p className="tenis-desk__eyebrow">Disciplina</p>
            <h2 className="tenis-desk__title">Tenis</h2>
            <p className="tenis-desk__lead">
              Abono $ 12.000 / mes · aparte de la cuota · sin 10 %. También vitalicios y fundadores.
            </p>
          </div>
        </div>
        <div className="tenis-desk__kpis" aria-label="Resumen tenis">
          <div className="tenis-desk__kpi">
            <span>Abonos</span>
            <strong className="tabular-nums">{tennisRows.length.toLocaleString('es-AR')}</strong>
          </div>
          <div className="tenis-desk__kpi">
            <span>Mes</span>
            <strong className="tabular-nums">{formatCurrency(monthTotal)}</strong>
          </div>
          <div className="tenis-desk__kpi is-debt">
            <span>Cuentas con saldo</span>
            <strong className="tabular-nums">{accountsWithDebt.toLocaleString('es-AR')}</strong>
          </div>
        </div>
      </header>

      {flash ? <p className="dues-flash" role="status">{flash}</p> : null}

      <div className="tenis-desk__filters" role="group" aria-label="Filtros tenis">
        <button type="button" className={`tenis-desk__filter${kindFilter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>
          Todos <b>{tennisRows.length}</b>
        </button>
        <button type="button" className={`tenis-desk__filter${kindFilter === 'titular' ? ' is-on' : ''}`} onClick={() => setFilter('titular')}>
          Titulares <b>{titulares.length}</b>
        </button>
        <button type="button" className={`tenis-desk__filter${kindFilter === 'familiar' ? ' is-on' : ''}`} onClick={() => setFilter('familiar')}>
          Grupo familiar <b>{familiares.length}</b>
        </button>
        <button type="button" className={`tenis-desk__filter is-debt${kindFilter === 'debt' ? ' is-on' : ''}`} onClick={() => setFilter('debt')}>
          Abono pendiente <b>{withDebt.length}</b>
          <span>{formatCurrency(debtTotal)}</span>
        </button>
      </div>

      <div className="tenis-desk__toolbar">
        <label className="tenis-desk__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            className="form-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Nombre, Nº o DNI…"
            aria-label="Buscar abono tenis"
          />
        </label>
        <p className="tenis-desk__count">
          {membersLoading ? 'Cargando…' : `${filtered.length.toLocaleString('es-AR')} en la lista`}
        </p>
      </div>

      <div className="table-responsive tenis-desk__wrap">
        <table className="admin-table tenis-desk__table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Cuenta</th>
              <th>Categoría</th>
              <th className="tenis-desk__num">Abono</th>
              <th className="tenis-desk__num">Vence</th>
              <th className="tenis-desk__num">Saldo cuenta</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="tenis-desk__empty">
                  {membersLoading ? 'Cargando…' : 'No hay abonos de tenis con este filtro.'}
                </td>
              </tr>
            ) : pageRows.map((m) => {
              const wa = toWhatsAppPhone(m.phone || m.account?.phone);
              const nro = memberNumberOf(m) || '—';
              const dueLabel = formatShortDate(m.dueIso) || '—';
              const sameAccount = String(m.accountId || '') === String(m.memberId || m.id || '');
              return (
                <tr key={m.memberId || m.id}>
                  <td>
                    <div className="tenis-desk__who">
                      <button
                        type="button"
                        className="tenis-desk__name"
                        onClick={() => onOpenProfile?.(m.memberId)}
                      >
                        {m.name}
                      </button>
                      <span className="tenis-desk__nro">
                        Nº {nro}
                        {m.role === 'familiar' ? ' · Familiar' : ''}
                      </span>
                    </div>
                  </td>
                  <td>
                    {sameAccount ? (
                      <span className="tenis-desk__account is-self">Titular</span>
                    ) : (
                      <button
                        type="button"
                        className="tenis-desk__account"
                        onClick={() => onOpenProfile?.(m.accountId)}
                        title={`Cuenta Nº ${m.accountNumber || '—'}`}
                      >
                        {m.accountName || 'Titular'}
                        {m.accountNumber ? (
                          <span className="tenis-desk__nro">Nº {m.accountNumber}</span>
                        ) : null}
                      </button>
                    )}
                  </td>
                  <td><TierChip tier={m.tier} catalog={tierCatalog} /></td>
                  <td className="tenis-desk__num">
                    <div className="tenis-desk__cuota">
                      <strong className="tabular-nums">{formatCurrency(m.tennisAmount)}</strong>
                      <span className="tenis-desk__tag">Sin mora 10 %</span>
                    </div>
                  </td>
                  <td className="tenis-desk__num tabular-nums">{dueLabel}</td>
                  <td className="tenis-desk__num">
                    <div className="tenis-desk__saldo">
                      <strong className={m.balance > 0 ? 'is-debt' : 'is-ok'}>
                        {formatCurrency(m.balance)}
                      </strong>
                      <span className={`tenis-desk__status is-${m.standing}`}>
                        {standingLabel(m.standing)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="tenis-desk__actions">
                      {wa ? (
                        <a
                          href={`https://wa.me/${wa}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tenis-desk__wa"
                          title={`WhatsApp ${m.phone || m.account?.phone}`}
                          aria-label={`WhatsApp ${m.name}`}
                        >
                          <WhatsAppIcon size={15} />
                        </a>
                      ) : null}
                      {canCollect && m.tennisPending ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => setCollectTarget({
                            account: m.account,
                            tennisAmount: m.tennisAmount,
                            personName: m.name,
                          })}
                        >
                          <Banknote size={14} /> Cobrar abono
                        </button>
                      ) : (
                        <span className="tenis-desk__idle">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE ? (
        <div className="dues-section-pager">
          <span className="dues-section-pager-meta">
            {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} de {filtered.length}
          </span>
          <div className="dues-section-pager-btns">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="dues-section-pager-page">{safePage + 1} / {totalPages}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {collectTarget?.account ? (
        <CollectDuesModal
          member={collectTarget.account}
          members={members}
          formatCurrency={formatCurrency}
          onClose={() => setCollectTarget(null)}
          onConfirm={handleConfirmCollect}
          paymentPlans={paymentPlans}
          paymentTolerance={paymentTolerance}
          chargeScope="abono_tenis"
          tennisMonthlyAmount={collectTarget.tennisAmount}
        />
      ) : null}
    </div>
  );
}
