import { lazy, Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, ShieldAlert,
  BookOpen, Book, ClipboardList, MessageSquare, Phone, Wallet, PieChart,
  FileSpreadsheet, Radio, Database, BellRing, PartyPopper, Trophy, Store, DoorOpen, QrCode, Newspaper, CreditCard,
  LayoutDashboard, ChevronRight, Briefcase, Headset, Settings, SlidersHorizontal, Building2, Waves, GraduationCap, Sparkles, TicketCheck,
} from 'lucide-react';
import { DEFAULT_POOL_SETTINGS } from '../domain/pool/poolAccess';
import { DEFAULT_CHART_OF_ACCOUNTS, resolveAccountId } from '../domain/accounting/chartOfAccounts';
import { getAccountBalance as domainAccountBalance } from '../domain/accounting/journal';
import {
  allowedAdminTabsForRoles,
  canAccessConcessions,
  canAccessQrGate,
  canLiquidateDues,
  canManageMembers,
  canWriteMemberLedger,
  isAccountingBookSubtab,
  isAccountingReportSubtab,
  isAccountingTreasurySubtab,
  ROLE_LABELS,
  ROLE_PANEL_META,
} from '../domain/auth/roles';
import { keepPageAtTop, preventButtonScroll } from '../lib/scrollPage';
import { countOverdueMembers, getUpcomingDuesMembers } from '../domain/members/dues';
import { isLiveMember, isTitularMember, mergeMemberRecord } from '../domain/members/households';
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
import { composeClubFinance, financeFromMonthlySummary, financeFromSummary, lilaContabilidadFromSnapshots } from '../domain/accounting/opsFinanceSnapshot';
import { useSnapshotSeed } from '../hooks/useSnapshots';
import { todayISODateAR } from '../lib/arDate';

const AccountingTab = lazy(() => import('../components/AccountingTab'));
const StaffTab = lazy(() => import('../components/StaffTab'));
const AlertsPanel = lazy(() => import('../components/erp/AlertsPanel'));
const ClubEventsPanel = lazy(() => import('../components/erp/ClubEventsPanel'));
const AdminDashboardTab = lazy(() => import('../components/admin/AdminDashboardTab'));
const MembersTab = lazy(() => import('../components/admin/MembersTab'));
const MemberProfilePanel = lazy(() => import('../components/admin/MemberProfilePanel'));
const StaffProfilePanel = lazy(() => import('../components/admin/StaffProfilePanel'));
const BookingsTab = lazy(() => import('../components/admin/BookingsTab'));
const ClaimsTab = lazy(() => import('../components/admin/ClaimsTab'));
const MessagingTab = lazy(() => import('../components/admin/MessagingTab'));
const ReportsTab = lazy(() => import('../components/admin/ReportsTab'));
const SurveysTab = lazy(() => import('../components/admin/SurveysTab'));
const MigrationTab = lazy(() => import('../components/admin/MigrationTab'));
const SystemSettingsTab = lazy(() => import('../components/admin/SystemSettingsTab'));
const CuotasPanel = lazy(() => import('../components/erp/CuotasPanel'));
const DisciplinesTab = lazy(() => import('../components/admin/DisciplinesTab'));
const AccessLogsTab = lazy(() => import('../components/admin/AccessLogsTab'));
const ClubFacilitiesPanel = lazy(() => import('../components/admin/ClubFacilitiesPanel'));
const NewsCmsTab = lazy(() => import('../components/admin/NewsCmsTab'));
const SystemAdminTab = lazy(() => import('../components/admin/SystemAdminTab'));
const PortalUserProfilePanel = lazy(() => import('../components/admin/PortalUserProfilePanel'));
const TeachersTab = lazy(() => import('../components/admin/TeachersTab'));
const PoolTab = lazy(() => import('../components/admin/PoolTab'));
const JevReviewTab = lazy(() => import('../components/admin/JevReviewTab'));

const TAB_FALLBACK = (
  <article className="glass-card fade-in" style={{ padding: '1.25rem' }}>
    <p className="ops-muted" style={{ margin: 0 }}>Cargando módulo…</p>
  </article>
);

