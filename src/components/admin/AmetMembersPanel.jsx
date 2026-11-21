import { useMemo, useState } from 'react';
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Search,
  BadgePercent,
} from 'lucide-react';
import {
  DUES_AMET_DUE_DAY,
  duesAmetInterestAmount,
  duesAmetQuotaAmount,
  duesRuleSentences,
  formatShortDate,
  isAmetDuesMember,
  pinDuesDueDate,
  toWhatsAppPhone,
} from '../../domain/members/dues';
import { DUES_AMET_RATE, getTierDisplayName, splitTierDisplayName, tierChipVars } from '../../domain/members/tiers';
import {
  isLiveMember,
  isTitularMember,
  memberMatchesDirectoryQuery,
  memberNumberOf,
} from '../../domain/members/households';
import { persistDuesCollection, recordDuesCollection } from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import CollectDuesModal from './CollectDuesModal';

const PAGE_SIZE = 25;

function ametKind(member) {
  const tier = String(member?.tier || '').toLowerCase();
  if (tier.includes('individual')) return 'individual';
  if (tier.includes('familiar')) return 'familiar';
  const cats = Array.isArray(member?.cuotaCategories)
    ? member.cuotaCategories.join(' ').toLowerCase()
    : String(member?.cuotaCategories || '').toLowerCase();
  if (cats.includes('individual')) return 'individual';
  return 'familiar';
}

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
 * Escritorio AMET: titulares familiar/individual AMET, vencimiento día 18,
 * cuota (base − 2,5 %) y saldo.
 */
