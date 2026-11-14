import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import CollectDuesModal from './CollectDuesModal';
import { isDuesExemptMember } from '../../domain/members/dues';
import { memberNumberOf, rankMemberSearchHit } from '../../domain/members/households';
import { getTierDisplayName, SIN_CATEGORIA_TIER } from '../../domain/members/tiers';
import { collectionPreview, persistDuesCollection, recordDuesCollection } from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import { isSupabaseConfigured } from '../../lib/supabase';
import * as repos from '../../data/repos';
import { formatCurrency as formatCurrencyDefault } from '../../domain/accounting/journal';
import { money } from '../../domain/money';
import {
  duesStandingDisplayHint,
  memberDuesStandingSummary,
} from '../../domain/accounting/appMonthlyDebts';

function hitHasCuotaCategories(member) {
  return Array.isArray(member?.cuotaCategories) && member.cuotaCategories.length > 0;
}

function enrichHitFromPadron(row, members = []) {
  const id = String(row?.memberId || memberNumberOf(row) || '');
  if (!id) return row;
  const local = (members || []).find((m) => String(m.memberId || memberNumberOf(m) || '') === id);
  if (!local) return row;
  // Preferir ficha del padrón (saldo / vencimiento) y conservar cuotaCategories
  // (la búsqueda o el padrón pueden tener la categoría real de cobro).
  const cuotaCategories = hitHasCuotaCategories(local)
    ? local.cuotaCategories
    : (hitHasCuotaCategories(row) ? row.cuotaCategories : local.cuotaCategories);
  return {
    ...row,
    ...local,
    name: local.name || row.name || row.fullName,
    documentNumber: local.documentNumber || row.documentNumber || row.dni,
    tier: local.tier || row.tier,
    cuotaCategories,
    outstandingBalance: local.outstandingBalance ?? row.outstandingBalance,
    nextDueDate: local.nextDueDate || row.nextDueDate,
    lastPaymentDate: local.lastPaymentDate || row.lastPaymentDate,
    overdueSince: local.overdueSince || row.overdueSince,
  };
}

function hitCategoryLabel(member, tierCatalog = []) {
  if (hitHasCuotaCategories(member)) {
    return member.cuotaCategories
      .map((cat) => getTierDisplayName(cat, tierCatalog))
      .filter((name) => name && name !== '—')
      .join(' · ') || getTierDisplayName(member.tier, tierCatalog);
  }
  return getTierDisplayName(member?.tier, tierCatalog);
}

function memberReadyForCollect(row) {
  if (!row) return false;
  const tier = String(row.tier || '').trim().toLowerCase();
  if (!tier || tier === SIN_CATEGORIA_TIER) return false;
  // search_members_lookup no trae categoría/saldo/vencimiento → hay que hidratar la ficha.
  if (row.recordScope === 'list' && !row.nextDueDate) return false;
  return true;
}

async function hydrateCollectMember(row) {
  if (!isSupabaseConfigured) return row;
  const dbId = row?.id;
  const number = memberNumberOf(row) || row?.memberId;
  try {
    if (dbId && typeof repos.getMember === 'function') {
      const full = await repos.getMember(dbId, { withPayments: true });
      if (full) return full;
    }
    if (number && typeof repos.getMemberByNumber === 'function') {
      const full = await repos.getMemberByNumber(number, { withPayments: true });
      if (full) return full;
    }
  } catch {
    /* se usa el hit de búsqueda si falla la ficha completa */
  }
  return row;
}

function memberMatches(member, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const digits = q.replace(/\D/g, '');
  const number = String(memberNumberOf(member) || member?.memberId || '').replace(/\D/g, '');
  const name = String(member?.name || member?.fullName || '').toLowerCase();
  const doc = String(member?.documentNumber || member?.dni || '').replace(/\D/g, '');
  if (digits.length >= 2 && (number.includes(digits) || doc.includes(digits))) return true;
  return name.includes(q);
}

/**
 * Cobrar cuota desde el escritorio: buscar socio → medios (efectivo / transferencia+comprobante / MP QR).
 * Reusa CollectDuesModal y las reglas de cuota / comprobante automático.
 */
