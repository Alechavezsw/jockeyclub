import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, CreditCard, Check, ShieldAlert,
  Clock, BookOpen, ClipboardList, MessageSquare, Phone,
  FileSpreadsheet, Radio, Database, BellRing, PartyPopper, Trophy, Store, DoorOpen, QrCode, Newspaper,
  LayoutDashboard, ChevronRight, Briefcase, Headset, Settings, Waves, GraduationCap, ListOrdered, TicketCheck,
} from 'lucide-react';
import AccountingTab from '../components/AccountingTab';
import StaffTab from '../components/StaffTab';
import AlertsPanel from '../components/erp/AlertsPanel';
import ClubEventsPanel from '../components/erp/ClubEventsPanel';
import AdminDashboardTab from '../components/admin/AdminDashboardTab';
import MembersTab from '../components/admin/MembersTab';
import MemberProfilePanel from '../components/admin/MemberProfilePanel';
import StaffProfilePanel from '../components/admin/StaffProfilePanel';
import BookingsTab from '../components/admin/BookingsTab';
import ClaimsTab from '../components/admin/ClaimsTab';
import MessagingTab from '../components/admin/MessagingTab';
import ReportsTab from '../components/admin/ReportsTab';
import SurveysTab from '../components/admin/SurveysTab';
import MigrationTab from '../components/admin/MigrationTab';
import CuotasPanel from '../components/erp/CuotasPanel';
import DisciplinesTab from '../components/admin/DisciplinesTab';
import AccessLogsTab from '../components/admin/AccessLogsTab';
import ClubFacilitiesPanel from '../components/admin/ClubFacilitiesPanel';
import NewsCmsTab from '../components/admin/NewsCmsTab';
import SystemAdminTab from '../components/admin/SystemAdminTab';
import PortalUserProfilePanel from '../components/admin/PortalUserProfilePanel';
import TeachersTab from '../components/admin/TeachersTab';
import PoolTab from '../components/admin/PoolTab';
import JevReviewTab from '../components/admin/JevReviewTab';
import { DEFAULT_POOL_SETTINGS } from '../domain/pool/poolAccess';
import { DEFAULT_CHART_OF_ACCOUNTS, resolveAccountId } from '../domain/accounting/chartOfAccounts';
import { getAccountBalance as domainAccountBalance } from '../domain/accounting/journal';
import { allowedAdminTabsForRoles, canAccessConcessions, canAccessQrGate, ROLE_LABELS, ROLE_PANEL_META } from '../domain/auth/roles';
import { getOverdueMembers, getUpcomingDuesMembers } from '../domain/members/dues';
import { isLiveMember, isTitularMember } from '../domain/members/households';
import { useAuth } from '../context/AuthContext';
import { repos } from '../data/bootstrap';
import { buildClubReview } from '../domain/review/buildClubReview';
import { membershipMovesSeed } from '../domain/members/membershipMoves';
import { currentAccountBalancesSeed } from '../domain/accounting/currentAccountBalances';
import { feeAccountDetailsForPeriod, feeAccountDetailsSeed } from '../domain/accounting/feeAccountDetails';
import { monthlyBalanceCards, monthlyBalanceSeed } from '../domain/accounting/monthlyBalance';
import { monthlyBalanceSummarySeed } from '../domain/accounting/monthlyBalanceSummary';
import { detailedCcSeed } from '../domain/accounting/detailedCurrentAccounts';
import { cashSeed } from '../domain/accounting/cashLedger';
import { cobranzasSeed } from '../domain/accounting/cobranzas';
import { composeClubFinance, financeFromMonthlySummary, lilaContabilidadFromSnapshots } from '../domain/accounting/opsFinanceSnapshot';
import { useSnapshotSeed } from '../hooks/useSnapshots';
import { todayISODateAR } from '../lib/arDate';

const LILA_METRIC_SNAPSHOTS = [
  'accessinMonthlyBalance',
  'accessinMonthlyBalanceSummary',
  'accessinDetailedCurrentAccounts',
  'accessinCashSnapshot',
  'accessinCobranzas',
];

function readLilaMetrics() {
  const monthly = monthlyBalanceSeed();
  const summary = monthlyBalanceSummarySeed();
  const summarySnapshot = summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT;
  const currentMonth = financeFromMonthlySummary({
    snapshot: summarySnapshot,
    sections: summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
    today: todayISODateAR(),
  });
  const detailed = lilaContabilidadFromSnapshots({
    monthlySnapshot: monthly.ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
    detailedSnapshot: detailedCcSeed().ACCESSIN_DETAILED_CC_SNAPSHOT,
    cashSnapshot: cashSeed().ACCESSIN_CASH_SNAPSHOT,
    cobranzas: cobranzasSeed().ACCESSIN_COBRANZAS,
  });
  return {
    money: currentMonth || detailed,
    cards: monthlyBalanceCards(
      currentMonth ? summarySnapshot : monthly.ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
    ),
  };
}

