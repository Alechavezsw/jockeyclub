import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Smartphone,
  Pencil,
  CreditCard,
  KeyRound,
  FileDown,
  MessageSquare,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Wallet,
  CalendarDays,
  DoorOpen,
  ClipboardList,
  Banknote,
} from 'lucide-react';
import { formatShortDate, isDuesExemptMember, quotaHeadline, toWhatsAppPhone } from '../../domain/members/dues';
import { imputationPeriodLabel } from '../../domain/members/duesImputations';
import {
  duesMethodLabel,
  isDuesCollectionJournal,
  journalEntryBelongsToMember,
  persistDuesCollection,
  recordDuesCollection,
} from '../../domain/members/memberPayments';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import {
  collectMemberMeta,
  memberAppAccess,
  memberHasPortalAccess,
} from '../../domain/members/memberAdminActions';
import {
  isFamilyDependent,
  memberMatchesDirectoryQuery,
  rankMemberSearchHit,
} from '../../domain/members/households';
import { getTierDisplayName, splitTierDisplayName, tierChipVars } from '../../domain/members/tiers';
import { portalLoginFromEmail } from '../../domain/auth/credentials';
import {
  accessInviteMailError,
  buildAccessInvite,
  portalLoginUrl,
} from '../../domain/members/selfService';
import { appMonthlyDebtForMember } from '../../domain/accounting/appMonthlyDebts';
import { downloadDuesDebtPdf } from '../../domain/accounting/exportDuesDebtPdf';
import { createMessage, MAILBOX } from '../../domain/messaging/messages';
import { formatPaymentWhen } from '../../domain/members/paymentHistory';
import VirtualCard from '../VirtualCard';
import CollectDuesModal from './CollectDuesModal';
import ModalDialog from '../ModalDialog';
import { MemberCredentialsModal } from './MemberAdminModals';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';

const PAGE_SIZE = 40;
const DETAIL_TABS = [
  { id: 'pagos', label: 'Pagos', icon: Wallet },
  { id: 'reservas', label: 'Reservas', icon: CalendarDays },
  { id: 'ingresos', label: 'Ingresos', icon: DoorOpen },
  { id: 'mensajes', label: 'Mensajes', icon: MessageSquare },
  { id: 'reclamos', label: 'Reclamos', icon: ClipboardList },
  { id: 'cuenta', label: 'Cuenta', icon: Banknote },
];

function memberInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function titleCase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ');
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

function EmptyBlock({ text }) {
  return <p className="members-app-desk__empty">{text}</p>;
}

/**
 * Escritorio de socios con portal: listado + interacción completa
 * (pagos, reservas, ingresos, mensajes, reclamos y acciones).
 */