/** Prefetch de pestañas pesadas al pasar el mouse por el rail. */
const TAB_PREFETCH = {
  accounting: () => import('../components/AccountingTab'),
  books: () => import('../components/AccountingTab'),
  informes: () => import('../components/AccountingTab'),
  operation: () => import('../components/AccountingTab'),
  members: () => import('../components/admin/MembersTab'),
  dues: () => import('../components/erp/CuotasPanel'),
  dashboard: () => import('../components/admin/AdminDashboardTab'),
  reports: () => import('../components/admin/ReportsTab'),
  pool: () => import('../components/admin/PoolTab'),
  jev: () => import('../components/admin/JevReviewTab'),
};

const LILA_METRIC_SNAPSHOTS_LIGHT = [
  'accessinMonthlyBalance',
  'accessinMonthlyBalanceSummary',
  'accessinCashSnapshot',
];

const LILA_METRIC_SNAPSHOTS = [
  ...LILA_METRIC_SNAPSHOTS_LIGHT,
  'accessinDetailedCurrentAccounts',
  'accessinCobranzas',
];

function readLilaMetrics() {
  const monthly = monthlyBalanceSeed();
  const summary = monthlyBalanceSummarySeed();
  const summarySnapshot = summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT;
  const sections = summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS;
  const today = todayISODateAR();
  const currentMonth = financeFromMonthlySummary({
    snapshot: summarySnapshot,
    sections,
    today,
  });
  const latestCut = financeFromSummary({
    snapshot: summarySnapshot,
    sections,
  });
  const detailed = lilaContabilidadFromSnapshots({
    monthlySnapshot: monthly.ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
    detailedSnapshot: detailedCcSeed().ACCESSIN_DETAILED_CC_SNAPSHOT,
    cashSnapshot: cashSeed().ACCESSIN_CASH_SNAPSHOT,
    cobranzas: cobranzasSeed().ACCESSIN_COBRANZAS,
  });
  const summaryMoney = currentMonth || latestCut;
  return {
    money: summaryMoney || detailed,
    cards: monthlyBalanceCards(
      summaryMoney ? summarySnapshot : monthly.ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
    ),
  };
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
  admin: Building2,
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
  persistReservation,
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
  setIsZondaActive,
  updateMember = null,
  poolAccesses = [],
  setPoolAccesses,
  recordPoolCanon,
  poolSettings = DEFAULT_POOL_SETTINGS,
  setPoolSettings,
  clubSettings,
  setClubSettings,
  duesSettings,
  setDuesSettings,
  systemRules,
  setSystemRules,
  paymentPlans = [],
  setPaymentPlans,
  facilityCatalog = null,
  setFacilityCatalog = null,
}) {
  const { user } = useAuth();
  const chartOfAccounts = erp.chartOfAccounts || DEFAULT_CHART_OF_ACCOUNTS;
  const [ledgerCount, setLedgerCount] = useState(0);
  const roleSource = user?.roles?.length ? user.roles : userRole;
  const liquidateDues = canLiquidateDues(roleSource);
  const manageMembers = canManageMembers(roleSource);
  const writeMemberLedger = canWriteMemberLedger(roleSource);
  // Cobrar / pileta escriben saldo sin poder editar padrón (canEditMember).
  const memberWrite = (manageMembers || writeMemberLedger) ? updateMember : null;
  const memberSet = (manageMembers || writeMemberLedger) ? setMembers : null;
  const permittedTabs = allowedAdminTabsForRoles(roleSource);

  // La pestaña activa vive en la URL (/panel/:tab); perfiles en /panel/members|:staff/:id
  // Subtabs: /panel/accounting|books|informes|operation?sub=…
  const { tab: routeTab, memberId: routeEntityId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab = routeTab && permittedTabs.includes(routeTab) ? routeTab : permittedTabs[0] || 'dashboard';
  const accountingSubTabFocus = (
    activeTab === 'accounting'
    || activeTab === 'books'
    || activeTab === 'informes'
    || activeTab === 'operation'
  )
    ? (searchParams.get('sub') || (
      activeTab === 'operation' && (userRole === 'cashier' || userRole === 'gate_operator') ? 'cash' : null
    ))
    : null;

  // El inicio pinta con el resumen y la caja. Los cortes de varios MB entran después,
  // o al abrir JEV, para no trabar el primer render.
  const needClubReviewSeeds = activeTab === 'dashboard' || activeTab === 'jev';
  const [idleHeavy, setIdleHeavy] = useState(false);
  useEffect(() => {
    if (activeTab !== 'dashboard') return undefined;
    const arm = () => setIdleHeavy(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(arm, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(arm, 700);
    return () => window.clearTimeout(id);
  }, [activeTab]);
  const heavySeeds = activeTab === 'jev' || idleHeavy;
  const lilaMetrics = useSnapshotSeed(
    needClubReviewSeeds ? (heavySeeds ? LILA_METRIC_SNAPSHOTS : LILA_METRIC_SNAPSHOTS_LIGHT) : [],
    readLilaMetrics,
  );
  const movesSeed = useSnapshotSeed(needClubReviewSeeds ? ['societasMembershipMoves'] : [], membershipMovesSeed);
  const balancesSeed = useSnapshotSeed(
    heavySeeds && needClubReviewSeeds ? ['accessinCurrentAccountBalances'] : [],
    currentAccountBalancesSeed,
  );
  const feeDetailsSeed = useSnapshotSeed(
    heavySeeds && needClubReviewSeeds ? ['accessinFeeAccountDetails'] : [],
    feeAccountDetailsSeed,
  );

  const membersSettled = !membersLoading && (members?.length || 0) > 0;
  useEffect(() => {
    // Completa los meses de las cuentas de cuotas: es una escritura del que liquida. Para el
    // resto la base la rechaza, y reintentarla en cada batch del padrón solo hace ruido.
    if (!liquidateDues || !membersSettled || !erp.ensureProcessedFeeLedger) return;
    void erp.ensureProcessedFeeLedger(members);
  }, [liquidateDues, membersSettled, erp.ensureProcessedFeeLedger]);
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
    if (!needClubReviewSeeds) return [];
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
  }, [needClubReviewSeeds, feeDetailsSeed]);
  const deferredMembers = useDeferredValue(members);
  const clubReview = useMemo(() => {
    if (!needClubReviewSeeds) return null;
    return buildClubReview({
    members: deferredMembers,
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
    altas: movesSeed?.SOCIETAS_MEMBERSHIP_ALTAS || [],
    membershipMovesAsOf: movesSeed?.SOCIETAS_MEMBERSHIP_MOVES_AS_OF
      || movesSeed?.SOCIETAS_MEMBERSHIP_MOVES_SNAPSHOT?.asOf
      || '',
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
  });
  }, [
    needClubReviewSeeds,
    deferredMembers,
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

  useEffect(() => {
    if (userRole !== 'pool_operator' || routeTab) return;
    navigate('/entrada-pileta', { replace: true });
  }, [userRole, routeTab, navigate]);

  // Libros, Informes y Operación desprendidos de Contabilidad: redirige enlaces viejos.
  useEffect(() => {
    const sub = searchParams.get('sub');
    if (!sub) return;
    if (activeTab === 'accounting' && isAccountingBookSubtab(sub) && permittedTabs.includes('books')) {
      navigate(`/panel/books?sub=${encodeURIComponent(sub)}`, { replace: true });
      return;
    }
    if (activeTab === 'accounting' && isAccountingReportSubtab(sub) && permittedTabs.includes('informes')) {
      navigate(`/panel/informes?sub=${encodeURIComponent(sub)}`, { replace: true });
      return;
    }
    if (activeTab === 'accounting' && isAccountingTreasurySubtab(sub) && permittedTabs.includes('operation')) {
      navigate(`/panel/operation?sub=${encodeURIComponent(sub)}`, { replace: true });
      return;
    }
    if (activeTab === 'books' && !isAccountingBookSubtab(sub)) {
      if (isAccountingReportSubtab(sub) && permittedTabs.includes('informes')) {
        navigate(`/panel/informes?sub=${encodeURIComponent(sub)}`, { replace: true });
      } else if (isAccountingTreasurySubtab(sub) && permittedTabs.includes('operation')) {
        navigate(`/panel/operation?sub=${encodeURIComponent(sub)}`, { replace: true });
      } else if (permittedTabs.includes('accounting')) {
        navigate(`/panel/accounting?sub=${encodeURIComponent(sub)}`, { replace: true });
      }
      return;
    }
    if (activeTab === 'informes' && !isAccountingReportSubtab(sub)) {
      if (isAccountingBookSubtab(sub) && permittedTabs.includes('books')) {
        navigate(`/panel/books?sub=${encodeURIComponent(sub)}`, { replace: true });
      } else if (isAccountingTreasurySubtab(sub) && permittedTabs.includes('operation')) {
        navigate(`/panel/operation?sub=${encodeURIComponent(sub)}`, { replace: true });
      } else if (permittedTabs.includes('accounting')) {
        navigate(`/panel/accounting?sub=${encodeURIComponent(sub)}`, { replace: true });
      }
      return;
    }
    if (activeTab === 'operation' && !isAccountingTreasurySubtab(sub)) {
      if (isAccountingBookSubtab(sub) && permittedTabs.includes('books')) {
        navigate(`/panel/books?sub=${encodeURIComponent(sub)}`, { replace: true });
      } else if (isAccountingReportSubtab(sub) && permittedTabs.includes('informes')) {
        navigate(`/panel/informes?sub=${encodeURIComponent(sub)}`, { replace: true });
      } else if (permittedTabs.includes('accounting')) {
        navigate(`/panel/accounting?sub=${encodeURIComponent(sub)}`, { replace: true });
      }
    }
  }, [activeTab, searchParams, navigate, permittedTabs]);

  const prefetchTab = (tabKey) => {
    const load = TAB_PREFETCH[tabKey];
    if (load) void load();
  };

  const goToTab = (tabKey, focus = null) => {
    prefetchTab(tabKey);
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
      if (focus && isAccountingBookSubtab(focus)) {
        navigate(`/panel/books?sub=${encodeURIComponent(focus)}`);
        return;
      }
      if (focus && isAccountingReportSubtab(focus)) {
        navigate(`/panel/informes?sub=${encodeURIComponent(focus)}`);
        return;
      }
      if (focus && isAccountingTreasurySubtab(focus)) {
        navigate(`/panel/operation?sub=${encodeURIComponent(focus)}`);
        return;
      }
      if (focus) {
        navigate(`/panel/accounting?sub=${encodeURIComponent(focus)}`);
      } else {
        navigate('/panel/accounting');
      }
      return;
    }
    if (tabKey === 'books') {
      const nextFocus = focus && isAccountingBookSubtab(focus) ? focus : null;
      if (nextFocus) {
        navigate(`/panel/books?sub=${encodeURIComponent(nextFocus)}`);
      } else {
        navigate('/panel/books');
      }
      return;
    }
    if (tabKey === 'informes') {
      const nextFocus = focus && isAccountingReportSubtab(focus) ? focus : null;
      if (nextFocus) {
        navigate(`/panel/informes?sub=${encodeURIComponent(nextFocus)}`);
      } else {
        navigate('/panel/informes');
      }
      return;
    }
    if (tabKey === 'operation') {
      const nextFocus = focus && isAccountingTreasurySubtab(focus)
        ? focus
        : (userRole === 'cashier' || userRole === 'gate_operator'
          ? 'cash'
          : (userRole === 'admin' || userRole === 'admin_employee' ? 'debit_moves' : null));
      if (nextFocus) {
        navigate(`/panel/operation?sub=${encodeURIComponent(nextFocus)}`);
      } else {
        navigate('/panel/operation');
      }
      return;
    }
    navigate(`/panel/${tabKey}`);
  };
  const setActiveTab = (tabKey) => goToTab(tabKey);

  useLayoutEffect(() => {
    keepPageAtTop();
  }, [activeTab]);
  const showConcessionsTab = canAccessConcessions(userRole) || (user?.roles || []).some((r) => canAccessConcessions(r.roleKey || r));
  const showQrGateTab = canAccessQrGate(userRole) || (user?.roles || []).some((r) => canAccessQrGate(r.roleKey || r));

  const navGroups = useMemo(() => (
    [
      {
        id: 'ops',
        label: 'Operación',
        tabs: [
          { key: 'members', icon: Users, label: 'Socios' },
          { key: 'dues', icon: ShieldAlert, label: liquidateDues ? 'Cuotas' : 'Saldos' },
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
        ],
      },
      {
        id: 'mgmt',
        label: 'Gestión',
        tabs: [
          { key: 'concessions', icon: Store, label: 'Concesiones' },
          { key: 'accounting', icon: BookOpen, label: 'Contabilidad' },
          { key: 'books', icon: Book, label: 'Libros' },
          { key: 'informes', icon: PieChart, label: 'Informes' },
          {
            key: 'operation',
            icon: (userRole === 'cashier' || userRole === 'gate_operator')
              ? DollarSign
              : (userRole === 'admin' || userRole === 'admin_employee')
                ? CreditCard
                : Wallet,
            label: (userRole === 'cashier' || userRole === 'gate_operator')
              ? 'Caja'
              : (userRole === 'admin' || userRole === 'admin_employee')
                ? 'Débitos'
                : 'Operación',
          },
          { key: 'reports', icon: FileSpreadsheet, label: 'Reportes' },
        ],
      },
      {
        id: 'care',
        label: 'Comunicación',
        tabs: [
          { key: 'news', icon: Newspaper, label: 'Novedades' },
          { key: 'surveys', icon: Radio, label: 'Encuestas' },
          { key: 'alerts', icon: BellRing, label: 'Alertas' },
          { key: 'claims', icon: MessageSquare, label: 'Reclamos' },
          { key: 'messaging', icon: Phone, label: 'Mensajería' },
        ],
      },
      {
        id: 'admin',
        label: 'Administración',
        tabs: [
          { key: 'staff', icon: ClipboardList, label: 'Personal' },
          { key: 'teachers', icon: GraduationCap, label: 'Profesores' },
          { key: 'system', icon: Settings, label: 'Usuarios y altas' },
        ],
      },
      {
        id: 'sys',
        label: 'Sistema',
        tabs: [
          { key: 'settings', icon: SlidersHorizontal, label: 'Configuración' },
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
  ), [permittedTabs, showConcessionsTab, showQrGateTab, userRole, liquidateDues]);

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
    if (local?.recordScope === 'full') setFetchedProfile(local);
    let cancelled = false;
    repos.getMemberByNumber(routeEntityId, { withPayments: true })
      .then((row) => {
        if (cancelled) return;
        if (row) {
          const full = { ...row, recordScope: 'full' };
          setFetchedProfile(full);
          setMembers?.((prev) => {
            const list = prev || [];
            const idx = list.findIndex((m) => findMemberForProfile([m], row.memberId));
            if (idx < 0) return [full, ...list];
            const next = list.slice();
            next[idx] = mergeMemberRecord(list[idx], full);
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

  const listedProfile = activeTab === 'members' && routeEntityId
    ? findMemberForProfile(members, routeEntityId)
    : null;
  const profileMember = activeTab === 'members' && routeEntityId
    ? mergeMemberRecord(listedProfile, fetchedProfile) || listedProfile || fetchedProfile
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

  const journalCash = getCategoryTotal(['Caja General', 'Caja Cantina', 'Banco Nación', 'AMET']);
  const totalPasivos = getCategoryTotal(['Proveedores Hípicos', 'Sueldos a Pagar', 'Impuestos Pendientes']);
  const totalPatrimonioNetoBase = getCategoryTotal(['Capital Social', 'Resultados Acumulados']);

  const totalIngresos = getCategoryTotal(['Cuotas Sociales', 'Reservas e Instalaciones', 'Concesión Gastronómica', 'Eventos y Fiestas']);
  const totalGastos = getCategoryTotal(['Sueldos y Jornales', 'Mantenimiento de Canchas', 'Alimento Equino', 'Servicios e Insumos']);
  const journalUtilidad = totalIngresos - totalGastos;
  const lilaCards = needClubReviewSeeds ? (lilaMetrics.cards || {}) : {};
  const clubFinance = useMemo(() => {
    if (!needClubReviewSeeds) return null;
    return composeClubFinance({
      lila: lilaMetrics.money,
      lilaCards,
      members: deferredMembers,
      journalEntries,
      chartOfAccounts,
      feePeriods: erp.feePeriods || [],
      today: todayISODateAR(),
    });
  }, [needClubReviewSeeds, lilaMetrics.money, lilaCards, deferredMembers, journalEntries, chartOfAccounts, erp.feePeriods]);
  const lilaMoney = clubFinance || (needClubReviewSeeds ? lilaMetrics.money : null);
  const hasLilaMonth = Boolean(lilaCards.totalIncome || lilaCards.totalExpenses || lilaMoney?.income);
  const totalActivos = lilaMoney?.cash || lilaCards.closingCash || journalCash;
  const resultadoAcumulado = lilaMoney?.result != null
    ? lilaMoney.result
    : (hasLilaMonth
      ? (Number(lilaCards.totalIncome) || 0) - (Number(lilaCards.totalExpenses) || 0)
      : journalUtilidad);
  const totalPatrimonioNetoTotal = totalPatrimonioNetoBase + resultadoAcumulado;

  const liveTitulares = useMemo(
    () => (deferredMembers || []).filter((member) => isLiveMember(member) && isTitularMember(member)),
    [deferredMembers],
  );
  const totalMembers = liveTitulares.length;
  const activeBookingsCount = reservations.filter(res => res.status === 'confirmed').length;
  const pendingBookingsCount = reservations.filter(res => res.status === 'pending').length;

  const duesStatsReady = activeTab === 'dashboard' && (deferredMembers?.length || 0) > 0;
  const overdueMembersCount = useMemo(
    () => (duesStatsReady ? countOverdueMembers(deferredMembers) : 0),
    [duesStatsReady, deferredMembers],
  );
  const upcomingDuesCount = useMemo(
    () => (duesStatsReady ? getUpcomingDuesMembers(deferredMembers).length : 0),
    [duesStatsReady, deferredMembers],
  );
  const totalOutstanding = useMemo(
    () => liveTitulares.reduce(
      (sum, member) => sum + Math.max(0, Number(member.outstandingBalance) || 0),
      0,
    ),
    [liveTitulares],
  );

  const pendingClaimsCount = claims.filter(c => c.status !== 'resolved').length;

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="admin-shell">
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
        <div className="admin-rail-brand" aria-hidden="true">
          <span className="admin-rail-brand-mark" />
          <span className="admin-rail-brand-text">Panel</span>
        </div>
        <nav className="admin-rail-nav">
          <div className="admin-rail-pin">
            {permittedTabs.includes('dashboard') && (
              <button
                type="button"
                className={`admin-rail-item is-pin${activeTab === 'dashboard' ? ' is-active' : ''}`}
                onMouseDown={preventButtonScroll}
                onMouseEnter={() => prefetchTab('dashboard')}
                onFocus={() => prefetchTab('dashboard')}
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
                className={`admin-rail-item is-pin is-ai${activeTab === 'jev' ? ' is-active' : ''}`}
                onMouseDown={preventButtonScroll}
                onMouseEnter={() => prefetchTab('jev')}
                onFocus={() => prefetchTab('jev')}
                onClick={() => setActiveTab('jev')}
                aria-current={activeTab === 'jev' ? 'page' : undefined}
                title="IA Jockey"
                aria-label="IA Jockey"
              >
                <span className="admin-rail-icon" aria-hidden="true">
                  <Sparkles size={18} strokeWidth={activeTab === 'jev' ? 2.4 : 2} />
                </span>
                <span className="admin-rail-label">IA Jockey</span>
              </button>
            )}
          </div>

          <div className="admin-rail-divider" aria-hidden="true" />

          {navGroups.map((group) => {
            const GroupIcon = GROUP_ICONS[group.id] || LayoutDashboard;
            const isOpen = openGroups.has(group.id);
            const hasActive = group.tabs.some((t) => t.key === activeTab);
            return (
              <div
                key={group.id}
                className={`admin-rail-group${isOpen ? ' is-open' : ''}${hasActive ? ' has-active' : ''}`}
                data-group={group.id}
              >
                <button
                  type="button"
                  className="admin-rail-group-btn"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  title={group.label}
                >
                  <span className="admin-rail-icon" aria-hidden="true">
                    <GroupIcon size={17} strokeWidth={hasActive ? 2.4 : 2} />
                  </span>
                  <span className="admin-rail-label">
                    <span className="admin-rail-group-name">{group.label}</span>
                    <span className="admin-rail-group-count">{group.tabs.length}</span>
                  </span>
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
                        onMouseDown={preventButtonScroll}
                        onMouseEnter={() => prefetchTab(tab.key)}
                        onFocus={() => prefetchTab(tab.key)}
                        onClick={() => setActiveTab(tab.key)}
                        className={`admin-rail-item is-sub${isActive ? ' is-active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                        title={tab.label}
                      >
                        <span className="admin-rail-icon" aria-hidden="true">
                          <Icon size={15} strokeWidth={isActive ? 2.4 : 2} />
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
      <div className="page-stage">
      {/* Cabecera solo fuera del Inicio (el dashboard ya trae su propia intro) */}
      {activeTab !== 'dashboard' && activeTab !== 'events' && activeTab !== 'accounting' && activeTab !== 'books' && activeTab !== 'informes' && activeTab !== 'operation' && activeTab !== 'jev' && (
        <div className="page-header">
          <div>
            <h1 className="page-title">{panelMeta.title}</h1>
            <p className="page-subtitle">{panelMeta.subtitle}</p>
          </div>
        </div>
      )}

      {/* --- CONTENIDO DE CADA TAB --- */}
      <Suspense fallback={TAB_FALLBACK}>

      {activeTab === 'dashboard' && (
        <AdminDashboardTab
          userRole={userRole}
          userName={user?.fullName || ROLE_LABELS[userRole] || ''}
          permittedTabs={permittedTabs}
          goToTab={goToTab}
          members={members}
          membersLoading={membersLoading}
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
          accessinCashMovements={erp.accessinCashMovements || []}
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
          feePeriods={erp.feePeriods || []}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          tierCatalog={tierCatalog}
          reservations={reservations}
          entryLogs={entryLogs}
          poolAccesses={poolAccesses}
          poolSettings={poolSettings}
          claims={claims}
          messages={messages}
          surveys={surveys}
          staffMembers={staffMembers}
          events={erp.clubEvents || []}
          alerts={erp.alerts || []}
          applications={membershipApplications}
          portalRequests={portalAccessRequests}
          concessions={erp.concessions || []}
        />
      )}

      {activeTab === 'dues' && (
        <CuotasPanel
          initialView={!liquidateDues || searchParams.get('vista') === 'saldos' ? 'balances' : 'hub'}
          balancesOnly={!liquidateDues}
          members={members}
          setMembers={memberSet}
          feePeriods={erp.feePeriods}
          onUpsertFeePeriods={erp.setFeePeriodsList}
          onPersistFeePeriod={erp.persistFeePeriod}
          onReopenFeePeriod={erp.reopenProcessedFeePeriod}
          onApplyBalanceDeltas={erp.applyMemberBalanceDeltas}
          collectionImports={erp.memberCollectionImports}
          onImportCollections={erp.importMemberCollections}
          onDeleteCollectionImport={erp.deleteMemberCollectionImport}
          feeChartAccounts={erp.feeChartAccounts}
          onUpsertFeeChartAccount={erp.upsertFeeChartAccountRecord}
          onDeleteFeeChartAccount={erp.deleteFeeChartAccountRecord}
          onPostFeeLedger={erp.postFeeLedgerCharges}
          memberAccountEntries={erp.memberAccountEntries}
          onUpsertMemberAccountEntry={erp.upsertMemberAccountEntryRecord}
          onDeleteMemberAccountEntry={erp.deleteMemberAccountEntryRecord}
          reservations={reservations}
          onImputeReservation={persistReservation || ((next) => {
            if (!setReservations || !(next?.id || next?.accessinId)) return;
            setReservations((prev) => (prev || []).map((row) => {
              const same = (next.id && row.id === next.id)
                || (next.accessinId && row.accessinId === next.accessinId);
              return same ? { ...row, ...next } : row;
            }));
          })}
          addJournalEntry={addJournalEntry}
          journalEntries={journalEntries}
          chartOfAccounts={chartOfAccounts}
          formatCurrency={formatCurrency}
          tierCatalog={tierCatalog}
          onSendMessage={sendMessage}
          duesSettings={duesSettings}
          setDuesSettings={setDuesSettings}
          paymentPlans={paymentPlans}
          membersLoading={membersLoading}
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
            updateMember={memberWrite}
            setMembers={memberSet}
            canEditMember={manageMembers}
            addJournalEntry={addJournalEntry}
            onAccountEntry={erp.upsertMemberAccountEntryRecord}
            onSendMessage={sendMessage}
            accessinCobranzas={erp.accessinCobranzas}
            poolSettings={poolSettings}
            paymentPlans={paymentPlans}
            paymentTolerance={duesSettings?.paymentTolerance}
          />
        ) : (
          <MembersTab
            members={members}
            membersCount={membersCount}
            membersLoading={membersLoading}
            membersProgress={membersProgress}
            setMembers={memberSet}
            canEditMember={manageMembers}
            addJournalEntry={addJournalEntry}
            onAccountEntry={erp.upsertMemberAccountEntryRecord}
            formatCurrency={formatCurrency}
            onOpenProfile={(id) => navigate(`/panel/members/${id}`)}
            disciplineOptions={(disciplineCatalog || []).filter((d) => d.isActive !== false).map((d) => d.name)}
            tierCatalog={tierCatalog}
            setTierCatalog={manageMembers ? setTierCatalog : null}
            updateMember={memberWrite}
            membershipApplications={membershipApplications}
            setMembershipApplications={manageMembers ? setMembershipApplications : null}
            portalAccessRequests={portalAccessRequests}
            setPortalAccessRequests={manageMembers ? setPortalAccessRequests : null}
            onSendMessage={sendMessage}
            paymentPlans={paymentPlans}
            paymentTolerance={duesSettings?.paymentTolerance}
          />
        )
      )}

      {activeTab === 'bookings' && (
        <BookingsTab reservations={reservations} setReservations={setReservations} />
      )}

      {activeTab === 'disciplines' && (
        <DisciplinesTab
          members={members}
          setMembers={manageMembers ? setMembers : null}
          reservations={reservations}
          staffMembers={staffMembers}
          catalog={disciplineCatalog}
          setCatalog={manageMembers ? setDisciplineCatalog : null}
          onOpenMember={(id) => navigate(`/panel/members/${id}`)}
        />
      )}

      {activeTab === 'pool' && (
        <PoolTab
          members={members}
          setMembers={memberSet}
          updateMember={memberWrite}
          formatCurrency={formatCurrency}
          recordPoolCanon={recordPoolCanon}
          onUpsertMemberAccountEntry={erp.upsertMemberAccountEntryRecord}
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

      {(activeTab === 'accounting' || activeTab === 'books' || activeTab === 'informes' || activeTab === 'operation') && (
        <AccountingTab
          section={
            activeTab === 'books'
              ? 'books'
              : activeTab === 'informes'
                ? 'informes'
                : activeTab === 'operation'
                  ? 'operation'
                  : 'general'
          }
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
          supplierEntries={erp.supplierEntries || []}
          otherIncomes={erp.otherIncomes}
          onCreateOtherIncome={erp.createOtherIncomeRecord}
          interestGenerators={erp.interestGenerators}
          interestRuns={erp.interestRuns}
          onUpsertInterestGenerator={erp.upsertInterestGeneratorRecord}
          onDeleteInterestGenerator={erp.deleteInterestGeneratorRecord}
          onRecordInterestRun={erp.recordInterestRun}
          onCancelInterestRun={erp.cancelInterestRunRecord}
          setMembers={memberSet}
          expenseImports={erp.expenseImports}
          onImportExpenses={erp.importExpenses}
          retenciones={erp.retenciones}
          upsertRetencion={erp.upsertRetencion}
          comprobantes={erp.comprobantes}
          liquidaciones={erp.liquidaciones}
          perfilFiscal={erp.perfilFiscal}
          onSaveComprobante={erp.saveComprobante}
          onVoidComprobante={erp.voidComprobanteRecord}
          onSavePerfilFiscal={erp.saveFiscalProfile}
          onSaveLiquidacion={erp.saveLiquidacion}
          onPostLiquidacion={erp.postLiquidacion}
          onPayLiquidacion={erp.payLiquidacion}
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
          onDeletePaymentOrder={erp.archivePaymentOrderRecord}
          accountingReports={erp.accountingReports}
          onRecordAccountingReport={erp.recordAccountingReport}
          feePeriods={erp.feePeriods}
          reservations={reservations}
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
          setMembers={manageMembers || liquidateDues ? setMembers : null}
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
          utilidadNeta={resultadoAcumulado}
          expenses={erp.expenses || []}
          concessions={erp.concessions || []}
          clubEvents={erp.clubEvents || []}
          alerts={erp.alerts || []}
          cashRegisters={erp.cashRegisters || []}
          cashSessions={erp.cashSessions || []}
          canonPayments={erp.canonPayments || []}
          suppliers={erp.suppliers || []}
          supplierEntries={erp.supplierEntries || []}
          paymentOrders={erp.paymentOrders || []}
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

      {activeTab === 'settings' && (
        <SystemSettingsTab
          clubSettings={clubSettings}
          setClubSettings={setClubSettings}
          duesSettings={duesSettings}
          setDuesSettings={setDuesSettings}
          systemRules={systemRules}
          setSystemRules={setSystemRules}
          paymentPlans={paymentPlans}
          setPaymentPlans={setPaymentPlans}
          poolSettings={poolSettings}
          setPoolSettings={setPoolSettings}
          isZondaActive={isZondaActive}
          setIsZondaActive={setIsZondaActive}
          goToTab={goToTab}
        />
      )}

      {activeTab === 'migration' && (
        <MigrationTab setMembers={manageMembers ? setMembers : null} setReservations={setReservations} />
      )}

      {activeTab === 'bookings' && (
        <ClubFacilitiesPanel
          reservations={reservations}
          isZondaActive={isZondaActive}
          facilityCatalog={facilityCatalog}
          setFacilityCatalog={setFacilityCatalog}
        />
      )}
      </Suspense>
      </div>
      </div>
    </div>
  );
}
