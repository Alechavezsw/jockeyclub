import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import CollectDuesModal from './CollectDuesModal';
import { isDuesExemptMember } from '../../domain/members/dues';
import { memberNumberOf, rankMemberSearchHit } from '../../domain/members/households';
import { SIN_CATEGORIA_TIER } from '../../domain/members/tiers';
import { collectionPreview, persistDuesCollection, recordDuesCollection } from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import { isSupabaseConfigured } from '../../lib/supabase';
import * as repos from '../../data/repos';
import { formatCurrency as formatCurrencyDefault } from '../../domain/accounting/journal';
import { money } from '../../domain/money';

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
      const full = await repos.getMember(dbId);
      if (full) return full;
    }
    if (number && typeof repos.getMemberByNumber === 'function') {
      const full = await repos.getMemberByNumber(number);
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
  onCollected,
}) {
  const [query, setQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
      setRemoteHits([]);
      setRemoteBusy(false);
      setMember(null);
      setError('');
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

  const pickMember = async (row) => {
    setError('');
    if (isDuesExemptMember(row)) {
      setError('Vitalicio, fundador y comisión no abonan cuota social.');
      return;
    }
    const fromPadron = (members || []).find((m) => String(m.memberId) === String(row.memberId));
    let next = fromPadron || row;
    if (!memberReadyForCollect(next)) {
      setRemoteBusy(true);
      next = await hydrateCollectMember(next);
      setRemoteBusy(false);
    }
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

  return (
    <ModalDialog
      onClose={onClose}
      labelledBy="collect-dues-desk-title"
      contentClassName="modal-content glass-panel"
      contentStyle={{
        width: '92%',
        maxWidth: 520,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-glass)',
        padding: '1.25rem',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h4 id="collect-dues-desk-title" className="serif-font" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-gold)' }}>
            Cobrar cuota
          </h4>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Buscá al socio, elegí el medio y confirmá. Baja el saldo del mes y manda el comprobante.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onClose}
          aria-label="Cerrar"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <X size={14} />
        </button>
      </div>

      <label className="form-group" style={{ marginBottom: '0.75rem' }}>
        <span className="form-label" htmlFor="collect-dues-desk-search">Buscar socio</span>
        <div style={{ position: 'relative' }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.55 }}
            aria-hidden="true"
          />
          <input
            id="collect-dues-desk-search"
            className="form-input"
            style={{ paddingLeft: 36 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, Nº de socio o DNI"
            autoFocus
          />
        </div>
      </label>

      {error ? <p className="ig-error">{error}</p> : null}
      {remoteBusy ? (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Buscando…</p>
      ) : null}

      <ul className="admin-picker-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hits.map((row) => {
          const nro = memberNumberOf(row) || row.memberId;
          const doc = row.documentNumber || row.dni || '';
          const preview = isDuesExemptMember(row)
            ? { cash: 0 }
            : collectionPreview(row, new Date());
          const toCollect = money(preview.cash);
          const capital = money(Math.max(0, Number(row.outstandingBalance) || 0));
          return (
            <li key={String(row.memberId || nro)}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  width: '100%',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'center',
                  padding: '0.7rem 0.85rem',
                }}
                onClick={() => pickMember(row)}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <strong style={{ fontSize: '0.92rem' }}>{row.name || row.fullName}</strong>
                  <small style={{ color: 'var(--text-muted)' }}>
                    Nº {nro}
                    {doc ? ` · DNI ${doc}` : ''}
                  </small>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span className="tabular-nums" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    {formatCurrency(toCollect)}
                  </span>
                  {capital > 0.01 && Math.abs(capital - toCollect) > 0.01 ? (
                    <small style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      capital {formatCurrency(capital)}
                    </small>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {query.trim().length >= 2 && !remoteBusy && !hits.length ? (
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Sin coincidencias.
        </p>
      ) : null}
    </ModalDialog>
  );
}