export default function AmetMembersPanel({
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
  const rules = useMemo(() => duesRuleSentences(), []);
  const ametCutPct = Math.round(DUES_AMET_RATE * 1000) / 10;
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [collectMember, setCollectMember] = useState(null);
  const [flash, setFlash] = useState('');

  const ametMembers = useMemo(() => {
    const today = new Date();
    return (members || [])
      .filter((m) => isLiveMember(m) && isTitularMember(m) && isAmetDuesMember(m))
      .map((m) => {
        const monthly = Number(duesAmetQuotaAmount(m, today)) || 0;
        const cut = Number(duesAmetInterestAmount(m, today)) || 0;
        const balance = Math.max(0, Number(m.outstandingBalance) || 0);
        const dueIso = pinDuesDueDate(m.nextDueDate, m) || m.nextDueDate || null;
        return {
          ...m,
          ametKind: ametKind(m),
          monthlyDues: monthly,
          ametCut: cut,
          balance,
          dueIso,
          mora: false,
          // AMET nunca entra en mora: solo deuda o al día.
          standing: balance > 0 ? 'deuda' : 'al_dia',
        };
      })
      .toSorted((a, b) => (b.balance - a.balance)
        || String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  }, [members]);

  const familiar = useMemo(
    () => ametMembers.filter((m) => m.ametKind === 'familiar'),
    [ametMembers],
  );
  const individual = useMemo(
    () => ametMembers.filter((m) => m.ametKind === 'individual'),
    [ametMembers],
  );
  const withDebt = useMemo(
    () => ametMembers.filter((m) => m.balance > 0),
    [ametMembers],
  );
  const monthTotal = useMemo(
    () => ametMembers.reduce((sum, m) => sum + (Number(m.monthlyDues) || 0), 0),
    [ametMembers],
  );
  const debtTotal = useMemo(
    () => withDebt.reduce((sum, m) => sum + (Number(m.balance) || 0), 0),
    [withDebt],
  );

  const filtered = useMemo(() => {
    let list = ametMembers;
    if (kindFilter === 'familiar') list = familiar;
    else if (kindFilter === 'individual') list = individual;
    else if (kindFilter === 'debt') list = withDebt;
    const q = query.trim();
    if (q) list = list.filter((m) => memberMatchesDirectoryQuery(m, q));
    return list;
  }, [ametMembers, familiar, individual, withDebt, kindFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const canCollect = typeof setMembers === 'function';

  const setFilter = (next) => {
    setKindFilter((cur) => (cur === next && next !== 'all' ? 'all' : next));
    setPage(0);
  };

  const handleConfirmCollect = async (payload) => {
    if (!collectMember) return;
    if (payload?.alreadyApplied) {
      setCollectMember(null);
      setFlash(`Pago de Mercado Pago acreditado · ${collectMember.name}`);
      window.setTimeout(() => setFlash(''), 5000);
      return;
    }
    const result = recordDuesCollection(collectMember, { ...payload, members, paymentPlans });
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
    setCollectMember(null);
    setFlash(`Cobro registrado · ${formatCurrency((saved?.payment || result.payment).amount)} · ${(saved?.member || result.member).name}`);
    window.setTimeout(() => setFlash(''), 5000);
  };

  return (
    <div className="fade-in glass-card amet-desk">
      <header className="amet-desk__head">
        <div className="amet-desk__title-row">
          <span className="amet-desk__icon" aria-hidden="true">
            <BadgePercent size={18} />
          </span>
          <div>
            <h2 className="amet-desk__title">AMET</h2>
            <p className="amet-desk__lead">
              Vence el {DUES_AMET_DUE_DAY} · cuota con −{String(ametCutPct).replace('.', ',')} % (tarifa, no mora).
              {' '}
              Sin recargo.
            </p>
          </div>
        </div>
        <p className="amet-desk__hint" title={rules.ametLine}>
          {ametMembers.length.toLocaleString('es-AR')} titulares · {formatCurrency(monthTotal)} / mes
        </p>
      </header>

      {flash ? <p className="dues-flash" role="status">{flash}</p> : null}

      <div className="amet-desk__filters" role="group" aria-label="Filtros AMET">
        <button type="button" className={`amet-desk__filter${kindFilter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>
          Todos <b>{ametMembers.length}</b>
        </button>
        <button type="button" className={`amet-desk__filter${kindFilter === 'familiar' ? ' is-on' : ''}`} onClick={() => setFilter('familiar')}>
          Familiar <b>{familiar.length}</b>
        </button>
        <button type="button" className={`amet-desk__filter${kindFilter === 'individual' ? ' is-on' : ''}`} onClick={() => setFilter('individual')}>
          Individual <b>{individual.length}</b>
        </button>
        <button type="button" className={`amet-desk__filter is-debt${kindFilter === 'debt' ? ' is-on' : ''}`} onClick={() => setFilter('debt')}>
          Con saldo <b>{withDebt.length}</b>
          <span>{formatCurrency(debtTotal)}</span>
        </button>
      </div>

      <div className="amet-desk__toolbar">
        <label className="amet-desk__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            className="form-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Nombre, Nº o DNI…"
            aria-label="Buscar socio AMET"
          />
        </label>
        <p className="amet-desk__count">
          {membersLoading ? 'Cargando…' : `${filtered.length.toLocaleString('es-AR')} en la lista`}
        </p>
      </div>

      <div className="table-responsive amet-desk__wrap">
        <table className="admin-table amet-desk__table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Categoría</th>
              <th className="amet-desk__num">Cuota</th>
              <th className="amet-desk__num">Vence</th>
              <th className="amet-desk__num">Saldo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="amet-desk__empty">
                  {membersLoading ? 'Cargando…' : 'No hay socios AMET con este filtro.'}
                </td>
              </tr>
            ) : pageRows.map((m) => {
              const wa = toWhatsAppPhone(m.phone);
              const nro = memberNumberOf(m) || '—';
              const dueLabel = formatShortDate(m.dueIso) || `${DUES_AMET_DUE_DAY}`;
              return (
                <tr key={m.memberId || m.id}>
                  <td>
                    <div className="amet-desk__who">
                      <button
                        type="button"
                        className="amet-desk__name"
                        onClick={() => onOpenProfile?.(m.memberId)}
                      >
                        {m.name}
                      </button>
                      <span className="amet-desk__nro">Nº {nro}</span>
                    </div>
                  </td>
                  <td><TierChip tier={m.tier} catalog={tierCatalog} /></td>
                  <td className="amet-desk__num">
                    <div className="amet-desk__cuota">
                      <strong className="tabular-nums">{formatCurrency(m.monthlyDues)}</strong>
                      <span className="amet-desk__interes tabular-nums">
                        −{String(ametCutPct).replace('.', ',')} %
                        {m.ametCut > 0 ? ` (${formatCurrency(m.ametCut)})` : ''}
                      </span>
                    </div>
                  </td>
                  <td className="amet-desk__num tabular-nums">{dueLabel}</td>
                  <td className="amet-desk__num">
                    <div className="amet-desk__saldo">
                      <strong className={m.balance > 0 ? 'is-debt' : 'is-ok'}>
                        {formatCurrency(m.balance)}
                      </strong>
                      <span className={`amet-desk__status is-${m.standing}`}>
                        {standingLabel(m.standing)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="amet-desk__actions">
                      {wa ? (
                        <a
                          href={`https://wa.me/${wa}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="amet-desk__wa"
                          title={`WhatsApp ${m.phone}`}
                          aria-label={`WhatsApp ${m.name}`}
                        >
                          <WhatsAppIcon size={15} />
                        </a>
                      ) : null}
                      {canCollect && m.balance > 0 ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => setCollectMember(m)}
                        >
                          <Banknote size={14} /> Cobrar
                        </button>
                      ) : (
                        <span className="amet-desk__idle">—</span>
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

      {collectMember ? (
        <CollectDuesModal
          member={collectMember}
          members={members}
          formatCurrency={formatCurrency}
          onClose={() => setCollectMember(null)}
          onConfirm={handleConfirmCollect}
          paymentPlans={paymentPlans}
          paymentTolerance={paymentTolerance}
        />
      ) : null}
    </div>
  );
}