function monthLabelFromIso(iso) {
  const [year, month] = String(iso || '').split('-');
  if (!year || !month) return '';
  const raw = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatIsoDateAR(iso) {
  const [year, month, day] = String(iso || '').split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

function findMemberForProfile(members = [], routeId) {
  if (!routeId) return null;
  const raw = decodeURIComponent(String(routeId));
  const digits = raw.replace(/\D/g, '');
  return (members || []).find((m) => {
    const id = String(m.memberId || '');
    const idDigits = id.replace(/\D/g, '');
    return id === raw
      || idDigits === digits
      || String(m.id || '') === raw
      || String(m.memberNumber || '') === raw;
  }) || null;
}

const GROUP_ICONS = {
  ops: Activity,
  club: Trophy,
  mgmt: Briefcase,
  care: Headset,
  admin: Settings,
  sys: Database,
};

/**
 * Panel operativo del club. Orquesta la cabecera, las métricas por rol y las
 * pestañas (cada una es un componente propio en src/components/admin/).
 */
export default function AdminView({
  members,
  membersCount = 0,
  membersLoading = false,
  membersProgress = { loaded: 0, total: 0 },
  reservations,
  setMembers,
  setReservations,
  journalEntries = [],
  setJournalEntries,
  addJournalEntry,
  staffMembers = [],
  setStaffMembers,
  staffHrRecords = [],
  setStaffHrRecords,
  claims = [],
  setClaims,
  messages = [],
  setMessages,
  refreshMessages,
  sendMessage,
  entryLogs = [],
  setEntryLogs,
  surveys = [],
  setSurveys,
  registeredUsersCount = 0,
  setRegisteredUsersCount,
  membershipApplications = [],
  setMembershipApplications,
  portalAccessRequests = [],
  setPortalAccessRequests,
  erp = {},
  latestNews = [],
  setNewsList,
  disciplineCatalog = [],
  setDisciplineCatalog,
  tierCatalog = [],
  setTierCatalog,
  userRole = 'admin',
  isZondaActive = false,
  updateMember = null,
  poolAccesses = [],
  setPoolAccesses,
  recordPoolCanon,
  poolSettings = DEFAULT_POOL_SETTINGS,
  setPoolSettings,
  facilityCatalog = null,
  setFacilityCatalog = null,
}) {
  const { user } = useAuth();
  const chartOfAccounts = erp.chartOfAccounts || DEFAULT_CHART_OF_ACCOUNTS;
  const lilaMetrics = useSnapshotSeed(LILA_METRIC_SNAPSHOTS, readLilaMetrics);
  const movesSeed = useSnapshotSeed(['societasMembershipMoves'], membershipMovesSeed);
  const balancesSeed = useSnapshotSeed(['accessinCurrentAccountBalances'], currentAccountBalancesSeed);
  const feeDetailsSeed = useSnapshotSeed(['accessinFeeAccountDetails'], feeAccountDetailsSeed);
  const [ledgerCount, setLedgerCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    repos.countGroupAccountLedgers()
      .then((count) => {
        if (!cancelled) setLedgerCount(count);
      })
      .catch(() => {
        if (!cancelled) setLedgerCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const feeChargedNumbers = useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const accounts = feeAccountDetailsForPeriod(key, feeDetailsSeed?.ACCESSIN_FEE_ACCOUNT_DETAILS || []);
    const ids = new Set();
    for (const account of accounts) {
      for (const line of account.lines || []) {
        const number = String(line.memberNumber || '').replace(/\D/g, '');
        if (number) ids.add(number);
      }
    }
    return [...ids];
  }, [feeDetailsSeed]);
  const permittedTabs = allowedAdminTabsForRoles(user?.roles?.length ? user.roles : userRole);
  const clubReview = useMemo(() => buildClubReview({
    members,
    journalEntries,
    chartOfAccounts,
    unidentifiedCollections: erp.unidentifiedCollections || [],
    cheques: erp.accessinCheques || [],
    concessions: erp.concessions || [],
    suppliers: erp.suppliers || [],
    retenciones: erp.retenciones || [],
    discounts: erp.discounts || [],
    reservations,
    poolAccesses,
    entryLogs,
    cashSessions: erp.cashSessions || [],
    interestGenerators: erp.interestGenerators || [],
    interestRuns: erp.interestRuns || [],
    bajas: movesSeed?.SOCIETAS_MEMBERSHIP_BAJAS || [],
    expenses: erp.expenses || [],
    paymentOrders: erp.paymentOrders || [],
    galiciaDebits: erp.galiciaDebits || [],
    feePeriods: erp.feePeriods || [],
    membershipApplications,
    claims,
    messages,
    accountBalances: {
      asOf: balancesSeed?.ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF || '',
      byNumber: balancesSeed?.ACCESSIN_CURRENT_ACCOUNT_BALANCES_BY_NUMBER || {},
    },
    feeChargedNumbers,
    accountLedgers: { loaded: ledgerCount },
    loading: membersLoading && !(members || []).length,
  }), [
    members,
    journalEntries,
    chartOfAccounts,
    erp.unidentifiedCollections,
    erp.accessinCheques,
    erp.concessions,
    erp.suppliers,
    erp.retenciones,
    erp.discounts,
    reservations,
    poolAccesses,
    entryLogs,
    erp.cashSessions,
    erp.interestGenerators,
    erp.interestRuns,
    movesSeed,
    erp.expenses,
    erp.paymentOrders,
    erp.galiciaDebits,
    erp.feePeriods,
    membershipApplications,
    claims,
    messages,
    balancesSeed,
    feeChargedNumbers,
    ledgerCount,
    membersLoading,
  ]);
  const panelMeta = ROLE_PANEL_META[userRole] || ROLE_PANEL_META.admin;
  const [openGroups, setOpenGroups] = useState(() => new Set());

  // La pestaña activa vive en la URL (/panel/:tab); perfiles en /panel/members|:staff/:id
  // Subtabs de contabilidad: /panel/accounting?sub=cash
  const { tab: routeTab, memberId: routeEntityId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab = routeTab && permittedTabs.includes(routeTab) ? routeTab : permittedTabs[0] || 'dashboard';
  const accountingSubTabFocus = activeTab === 'accounting'
    ? (searchParams.get('sub') || (userRole === 'cashier' ? 'cash' : null))
    : null;

  const goToTab = (tabKey, focus = null) => {
    if (tabKey === 'concessions') {
      navigate('/concesiones');
      return;
    }
    if (tabKey === 'qr_gate') {
      navigate('/acceso');
      return;
    }
    if (tabKey === 'pool') {
      navigate('/pileta');
      return;
    }
    if (tabKey === 'pool_gate') {
      navigate('/entrada-pileta');
      return;
    }
    if (tabKey === 'accounting') {
      const nextFocus = focus || (userRole === 'cashier' ? 'cash' : null);
      if (nextFocus) {
        navigate(`/panel/accounting?sub=${encodeURIComponent(nextFocus)}`);
      } else {
        navigate('/panel/accounting');
      }
      return;
    }
    navigate(`/panel/${tabKey}`);
  };
  const setActiveTab = (tabKey) => goToTab(tabKey);
  const showConcessionsTab = canAccessConcessions(userRole) || (user?.roles || []).some((r) => canAccessConcessions(r.roleKey || r));
  const showQrGateTab = canAccessQrGate(userRole) || (user?.roles || []).some((r) => canAccessQrGate(r.roleKey || r));

  const navGroups = useMemo(() => (
    [
      {
        id: 'ops',
        label: 'Operación',
        tabs: [
          { key: 'members', icon: Users, label: 'Socios' },
          { key: 'dues', icon: ShieldAlert, label: 'Cuotas' },
          { key: 'bookings', icon: Calendar, label: 'Reservas' },
          { key: 'access', icon: DoorOpen, label: 'Ingresos' },
          { key: 'qr_gate', icon: QrCode, label: 'Acceso QR' },
          { key: 'pool_gate', icon: TicketCheck, label: 'Entrada pileta' },
          { key: 'pool', icon: Waves, label: 'Pileta' },
        ],
      },
      {
        id: 'club',
        label: 'Club',
        tabs: [
          { key: 'disciplines', icon: Trophy, label: 'Disciplinas' },
          { key: 'events', icon: PartyPopper, label: 'Fiestas' },
          { key: 'news', icon: Newspaper, label: 'Revista' },
          { key: 'surveys', icon: Radio, label: 'Encuestas' },
        ],
      },
      {
        id: 'mgmt',
        label: 'Gestión',
        tabs: [
          { key: 'concessions', icon: Store, label: 'Concesiones' },
          {
            key: 'accounting',
            icon: userRole === 'cashier' ? DollarSign : BookOpen,
            label: userRole === 'cashier' ? 'Caja' : 'Contabilidad',
          },
          { key: 'staff', icon: ClipboardList, label: 'Personal' },
          { key: 'reports', icon: FileSpreadsheet, label: 'Reportes' },
        ],
      },
      {
        id: 'care',
        label: 'Atención',
        tabs: [
          { key: 'alerts', icon: BellRing, label: 'Alertas' },
          { key: 'claims', icon: MessageSquare, label: 'Reclamos' },
          { key: 'messaging', icon: Phone, label: 'Mensajería' },
        ],
      },
      {
        id: 'admin',
        label: 'Administración',
        tabs: [
          { key: 'teachers', icon: GraduationCap, label: 'Profesores' },
          { key: 'system', icon: Settings, label: 'Usuarios y altas' },
        ],
      },
      {
        id: 'sys',
        label: 'Sistema',
        tabs: [
          { key: 'migration', icon: Database, label: 'Migración' },
        ],
      },
    ]
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter((tab) => {
          if (tab.key === 'concessions') return showConcessionsTab;
          if (tab.key === 'qr_gate') return showQrGateTab;
          if (tab.key === 'pool_gate') return permittedTabs.includes('pool');
          return permittedTabs.includes(tab.key);
        }),
      }))
      .filter((group) => group.tabs.length > 0)
  ), [permittedTabs, showConcessionsTab, showQrGateTab, userRole]);

  useEffect(() => {
    const parent = navGroups.find((g) => g.tabs.some((t) => t.key === activeTab));
    if (!parent) return;
    setOpenGroups((prev) => {
      if (prev.has(parent.id)) return prev;
      const next = new Set(prev);
      next.add(parent.id);
      return next;
    });
  }, [activeTab, navGroups]);

  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const [fetchedProfile, setFetchedProfile] = useState(null);
  const [profileLookupDone, setProfileLookupDone] = useState(false);

  useEffect(() => {
    if (activeTab !== 'members' || !routeEntityId) {
      setFetchedProfile(null);
      setProfileLookupDone(true);
      return undefined;
    }
    setProfileLookupDone(false);
    const local = findMemberForProfile(members, routeEntityId);
    if (local && local.recordScope !== 'list') {
      setFetchedProfile(local);
      setProfileLookupDone(true);
      return undefined;
    }
    let cancelled = false;
    repos.getMemberByNumber(routeEntityId, { withPayments: true })
      .then((row) => {
        if (cancelled) return;
        if (row) {
          setFetchedProfile(row);
          setMembers?.((prev) => {
            const list = prev || [];
            const idx = list.findIndex((m) => findMemberForProfile([m], row.memberId));
            if (idx < 0) return [row, ...list];
            const next = list.slice();
            next[idx] = { ...list[idx], ...row, recordScope: 'full' };
            return next;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProfileLookupDone(true);
      });
    return () => { cancelled = true; };
  }, [activeTab, routeEntityId]);

  const profileMember = activeTab === 'members' && routeEntityId
    ? findMemberForProfile(members, routeEntityId) || fetchedProfile
    : null;
  const profileStaff = activeTab === 'staff' && routeEntityId
    ? staffMembers.find((e) => e.id === routeEntityId) || null
    : null;

  // --- CÁLCULOS CONTABLES DINÁMICOS PARA MÉTRICAS ERP ---
  const getAccountBalance = (accountName) => {
    const accountId = resolveAccountId(chartOfAccounts, accountName);
    if (!accountId) return 0;
    return domainAccountBalance(accountId, journalEntries || [], chartOfAccounts);
  };

  const getCategoryTotal = (accountsArray) => {
    return accountsArray.reduce((sum, acc) => sum + getAccountBalance(acc), 0);
  };

  const journalCash = getCategoryTotal(['Caja General', 'Caja Cantina', 'Banco Nación']);
  const totalPasivos = getCategoryTotal(['Proveedores Hípicos', 'Sueldos a Pagar', 'Impuestos Pendientes']);
  const totalPatrimonioNetoBase = getCategoryTotal(['Capital Social', 'Resultados Acumulados']);

  const totalIngresos = getCategoryTotal(['Cuotas Sociales', 'Reservas e Instalaciones', 'Concesión Gastronómica', 'Eventos y Fiestas']);
  const totalGastos = getCategoryTotal(['Sueldos y Jornales', 'Mantenimiento de Canchas', 'Alimento Equino', 'Servicios e Insumos']);
  const journalUtilidad = totalIngresos - totalGastos;
  const lilaCards = lilaMetrics.cards || {};
  const clubFinance = useMemo(
    () => composeClubFinance({
      lila: lilaMetrics.money,
      lilaCards,
      members,
      journalEntries,
      chartOfAccounts,
      feePeriods: erp.feePeriods || [],
      today: todayISODateAR(),
    }),
    [lilaMetrics.money, lilaCards, members, journalEntries, chartOfAccounts, erp.feePeriods],
  );
  const lilaMoney = clubFinance || lilaMetrics.money;
  const lilaMonthLabel = monthLabelFromIso(lilaCards.periodTo || lilaMoney?.periodTo);
  const lilaAsOfLabel = formatIsoDateAR(lilaCards.asOf || lilaMoney?.periodTo);
  const addedSinceHandoff = Boolean(
    lilaMoney?.added?.recaudado
    || lilaMoney?.added?.liquidado
    || lilaMoney?.added?.cash
    || lilaMoney?.added?.income
    || lilaMoney?.added?.expenses,
  );
  const hasLilaMonth = Boolean(lilaCards.totalIncome || lilaCards.totalExpenses || lilaMoney?.income);
  const totalActivos = lilaMoney?.cash || lilaCards.closingCash || journalCash;
  const utilidadNeta = lilaMoney?.result != null
    ? lilaMoney.result
    : (hasLilaMonth
      ? (Number(lilaCards.totalIncome) || 0) - (Number(lilaCards.totalExpenses) || 0)
      : journalUtilidad);
  const totalPatrimonioNetoTotal = totalPatrimonioNetoBase + utilidadNeta;

  const liveTitulares = useMemo(
    () => (members || []).filter((member) => isLiveMember(member) && isTitularMember(member)),
    [members],
  );
  const totalMembers = liveTitulares.length;
  const padronReady = !membersLoading && members.length > 0;
  const padronProgressLabel = membersLoading && membersProgress?.total
    ? `Cargando ${membersProgress.loaded.toLocaleString('es-AR')} de ${membersProgress.total.toLocaleString('es-AR')}…`
    : (membersLoading ? 'Cargando detalle del padrón…' : 'Membresías titulares activas');
  const activeBookingsCount = reservations.filter(res => res.status === 'confirmed').length;
  const pendingBookingsCount = reservations.filter(res => res.status === 'pending').length;

  const paidMembers = liveTitulares.filter((m) => (Number(m.outstandingBalance) || 0) === 0).length;
  const overdueMembers = getOverdueMembers(members);
  const overdueMembersCount = overdueMembers.length;
  const upcomingDuesCount = getUpcomingDuesMembers(members, { withinDays: 15 }).length;
  const paymentCollectionRate = lilaMoney
    ? lilaMoney.rate
    : (liveTitulares.length
      ? Math.round((paidMembers / liveTitulares.length) * 100)
      : 0);
  const totalOutstanding = liveTitulares.reduce(
    (sum, member) => sum + Math.max(0, Number(member.outstandingBalance) || 0),
    0,
  );

  // Indicadores operativos para dashboards por rol
  const totalCashOnHand = totalActivos;
  const pendingClaimsCount = claims.filter(c => c.status !== 'resolved').length;
  const activeStaffCount = staffMembers.filter(s => s.status === 'active').length;

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="fade-in admin-shell">
      <style>{`
        /* Animaciones del Scanner QR */
        .scanner-visualizer {
          position: relative;
          width: 100%;
          height: 250px;
          border-radius: 12px;
          background: #020804;
          border: 2px solid var(--primary-gold);
          box-shadow: 0 0 15px rgba(var(--primary-gold-rgb), 0.2);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .scanner-beam {
          position: absolute;
          width: 100%;
          height: 3px;
          background: linear-gradient(to right, transparent, var(--primary-gold), transparent);
          box-shadow: 0 0 8px var(--primary-gold);
          animation: scanVertical 2s linear infinite;
        }
        @keyframes scanVertical {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
        .led-indicator {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 8px currentColor;
        }
        .led-green {
          background-color: var(--emerald-accent);
          color: var(--emerald-accent);
          animation: pulseLed 1s infinite alternate;
        }
        .led-red {
          background-color: #ef4444;
          color: #ef4444;
          animation: pulseLed 0.5s infinite alternate;
        }
        .led-grey {
          background-color: #6b7280;
          color: #6b7280;
        }
        @keyframes pulseLed {
          from { opacity: 0.5; box-shadow: 0 0 2px currentColor; }
          to { opacity: 1; box-shadow: 0 0 12px currentColor; }
        }

        /* Consola de terminal para migración */
        .terminal-box {
          background: #000;
          border: 1px solid #1f2937;
          border-radius: 8px;
          padding: 1rem;
          font-family: 'Courier New', Courier, monospace;
          color: var(--emerald-accent);
          min-height: 200px;
          max-height: 320px;
          overflow-y: auto;
          box-shadow: inset 0 0 10px rgba(0,0,0,0.8);
          font-size: 0.85rem;
          line-height: 1.4;
        }

        /* Progress bar reports */
        .progress-bar-container {
          background: rgba(255,255,255,0.05);
          border-radius: 6px;
          height: 12px;
          overflow: hidden;
          width: 100%;
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 6px;
          transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Sub-tabla Adherentes */
        .adherents-subtable-box {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border-glass);
          border-radius: 8px;
          padding: 1rem;
          margin-top: 0.5rem;
          animation: slideDownFast 0.25s ease-out;
        }
        @keyframes slideDownFast {
          from { opacity: 0; transform: translateY(-3px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .donut-chart {
          width: 140px;
          height: 140px;
          border-radius: 50%;
          position: relative;
          background: conic-gradient(
            var(--emerald-accent) 0% 60%,
            #eab308 60% 80%,
            #ef4444 80% 100%
          );
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .donut-hole {
          width: 90px;
          height: 90px;
          border-radius: 50%;
          background: var(--surface-bg);
          z-index: 2;
        }
      `}</style>

      <aside className="admin-rail" aria-label="Secciones del panel">
        <nav className="admin-rail-nav">
          {permittedTabs.includes('dashboard') && (
            <button
              type="button"
              className={`admin-rail-item${activeTab === 'dashboard' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
              aria-current={activeTab === 'dashboard' ? 'page' : undefined}
              title="Inicio"
            >
              <span className="admin-rail-icon" aria-hidden="true">
                <LayoutDashboard size={18} strokeWidth={activeTab === 'dashboard' ? 2.4 : 2} />
              </span>
              <span className="admin-rail-label">Inicio</span>
            </button>
          )}
          {permittedTabs.includes('jev') && (
            <button
              type="button"
              className={`admin-rail-item${activeTab === 'jev' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('jev')}
              aria-current={activeTab === 'jev' ? 'page' : undefined}
              title="Jev"
            >
              <span className="admin-rail-icon" aria-hidden="true">
                <ListOrdered size={18} strokeWidth={activeTab === 'jev' ? 2.4 : 2} />
              </span>
              <span className="admin-rail-label">Jev</span>
            </button>
          )}

          {navGroups.map((group) => {
            const GroupIcon = GROUP_ICONS[group.id] || LayoutDashboard;
            const isOpen = openGroups.has(group.id);
            const hasActive = group.tabs.some((t) => t.key === activeTab);
            return (
              <div
                key={group.id}
                className={`admin-rail-group${isOpen ? ' is-open' : ''}${hasActive ? ' has-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-rail-group-btn"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  title={group.label}
                >
                  <span className="admin-rail-icon" aria-hidden="true">
                    <GroupIcon size={18} strokeWidth={hasActive ? 2.4 : 2} />
                  </span>
                  <span className="admin-rail-label">{group.label}</span>
                  <ChevronRight size={14} className="admin-rail-chevron" aria-hidden="true" />
                </button>
                <div className="admin-rail-submenu" hidden={!isOpen}>
                  {group.tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={`admin-rail-item is-sub${isActive ? ' is-active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                        title={tab.label}
                      >
                        <span className="admin-rail-icon" aria-hidden="true">
                          <Icon size={16} strokeWidth={isActive ? 2.4 : 2} />
                        </span>
                        <span className="admin-rail-label">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="admin-main">
      {/* Cabecera solo fuera del Inicio (el dashboard ya trae su propia intro) */}
      {activeTab !== 'dashboard' && activeTab !== 'events' && activeTab !== 'accounting' && activeTab !== 'jev' && (
        <div className="page-header">
          <div>
            <h1 className="page-title">{panelMeta.title}</h1>
            <p className="page-subtitle">{panelMeta.subtitle}</p>
          </div>
        </div>
      )}

      {/* Tarjetas de métricas solo en Inicio */}
      {activeTab === 'dashboard' && (
      <div className="admin-metrics">
        {(() => {
          const recaudacionValue = (lilaMoney || padronReady) ? `${paymentCollectionRate}%` : '…';
          const recaudacionSub = lilaMoney
            ? `${formatCurrency(lilaMoney.recaudado)} de ${formatCurrency(lilaMoney.liquidado)}${addedSinceHandoff ? ' · LILA + club' : ''}`
            : (padronReady
              ? `Pendiente: ${formatCurrency(totalOutstanding)}`
              : 'Se calcula al terminar el padrón');
          const cajaSub = addedSinceHandoff
            ? `LILA al ${lilaAsOfLabel || '30/09'} + movimientos desde el 1/10`
            : (lilaAsOfLabel ? `Corte al ${lilaAsOfLabel}` : 'Caja, cantina y bancos');
          const resultadoSub = addedSinceHandoff
            ? `Ingresos ${formatCurrency(lilaMoney.income)} · Gastos ${formatCurrency(lilaMoney.expenses)} · LILA + club`
            : (hasLilaMonth
              ? (lilaCards.totalExpenses
                ? `Ingresos ${formatCurrency(lilaCards.totalIncome)} · Gastos ${formatCurrency(lilaCards.totalExpenses)}`
                : `Ingresos de ${lilaMonthLabel}`)
              : `Diario · ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`);
          const metricsByRole = {
            staff: [
              { icon: <Calendar size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Reservas Activas', value: activeBookingsCount, valueColor: 'var(--emerald-accent)', sub: 'Turnos confirmados de canchas' },
              { icon: <Clock size={20} />, bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', title: 'Reservas Pendientes', value: pendingBookingsCount, valueColor: '#f59e0b', sub: 'A la espera de confirmación' },
              { icon: <MessageSquare size={20} />, bg: 'rgba(var(--primary-gold-rgb), 0.1)', color: 'var(--primary-gold)', title: 'Reclamos Abiertos', value: pendingClaimsCount, valueColor: 'var(--primary-gold)', sub: 'Pedidos de socios sin resolver' },
              { icon: <ClipboardList size={20} />, bg: 'rgba(var(--primary-gold-rgb), 0.1)', color: 'var(--primary-gold)', title: 'Personal en Servicio', value: activeStaffCount, sub: 'Empleados activos hoy' },
            ],
            cashier: [
              { icon: <DollarSign size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Caja y bancos', value: formatCurrency(totalCashOnHand), valueColor: 'var(--emerald-accent)', compact: true, sub: cajaSub },
              { icon: <Check size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Recaudación Cuotas', value: recaudacionValue, valueColor: 'var(--emerald-accent)', sub: lilaMoney ? recaudacionSub : `${paidMembers} de ${totalMembers} socios al día` },
              { icon: <ShieldAlert size={20} />, bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', title: 'Deuda Pendiente', value: formatCurrency(totalOutstanding), valueColor: '#f59e0b', compact: true, sub: 'Titulares activos a cobrar' },
              { icon: <Users size={20} />, bg: 'rgba(var(--primary-gold-rgb), 0.1)', color: 'var(--primary-gold)', title: 'Padrón Social', value: totalMembers, sub: padronProgressLabel },
            ],
            accountant: [
              { icon: <CreditCard size={20} />, bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', title: 'Caja y bancos', value: formatCurrency(totalActivos), compact: true, sub: cajaSub },
              { icon: <BookOpen size={20} />, bg: 'rgba(var(--primary-gold-rgb), 0.1)', color: 'var(--primary-gold)', title: 'Patrimonio Neto', value: formatCurrency(totalPatrimonioNetoTotal), compact: true, sub: 'Incluye resultado del mes' },
              { icon: <Activity size={20} />, bg: utilidadNeta >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', title: hasLilaMonth ? 'Resultado del mes' : 'Resultado del ejercicio', value: formatCurrency(utilidadNeta), valueColor: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', compact: true, sub: resultadoSub },
              { icon: <DollarSign size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Recaudación Cuotas', value: recaudacionValue, valueColor: 'var(--emerald-accent)', sub: recaudacionSub },
            ],
            admin: [
              { icon: <Users size={20} />, bg: 'rgba(var(--primary-gold-rgb), 0.1)', color: 'var(--primary-gold)', title: 'Padrón Social', value: totalMembers, sub: padronProgressLabel },
              { icon: <DollarSign size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Recaudación Cuotas', value: recaudacionValue, valueColor: 'var(--emerald-accent)', sub: recaudacionSub },
              {
                icon: <ShieldAlert size={20} />,
                bg: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                title: 'Cuotas Vencidas',
                value: overdueMembersCount,
                valueColor: '#ef4444',
                sub: `${formatCurrency(totalOutstanding)} · ${upcomingDuesCount} a vencer`,
                alert: true,
                onClick: () => setActiveTab('dues'),
              },
              { icon: <CreditCard size={20} />, bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', title: 'Caja y bancos', value: formatCurrency(totalActivos), compact: true, sub: cajaSub },
              { icon: <Activity size={20} />, bg: utilidadNeta >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', title: hasLilaMonth ? 'Resultado del mes' : 'Utilidad del ejercicio', value: formatCurrency(utilidadNeta), valueColor: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', compact: true, sub: resultadoSub },
            ],
          };
          const cards = metricsByRole[userRole] || metricsByRole.admin;
          return cards.map((card, i) => (
            <div
              key={i}
              role={card.onClick ? 'button' : undefined}
              tabIndex={card.onClick ? 0 : undefined}
              onClick={card.onClick}
              onKeyDown={card.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onClick(); } } : undefined}
              className={`glass-card stat-widget${card.alert ? ' stat-widget-alert' : ''}`}
              style={{
                ...(card.alert ? {
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  background: 'rgba(239, 68, 68, 0.08)',
                  boxShadow: '0 0 0 1px rgba(239, 68, 68, 0.12), 0 8px 24px rgba(239, 68, 68, 0.12)',
                } : {}),
                ...(card.onClick ? { cursor: 'pointer' } : {}),
              }}
              title={card.onClick ? 'Ver detalle de cuotas' : undefined}
            >
              <div className="stat-icon" style={{ background: card.bg, color: card.color }}>
                {card.icon}
              </div>
              <div className="stat-info">
                <h4 style={card.alert ? { color: '#ef4444', marginBottom: 4 } : undefined}>
                  {card.title}
                </h4>
                <div className="stat-value" style={{ ...(card.valueColor ? { color: card.valueColor } : {}), ...(card.compact ? { fontSize: '1.2rem', fontWeight: '700', marginTop: '0.2rem' } : {}) }}>
                  {card.value}
                </div>
                <p style={{ fontSize: '0.75rem', color: card.alert ? '#fca5a5' : 'var(--text-secondary)', lineHeight: 1.35 }}>{card.sub}</p>
              </div>
            </div>
          ));
        })()}
      </div>
      )}

      {/* --- CONTENIDO DE CADA TAB --- */}

      {activeTab === 'dashboard' && (
        <AdminDashboardTab
          userRole={userRole}
          userName={user?.fullName || ROLE_LABELS[userRole] || ''}
          permittedTabs={permittedTabs}
          goToTab={goToTab}
          members={members}
          reservations={reservations}
          claims={claims}
          messages={messages}
          entryLogs={entryLogs}
          surveys={surveys}
          staffMembers={staffMembers}
          staffHrRecords={staffHrRecords}
          clubEvents={erp.clubEvents || []}
          alerts={erp.alerts || []}
          alertAcks={erp.alertAcks || []}
          onAckAlert={(alert) => erp.ackAlert(alert, user?.id || 'local-user')}
          latestNews={latestNews}
          isZondaActive={isZondaActive}
          tierCatalog={tierCatalog}
          totalMembers={totalMembers}
          paymentCollectionRate={paymentCollectionRate}
          totalActivos={totalActivos}
          totalIngresos={totalIngresos}
          overdueMembersCount={overdueMembersCount}
          upcomingDuesCount={upcomingDuesCount}
          totalOutstanding={totalOutstanding}
          pendingClaimsCount={pendingClaimsCount}
          activeBookingsCount={activeBookingsCount}
          pendingBookingsCount={pendingBookingsCount}
          formatCurrency={formatCurrency}
          getAccountBalance={getAccountBalance}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          feePeriods={erp.feePeriods || []}
          poolAccesses={poolAccesses}
          cashSessions={erp.cashSessions || []}
          cashRegisters={erp.cashRegisters || []}
          onOpenDayCash={erp.openPoolDayCash}
          registeredUsersCount={registeredUsersCount}
          membershipApplications={membershipApplications}
          portalAccessRequests={portalAccessRequests}
          jevReview={clubReview}
        />
      )}

      {activeTab === 'jev' && (
        <JevReviewTab
          review={clubReview}
          permittedTabs={permittedTabs}
          showConcessions={showConcessionsTab}
          goToTab={goToTab}
          members={members}
        />
      )}

      {activeTab === 'dues' && (
        <CuotasPanel
          initialView={searchParams.get('vista') === 'saldos' ? 'balances' : 'hub'}
          members={members}
          setMembers={setMembers}
          feePeriods={erp.feePeriods}
          onUpsertFeePeriods={erp.setFeePeriodsList}
          onPersistFeePeriod={erp.persistFeePeriod}
          collectionImports={erp.memberCollectionImports}
          onImportCollections={erp.importMemberCollections}
          onDeleteCollectionImport={erp.deleteMemberCollectionImport}
          feeChartAccounts={erp.feeChartAccounts}
          onUpsertFeeChartAccount={erp.upsertFeeChartAccountRecord}
          onDeleteFeeChartAccount={erp.deleteFeeChartAccountRecord}
          memberAccountEntries={erp.memberAccountEntries}
          onUpsertMemberAccountEntry={erp.upsertMemberAccountEntryRecord}
          onDeleteMemberAccountEntry={erp.deleteMemberAccountEntryRecord}
          reservations={reservations}
          onImputeReservation={(r) => {
            if (!setReservations || !(r?.id || r?.accessinId)) return;
            setReservations((prev) => (prev || []).map((row) => {
              const same = (r.id && row.id === r.id)
                || (r.accessinId && row.accessinId === r.accessinId);
              if (!same) return row;
              return { ...row, imputed: true, feeImputed: true, imputedAt: new Date().toISOString() };
            }));
          }}
          addJournalEntry={addJournalEntry}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          formatCurrency={formatCurrency}
          tierCatalog={tierCatalog}
        />
      )}

      {activeTab === 'members' && (
        routeEntityId && !profileMember && (membersLoading || !profileLookupDone) ? (
          <article className="glass-card fade-in">
            <p className="ops-muted" style={{ margin: 0 }}>Cargando ficha del socio…</p>
          </article>
        ) : routeEntityId ? (
          <MemberProfilePanel
            member={profileMember}
            members={members}
            onBack={() => navigate('/panel/members')}
            onOpenMember={(id) => navigate(`/panel/members/${id}`)}
            formatCurrency={formatCurrency}
            journalEntries={journalEntries}
            entryLogs={entryLogs}
            reservations={reservations}
            claims={claims}
            messages={messages}
            tierCatalog={tierCatalog}
            disciplineCatalog={disciplineCatalog}
            updateMember={updateMember}
            setMembers={setMembers}
            addJournalEntry={addJournalEntry}
            onAccountEntry={erp.upsertMemberAccountEntryRecord}
            onSendMessage={sendMessage}
          />
        ) : (
          <MembersTab
            members={members}
            membersCount={membersCount}
            membersLoading={membersLoading}
            membersProgress={membersProgress}
            setMembers={setMembers}
            addJournalEntry={addJournalEntry}
            onAccountEntry={erp.upsertMemberAccountEntryRecord}
            formatCurrency={formatCurrency}
            onOpenProfile={(id) => navigate(`/panel/members/${id}`)}
            disciplineOptions={(disciplineCatalog || []).filter((d) => d.isActive !== false).map((d) => d.name)}
            tierCatalog={tierCatalog}
            setTierCatalog={setTierCatalog}
            updateMember={updateMember}
            membershipApplications={membershipApplications}
            setMembershipApplications={setMembershipApplications}
            portalAccessRequests={portalAccessRequests}
            setPortalAccessRequests={setPortalAccessRequests}
            onSendMessage={sendMessage}
          />
        )
      )}

      {activeTab === 'bookings' && (
        <BookingsTab reservations={reservations} setReservations={setReservations} />
      )}

      {activeTab === 'disciplines' && (
        <DisciplinesTab
          members={members}
          setMembers={setMembers}
          reservations={reservations}
          staffMembers={staffMembers}
          catalog={disciplineCatalog}
          setCatalog={setDisciplineCatalog}
          onOpenMember={(id) => navigate(`/panel/members/${id}`)}
        />
      )}

      {activeTab === 'pool' && (
        <PoolTab
          members={members}
          setMembers={setMembers}
          updateMember={updateMember}
          formatCurrency={formatCurrency}
          recordPoolCanon={recordPoolCanon}
          cashSessions={erp.cashSessions || []}
          cashRegisters={erp.cashRegisters || []}
          onOpenDayCash={erp.openPoolDayCash}
          poolAccesses={poolAccesses}
          setPoolAccesses={setPoolAccesses}
          setEntryLogs={setEntryLogs}
          poolSettings={poolSettings}
          setPoolSettings={setPoolSettings}
        />
      )}

      {activeTab === 'access' && (
        <AccessLogsTab
          entryLogs={entryLogs}
          poolAccesses={poolAccesses}
          onOpenGate={() => navigate('/acceso')}
        />
      )}

      {activeTab === 'accounting' && (
        <AccountingTab
          initialSubTab={accountingSubTabFocus}
          journalEntries={journalEntries}
          addJournalEntry={addJournalEntry}
          chartOfAccounts={chartOfAccounts}
          setChartOfAccounts={erp.setChartOfAccounts}
          upsertChartAccount={erp.upsertChartAccount}
          cashRegisters={erp.cashRegisters}
          cashSessions={erp.cashSessions}
          cashMovements={erp.cashMovements}
          accessinCashMovements={erp.accessinCashMovements}
          accessinCheques={erp.accessinCheques}
          accessinCobranzas={erp.accessinCobranzas}
          accessinSupplierPayments={erp.accessinSupplierPayments}
          accessinBankAccounts={erp.accessinBankAccounts}
          upsertBankAccount={erp.upsertAccessinBankAccount}
          deleteBankAccount={erp.deleteAccessinBankAccount}
          addBankAccountEntry={erp.addAccessinBankAccountEntry}
          openRegister={erp.openRegister}
          closeRegister={erp.closeRegister}
          addCashMovement={erp.addCashMovement}
          transferCash={erp.transferCash}
          expenses={erp.expenses}
          submitExpense={erp.submitExpense}
          setExpenseApproved={erp.setExpenseApproved}
          setExpenseRejected={erp.setExpenseRejected}
          setExpensePaid={erp.setExpensePaid}
          suppliers={erp.suppliers}
          upsertSupplier={erp.upsertSupplier}
          toggleSupplierStatus={erp.toggleSupplierStatus}
          paymentImports={erp.supplierPaymentImports}
          onImportSupplierPayments={erp.importSupplierPayments}
          onCreateSupplierEntry={erp.createSupplierEntry}
          otherIncomes={erp.otherIncomes}
          onCreateOtherIncome={erp.createOtherIncomeRecord}
          interestGenerators={erp.interestGenerators}
          interestRuns={erp.interestRuns}
          onUpsertInterestGenerator={erp.upsertInterestGeneratorRecord}
          onDeleteInterestGenerator={erp.deleteInterestGeneratorRecord}
          onRecordInterestRun={erp.recordInterestRun}
          onCancelInterestRun={erp.cancelInterestRunRecord}
          setMembers={setMembers}
          expenseImports={erp.expenseImports}
          onImportExpenses={erp.importExpenses}
          retenciones={erp.retenciones}
          upsertRetencion={erp.upsertRetencion}
          members={members}
          unidentifiedCollections={erp.unidentifiedCollections}
          upsertUnidentifiedCollection={erp.upsertUnidentifiedCollection}
          galiciaDebits={erp.galiciaDebits}
          upsertGaliciaDebit={erp.upsertGaliciaDebit}
          fixedExpenses={erp.fixedExpenses}
          addFixedExpense={erp.addFixedExpense}
          toggleFixedExpense={erp.toggleFixedExpense}
          fixedDiscounts={erp.fixedDiscounts}
          addFixedDiscount={erp.addFixedDiscount}
          toggleFixedDiscount={erp.toggleFixedDiscount}
          discounts={erp.discounts}
          onUpsertDiscount={erp.upsertDiscountRecord}
          onDeleteDiscount={erp.deleteDiscountRecord}
          feeExpenses={erp.feeExpenses}
          onUpsertFeeExpense={erp.upsertFeeExpenseRecord}
          onDeleteFeeExpense={erp.deleteFeeExpenseRecord}
          paymentOrders={erp.paymentOrders}
          upsertPaymentOrder={erp.upsertPaymentOrder}
          accountingReports={erp.accountingReports}
          onRecordAccountingReport={erp.recordAccountingReport}
        />
      )}

      {activeTab === 'staff' && (
        routeEntityId ? (
          <StaffProfilePanel
            employee={profileStaff}
            onBack={() => navigate('/panel/staff')}
            hrRecords={staffHrRecords}
          />
        ) : (
          <StaffTab
            staffMembers={staffMembers}
            setStaffMembers={setStaffMembers}
            onOpenProfile={(id) => navigate(`/panel/staff/${id}`)}
            hrRecords={staffHrRecords}
            setHrRecords={setStaffHrRecords}
          />
        )
      )}

      {activeTab === 'teachers' && (
        <TeachersTab
          userRole={userRole}
          disciplineCatalog={disciplineCatalog}
        />
      )}

      {activeTab === 'events' && (
        <ClubEventsPanel
          clubEvents={erp.clubEvents || []}
          eventRegistrations={erp.eventRegistrations || []}
          members={members}
          addClubEvent={erp.addClubEvent}
          registerMemberToEvent={erp.registerMemberToEvent}
          revokeEventRegistration={erp.revokeEventRegistration}
        />
      )}

      {activeTab === 'alerts' && (
        <div className="glass-card fade-in" style={{ padding: '1.25rem' }}>
          <AlertsPanel
            alerts={erp.alerts || []}
            publishAlert={erp.publishAlert}
            deactivateAlert={erp.deactivateAlert}
          />
        </div>
      )}

      {activeTab === 'claims' && (
        <ClaimsTab
          claims={claims}
          setClaims={setClaims}
          staffMembers={staffMembers}
          setStaffMembers={setStaffMembers}
        />
      )}

      {activeTab === 'messaging' && (
        <MessagingTab
          members={members}
          messages={messages}
          setMessages={setMessages}
          formatCurrency={formatCurrency}
          onRefresh={refreshMessages}
          onSendMessage={sendMessage}
        />
      )}

      {activeTab === 'news' && (
        <NewsCmsTab
          newsList={latestNews}
          setNewsList={setNewsList}
          authorName={user?.fullName || ROLE_LABELS[userRole] || ''}
        />
      )}

      {activeTab === 'reports' && (
        <ReportsTab
          members={members}
          reservations={reservations}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          staffMembers={staffMembers}
          claims={claims}
          messages={messages}
          entryLogs={entryLogs}
          surveys={surveys}
          setMembers={setMembers}
          setReservations={setReservations}
          setJournalEntries={setJournalEntries}
          setStaffMembers={setStaffMembers}
          setClaims={setClaims}
          setMessages={setMessages}
          setEntryLogs={setEntryLogs}
          setSurveys={setSurveys}
          formatCurrency={formatCurrency}
          getAccountBalance={getAccountBalance}
          totalActivos={totalActivos}
          totalPasivos={totalPasivos}
          totalPatrimonioNetoTotal={totalPatrimonioNetoTotal}
          totalIngresos={totalIngresos}
          totalGastos={totalGastos}
          utilidadNeta={utilidadNeta}
          expenses={erp.expenses || []}
          concessions={erp.concessions || []}
          clubEvents={erp.clubEvents || []}
          alerts={erp.alerts || []}
          cashRegisters={erp.cashRegisters || []}
          cashSessions={erp.cashSessions || []}
          canonPayments={erp.canonPayments || []}
          suppliers={erp.suppliers || []}
          retenciones={erp.retenciones || []}
          newsList={latestNews || []}
        />
      )}

      {activeTab === 'surveys' && (
        <SurveysTab surveys={surveys} setSurveys={setSurveys} />
      )}

      {activeTab === 'system' && (
        routeEntityId ? (
          <PortalUserProfilePanel
            profileId={routeEntityId}
            onBack={() => navigate('/panel/system')}
            onEdit={(p) => navigate('/panel/system', { state: { editProfileId: p.id } })}
          />
        ) : (
          <SystemAdminTab
            userRole={userRole}
            registeredUsersCount={registeredUsersCount}
            setRegisteredUsersCount={setRegisteredUsersCount}
          />
        )
      )}

      {activeTab === 'migration' && (
        <MigrationTab setMembers={setMembers} setReservations={setReservations} />
      )}

      {activeTab === 'bookings' && (
        <ClubFacilitiesPanel
          reservations={reservations}
          isZondaActive={isZondaActive}
          facilityCatalog={facilityCatalog}
          setFacilityCatalog={setFacilityCatalog}
        />
      )}
      </div>
    </div>
  );
}
