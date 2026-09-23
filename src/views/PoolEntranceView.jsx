import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_POOL_SETTINGS,
  mergePoolSettings,
  evaluatePoolAccess,
  enableMemberPoolAccess,
  recordPoolAttendance,
  searchPoolMembers,
  poolDayStats,
  mergePoolSearchHits,
  poolEntranceVerdict,
  guestDayAccessesForHost,
} from '../domain/pool/poolAccess';
import { todayISODateAR } from '../lib/arDate';
import { isSupabaseConfigured } from '../lib/supabase';
import { searchMembersDirectory, listMembersGateIndex, getMemberByNumber } from '../data/repos';
import { poolIngressToAccessLog } from '../domain/credentials/accessLog';

/**
 * Entrada de pileta: página de puerta, como /acceso.
 * Buscador grande y ficha completa del socio.
 */
export default function PoolEntranceView({
  members = [],
  formatCurrency,
  addJournalEntry,
  poolAccesses = [],
  setPoolAccesses,
  setEntryLogs,
  poolSettings = DEFAULT_POOL_SETTINGS,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const actorName = user?.fullName || user?.name || user?.email || '';
  const today = todayISODateAR();
  const settings = mergePoolSettings(poolSettings);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [picked, setPicked] = useState(null);
  const [directory, setDirectory] = useState(members);
  const [, setIndexLoading] = useState(() => isSupabaseConfigured && members.length === 0);
  const [remoteHits, setRemoteHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (members.length > directory.length) setDirectory(members);
  }, [members, directory.length]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIndexLoading(false);
      return undefined;
    }
    let cancelled = false;
    setIndexLoading(true);
    listMembersGateIndex()
      .then((rows) => {
        if (cancelled || !rows?.length) return;
        setDirectory((prev) => (prev.length >= rows.length ? prev : rows));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'No se pudo cargar el padrón.');
      })
      .finally(() => {
        if (!cancelled) setIndexLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const id = String(selectedId);
    return directory.find((m) => String(m.memberId) === id)
      || members.find((m) => String(m.memberId) === id)
      || remoteHits.find((m) => String(m.memberId) === id)
      || (picked && String(picked.memberId) === id ? picked : null);
  }, [directory, members, remoteHits, picked, selectedId]);
  const eval_ = useMemo(
    () => evaluatePoolAccess(selected, { accesses: poolAccesses, today, settings }),
    [selected, poolAccesses, today, settings],
  );
  const dues = Number(selected?.outstandingBalance) || 0;
  const verdict = poolEntranceVerdict(selected, eval_, dues);
  const guests = selected ? guestDayAccessesForHost(poolAccesses, selected.memberId, today) : [];
  const dayStats = poolDayStats(poolAccesses, today);

  const hits = useMemo(() => {
    const local = searchPoolMembers(directory, query, { limit: 30 });
    return mergePoolSearchHits(local, remoteHits, { limit: 30 }).map((member) => ({
      member,
      snap: evaluatePoolAccess(member, { accesses: poolAccesses, today, settings }),
      dues: Number(member.outstandingBalance) || 0,
    }));
  }, [directory, remoteHits, query, poolAccesses, today, settings]);

  useEffect(() => {
    const raw = query.trim();
    const digits = raw.replace(/\D/g, '');
    const enough = raw.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchMembersDirectory(raw, { limit: 20 })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch((err) => {
          if (!cancelled) {
            setRemoteHits([]);
            setError(err?.message || 'No se pudo buscar.');
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const handleEnable = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const { entry, accesses } = enableMemberPoolAccess({
        member: selected,
        accesses: poolAccesses,
        method: 'efectivo',
        today,
        settings,
        actorName,
      });
      setPoolAccesses(accesses);
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(entry);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
      if (typeof addJournalEntry === 'function' && entry.payment.amount > 0) {
        addJournalEntry({
          date: today,
          description: `Canon pileta — ${selected.name} (entrada)`,
          lines: [
            { account: 'Caja General', type: 'debit', amount: entry.payment.amount },
            { account: 'Reservas e Instalaciones', type: 'credit', amount: entry.payment.amount },
          ],
          sourceModule: 'pileta',
        });
      }
    } catch (err) {
      setError(err?.message || 'No se pudo habilitar.');
    } finally {
      setBusy(false);
    }
  };

  const handleAttend = () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const { entry, accesses } = recordPoolAttendance({
        member: selected,
        accesses: poolAccesses,
        today,
        actorName,
      });
      setPoolAccesses(accesses);
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(entry);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
    } catch (err) {
      setError(err?.message || 'No se pudo anotar la asistencia.');
    } finally {
      setBusy(false);
    }
  };

  const pick = (member) => {
    setSelectedId(member.memberId);
    setPicked(member);
    setError('');
    if (!isSupabaseConfigured || !member?.memberId) return;
    getMemberByNumber(member.memberId).then((full) => {
      if (full && String(full.memberId) === String(member.memberId)) setPicked(full);
    }).catch(() => {});
  };

  const clearSearch = () => {
    setQuery('');
    setSelectedId(null);
    setPicked(null);
    setRemoteHits([]);
    setError('');
  };

  const handleClose = (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearSearch();
  };

  useEffect(() => {
    if (!query && !selectedId) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') clearSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, selectedId]);

  return (
    <div className="pool-entrance">
      <header className="pool-entrance-header">
        <div className="pool-entrance-brand">
          <img className="club-mark" src="/logo-jockey-club.png?v=clavos-blancos" alt="Jockey Club" />
          <div>
            <div className="serif-font pool-entrance-title">Entrada pileta</div>
            <div className="pool-entrance-sub">
              Sede Rivadavia · Puerta
              {dayStats.members
                ? ` · ${dayStats.members} ${dayStats.members === 1 ? 'asistió' : 'asistieron'} hoy`
                : ' · Buscá y sale todo'}
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/panel')}>
          <ArrowLeft size={14} /> Panel
        </button>
      </header>

      <label className="pool-entrance-search-label" htmlFor="pool-entrance-search">
        Buscar socio
      </label>
      <div className="pool-entrance-search">
        <Search size={26} aria-hidden="true" />
        <input
          id="pool-entrance-search"
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (!next.trim()) {
              setSelectedId(null);
              setError('');
            }
          }}
          placeholder="Nombre, DNI o Nº de socio…"
          autoComplete="off"
          autoFocus
        />
        {query || selected ? (
          <button
            type="button"
            className="pool-entrance-clear"
            onPointerDown={handleClose}
            onClick={handleClose}
            aria-label="Cerrar ficha y limpiar búsqueda"
          >
            <X size={22} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>

      {error ? <p className="conc-error" role="alert">{error}</p> : null}

      {selected ? (
        <section className={`pool-entrance-card is-${verdict.status}`} aria-live="polite">
          <button
            type="button"
            className="pool-entrance-card-close"
            onPointerDown={handleClose}
            onClick={handleClose}
            aria-label="Cerrar ficha"
          >
            <X size={22} strokeWidth={2.5} />
          </button>
          {selected.photo ? <img src={selected.photo} alt="" className="pool-entrance-photo" /> : null}
          {verdict.status === 'granted'
            ? <CheckCircle2 size={56} aria-hidden="true" />
            : <AlertCircle size={56} aria-hidden="true" />}
          <p className="pool-entrance-verdict">{verdict.title}</p>
          <h1 className="serif-font">{selected.name}</h1>
          <p className="pool-entrance-id">
            Nº {selected.memberId}
            {selected.documentNumber ? ` · DNI ${selected.documentNumber}` : ''}
          </p>
          <p className="pool-entrance-detail">{verdict.detail}</p>

          <dl className="pool-entrance-facts">
            <div className={selected.status === 'active' ? 'is-ok' : 'is-bad'}>
              <dt>Cuenta</dt>
              <dd>{selected.status === 'active' ? 'Habilitada' : selected.status === 'inactive' ? 'Baja' : selected.status}</dd>
            </div>
            <div className={dues > 0 ? 'is-bad' : 'is-ok'}>
              <dt>Cuota social</dt>
              <dd>{dues > 0 ? `No pagó · ${formatCurrency(dues)}` : 'Pagó / al día'}</dd>
            </div>
            <div className={eval_.paidToday ? 'is-ok' : 'is-bad'}>
              <dt>Canon pileta</dt>
              <dd>{eval_.paidToday ? `Pagó · ${formatCurrency(settings.memberDayFee)}` : `No pagó · ${formatCurrency(settings.memberDayFee)}`}</dd>
            </div>
            <div className={eval_.medical?.ok ? 'is-ok' : 'is-bad'}>
              <dt>Apto médico</dt>
              <dd>
                {eval_.medical?.label || 'Sin revisación'}
                {eval_.medical?.expiresAt ? ` · vence ${eval_.medical.expiresAt}` : ''}
              </dd>
            </div>
            <div className={eval_.alreadyIn ? 'is-ok' : ''}>
              <dt>Hoy en pileta</dt>
              <dd>{eval_.alreadyIn ? 'Ya ingresó' : 'Todavía no'}</dd>
            </div>
            <div>
              <dt>Invitados hoy</dt>
              <dd>
                {guests.length
                  ? guests.map((g) => g.guestName).join(', ')
                  : 'Ninguno'}
              </dd>
            </div>
          </dl>

          {eval_.canEnable ? (
            <button
              type="button"
              className="btn btn-primary pool-entrance-pay"
              disabled={busy}
              onClick={handleEnable}
            >
              Cobrar canon e ingresar · {formatCurrency(settings.memberDayFee)}
            </button>
          ) : null}

          {eval_.alreadyIn ? (
            <p className="pool-entrance-attended">Anotado en ingresos de hoy</p>
          ) : (
            <button
              type="button"
              className="btn pool-entrance-attend"
              disabled={busy}
              onClick={handleAttend}
            >
              Asistió
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary pool-entrance-dismiss"
            onPointerDown={handleClose}
            onClick={handleClose}
          >
            Cerrar
          </button>
        </section>
      ) : null}

      {hits.length > 0 ? (
        <ul className="pool-entrance-hits">
          {hits.map(({ member: m, snap, dues: owed }) => (
            <li key={m.memberId}>
              <button
                type="button"
                className={String(selectedId) === String(m.memberId) ? 'is-on' : ''}
                onClick={() => pick(m)}
              >
                <strong>{m.name}</strong>
                <span>
                  Nº {m.memberId}
                  {m.documentNumber ? ` · DNI ${m.documentNumber}` : ''}
                </span>
                <span className="pool-hit-flags">
                  <em className={snap.paidToday ? 'is-ok' : 'is-bad'}>{snap.paidToday ? 'Canon pago' : 'Canon impago'}</em>
                  <em className={snap.medical?.ok ? 'is-ok' : 'is-bad'}>{snap.medical?.ok ? 'Apto' : 'Sin apto'}</em>
                  <em className={owed > 0 ? 'is-bad' : 'is-ok'}>{owed > 0 ? `Debe ${formatCurrency(owed)}` : 'Cuota al día'}</em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pool-entrance-hint">
          {searching
            ? 'Buscando en el padrón…'
            : query.trim()
              ? 'Ningún socio con ese nombre, DNI o número.'
              : 'Escribí nombre, DNI o número. No hace falta esperar el padrón completo.'}
        </p>
      )}
    </div>
  );
}
