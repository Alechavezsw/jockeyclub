import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, QrCode } from 'lucide-react';
import JoinClubPlaque from './JoinClubPlaque';
import { publicJoinUrl } from '../../domain/members/selfService';
import {
  accessReasonLabel,
  buildRequestDetail,
  formatRequestWhen,
  matchMemberForAccessRequest,
  accessInviteMailError,
  requestStatusLabel,
} from '../../domain/members/selfService';
import { getTierDisplayName } from '../../domain/members/tiers';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import FoldableSection from './FoldableSection';
import MemberRequestDetailModal from './MemberRequestDetailModal';

export default function MemberRequestsSection({
  members = [],
  membershipApplications = [],
  setMembershipApplications,
  portalAccessRequests = [],
  setPortalAccessRequests,
  onOpenAccessCredentials,
  onPrefillAlta,
  onDeliverAccess,
}) {
  const [params] = useSearchParams();
  const openJoinInbox = params.get('solicitudes') === 'alta';
  const [view, setView] = useState(openJoinInbox ? 'alta' : 'acceso');
  const [busyId, setBusyId] = useState('');
  const [rejectId, setRejectId] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [detail, setDetail] = useState(null);
  const [invite, setInvite] = useState(null);
  const [invitesById, setInvitesById] = useState({});
  const [deliverError, setDeliverError] = useState('');
  const [plaqueOpen, setPlaqueOpen] = useState(false);
  const joinUrl = publicJoinUrl();

  useEffect(() => {
    if (openJoinInbox) setView('alta');
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

  const pendingAccess = useMemo(
    () => (portalAccessRequests || []).filter((r) => r.status === 'pending'),
    [portalAccessRequests],
  );
  const pendingJoin = useMemo(
    () => (membershipApplications || []).filter((a) => a.status === 'pending'),
    [membershipApplications],
  );

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
    const match = matchMemberForAccessRequest(members, item);
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
    const match = matchMemberForAccessRequest(members, item);
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
        const match = prev.match || matchMemberForAccessRequest(members, item);
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
      const next = await onDeliverAccess(kind, item, null, (ready) => {
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

  const rows = view === 'acceso' ? portalAccessRequests : membershipApplications;
  const detailPending = detail?.item?.status === 'pending' && !invite;

  return (
    <>
    <FoldableSection
      className="membership-moves member-requests"
      id="member-requests-title"
      title="Solicitudes"
      subtitle="Pedidos del formulario público"
      count={(pendingAccess.length + pendingJoin.length).toLocaleString('es-AR')}
      defaultOpen={pendingAccess.length + pendingJoin.length > 0}
      storageKey="solicitudes"
      forceOpen={openJoinInbox}
      extra={(
        <div className="membership-moves-tabs">
          <div className="member-requests-public-wrap">
            <Link to="/registro?tramite=alta" className="member-requests-public">
              <ExternalLink size={13} aria-hidden="true" />
              Link público
            </Link>
            <button
              type="button"
              className="member-requests-public member-requests-qr"
              onClick={() => setPlaqueOpen(true)}
              title="QR y placa para pegar"
            >
              <QrCode size={13} aria-hidden="true" />
              Placa
            </button>
          </div>
          <button
            type="button"
            className={view === 'acceso' ? 'is-on' : ''}
            style={{ '--stat-accent': '#b08d57' }}
            onClick={() => setView('acceso')}
          >
            Acceso al portal
          </button>
          <button
            type="button"
            className={view === 'alta' ? 'is-on' : ''}
            style={{ '--stat-accent': '#1f7a4d' }}
            onClick={() => setView('alta')}
          >
            Quiero asociarme
          </button>
        </div>
      )}
    >

      {rows.length === 0 ? (
        <p className="membership-moves-meta" style={{ margin: 0 }}>No hay trámites en esta bandeja.</p>
      ) : (
        <ul className="membership-moves-list">
          {view === 'acceso'
            ? portalAccessRequests.map((item) => {
              const match = matchMemberForAccessRequest(members, item);
              const color = item.status === 'rejected' ? '#c23b3b' : item.status === 'approved' ? '#1f7a4d' : '#b08d57';
              return (
                <li key={item.id} className="membership-moves-row" style={{ '--move-color': color }}>
                  <div>
                    <button type="button" className="membership-moves-name" onClick={() => openAccessDetail(item)}>
                      {item.fullName}
                      <span className="membership-moves-meta">
                        DNI {item.documentNumber || '—'}
                        {item.memberNumber ? ` · Nº ${item.memberNumber}` : ''}
                        {' · '}
                        {accessReasonLabel(item.reason)}
                        {' · '}
                        {item.phone || 'sin celular'}
                        {' · '}
                        {formatRequestWhen(item.createdAt)}
                        {match ? ` · ficha ${match.name}` : ' · sin ficha automática'}
                      </span>
                    </button>
                  </div>
                  <div className="membership-moves-right">
                    <span className="membership-moves-chip">{requestStatusLabel(item.status)}</span>
                    {item.status === 'pending' ? (
                      <>
                        <button type="button" className="membership-moves-link" disabled={busyId === item.id} onClick={() => startDeliver('acceso', item)}>
                          Entregar acceso
                        </button>
                        {match ? (
                          <button type="button" className="membership-moves-link" onClick={() => handleResolveAccess(item, { openCreds: true })}>
                            Credenciales
                          </button>
                        ) : null}
                        <button type="button" className="membership-moves-link" disabled={busyId === item.id} onClick={() => handleResolveAccess(item)}>
                          Ya contactado
                        </button>
                        <button
                          type="button"
                          className="membership-moves-link"
                          onClick={() => {
                            setRejectId(item.id);
                            setRejectNote('');
                          }}
                        >
                          Rechazar
                        </button>
                      </>
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
            : membershipApplications.map((item) => {
              const match = joinMatch(item);
              const color = item.status === 'rejected' ? '#c23b3b' : item.status === 'approved' ? '#1f7a4d' : '#1f7a4d';
              const pending = item.status === 'pending';
              return (
                <li key={item.id} className="membership-moves-row" style={{ '--move-color': pending ? 'var(--primary-gold)' : color }}>
                  <div>
                    <button type="button" className="membership-moves-name" onClick={() => openJoinDetail(item)}>
                      {item.fullName}
                      <span className="membership-moves-meta">
                        {item.documentType || 'DNI'} {item.documentNumber || '—'}
                        {' · '}
                        {item.phone || 'sin celular'}
                        {item.requestedTier ? ` · ${getTierDisplayName(item.requestedTier)}` : ''}
                        {' · '}
                        {formatRequestWhen(item.createdAt)}
                        {match ? ` · Ya es socio: ${match.name} Nº ${match.memberId}` : ''}
                      </span>
                    </button>
                  </div>
                  <div className="membership-moves-right">
                    <span className="membership-moves-chip">{requestStatusLabel(item.status)}</span>
                    {pending ? (
                      <>
                        <button type="button" className="membership-moves-link" disabled={busyId === item.id} onClick={() => startDeliver('alta', item)}>
                          {match ? 'Actualizar ficha y enviar acceso' : 'Dar de alta y enviar usuario'}
                        </button>
                        <button type="button" className="membership-moves-link" onClick={() => onPrefillAlta?.(item)}>
                          Dar de alta
                        </button>
                        <button
                          type="button"
                          className="membership-moves-link"
                          onClick={() => {
                            setRejectId(item.id);
                            setRejectNote('');
                          }}
                        >
                          Rechazar
                        </button>
                      </>
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