export default function CollectDuesDeskFlow({
  open,
  onClose,
  members = [],
  setMembers,
  addJournalEntry,
  onAccountEntry,
  onSendMessage,
  formatCurrency = formatCurrencyDefault,
  paymentPlans = [],
  paymentTolerance,
  tierCatalog = [],
  onCollected,
}) {
  const [query, setQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');
  const [coveredByMember, setCoveredByMember] = useState({});

  useEffect(() => {
    if (!open) {
      setQuery('');
      setRemoteHits([]);
      setRemoteBusy(false);
      setMember(null);
      setError('');
      setCoveredByMember({});
      return;
    }
    // Evita hits viejos de search_members_lookup sin categoría/saldo.
    if (typeof repos.invalidateMemberSearchCache === 'function') {
      repos.invalidateMemberSearchCache();
    }
  }, [open]);

  useEffect(() => {
    const needle = query.trim();
    const digits = needle.replace(/\D/g, '');
    const enough = needle.length >= 2 || digits.length >= 3;
    if (!open || member || !enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      repos.searchMembersDirectory(needle, { limit: 12, signal: controller.signal })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open, member]);

  const hits = useMemo(() => {
    if (member) return [];
    const q = query.trim();
    if (!q) return [];
    const local = (members || [])
      .filter((m) => memberMatches(m, q))
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 12);
    const byId = new Map(local.map((m) => [String(m.memberId), m]));
    for (const row of remoteHits) {
      const id = String(row.memberId || '');
      if (id && !byId.has(id)) byId.set(id, row);
    }
    return [...byId.values()]
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 12);
  }, [members, query, remoteHits, member]);

  const hitKey = hits.map((row) => row.id).filter(Boolean).join(',');
  useEffect(() => {
    if (!open || !hitKey || !isSupabaseConfigured || typeof repos.listCoveredDueOnsByMember !== 'function') {
      return undefined;
    }
    let cancelled = false;
    repos.listCoveredDueOnsByMember(hitKey.split(','))
      .then((map) => {
        if (!cancelled) setCoveredByMember(map || {});
      })
      .catch(() => {
        if (!cancelled) setCoveredByMember({});
      });
    return () => {
      cancelled = true;
    };
  }, [open, hitKey]);

  const pickMember = async (row) => {
    setError('');
    if (isDuesExemptMember(row)) {
      setError('Vitalicio, fundador y comisión no abonan cuota social.');
      return;
    }
    const fromPadron = (members || []).find((m) => String(m.memberId) === String(row.memberId));
    let next = fromPadron || row;
    // Siempre hidratar saldo / nextDue desde Supabase: el padrón en memoria
    // puede seguir mostrando meses ya cobrados y volver a marcarlos.
    setRemoteBusy(true);
    next = await hydrateCollectMember(next);
    setRemoteBusy(false);
    if (isDuesExemptMember(next)) {
      setError('Vitalicio, fundador y comisión no abonan cuota social.');
      return;
    }
    if (!memberReadyForCollect(next)) {
      setError('No se pudo cargar la categoría y el saldo de este socio. Reintentá en unos segundos.');
      return;
    }
    setMember(next);
  };

  const handleConfirm = async (payload) => {
    if (!member) return;
    // Mercado Pago ya acreditó por webhook: no volver a registrar_cobro ni reenviar recibo.
    if (payload?.alreadyApplied) {
      if (member.memberId && typeof setMembers === 'function') {
        try {
          const fresh = await repos.getMemberByNumber(member.memberId, { withPayments: true });
          if (fresh) {
            setMembers((prev) => (prev || []).map((row) => (
              String(row.memberId) === String(fresh.memberId) ? { ...row, ...fresh } : row
            )));
          }
        } catch {
          /* refresh best-effort */
        }
      }
      onCollected?.({
        member,
        payment: null,
        message: `Pago de Mercado Pago acreditado · ${member.name || ''}`.trim(),
      });
      setMember(null);
      onClose?.();
      return;
    }
    const result = recordDuesCollection(member, { ...payload, members });
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
    const paid = saved?.payment || result.payment;
    const who = saved?.member || result.member;
    onCollected?.({
      member: who,
      payment: paid,
      message: `Cobro registrado · ${formatCurrency(paid?.amount)} · ${who?.name || member.name}`,
    });
    setMember(null);
    onClose?.();
  };

  if (!open) return null;

  if (member) {
    return (
      <CollectDuesModal
        member={member}
        members={members}
        formatCurrency={formatCurrency}
        onClose={() => setMember(null)}
        onConfirm={handleConfirm}
        paymentPlans={paymentPlans}
        paymentTolerance={paymentTolerance}
      />
    );
  }

  const showEmpty = query.trim().length >= 2 && !remoteBusy && !hits.length;
  const showHint = !query.trim() && !hits.length && !error;

  return (
    <ModalDialog
      onClose={onClose}
      labelledBy="collect-dues-desk-title"
      describedBy="collect-dues-desk-lead"
      contentClassName="modal-content glass-panel cdd-desk"
    >
      <header className="cdd-desk-hero">
        <div className="cdd-desk-hero-main">
          <h4 id="collect-dues-desk-title" className="serif-font cdd-desk-title">
            Cobrar cuota
          </h4>
          <p id="collect-dues-desk-lead" className="cdd-desk-lead">
            Buscá al socio, elegí el medio y confirmá. Baja el saldo del mes y manda el comprobante.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm cdd-desk-close"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X size={14} aria-hidden="true" />
          <span>Cerrar</span>
        </button>
      </header>

      <div className="cdd-desk-body">
        <label className="cdd-desk-search" htmlFor="collect-dues-desk-search">
          <span className="cdd-desk-search-label">Buscar socio</span>
          <div className="cdd-desk-search-field">
            <Search className="cdd-desk-search-icon" size={20} aria-hidden="true" />
            <input
              id="collect-dues-desk-search"
              className="form-input cdd-desk-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, Nº de socio o DNI"
              autoFocus
              autoComplete="off"
            />
          </div>
        </label>

        {error ? <p className="ig-error cdd-desk-error">{error}</p> : null}
        {remoteBusy ? (
          <p className="cdd-desk-status" role="status">Buscando en el padrón…</p>
        ) : null}

        {showHint ? (
          <div className="cdd-desk-hint">
            <p className="cdd-desk-hint-title">Empezá a escribir</p>
            <p className="cdd-desk-hint-text">
              Con dos letras del apellido, el número de socio o el DNI aparecen las fichas listas para cobrar.
            </p>
          </div>
        ) : null}

        {hits.length > 0 ? (
          <ul className="cdd-desk-hits">
            {hits.map((raw) => {
              const row = enrichHitFromPadron(raw, members);
              const nro = memberNumberOf(row) || row.memberId;
              const doc = row.documentNumber || row.dni || '';
              const category = hitCategoryLabel(row, tierCatalog);
              const exempt = isDuesExemptMember(row);
              const covered = coveredByMember[row.id];
              const forPreview = covered?.length
                ? { ...row, paymentHistory: [...(row.paymentHistory || []), ...covered] }
                : row;
              const standing = exempt
                ? null
                : memberDuesStandingSummary(forPreview);
              const preview = exempt
                ? { cash: 0, quota: 0, surcharge: 0 }
                : collectionPreview(forPreview, new Date());
              const toCollect = standing && !standing.clear
                ? money(standing.totalDebt)
                : money(preview.cash);
              const hintFull = standing && !standing.clear
                ? duesStandingDisplayHint(standing, formatCurrency)
                : '';
              const hint = standing && !standing.clear
                ? duesStandingDisplayHint(standing, formatCurrency, { compact: true })
                : '';
              return (
                <li key={String(row.memberId || nro)}>
                  <button
                    type="button"
                    className="btn btn-secondary cdd-desk-hit"
                    title={hintFull || undefined}
                    onClick={() => pickMember(row)}
                  >
                    <span className="cdd-desk-hit-main">
                      <strong className="cdd-desk-hit-name">{row.name || row.fullName}</strong>
                      <span className="cdd-desk-hit-meta">
                        Nº {nro}
                        {doc ? ` · DNI ${doc}` : ''}
                        {category && category !== '—' ? ` · ${category}` : ''}
                      </span>
                    </span>
                    <span className="cdd-desk-hit-side">
                      <span className="cdd-desk-hit-figures">
                        {exempt ? (
                          <span className="cdd-desk-hit-exempt">Exento</span>
                        ) : !standing || standing.clear || toCollect <= 0.01 ? (
                          <span className="cdd-desk-hit-exempt">Al día</span>
                        ) : (
                          <>
                            <span className="cdd-desk-hit-amount tabular-nums">
                              {formatCurrency(toCollect)}
                            </span>
                            <span className="cdd-desk-hit-capital">
                              {hint || 'a cobrar'}
                            </span>
                          </>
                        )}
                      </span>
                      <ChevronRight className="cdd-desk-hit-chevron" size={18} aria-hidden="true" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {showEmpty ? (
          <p className="cdd-desk-empty">Sin coincidencias para «{query.trim()}».</p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