export default function MembersWithAppPanel({
  members = [],
  membersLoading = false,
  setMembers,
  updateMember,
  addJournalEntry,
  onAccountEntry,
  formatCurrency,
  onOpenProfile,
  onSendMessage,
  tierCatalog = [],
  paymentPlans,
  paymentTolerance,
  journalEntries = [],
  reservations = [],
  entryLogs = [],
  claims = [],
  messages = [],
}) {
  const { user } = useAuth();
  const actorName = user?.name || user?.email || 'Administración';

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [debtFilter, setDebtFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [detailTab, setDetailTab] = useState('pagos');
  const [hydrated, setHydrated] = useState(null);
  const [liveBookings, setLiveBookings] = useState([]);
  const [liveEntries, setLiveEntries] = useState([]);
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveClaims, setLiveClaims] = useState([]);
  const [liveReady, setLiveReady] = useState(false);
  const [hydrateBusy, setHydrateBusy] = useState(false);
  const [liveAt, setLiveAt] = useState('');
  const [flash, setFlash] = useState('');
  const [collectMember, setCollectMember] = useState(null);
  const [cardMember, setCardMember] = useState(null);
  const [credsTarget, setCredsTarget] = useState(null);
  const [credsResult, setCredsResult] = useState(null);
  const [credsBusy, setCredsBusy] = useState(false);
  const [credsSending, setCredsSending] = useState('');
  const [credsError, setCredsError] = useState('');
  const [credsNotice, setCredsNotice] = useState('');
  const [msgTarget, setMsgTarget] = useState(null);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const withApp = useMemo(
    () => (members || []).filter((m) => memberHasPortalAccess(m)),
    [members],
  );

  const filtered = useMemo(() => {
    const q = String(query || '').trim();
    let list = withApp;
    if (debtFilter === 'debt') {
      list = list.filter((m) => !isFamilyDependent(m) && !isDuesExemptMember(m) && (Number(m.outstandingBalance) || 0) > 0);
    } else if (debtFilter === 'clear') {
      list = list.filter((m) => isFamilyDependent(m) || isDuesExemptMember(m) || (Number(m.outstandingBalance) || 0) <= 0);
    }
    if (!q) {
      return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    }
    return list
      .filter((m) => memberMatchesDirectoryQuery(m, q))
      .map((m) => ({ m, rank: rankMemberSearchHit(m, q) }))
      .sort((a, b) => b.rank - a.rank || String(a.m.name || '').localeCompare(String(b.m.name || ''), 'es'))
      .map((h) => h.m);
  }, [withApp, query, debtFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, debtFilter]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId('');
      return;
    }
    if (!selectedId || !filtered.some((m) => m.memberId === selectedId)) {
      setSelectedId(filtered[0].memberId);
    }
  }, [filtered, selectedId]);

  const listMember = useMemo(
    () => (members || []).find((m) => m.memberId === selectedId) || null,
    [members, selectedId],
  );

  const selected = useMemo(() => {
    if (!listMember) return null;
    if (hydrated?.memberId === listMember.memberId) {
      return { ...listMember, ...hydrated, paymentHistory: hydrated.paymentHistory || listMember.paymentHistory || [] };
    }
    return listMember;
  }, [listMember, hydrated]);

  useEffect(() => {
    if (!selectedId) {
      setHydrated(null);
      setLiveBookings([]);
      setLiveEntries([]);
      setLiveMessages([]);
      setLiveClaims([]);
      setLiveReady(false);
      setLiveAt('');
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    const applyFallback = () => {
      const local = (members || []).find((m) => m.memberId === selectedId) || null;
      setHydrated(local);
      setLiveBookings((reservations || []).filter((r) => r.memberId === selectedId || r.memberName === local?.name));
      setLiveEntries((entryLogs || []).filter((e) => e.memberId === selectedId));
      setLiveMessages((messages || []).filter((m) => m.recipientId === selectedId || m.senderId === selectedId));
      setLiveClaims((claims || []).filter((c) => c.memberId === selectedId));
      setLiveReady(true);
    };

    const loadLive = async ({ silent = false } = {}) => {
      if (!silent) setHydrateBusy(true);
      try {
        if (!isSupabaseConfigured) {
          if (!cancelled) applyFallback();
          return;
        }
        const [fresh, bookingsRows, messageRows, claimRows, accessRows] = await Promise.all([
          repos.getMemberByNumber(selectedId, { withPayments: true }).catch(() => null),
          repos.listReservations({ memberNumber: selectedId, limit: 120 }).catch(() => []),
          repos.listMessages({ memberNumber: selectedId, limit: 100 }).catch(() => []),
          repos.listClaims({ memberNumber: selectedId, limit: 80 }).catch(() => []),
          repos.listAccessLogs({ memberNumber: selectedId, limit: 120 }).catch(() => []),
        ]);
        if (cancelled) return;
        if (fresh) {
          setHydrated(fresh);
          if (typeof updateMember === 'function') void updateMember(fresh);
          else if (typeof setMembers === 'function') {
            setMembers((prev) => prev.map((x) => (x.memberId === fresh.memberId ? { ...x, ...fresh } : x)));
          }
        } else {
          applyFallback();
        }
        setLiveBookings(Array.isArray(bookingsRows) ? bookingsRows : []);
        setLiveMessages(Array.isArray(messageRows) ? messageRows : []);
        setLiveClaims(Array.isArray(claimRows) ? claimRows : []);
        setLiveEntries(Array.isArray(accessRows) ? accessRows : []);
        setLiveReady(true);
        setLiveAt(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } finally {
        if (!cancelled) setHydrateBusy(false);
      }
    };

    void loadLive();
    timer = window.setInterval(() => { void loadLive({ silent: true }); }, 12000);

    let channel = null;
    if (isSupabaseConfigured && supabase) {
      channel = supabase
        .channel(`members-app-${selectedId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'member_payments' }, () => {
          void loadLive({ silent: true });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
          void loadLive({ silent: true });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
          void loadLive({ silent: true });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, () => {
          void loadLive({ silent: true });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'access_logs' }, () => {
          void loadLive({ silent: true });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => {
          void loadLive({ silent: true });
        })
        .subscribe();
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') void loadLive({ silent: true });
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      if (channel) supabase?.removeChannel(channel);
    };
    // Props de listado solo alimentan el fallback local; el refresh lo dispara selectedId + realtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- members/reservations/etc. son snapshot de respaldo
  }, [selectedId, setMembers, updateMember]);

  const stats = useMemo(() => {
    const debt = withApp.filter((m) => !isFamilyDependent(m) && !isDuesExemptMember(m) && (Number(m.outstandingBalance) || 0) > 0).length;
    return { total: withApp.length, debt, clear: withApp.length - debt };
  }, [withApp]);

  const payments = useMemo(() => {
    const rows = [...(selected?.paymentHistory || [])];
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return rows;
  }, [selected]);

  const bookings = useMemo(() => {
    const rows = liveReady
      ? liveBookings
      : (reservations || []).filter((r) => r.memberId === selectedId || r.memberName === selected?.name);
    return [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [liveReady, liveBookings, reservations, selectedId, selected]);

  const entries = useMemo(() => {
    const rows = liveReady
      ? liveEntries
      : (entryLogs || []).filter((e) => e.memberId === selectedId);
    return [...rows].sort((a, b) => `${b.date || ''}${b.time || ''}`.localeCompare(`${a.date || ''}${a.time || ''}`));
  }, [liveReady, liveEntries, entryLogs, selectedId]);

  const memberMessages = useMemo(() => {
    const rows = liveReady
      ? liveMessages
      : (messages || []).filter((m) => m.recipientId === selectedId || m.senderId === selectedId);
    return [...rows].sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
  }, [liveReady, liveMessages, messages, selectedId]);

  const memberClaims = useMemo(() => {
    const rows = liveReady
      ? liveClaims
      : (claims || []).filter((c) => c.memberId === selectedId);
    return [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [liveReady, liveClaims, claims, selectedId]);

  const movements = useMemo(() => {
    if (!selected) return [];
    return (journalEntries || [])
      .filter((entry) => journalEntryBelongsToMember(entry, selected) && !isDuesCollectionJournal(entry))
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [journalEntries, selected]);

  const tabCounts = useMemo(() => ({
    pagos: payments.length,
    reservas: bookings.length,
    ingresos: entries.length,
    mensajes: memberMessages.length,
    reclamos: memberClaims.length,
    cuenta: movements.length,
  }), [payments, bookings, entries, memberMessages, memberClaims, movements]);

  const putMemberInList = (saved) => {
    if (!saved?.memberId) return;
    if (typeof updateMember === 'function') {
      void updateMember(saved);
    } else if (typeof setMembers === 'function') {
      setMembers((prev) => prev.map((x) => (x.memberId === saved.memberId ? saved : x)));
    }
    if (saved.memberId === selectedId) setHydrated(saved);
  };

  const handleConfirmCollect = async (payload) => {
    const member = collectMember;
    if (!member) return;
    if (payload?.alreadyApplied) {
      if (member.memberId) {
        repos.getMemberByNumber(member.memberId, { withPayments: true })
          .then((fresh) => { if (fresh) putMemberInList(fresh); })
          .catch(() => {});
      }
      setCollectMember(null);
      return;
    }
    try {
      const result = await persistDuesCollection(recordDuesCollection(member, { ...payload, members }), {
        setMembers,
        updateMember,
        addJournalEntry,
        onAccountEntry,
      });
      void deliverPaymentReceipt({
        member: result.member,
        payment: result.payment,
        onSendMessage,
        kind: 'cuota',
      });
      putMemberInList(result.member);
      setCollectMember(null);
      setFlash(`Cobro registrado · ${member.name}`);
      setDetailTab('pagos');
      window.setTimeout(() => setFlash(''), 3200);
    } catch (err) {
      window.alert(err?.message || 'No se pudo registrar el cobro.');
      throw err;
    }
  };

  const openCredentials = (member) => {
    setCredsError('');
    setCredsNotice('');
    setCredsSending('');
    setCredsResult(null);
    setCredsTarget(member);
  };

  const savePortalAccess = async (creds) => {
    if (!credsTarget) throw new Error('No hay socio seleccionado.');
    const email = String(creds.email || credsTarget.email || '').trim().toLowerCase();
    const username = String(creds.username || portalLoginFromEmail(email).username || email);
    const password = String(creds.password || '');
    if (!email.includes('@') || password.length < 6) {
      throw new Error('El email del socio y una contraseña (mín. 6) son obligatorios.');
    }
    const ready = { username, password, email };

    if (credsResult?.creds?.email === email && credsResult?.creds?.password === password) {
      return credsResult.creds;
    }

    let profileId = credsTarget.profileId || credsTarget.profile_id || null;
    if (isSupabaseConfigured) {
      const byEmail = await repos.portalProfileIdForLogin(email, credsTarget.id);
      if (byEmail) profileId = byEmail;
    }

    if (isSupabaseConfigured && profileId) {
      await repos.resetPortalUserPassword(profileId, password, email, {
        memberId: credsTarget.id,
        actorName,
        username,
      });
      let saved;
      try {
        saved = await repos.linkMemberPortalAccess(credsTarget, profileId, ready, actorName);
      } catch {
        saved = {
          ...credsTarget,
          profileId,
          meta: {
            ...collectMemberMeta(credsTarget),
            portalUsername: username,
            portalProvisionedAt: new Date().toISOString(),
            portalProvisionedBy: actorName || null,
          },
        };
      }
      putMemberInList(saved);
    } else if (isSupabaseConfigured) {
      const { member: saved, creds: out } = await repos.provisionMemberPortalAccess(
        credsTarget,
        ready,
        { actorName },
      );
      putMemberInList(saved);
      ready.username = out?.username || username;
      ready.email = out?.email || email;
      ready.password = out?.password || password;
    } else {
      const next = {
        ...credsTarget,
        email: credsTarget.email || email,
        meta: {
          ...collectMemberMeta(credsTarget),
          portalUsername: username,
          portalProvisionedAt: new Date().toISOString(),
          portalProvisionedBy: actorName || null,
        },
      };
      putMemberInList(next);
    }
    setCredsResult({ creds: ready });
    setFlash(`Acceso listo · ${credsTarget.name}`);
    window.setTimeout(() => setFlash(''), 3200);
    return ready;
  };

  const handleCredentialsGenerate = async (creds) => {
    setCredsBusy(true);
    setCredsSending('');
    setCredsError('');
    setCredsNotice('');
    try {
      await savePortalAccess(creds);
    } catch (err) {
      setCredsError(err?.message || 'No se pudo crear el acceso.');
    } finally {
      setCredsBusy(false);
    }
  };

  const handleSendCredentialsEmail = async (creds) => {
    setCredsBusy(true);
    setCredsSending('email');
    setCredsError('');
    setCredsNotice('');
    try {
      const ready = await savePortalAccess(creds);
      if (!isSupabaseConfigured) {
        throw new Error('El mail sale por Resend cuando el portal está conectado.');
      }
      await repos.sendAccessInviteEmail({
        to: ready.email,
        name: credsTarget?.name,
        username: ready.username,
        loginEmail: ready.email,
        password: ready.password,
        portalUrl: portalLoginUrl(),
        logoUrl: `${portalLoginUrl()}logo-jockey-club.png`,
      });
      setCredsNotice(`Mail enviado a ${ready.email}.`);
    } catch (err) {
      const mailError = accessInviteMailError(err?.message);
      if (mailError) setCredsError(mailError);
      else setCredsNotice('Acceso listo. El mail no salió: pasale la contraseña por WhatsApp.');
    } finally {
      setCredsBusy(false);
      setCredsSending('');
    }
  };

  const handleSendCredentialsWhatsApp = async (creds) => {
    const popup = window.open('', '_blank');
    setCredsBusy(true);
    setCredsSending('whatsapp');
    setCredsError('');
    setCredsNotice('');
    try {
      const ready = await savePortalAccess(creds);
      const invite = buildAccessInvite({
        name: credsTarget?.name,
        phone: credsTarget?.phone,
        contactEmail: ready.email,
        creds: ready,
        portalUrl: portalLoginUrl(),
      });
      if (!invite.whatsappUrl) {
        popup?.close();
        throw new Error('La ficha no tiene un celular válido para WhatsApp.');
      }
      if (popup) popup.location.href = invite.whatsappUrl;
      else window.open(invite.whatsappUrl, '_blank', 'noopener,noreferrer');
      setCredsNotice('WhatsApp abierto con las credenciales.');
    } catch (err) {
      popup?.close();
      setCredsError(err?.message || 'No se pudo abrir WhatsApp.');
    } finally {
      setCredsBusy(false);
      setCredsSending('');
    }
  };

  const handleDebtPdf = async (member) => {
    setPdfBusy(true);
    try {
      const debt = appMonthlyDebtForMember(member, {
        today: new Date(),
        entries: journalEntries,
      });
      await downloadDuesDebtPdf({ member, debt });
    } catch (err) {
      window.alert(err?.message || 'No se pudo generar el PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const openMessage = (member) => {
    setMsgTarget(member);
    setMsgSubject(`Comunicado · ${member.name}`);
    setMsgBody('');
  };

  const sendQuickMessage = async () => {
    if (!msgTarget || typeof onSendMessage !== 'function') return;
    const subject = String(msgSubject || '').trim();
    const body = String(msgBody || '').trim();
    if (!subject || !body) {
      window.alert('Asunto y mensaje son obligatorios.');
      return;
    }
    setMsgBusy(true);
    try {
      const msg = createMessage({
        sender: actorName,
        senderId: MAILBOX.OPERATIONS,
        recipientId: msgTarget.memberId,
        subject,
        content: body,
        meta: { kind: 'club_notice' },
      });
      await onSendMessage(msg);
      setMsgTarget(null);
      setFlash(`Mensaje enviado · ${msgTarget.name}`);
      setDetailTab('mensajes');
      window.setTimeout(() => setFlash(''), 3200);
    } catch (err) {
      window.alert(err?.message || 'No se pudo enviar el mensaje.');
    } finally {
      setMsgBusy(false);
    }
  };

  const balance = Number(selected?.outstandingBalance) || 0;
  const canCollect = Boolean(
    selected
    && !isFamilyDependent(selected)
    && !isDuesExemptMember(selected)
    && balance > 0,
  );
  const wa = selected ? toWhatsAppPhone(selected.phone) : '';
  const headline = selected ? quotaHeadline(selected) : null;
  const access = selected ? memberAppAccess(selected) : null;

  return (
    <section className="members-app-desk fade-in" aria-labelledby="members-app-title">
      <header className="members-app-desk__head">
        <div className="members-app-desk__title-row">
          <span className="members-app-desk__icon" aria-hidden="true">
            <Smartphone size={22} />
          </span>
          <div>
            <h2 id="members-app-title" className="serif-font" style={{ margin: 0 }}>
              Socios con app
            </h2>
            <p className="ops-muted" style={{ margin: '0.25rem 0 0' }}>
              Datos en vivo desde Supabase: pagos, reservas, ingresos, mensajes y reclamos.
            </p>
          </div>
        </div>
        <div className="members-app-desk__stats" role="status">
          <span><strong>{stats.total}</strong> con app</span>
          <span><strong>{stats.debt}</strong> con deuda</span>
          <span><strong>{stats.clear}</strong> al día / exentos</span>
        </div>
      </header>

      {flash ? (
        <p className="members-app-desk__flash" role="status">{flash}</p>
      ) : null}

      <div className="members-app-desk__toolbar">
        <label className="members-app-desk__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, Nº, DNI, mail o celular…"
            aria-label="Buscar socios con app"
          />
        </label>
        <div className="members-app-desk__filters" role="group" aria-label="Filtro de deuda">
          <button type="button" className={`members-app-desk__chip${debtFilter === 'all' ? ' is-on' : ''}`} onClick={() => setDebtFilter('all')}>Todos</button>
          <button type="button" className={`members-app-desk__chip${debtFilter === 'debt' ? ' is-on' : ''}`} onClick={() => setDebtFilter('debt')}>Con deuda</button>
          <button type="button" className={`members-app-desk__chip${debtFilter === 'clear' ? ' is-on' : ''}`} onClick={() => setDebtFilter('clear')}>Al día</button>
        </div>
      </div>

      {membersLoading && !withApp.length ? (
        <p className="ops-muted">Cargando padrón…</p>
      ) : !filtered.length ? (
        <article className="glass-card" style={{ padding: '1.25rem' }}>
          <p style={{ margin: 0 }}>
            {query.trim()
              ? 'Ningún socio con app coincide con la búsqueda.'
              : 'Todavía no hay socios con acceso al portal en este listado.'}
          </p>
        </article>
      ) : (
        <div className="members-app-desk__split">
          <aside className="members-app-desk__rail" aria-label="Listado con app">
            <ul className="members-app-desk__rail-list">
              {pageRows.map((m) => {
                const bal = Number(m.outstandingBalance) || 0;
                const active = m.memberId === selectedId;
                return (
                  <li key={m.memberId || m.id}>
                    <button
                      type="button"
                      className={`members-app-desk__rail-item${active ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(m.memberId);
                        setDetailTab('pagos');
                      }}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="members-app-desk__avatar is-sm" aria-hidden="true">
                        {m.photo ? <img src={m.photo} alt="" /> : memberInitials(m.name)}
                      </span>
                      <span className="members-app-desk__copy">
                        <strong>{m.name}</strong>
                        <span>Nº {String(m.memberId || '').replace(/(\d{4})/g, '$1 ').trim()}</span>
                        <span className="members-app-desk__balance">
                          {isFamilyDependent(m) || isDuesExemptMember(m) || bal <= 0
                            ? quotaHeadline(m).title
                            : formatCurrency(bal)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtered.length > PAGE_SIZE ? (
              <div className="members-app-desk__pager is-compact">
                <button type="button" className="btn btn-secondary btn-xs" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft size={14} />
                </button>
                <span className="ops-muted">{safePage}/{totalPages}</span>
                <button type="button" className="btn btn-secondary btn-xs" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  <ChevronRight size={14} />
                </button>
              </div>
            ) : null}
          </aside>

          <article className="members-app-desk__detail" aria-live="polite">
            {!selected ? (
              <EmptyBlock text="Elegí un socio del listado." />
            ) : (
              <>
                <div className="members-app-desk__detail-head">
                  <div className="members-app-desk__identity" aria-label={`Socio ${selected.name}`}>
                    <span className="members-app-desk__avatar" aria-hidden="true">
                      {selected.photo ? <img src={selected.photo} alt="" /> : memberInitials(selected.name)}
                    </span>
                    <span className="members-app-desk__copy">
                      <strong>{selected.name}</strong>
                      <span>
                        Nº {String(selected.memberId || '').replace(/(\d{4})/g, '$1 ').trim()}
                        {' · '}
                        <TierChip tier={selected.tier} catalog={tierCatalog} />
                        {' · '}
                        <em style={{ fontStyle: 'normal', color: 'var(--emerald-accent)' }}>{access?.label}</em>
                      </span>
                      <span className="members-app-desk__balance">
                        {isFamilyDependent(selected) || isDuesExemptMember(selected) || balance <= 0
                          ? headline?.title
                          : formatCurrency(balance)}
                        {hydrateBusy
                          ? ' · actualizando…'
                          : liveAt
                            ? ` · en vivo ${liveAt}`
                            : ''}
                      </span>
                    </span>
                  </div>

                  <div className="members-app-desk__actions">
                    <button type="button" className="members-app-desk__action-btn" onClick={() => onOpenProfile?.(selected.memberId)}>
                      <Pencil size={14} /> Ficha
                    </button>
                    {canCollect ? (
                      <button type="button" className="members-app-desk__action-btn is-collect" onClick={() => setCollectMember(selected)}>
                        <Check size={14} /> Cobrar
                      </button>
                    ) : null}
                    <button type="button" className="members-app-desk__action-btn" disabled={pdfBusy || isDuesExemptMember(selected)} onClick={() => handleDebtPdf(selected)}>
                      <FileDown size={14} /> Deuda
                    </button>
                    <button type="button" className="members-app-desk__action-btn" onClick={() => setCardMember(selected)}>
                      <CreditCard size={14} /> Tarjeta
                    </button>
                    <button type="button" className="members-app-desk__action-btn" onClick={() => openCredentials(selected)}>
                      <KeyRound size={14} /> Acceso
                    </button>
                    {wa ? (
                      <a className="members-app-desk__action-btn" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                        <WhatsAppIcon size={14} /> WhatsApp
                      </a>
                    ) : null}
                    {typeof onSendMessage === 'function' ? (
                      <button type="button" className="members-app-desk__action-btn" onClick={() => openMessage(selected)}>
                        <MessageSquare size={14} /> Mensaje
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="members-app-desk__tabs" role="tablist" aria-label="Interacción del socio">
                  {DETAIL_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = detailTab === tab.id;
                    const count = tabCounts[tab.id] || 0;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`members-app-desk__tab${active ? ' is-active' : ''}`}
                        onClick={() => setDetailTab(tab.id)}
                      >
                        <Icon size={14} aria-hidden="true" />
                        <span>{tab.label}</span>
                        <em>{count}</em>
                      </button>
                    );
                  })}
                </div>

                <div className="members-app-desk__panel" role="tabpanel">
                  {detailTab === 'pagos' && (
                    payments.length === 0 ? (
                      <EmptyBlock text="Sin pagos registrados en la ficha." />
                    ) : (
                      payments.map((p) => (
                        <div key={p.id || `${p.date}-${p.amount}-${p.concept || ''}`} className="mp-list-row">
                          <span className="mp-list-when">{formatPaymentWhen(p)}</span>
                          <span className="mp-list-main">
                            {p.concept || `Cobro · ${duesMethodLabel(p.method, p.bankName)}`}
                            {p.status === 'void' ? (
                              <div className="mp-list-sub">Anulado{p.voidedBy ? ` · ${p.voidedBy}` : ''}</div>
                            ) : null}
                            {p.imputations?.length ? (
                              <div className="mp-list-sub">
                                {p.imputations.map((row) => (
                                  `${imputationPeriodLabel(row.dueOn)}: cuota ${formatCurrency(row.capital)}`
                                  + (row.surcharge > 0 ? ` · recargo ${formatCurrency(row.surcharge)}` : '')
                                )).join(' · ')}
                              </div>
                            ) : null}
                          </span>
                          <strong className="mp-list-amount" style={p.status === 'void' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                            {formatCurrency(p.amount)}
                          </strong>
                        </div>
                      ))
                    )
                  )}

                  {detailTab === 'reservas' && (
                    bookings.length === 0 ? (
                      <EmptyBlock text="Sin reservas registradas." />
                    ) : (
                      bookings.map((r) => (
                        <div key={r.id} className="mp-list-row">
                          <span className="mp-list-when">{formatShortDate(r.date)} {r.time || ''}</span>
                          <span className="mp-list-main">
                            <strong>{r.facilityName || r.facility || 'Instalación'}</strong>
                            {r.guestNames ? <div className="mp-list-sub">Invitados: {r.guestNames}</div> : null}
                            {r.amount != null || r.totalPrice != null || r.price != null ? (
                              <div className="mp-list-sub">
                                Monto: {formatCurrency(r.amount ?? r.totalPrice ?? r.price)}
                                {r.depositPaid || r.depositAmount
                                  ? ` · Seña ${formatCurrency(r.depositPaid || r.depositAmount)}`
                                  : ''}
                              </div>
                            ) : null}
                          </span>
                          <span className={r.status === 'confirmed' ? 'tone-ok' : 'tone-warn'}>
                            {r.status === 'confirmed' ? 'Confirmada' : titleCase(r.status)}
                          </span>
                        </div>
                      ))
                    )
                  )}

                  {detailTab === 'ingresos' && (
                    entries.length === 0 ? (
                      <EmptyBlock text="Sin ingresos por QR / portería." />
                    ) : (
                      entries.map((e) => (
                        <div key={e.id} className="mp-list-row">
                          <span className="mp-list-when">{formatShortDate(e.date)} {e.time || ''}</span>
                          <span className="mp-list-main muted">{e.notes || e.role || e.gate || 'Ingreso'}</span>
                          <strong className={e.status === 'granted' ? 'tone-ok' : 'tone-danger'}>
                            {e.status === 'granted' ? 'Ingreso OK' : titleCase(e.status || 'Denegado')}
                          </strong>
                        </div>
                      ))
                    )
                  )}

                  {detailTab === 'mensajes' && (
                    memberMessages.length === 0 ? (
                      <EmptyBlock text="Sin mensajes vinculados." />
                    ) : (
                      memberMessages.map((m) => (
                        <div key={m.id} className="mp-claim-row">
                          <div className="mp-claim-top">
                            <strong>{m.subject}</strong>
                            <span>{formatShortDate(m.date || (m.createdAt || '').slice(0, 10))}</span>
                          </div>
                          <div className="mp-list-sub">
                            De: {m.sender || m.senderId} → {m.recipientId === selected.memberId ? 'Este socio' : m.recipientId}
                          </div>
                          <div className="mp-claim-body">{m.content}</div>
                        </div>
                      ))
                    )
                  )}

                  {detailTab === 'reclamos' && (
                    memberClaims.length === 0 ? (
                      <EmptyBlock text="Sin reclamos asociados." />
                    ) : (
                      memberClaims.map((c) => (
                        <div key={c.id} className="mp-claim-row">
                          <div className="mp-claim-top">
                            <strong>{c.title}</strong>
                            <span>{formatShortDate(c.date)}</span>
                          </div>
                          <div className="mp-claim-body">{c.description || c.detail}</div>
                          <div className="mp-claim-status">Estado: {titleCase(c.status)}</div>
                        </div>
                      ))
                    )
                  )}

                  {detailTab === 'cuenta' && (
                    movements.length === 0 ? (
                      <EmptyBlock text="Sin otros movimientos de cuenta (alquileres, cargos, etc.)." />
                    ) : (
                      movements.map((e) => {
                        const amount = (e.lines || []).find((l) => l.type === 'debit')?.amount
                          ?? (e.lines || []).find((l) => l.type === 'credit')?.amount;
                        return (
                          <div key={e.id} className="mp-list-row">
                            <span className="mp-list-when">{formatShortDate(e.date)}</span>
                            <span className="mp-list-main">{e.description || e.memo || 'Movimiento'}</span>
                            <strong className="mp-list-amount">
                              {amount != null ? formatCurrency(amount) : '—'}
                            </strong>
                          </div>
                        );
                      })
                    )
                  )}
                </div>
              </>
            )}
          </article>
        </div>
      )}

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

      {cardMember ? (
        <ModalDialog
          onClose={() => setCardMember(null)}
          labelledBy="members-app-card-title"
          contentClassName="modal-content glass-panel"
          contentStyle={{
            width: '90%',
            maxWidth: 460,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: '0.75rem' }}>
            <h4 id="members-app-card-title" className="serif-font" style={{ margin: 0, color: 'var(--text-gold)' }}>
              Tarjeta virtual
            </h4>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCardMember(null)} aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>
          <VirtualCard member={cardMember} />
        </ModalDialog>
      ) : null}

      <MemberCredentialsModal
        key={credsTarget ? `creds-app-${credsTarget.memberId}` : 'creds-app-closed'}
        open={Boolean(credsTarget)}
        member={credsTarget}
        busy={credsBusy}
        sending={credsSending}
        error={credsError}
        notice={credsNotice}
        result={credsResult}
        onClose={() => {
          setCredsTarget(null);
          setCredsResult(null);
          setCredsError('');
          setCredsNotice('');
        }}
        onGenerate={handleCredentialsGenerate}
        onSendEmail={handleSendCredentialsEmail}
        onSendWhatsApp={handleSendCredentialsWhatsApp}
      />

      {msgTarget ? (
        <ModalDialog
          onClose={msgBusy ? undefined : () => setMsgTarget(null)}
          labelledBy="members-app-msg-title"
          contentStyle={{
            width: 'min(92vw, 480px)',
            padding: '1.25rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-glass)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: '0.85rem' }}>
            <div>
              <h4 id="members-app-msg-title" className="serif-font" style={{ margin: 0, color: 'var(--text-gold)' }}>
                Mensaje al portal
              </h4>
              <p className="ops-muted" style={{ margin: '0.35rem 0 0' }}>
                {msgTarget.name} · Nº {msgTarget.memberId}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMsgTarget(null)} disabled={msgBusy} aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>
          <label className="form-label" htmlFor="members-app-msg-subject">Asunto</label>
          <input id="members-app-msg-subject" className="form-input" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} disabled={msgBusy} />
          <label className="form-label" htmlFor="members-app-msg-body" style={{ marginTop: '0.75rem' }}>Mensaje</label>
          <textarea id="members-app-msg-body" className="form-input" rows={5} value={msgBody} onChange={(e) => setMsgBody(e.target.value)} disabled={msgBusy} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setMsgTarget(null)} disabled={msgBusy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={sendQuickMessage} disabled={msgBusy}>
              {msgBusy ? 'Enviando…' : 'Enviar MD'}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </section>
  );
}
