import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, QrCode } from 'lucide-react';
import JoinClubPlaque from './JoinClubPlaque';
import { publicJoinUrl } from '../../domain/members/selfService';
import {
  accessReasonLabel,
  accessRequestIsOpen,
  buildRequestDetail,
  effectiveAccessStatus,
  formatRequestWhen,
  matchMemberForAccessRequest,
  accessInviteMailError,
  requestStatusLabel,
  splitAccessRequestInbox,
} from '../../domain/members/selfService';
import { getTierDisplayName } from '../../domain/members/tiers';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import FoldableSection from './FoldableSection';
import MemberRequestDetailModal from './MemberRequestDetailModal';

export default function MemberRequestsSection({
  members = [],
  focusRequest = null,
  membershipApplications = [],
  setMembershipApplications,
  portalAccessRequests = [],
  setPortalAccessRequests,
  onOpenAccessCredentials,
  onPrefillAlta,
  onDeliverAccess,
  embedded = false,
}) {
  const [params] = useSearchParams();
  const openJoinInbox = params.get('solicitudes') === 'alta';
  const [view, setView] = useState(openJoinInbox ? 'alta' : 'acceso');
  const [showClosed, setShowClosed] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [rejectId, setRejectId] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [detail, setDetail] = useState(null);
  const [invite, setInvite] = useState(null);
  const [invitesById, setInvitesById] = useState({});
  const [deliverError, setDeliverError] = useState('');
  const [plaqueOpen, setPlaqueOpen] = useState(false);
  const [remoteMatches, setRemoteMatches] = useState({});
  const joinUrl = publicJoinUrl();

  useEffect(() => {
    if (openJoinInbox) {
      setView('alta');
      setShowClosed(false);
    }
  }, [openJoinInbox]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;
    Promise.all([
      typeof setPortalAccessRequests === 'function' ? repos.listPortalAccessRequests() : null,
      typeof setMembershipApplications === 'function' ? repos.listMembershipApplications() : null,
    ]).then(([access, apps]) => {
      if (cancelled) return;
      if (access) setPortalAccessRequests(access);
      if (apps) setMembershipApplications(apps);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [setMembershipApplications, setPortalAccessRequests]);

  const accessInbox = useMemo(
    () => splitAccessRequestInbox(portalAccessRequests),
    [portalAccessRequests],
  );
  const pendingJoin = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending'),
    [membershipApplications],
  );
  const pendingJoinClosed = useMemo(
    () => (membershipApplications || []).filter((a) => a.status !== 'pending'),
    [membershipApplications],
  );

  const accessMatch = (item) => (
    matchMemberForAccessRequest(members, item) || remoteMatches[item?.id] || null
  );

  const localMissIds = useMemo(() => (
    (accessInbox.open || [])
      .filter((item) => !matchMemberForAccessRequest(members, item))
      .map((item) => item.id)
      .join('|')
  ), [accessInbox.open, members]);

  const openAccessRef = useRef(accessInbox.open);
  openAccessRef.current = accessInbox.open;

  useEffect(() => {
    if (!isSupabaseConfigured || !localMissIds) return undefined;
    const ids = new Set(localMissIds.split('|'));
    const pending = (openAccessRef.current || []).filter((item) => ids.has(item.id));
    if (!pending.length) return undefined;
    let cancelled = false;
    Promise.all(pending.map(async (item) => {
      try {
        const found = await repos.resolveMemberForApplication(item);
        return [item.id, found || null];
      } catch {
        return [item.id, null];
      }
    })).then((pairs) => {
      if (cancelled) return;
      setRemoteMatches((prev) => {
        const next = { ...prev };
        for (const [id, found] of pairs) {
          if (found) next[id] = found;
          else delete next[id];
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [localMissIds]);

  useEffect(() => {
    setDetail((prev) => {
      if (!prev || prev.kind !== 'acceso' || prev.match) return prev;
      const found = matchMemberForAccessRequest(members, prev.item) || remoteMatches[prev.item?.id] || null;
      if (!found) return prev;
      return {
        ...prev,
        match: found,
        data: buildRequestDetail('acceso', prev.item, { matchName: found.name }),
      };
    });
  }, [remoteMatches, members]);

  const persistAccess = async (next) => {
    if (isSupabaseConfigured) {
      const saved = await repos.upsertPortalAccessRequest(next);
      setPortalAccessRequests((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      return saved;
    }
    setPortalAccessRequests((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    return next;
  };

  const persistJoin = async (next) => {
    if (isSupabaseConfigured) {
      const saved = await repos.upsertMembershipApplication(next);
      setMembershipApplications((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      return saved;
    }
    setMembershipApplications((prev) => prev.map((a) => (a.id === next.id ? next : a)));
    return next;
  };

  const reviewStamp = () => ({
    reviewedAt: new Date().toISOString(),
  });

  const handleReject = async (kind, item) => {
    setBusyId(item.id);
    try {
      const notes = rejectNote.trim();
      if (kind === 'acceso') {
        await persistAccess({ ...item, status: 'rejected', notes, ...reviewStamp() });
      } else {
        await persistJoin({ ...item, status: 'rejected', notes, ...reviewStamp() });
      }
      setRejectId('');
      setRejectNote('');
    } finally {
      setBusyId('');
    }
  };

  const handleResolveAccess = async (item, { openCreds = false } = {}) => {
    const match = accessMatch(item);
    if (openCreds) {
      if (!match) return;
      onOpenAccessCredentials?.(match, item);
      return;
    }
    setBusyId(item.id);
    try {
      await persistAccess({
        ...item,
        status: 'approved',
        notes: item.notes || 'Contactado por secretaría',
        memberDbId: match?.id || item.memberId || null,
        ...reviewStamp(),
      });
    } finally {
      setBusyId('');
    }
  };

  const openAccessDetail = (item) => {
    const match = accessMatch(item);
    const stored = invitesById[item.id];
    setInvite(stored ? { ...stored, emailError: accessInviteMailError(stored.emailError) } : null);
    setDeliverError('');
    setDetail({
      kind: 'acceso',
      item,
      match,
      data: buildRequestDetail('acceso', item, { matchName: match?.name }),
    });
  };

  const joinMatch = (item) => matchMemberForAccessRequest(members, {
    documentNumber: item.documentNumber,
    fullName: item.fullName,
  });

  const openJoinDetail = (item) => {
    const match = joinMatch(item);
    const stored = invitesById[item.id];
    setInvite(stored ? { ...stored, emailError: accessInviteMailError(stored.emailError) } : null);
    setDeliverError('');
    setDetail({
      kind: 'alta',
      item,
      data: buildRequestDetail('alta', item, {
        tierLabel: item.requestedTier ? getTierDisplayName(item.requestedTier) : '',
        matchName: match ? `${match.name} · Nº ${match.memberId}` : '',
      }),
    });
  };

  useEffect(() => {
    if (!focusRequest?.id) return;
    const kind = focusRequest.kind === 'alta' ? 'alta' : 'acceso';
    const list = kind === 'alta' ? membershipApplications : portalAccessRequests;
    const item = (list || []).find((row) => row.id === focusRequest.id);
    if (!item) return;
    const pending = kind === 'alta' ? item.status === 'pending' : accessRequestIsOpen(item);
    setView(kind);
    setShowClosed(!pending);
    if (kind === 'alta') openJoinDetail(item);
    else openAccessDetail(item);
  }, [focusRequest]);

  const closeDetail = () => {
    setDetail(null);
    setInvite(null);
    setDeliverError('');
  };

  const markDetailApproved = (kind, source) => {
    setDetail((prev) => {
      if (!prev || prev.item?.id !== source.id) return prev;
      const item = { ...prev.item, status: 'approved' };
      if (kind === 'acceso') {
        const match = prev.match || accessMatch(item);
        return {
          ...prev,
          item,
          match,
          data: buildRequestDetail('acceso', item, { matchName: match?.name }),
        };
      }
      const match = joinMatch(item);
      return {
        ...prev,
        item,
        data: buildRequestDetail('alta', item, {
          tierLabel: item.requestedTier ? getTierDisplayName(item.requestedTier) : '',
          matchName: match ? `${match.name} · Nº ${match.memberId}` : '',
        }),
      };
    });
  };

  const startDeliver = async (kind, item) => {
    if (!item || typeof onDeliverAccess !== 'function') return;
    if (kind === 'acceso') openAccessDetail(item);
    else openJoinDetail(item);
    setBusyId(item.id);
    setDeliverError('');
    try {
      const known = kind === 'acceso' ? accessMatch(item) : null;
      const next = await onDeliverAccess(kind, item, known, (ready) => {
        setInvite(ready);
        setInvitesById((prev) => ({ ...prev, [item.id]: ready }));
        markDetailApproved(kind, item);
        setBusyId('');
      });
      const mailError = accessInviteMailError(next?.emailError);
      const shown = mailError ? next : { ...next, emailError: '' };
      setInvite(shown);
      setInvitesById((prev) => ({ ...prev, [item.id]: shown }));
      markDetailApproved(kind, item);
    } catch (err) {
      setDeliverError(err?.message || 'No se pudo generar el acceso.');
    } finally {
      setBusyId('');
    }
  };

  const handleDeliver = async () => {
    if (!detail?.item) return;
    await startDeliver(detail.kind, detail.item);
  };

  const accessRows = showClosed ? accessInbox.hidden : accessInbox.open;
  const joinRows = showClosed ? pendingJoinClosed : pendingJoin;
  const rows = view === 'acceso' ? accessRows : joinRows;
  const closedCount = view === 'acceso' ? accessInbox.hidden.length : pendingJoinClosed.length;
  const detailPending = Boolean(detail?.item) && !invite && (
    detail.kind === 'acceso' ? accessRequestIsOpen(detail.item) : detail.item.status === 'pending'
  );
  const setInbox = (nextView) => {
    setView(nextView);
    setShowClosed(false);
  };

  const openTotal = accessInbox.open.length + pendingJoin.length;
  const inboxTitle = showClosed
    ? 'Pedidos cerrados'
    : view === 'acceso'
      ? 'Piden acceso a la app'
      : 'Quieren asociarse';
  const inboxHint = showClosed
    ? 'Ya revisados o rechazados'
    : 'Formulario público · se guardan 7 días';

  return (
    <>
    <FoldableSection
      className="membership-moves member-requests"
      id="member-requests-title"
      title="Solicitudes"
      subtitle={inboxHint}
      count={openTotal.toLocaleString('es-AR')}
      defaultOpen
      storageKey="solicitudes"
      embedded={embedded}
      forceOpen={openJoinInbox || Boolean(focusRequest?.id)}
    >
      <div className="member-requests-inbox">
        <header className="member-requests-inbox-head">
          <div className="member-requests-inbox-copy">
            <h4>{inboxTitle}</h4>
            <p>{inboxHint}</p>
          </div>
          <div className="member-requests-public-wrap">
            <Link to="/registro?tramite=alta" className="member-requests-public">
              <ExternalLink size={13} aria-hidden="true" />
              Formulario
            </Link>
            <button
              type="button"
              className="member-requests-public member-requests-qr"
              onClick={() => setPlaqueOpen(true)}
              title="QR y placa para pegar"
            >
              <QrCode size={13} aria-hidden="true" />
              Placa QR
            </button>
          </div>
        </header>

        <div className="member-requests-segments" role="tablist" aria-label="Tipo de solicitud">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'acceso' && !showClosed}
            className={view === 'acceso' && !showClosed ? 'is-on' : ''}
            onClick={() => setInbox('acceso')}
          >
            Acceso app
            <b className="tabular-nums">{accessInbox.open.length.toLocaleString('es-AR')}</b>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'alta' && !showClosed}
            className={view === 'alta' && !showClosed ? 'is-on' : ''}
            onClick={() => setInbox('alta')}
          >
            Asociarse
            <b className="tabular-nums">{pendingJoin.length.toLocaleString('es-AR')}</b>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showClosed}
            className={showClosed ? 'is-on is-muted' : 'is-muted'}
            onClick={() => setShowClosed((on) => !on)}
          >
            Cerrados
            {closedCount ? <b className="tabular-nums">{closedCount.toLocaleString('es-AR')}</b> : null}
          </button>
        </div>

      {rows.length === 0 ? (
        <p className="member-requests-empty">
          {showClosed ? 'No hay pedidos cerrados para mostrar.' : 'Nada pendiente en esta bandeja.'}
        </p>
      ) : (
        <ul className="member-requests-list">
          {view === 'acceso'
            ? accessRows.map((item) => {
              const match = accessMatch(item);
              const status = effectiveAccessStatus(item);
              const open = accessRequestIsOpen(item);
              const color = status === 'rejected' ? '#c23b3b' : status === 'approved' ? '#1f7a4d' : status === 'done' ? '#6b7c74' : '#b08d57';
              return (
                <li key={item.id} className="member-requests-card" style={{ '--move-color': color }}>
                  <div className="member-requests-card-main">
                    <button type="button" className="member-requests-card-name" onClick={() => openAccessDetail(item)}>
                      {item.fullName}
                    </button>
                    <p className="member-requests-card-meta">
                      <span>DNI {item.documentNumber || '—'}</span>
                      {item.memberNumber ? <span>Nº {item.memberNumber}</span> : null}
                      <span>{accessReasonLabel(item.reason)}</span>
                      <span>{item.phone || 'Sin celular'}</span>
                      <span>{formatRequestWhen(item.createdAt)}</span>
                    </p>
                    <p className={`member-requests-card-match${match ? '' : ' is-miss'}`}>
                      {match ? `Ficha: ${match.name}` : 'Sin ficha automática'}
                    </p>
                  </div>
                  <div className="member-requests-card-side">
                    <span className="membership-moves-chip">{requestStatusLabel(status)}</span>
                    {open ? (
                      <div className="member-requests-card-actions">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busyId === item.id} onClick={() => startDeliver('acceso', item)}>
                          Entregar acceso
                        </button>
                        {match ? (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleResolveAccess(item, { openCreds: true })}>
                            Credenciales
                          </button>
                        ) : null}
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => handleResolveAccess(item)}>
                          Ya contactado
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm member-requests-reject-btn"
                          onClick={() => {
                            setRejectId(item.id);
                            setRejectNote('');
                          }}
                        >
                          Rechazar
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {rejectId === item.id ? (
                    <div className="member-requests-reject">
                      <input
                        className="form-input"
                        placeholder="Nota (baja, datos no coinciden…)"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => handleReject('acceso', item)}>
                        Confirmar
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })
            : joinRows.map((item) => {
              const match = joinMatch(item);
              const color = item.status === 'rejected' ? '#c23b3b' : item.status === 'approved' ? '#1f7a4d' : 'var(--primary-gold)';
              const pending = item.status === 'pending';
              return (
                <li key={item.id} className="member-requests-card" style={{ '--move-color': color }}>
                  <div className="member-requests-card-main">
                    <button type="button" className="member-requests-card-name" onClick={() => openJoinDetail(item)}>
                      {item.fullName}
                    </button>
                    <p className="member-requests-card-meta">
                      <span>{item.documentType || 'DNI'} {item.documentNumber || '—'}</span>
                      <span>{item.phone || 'Sin celular'}</span>
                      {item.requestedTier ? <span>{getTierDisplayName(item.requestedTier)}</span> : null}
                      <span>{formatRequestWhen(item.createdAt)}</span>
                    </p>
                    {match ? (
                      <p className="member-requests-card-match">
                        Ya es socio: {match.name} · Nº {match.memberId}
                      </p>
                    ) : null}
                  </div>
                  <div className="member-requests-card-side">
                    <span className="membership-moves-chip">{requestStatusLabel(item.status)}</span>
                    {pending ? (
                      <div className="member-requests-card-actions">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busyId === item.id} onClick={() => startDeliver('alta', item)}>
                          {match ? 'Actualizar y enviar' : 'Alta + acceso'}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPrefillAlta?.(item)}>
                          Solo alta
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm member-requests-reject-btn"
                          onClick={() => {
                            setRejectId(item.id);
                            setRejectNote('');
                          }}
                        >
                          Rechazar
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {rejectId === item.id ? (
                    <div className="member-requests-reject">
                      <input
                        className="form-input"
                        placeholder="Motivo del rechazo"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => handleReject('alta', item)}>
                        Confirmar
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
        </ul>
      )}
      </div>
    </FoldableSection>

      <MemberRequestDetailModal
        open={Boolean(detail)}
        detail={detail?.data}
        pending={detailPending}
        busy={busyId === detail?.item?.id}
        invite={invite}
        deliverError={deliverError}
        onClose={closeDetail}
        onDeliver={onDeliverAccess ? handleDeliver : undefined}
        onAlta={detailPending && detail?.kind === 'alta' ? () => {
          onPrefillAlta?.(detail.item);
          closeDetail();
        } : undefined}
        onReject={detailPending ? () => {
          setRejectId(detail.item.id);
          setRejectNote('');
          closeDetail();
        } : undefined}
      />
      <JoinClubPlaque open={plaqueOpen} onClose={() => setPlaqueOpen(false)} url={joinUrl} />
    </>
  );
}
