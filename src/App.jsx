import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { keepPageAtTop } from './lib/scrollPage';
import Navbar from './components/Navbar';
import SessionDeskGate from './views/SessionDeskGate';
import PublicRoutes from './app/routes/PublicRoutes';
import ClubRoutes from './app/routes/ClubRoutes';
import useErpStore from './hooks/useErpStore';
import { AlertsBanner } from './components/erp/AlertsPanel';
import SessionStatusBar from './components/SessionStatusBar';
import { useAuth } from './context/AuthContext';
import { canAccessAdmin, allowedAdminTabs } from './domain/auth/roles';
import { isDemoFacilityId, isRealBookableSpace, OFFICIAL_FACILITY_IDS, RETIRED_FACILITY_IDS, FACILITIES } from './domain/reservations/facilities';
import { accountEntriesFromImputedReservations } from './domain/accounting/eventImputation';
import { buildFacilityCatalog } from './domain/reservations/facilityConfig';
import { validateMemberBooking } from './domain/reservations/bookingRules';
import { countUnread, markMessageRead, messageReaderKey, rememberReadMessage, withRememberedReads } from './domain/messaging/messages';
import {
  buildNotifications,
  duesBellItem,
  loadDismissedNotificationIds,
  saveDismissedNotificationIds,
} from './domain/notifications/buildNotifications';
import { setRuntimeDueDay } from './domain/members/dues';
import { commitDuesCollection, isPersistedPaymentId, localDuesPayment } from './domain/members/memberPayments';
import {
  DEFAULT_CLUB_SETTINGS,
  DEFAULT_DUES_SETTINGS,
  clubFooterLine,
  mergeClubSettings,
  mergeDuesSettings,
  mergePoolSettings,
  setRuntimeClubSettings,
  SETTINGS_KEYS,
  DEFAULT_SYSTEM_RULES,
  mergeSystemRules,
} from './domain/system/clubSettings';
import { DEFAULT_PAYMENT_PLANS, mergePaymentPlans } from './domain/system/paymentPlans';
import { applyMemberListRefresh, attachHouseholdToMembers } from './domain/members/households';
// Los saldos de cuenta corriente vienen de la base: public.members.outstanding_balance
// más el desglose en members.meta (ver scripts/sync-accessin-balances.mjs). El snapshot
// LILA ya no se aplica del lado del cliente; solo lo usan los reportes de administración.
import { loadDisciplineCatalog } from './domain/sports/disciplines';
import { loadTierCatalog, mergeOfficialTiers, setRuntimeTierCatalog, stripExampleTiers } from './domain/members/tiers';
import { isProductionWithoutBackend, isSupabaseConfigured, supabase } from './lib/supabase';
import ConfigError from './components/ConfigError';
import { BrandSplash, JockeyWordmark, SilksBand } from './components/brand/JockeyBrand';
import { notifyNextOnWaitlist } from './domain/reservations/waitlist';
import { clubCancelledReservationNotice } from './domain/reservations/clubCancelNotice';
import { bootstrapShellFromDb, bootstrapDeferredFromDb, bootstrapMembersFromDb, bootstrapErpFromDb, repos } from './data/bootstrap';
import { drainAccessOutbox, enqueueAccessLog } from './domain/credentials/accessOutbox';
import { useDailyBackup } from './hooks/useDailyBackup';
import { todayAR } from './lib/arDate';


// Seed opcional (generado por npm run import:reservas; puede faltar en clones limpios).
// Sin `eager`: trae nombre y reservas de socios reales, y con carga ansiosa quedaba
// embebido en el chunk de entrada. loadDatitaReservas() lo pide solo en modo local, que
// en producción no existe: sin la guarda de DEV, un build hecho en una máquina que tiene
// el archivo lo publicaba como chunk descargable.
const _seedMod = import.meta.env.DEV ? import.meta.glob('./data/seedDatitaReservas.js') : {};
let datitaReservasPromise = null;
function loadDatitaReservas() {
  if (!datitaReservasPromise) {
    const loader = _seedMod['./data/seedDatitaReservas.js'];
    datitaReservasPromise = loader
      ? loader().then((m) => m.SEED_DATITA_RESERVAS || []).catch(() => [])
      : Promise.resolve([]);
  }
  return datitaReservasPromise;
}


const persistOnceKeys = new Set();

function persistOnce(key, run) {
  const id = String(key || '');
  if (!id || persistOnceKeys.has(id)) return;
  persistOnceKeys.add(id);
  Promise.resolve()
    .then(run)
    .catch(() => {
      persistOnceKeys.delete(id);
    });
}

// Semilla demo (padrón, noticias, caja de ejemplo) solo en modo local.
// Con Supabase este import() no corre y el celular no baja el chunk.
let localDemoPromise = null;
function loadLocalDemo() {
  if (isSupabaseConfigured) return Promise.resolve(null);
  if (!localDemoPromise) localDemoPromise = import('./app/localSeed.js');
  return localDemoPromise;
}

const DEMO_MEMBER_IDS = new Set([
  '2020445599881122', // Victoria Cantoni
  '2018776655443322', // Adolfo Sarmiento
  '2022112233445566', // Bautista Del Carril
  '2024990088776655', // Isabel Albarracín
]);

function isDemoMember(m) {
  return DEMO_MEMBER_IDS.has(String(m?.memberId || ''));
}

function isDatitaReservation(r) {
  return r?.source === 'datita' || String(r?.id || '').startsWith('datita-res-');
}

function isDemoReservation(r) {
  if (!r) return false;
  if (isDatitaReservation(r)) return false;
  const id = r.id;
  if (typeof id === 'number' && id <= 10) return true;
  const demoFacilities = new Set(['rugby_masc', 'tenis_trad', 'fitness', 'padel_vidrio']);
  return isDemoMember({ memberId: r.memberId }) && demoFacilities.has(String(r.facilityId || ''));
}

function pickReservations(preferred, fallbackSeed = []) {
  const list = Array.isArray(preferred) ? preferred.filter((r) => !isDemoReservation(r)) : [];
  const seed = Array.isArray(fallbackSeed) ? fallbackSeed : [];
  // Preferir seed datita completo si la nube aún no tiene el lote (o quedó a medias)
  if (seed.length && seed.length > list.length) return seed;
  if (list.some(isDatitaReservation) || list.length) return list;
  return seed;
}

/** Mensajes de error de BD legibles (pool / red). */
function friendlyDbError(err, fallback = 'Error de base de datos') {
  const msg = err?.message || String(err || '');
  if (/Timed out acquiring connection from connection pool|connection pool/i.test(msg)) {
    return 'La base está saturada (pool de conexiones). Recargá en unos segundos; se muestra la app con datos parciales.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return 'Sin conexión con la base. Revisá internet y recargá.';
  }
  return msg || fallback;
}

function loadInitialReservations() {
  try {
    const local = localStorage.getItem('jockey-reservations');
    if (!local) return pickReservations([]);
    const parsed = JSON.parse(local);
    return pickReservations(parsed);
  } catch {
    return pickReservations([]);
  }
}

// Datos de semilla predeterminados para noticias del Jockey Club San Juan
// Datos de semilla contable oficial de San Juan (Libro Diario inicial balanceado)
// Datos de semilla para el personal de San Juan y bitácora de trazabilidad
// RR.HH. personal: novedades, faltas, tardanzas, permisos, solicitudes
// NUEVO: Semillas para Solicitudes, Pedidos y Reclamos
// NUEVO: Semillas para Bandeja de Entrada de Mensajería
export default function App() {
  // Constante del build: en producción sin backend no hay portal que montar. Va en un
  // componente aparte para que los hooks del portal no queden detrás de un return.
  if (isProductionWithoutBackend) {
    return <ConfigError />;
  }
  return <ClubPortal />;
}

function clearCloudBusinessLocalCache() {
  if (!isSupabaseConfigured || typeof localStorage === 'undefined') return;
  const keep = new Set([
    'jockey-theme',
    'jockey-alert-acks',
    'jockey-notif-dismissed-v2',
    'jockey-saved-news',
    'padronFold:v1',
  ]);
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (keep.has(key)) continue;
      if (key.startsWith('sb-') || key.includes('supabase')) continue;
      if (key.startsWith('jockey-read-messages:')) continue;
      if (key.startsWith('jockey-') || key.startsWith('padronFold:')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* private mode / quota */
  }
}

function ClubPortal() {
  const { user, loading: authLoading, isAuthenticated, role, desk, needsDeskChoice, canAccessAdmin: sessionCanAccessAdmin } = useAuth();
  const userRole = role || 'member';
  const cloudMode = isSupabaseConfigured;
  const localDemoReady = useRef(isSupabaseConfigured);
  useEffect(() => {
    clearCloudBusinessLocalCache();
  }, []);
  const [demoMembers, setDemoMembers] = useState([]);
  const hydratedRef = useRef(false);
  const membersLoadStartedRef = useRef(false);
  const prevDeskRef = useRef(desk);
  useEffect(() => {
    if (prevDeskRef.current === desk) return;
    prevDeskRef.current = desk;
    hydratedRef.current = false;
    membersLoadStartedRef.current = false;
  }, [desk]);
  const membersRefreshGen = useRef(0);
  const [dbReady, setDbReady] = useState(true);
  const [dbSyncing, setDbSyncing] = useState(false);
  // Espejo de hydratedRef para lo que se muestra en pantalla (una ref no re-renderiza).
  const [dbHydrated, setDbHydrated] = useState(false);
  const [dbError, setDbError] = useState('');
  const [memberDbIds, setMemberDbIds] = useState({});

  // Inicialización de Estados Cargando desde LocalStorage o Valores de Semilla
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('jockey-theme') || 'dark';
  });

  // Navegación por URL: el "view id" histórico se traduce a rutas reales.
  const navigate = useNavigate();
  const location = useLocation();
  const isOperativeRole = Boolean(sessionCanAccessAdmin);

  const pathForView = useCallback((viewId) => {
    switch (viewId) {
      case 'reservations': return isOperativeRole ? '/panel' : '/reservas';
      case 'attendance': return '/asistencia';
      case 'news': return '/revista';
      case 'messages': return '/mensajes';
      case 'payments': return '/cuenta';
      case 'profile': return '/perfil';
      case 'concessions': return '/panel/concessions';
      case 'admin': return isOperativeRole ? '/panel' : (userRole === 'teacher' ? '/asistencia' : '/');
      case 'dashboard':
      default: return isOperativeRole ? '/panel' : (userRole === 'teacher' ? '/asistencia' : '/');
    }
  }, [isOperativeRole, userRole]);

  const setCurrentView = useCallback((viewId) => navigate(pathForView(viewId)), [navigate, pathForView]);

  const currentView = location.pathname.startsWith('/reservas')
    ? 'reservations'
    : location.pathname.startsWith('/asistencia')
      ? 'attendance'
      : location.pathname.startsWith('/revista')
      ? 'news'
      : location.pathname.startsWith('/mensajes')
        ? 'messages'
        : location.pathname.startsWith('/cuenta')
          ? 'payments'
          : location.pathname.startsWith('/perfil')
            ? 'profile'
            : location.pathname.startsWith('/concesiones')
              ? 'concessions'
              : 'dashboard';

  useLayoutEffect(() => {
    keepPageAtTop();
  }, [location.pathname]);

  const [members, setMembers] = useState([]);

  // Los snapshots Accessin del ERP solo se bajan con sesión operativa abierta.
  const canLoadErpSeeds = !isSupabaseConfigured || (isAuthenticated && isOperativeRole);

  const [reservations, setReservations] = useState(() => (
    isSupabaseConfigured ? [] : loadInitialReservations()
  ));

  // Modo local: completar con el seed datita una vez que llega su chunk.
  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    let cancelled = false;
    loadDatitaReservas().then((seed) => {
      if (cancelled || !seed.length) return;
      setReservations((cur) => pickReservations(cur, seed));
    });
    return () => { cancelled = true; };
  }, []);

  const [newsList, setNewsList] = useState([]);

  const [disciplineCatalog, setDisciplineCatalog] = useState(() => loadDisciplineCatalog());
  const [tierCatalog, setTierCatalog] = useState(() => {
    const cat = mergeOfficialTiers(stripExampleTiers(loadTierCatalog()));
    setRuntimeTierCatalog(cat);
    return cat;
  });

  const [rsvpList, setRsvpList] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      const local = localStorage.getItem('jockey-rsvps');
      return local ? JSON.parse(local) : [];
    } catch {
      return [];
    }
  });

  const [journalEntries, setJournalEntries] = useState([]);

  const [staffMembers, setStaffMembers] = useState([]);

  const [staffHrRecords, setStaffHrRecords] = useState([]);

  // NUEVOS ESTADOS FASE 3
  const [claims, setClaims] = useState([]);

  const [messages, setMessages] = useState([]);

  const [entryLogs, setEntryLogs] = useState([]);

  const [surveys, setSurveys] = useState([]);
  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    let cancelled = false;
    loadLocalDemo().then((mod) => {
      if (cancelled || !mod) return;
      localDemoReady.current = true;
      setDemoMembers(mod.DEFAULT_MEMBERS);
      setMembers(mod.initialMembers());
      setNewsList(mod.initialNews());
      setJournalEntries(mod.initialJournalEntries());
      setStaffMembers(mod.initialStaff());
      setStaffHrRecords(mod.initialStaffHr());
      setClaims(mod.initialClaims());
      setMessages(mod.initialMessages());
      setEntryLogs(mod.initialEntryLogs());
      setSurveys(mod.initialSurveys());
    });
    return () => { cancelled = true; };
  }, []);

  const [guestPasses, setGuestPasses] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      return JSON.parse(localStorage.getItem('jockey-guest-passes') || '[]');
    } catch {
      return [];
    }
  });

  const [attendanceSessions, setAttendanceSessions] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      return JSON.parse(localStorage.getItem('jockey-attendance') || '[]');
    } catch {
      return [];
    }
  });

  const [poolAccesses, setPoolAccesses] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      return JSON.parse(localStorage.getItem('jockey-pool-access') || '[]');
    } catch {
      return [];
    }
  });

  const [poolSettings, setPoolSettings] = useState(() => {
    if (isSupabaseConfigured) return mergePoolSettings();
    try {
      return mergePoolSettings(JSON.parse(localStorage.getItem('jockey-pool-settings') || '{}'));
    } catch {
      return mergePoolSettings();
    }
  });

  const [clubSettings, setClubSettings] = useState(() => {
    if (isSupabaseConfigured) {
      setRuntimeClubSettings(DEFAULT_CLUB_SETTINGS);
      return DEFAULT_CLUB_SETTINGS;
    }
    try {
      const next = mergeClubSettings(JSON.parse(localStorage.getItem('jockey-club-settings') || '{}'));
      setRuntimeClubSettings(next);
      return next;
    } catch {
      return DEFAULT_CLUB_SETTINGS;
    }
  });

  const [systemRules, setSystemRules] = useState(() => {
    if (isSupabaseConfigured) return DEFAULT_SYSTEM_RULES;
    try {
      return mergeSystemRules(JSON.parse(localStorage.getItem('jockey-system-rules') || '{}'));
    } catch {
      return DEFAULT_SYSTEM_RULES;
    }
  });

  const [duesSettings, setDuesSettings] = useState(() => {
    if (isSupabaseConfigured) {
      setRuntimeDueDay(DEFAULT_DUES_SETTINGS.dueDay);
      return DEFAULT_DUES_SETTINGS;
    }
    try {
      const next = mergeDuesSettings(JSON.parse(localStorage.getItem('jockey-dues-settings') || '{}'));
      setRuntimeDueDay(next.dueDay);
      return next;
    } catch {
      return DEFAULT_DUES_SETTINGS;
    }
  });

  const [paymentPlans, setPaymentPlans] = useState(() => {
    if (isSupabaseConfigured) return DEFAULT_PAYMENT_PLANS;
    try {
      return mergePaymentPlans(JSON.parse(localStorage.getItem('jockey-payment-plans') || 'null'));
    } catch {
      return DEFAULT_PAYMENT_PLANS;
    }
  });

  const [facilityCatalog, setFacilityCatalog] = useState(() => {
    if (isSupabaseConfigured) return null;
    try {
      const raw = JSON.parse(localStorage.getItem('jockey-facility-catalog') || 'null');
      if (!Array.isArray(raw) || !raw.length) return null;
      const real = raw.filter((f) => (
        f?.id
        && !isDemoFacilityId(f.id)
        && !RETIRED_FACILITY_IDS.has(f.id)
        && (OFFICIAL_FACILITY_IDS.has(f.id) || isRealBookableSpace(f))
      ));
      return real.length ? real : null;
    } catch {
      return null;
    }
  });

  const [registeredUsersCount, setRegisteredUsersCount] = useState(0);
  const [membershipApplications, setMembershipApplications] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      return JSON.parse(localStorage.getItem('jockey-membership-applications') || '[]');
    } catch {
      return [];
    }
  });
  const [portalAccessRequests, setPortalAccessRequests] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      return JSON.parse(localStorage.getItem('jockey-portal-access-requests') || '[]');
    } catch {
      return [];
    }
  });
  const [membersCount, setMembersCount] = useState(0);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersProgress, setMembersProgress] = useState({ loaded: 0, total: 0 });

  const [waitlist, setWaitlist] = useState(() => {
    if (isSupabaseConfigured) return [];
    try {
      return JSON.parse(localStorage.getItem('jockey-waitlist') || '[]');
    } catch {
      return [];
    }
  });

  const [isZondaActive, setIsZondaActive] = useState(() => {
    if (isSupabaseConfigured) return false;
    return localStorage.getItem('jockey-zonda') === 'true';
  });

  // NUEVO: Estado Offline/Online y Cola de Sincronización
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncQueue, setSyncQueue] = useState(() => {
    if (isSupabaseConfigured) return [];
    const local = localStorage.getItem('jockey-sync-queue');
    return local ? JSON.parse(local) : [];
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-sync-queue', JSON.stringify(syncQueue));
  }, [syncQueue, cloudMode]);

  // Sincronización automática al recuperar conexión (solo modo local)
  useEffect(() => {
    if (cloudMode) return undefined;
    if (isOnline && syncQueue.length > 0) {
      const syncTimeout = setTimeout(() => {
        setSyncQueue([]);
      }, 2000);
      return () => clearTimeout(syncTimeout);
    }
    return undefined;
  }, [isOnline, syncQueue.length, cloudMode]);

  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-zonda', isZondaActive);
  }, [isZondaActive, cloudMode]);

  useEffect(() => {
    localStorage.setItem('jockey-theme', theme);
    document.documentElement.setAttribute('data-theme', isAuthenticated ? theme : 'light');
  }, [theme, isAuthenticated]);

  // Persistencia local solo si no hay Supabase
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-members', JSON.stringify(members));
  }, [members, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-reservations', JSON.stringify(reservations));
  }, [reservations, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-news', JSON.stringify(newsList));
  }, [newsList, cloudMode]);
  useEffect(() => {
    // Cloud: app_settings solo se escribe en guardados explícitos (no al hidratar).
    if (!cloudMode) localStorage.setItem('jockey-disciplines-catalog', JSON.stringify(disciplineCatalog));
  }, [disciplineCatalog, cloudMode]);
  useEffect(() => {
    setRuntimeTierCatalog(tierCatalog);
    if (!cloudMode) localStorage.setItem('jockey-member-tiers', JSON.stringify(tierCatalog));
  }, [tierCatalog, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-rsvps', JSON.stringify(rsvpList));
  }, [rsvpList, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-journal-entries', JSON.stringify(journalEntries));
  }, [journalEntries, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-staff-members', JSON.stringify(staffMembers));
  }, [staffMembers, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-staff-hr', JSON.stringify(staffHrRecords));
  }, [staffHrRecords, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-claims', JSON.stringify(claims));
  }, [claims, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-messages', JSON.stringify(messages));
  }, [messages, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-entry-logs', JSON.stringify(entryLogs));
  }, [entryLogs, cloudMode]);
  useEffect(() => {
    if (!cloudMode && localDemoReady.current) localStorage.setItem('jockey-surveys', JSON.stringify(surveys));
  }, [surveys, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-guest-passes', JSON.stringify(guestPasses));
  }, [guestPasses, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-attendance', JSON.stringify(attendanceSessions));
  }, [attendanceSessions, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-pool-access', JSON.stringify(poolAccesses));
  }, [poolAccesses, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-pool-settings', JSON.stringify(poolSettings));
  }, [poolSettings, cloudMode]);
  useEffect(() => {
    setRuntimeClubSettings(clubSettings);
    if (!cloudMode) localStorage.setItem('jockey-club-settings', JSON.stringify(clubSettings));
  }, [clubSettings, cloudMode]);
  useEffect(() => {
    setRuntimeDueDay(duesSettings.dueDay);
    if (!cloudMode) localStorage.setItem('jockey-dues-settings', JSON.stringify(duesSettings));
  }, [duesSettings, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-system-rules', JSON.stringify(systemRules));
  }, [systemRules, cloudMode]);

  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-payment-plans', JSON.stringify(paymentPlans));
  }, [paymentPlans, cloudMode]);
  useEffect(() => {
    if (!facilityCatalog) return;
    if (!cloudMode) {
      localStorage.setItem('jockey-facility-catalog', JSON.stringify(facilityCatalog));
    }
  }, [facilityCatalog, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-waitlist', JSON.stringify(waitlist));
  }, [waitlist, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-membership-applications', JSON.stringify(membershipApplications));
  }, [membershipApplications, cloudMode]);
  useEffect(() => {
    if (!cloudMode) localStorage.setItem('jockey-portal-access-requests', JSON.stringify(portalAccessRequests));
  }, [portalAccessRequests, cloudMode]);

  /** Escritura a app_settings solo desde la UI (nunca al hidratar desde Supabase). */
  const persistAppSetting = useCallback((key, value) => {
    if (!cloudMode || !isSupabaseConfigured) return;
    repos.setSetting(key, value, user?.id).catch(() => {});
  }, [cloudMode, user?.id]);

  const makeSettingSetter = useCallback((setState, key, normalize) => (
    (valueOrUpdater) => {
      setState((prev) => {
        const raw = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
        const next = normalize ? normalize(raw) : raw;
        persistAppSetting(key, next);
        return next;
      });
    }
  ), [persistAppSetting]);

  const saveClubSettings = useMemo(
    () => makeSettingSetter(setClubSettings, SETTINGS_KEYS.club, mergeClubSettings),
    [makeSettingSetter],
  );
  const saveDuesSettings = useMemo(
    () => makeSettingSetter(setDuesSettings, SETTINGS_KEYS.dues, mergeDuesSettings),
    [makeSettingSetter],
  );
  const savePoolSettings = useMemo(
    () => makeSettingSetter(setPoolSettings, SETTINGS_KEYS.pool, mergePoolSettings),
    [makeSettingSetter],
  );
  const saveSystemRules = useMemo(
    () => makeSettingSetter(setSystemRules, SETTINGS_KEYS.system, mergeSystemRules),
    [makeSettingSetter],
  );
  const savePaymentPlans = useMemo(
    () => makeSettingSetter(setPaymentPlans, SETTINGS_KEYS.paymentPlans, mergePaymentPlans),
    [makeSettingSetter],
  );
  const saveTierCatalog = useMemo(
    () => makeSettingSetter(setTierCatalog, 'member_tiers', (raw) => {
      const list = Array.isArray(raw) ? raw : [];
      const cleaned = mergeOfficialTiers(stripExampleTiers(list));
      const next = cleaned.length ? cleaned : list;
      setRuntimeTierCatalog(next);
      return next;
    }),
    [makeSettingSetter],
  );
  const saveDisciplineCatalog = useMemo(
    () => makeSettingSetter(setDisciplineCatalog, 'disciplines_catalog'),
    [makeSettingSetter],
  );
  const saveFacilityCatalog = useMemo(
    () => makeSettingSetter(setFacilityCatalog, 'facility_catalog'),
    [makeSettingSetter],
  );
  const saveIsZondaActive = useCallback((valueOrUpdater) => {
    setIsZondaActive((prev) => {
      const next = typeof valueOrUpdater === 'function' ? Boolean(valueOrUpdater(prev)) : Boolean(valueOrUpdater);
      persistAppSetting('zonda', { active: next });
      return next;
    });
  }, [persistAppSetting]);

  // Socio activo: el vinculado a la sesión, o el primero como fallback operativo
  const sessionMemberFallback = useMemo(() => {
    if (!user?.memberId && !user?.fullName && !user?.name && !user?.email) return null;
    const fromDefaults = !isSupabaseConfigured
      ? demoMembers.find((m) => m.memberId === user?.memberId)
      : null;
    if (fromDefaults) return fromDefaults;
    const profileName = String(user?.fullName || user?.name || '').trim();
    const looksEmail = profileName.includes('@');
    return {
      memberId: user?.memberId || 'session',
      name: (!looksEmail && profileName) ? profileName : 'Socio',
      tier: 'socio_individual',
      outstandingBalance: 0,
      yearsActive: 0,
      adherents: [],
      status: 'active',
    };
  }, [demoMembers, user?.memberId, user?.fullName, user?.name, user?.email]);

  const [ownCredentialToken, setOwnCredentialToken] = useState('');
  const [ownMember, setOwnMember] = useState(null);

  useEffect(() => {
    const number = user?.memberId;
    if (!cloudMode || !number) {
      setOwnCredentialToken('');
      setOwnMember(null);
      return undefined;
    }
    let cancel = false;
    repos.getMemberByNumber(number).then((row) => {
      if (cancel) return;
      setOwnCredentialToken(row?.credentialToken || '');
      setOwnMember(row || null);
    }).catch(() => {
      if (cancel) return;
      setOwnCredentialToken('');
      setOwnMember(null);
    });
    return () => {
      cancel = true;
    };
  }, [cloudMode, user?.memberId]);

  const listedMember = user?.memberId
    ? (ownMember || members.find((m) => m.memberId === user.memberId) || sessionMemberFallback)
    : sessionMemberFallback;
  const activeMember = listedMember && ownCredentialToken
    ? { ...listedMember, credentialToken: ownCredentialToken }
    : listedMember;

  // Alternar Tema Claro / Oscuro
  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Agregar una reserva (con guardia de dominio contra turnos duplicados)
  const addReservation = async (newRes) => {
    const catalog = buildFacilityCatalog(FACILITIES, facilityCatalog);
    const facility = catalog.find((item) => item.id === newRes?.facilityId);
    const member = (members || []).find((item) => String(item.memberId) === String(newRes?.memberId)) || {
      memberId: newRes?.memberId,
      tier: newRes?.tier,
    };
    const asAdmin = newRes?.source === 'admin' || newRes?.forceConfirmed === true;
    const check = validateMemberBooking({
      facility,
      member,
      reservations,
      date: newRes?.date,
      time: newRes?.time,
      guests: newRes?.guests,
      asAdmin,
    });
    if (!check.ok) return { ok: false, error: check.error };
    const booking = {
      ...newRes,
      status: asAdmin ? 'confirmed' : check.status,
      endTime: check.turn.endTime || newRes.endTime || null,
      recordedBy: newRes?.recordedBy || user?.id || null,
      recordedByName: newRes?.recordedByName
        || (asAdmin
          ? (String(user?.fullName || user?.email || '').trim() || null)
          : (String(newRes?.memberName || user?.fullName || '').trim() || null)),
    };
    if (cloudMode) {
      try {
        const dbId = memberDbIds[booking.memberId] || await repos.findMemberDbIdByNumber(booking.memberId);
        const saved = await repos.createReservation(booking, dbId);
        setReservations((prev) => [saved, ...prev]);
        return { ok: true, reservation: saved };
      } catch (err) {
        return { ok: false, error: err.message || 'No se pudo guardar la reserva en la base.' };
      }
    }
    const resWithId = {
      ...booking,
      id: Date.now()
    };
    setReservations(prev => [resWithId, ...prev]);
    return { ok: true };
  };

  const pushReservationMessage = (msg) => {
    if (!msg?.recipientId) return;
    if (cloudMode) {
      repos.insertMessage(msg).then((saved) => {
        setMessages((msgs) => [saved, ...msgs]);
      }).catch(() => setMessages((msgs) => [msg, ...msgs]));
      return;
    }
    setMessages((msgs) => [msg, ...msgs]);
  };

  const notifyWaitlistAfterCancel = (current) => {
    if (!current) return;
    setWaitlist((prev) => {
      const { entries, notified } = notifyNextOnWaitlist(prev, {
        facilityId: current.facilityId,
        date: current.date,
        time: current.time,
      });
      if (notified) {
        pushReservationMessage({
          id: `wl-msg-${Date.now()}`,
          date: todayAR(),
          sender: 'Reservas · Jockey Club',
          senderId: 'ops',
          recipientId: notified.memberId,
          subject: 'Turno liberado · lista de espera',
          content: `Se liberó ${notified.facilityName} el ${notified.date} a las ${notified.time}. Reservá desde Instalaciones.`,
          isRead: false,
        });
      }
      if (cloudMode) {
        repos.replaceWaitlist(entries, memberDbIds).then(setWaitlist).catch(() => {});
      }
      return entries;
    });
  };

  // Cancelar una reserva (socio) y avisar al primero de la lista de espera
  const cancelReservation = async (resId) => {
    const current = reservations.find((r) => r.id === resId);
    if (cloudMode && current) {
      try {
        const saved = await repos.cancelOwnReservation(resId);
        setReservations((prev) => prev.map((res) => (res.id === resId ? saved : res)));
      } catch (err) {
        setDbError(err?.message || 'No se pudo cancelar la reserva.');
        return;
      }
    } else {
      setReservations((prev) =>
        prev.map((res) => (res.id === resId ? { ...res, status: 'cancelled' } : res))
      );
    }
    notifyWaitlistAfterCancel(current);
  };

  const updateMember = async (nextMember) => {
    if (!nextMember?.memberId) return;
    if (cloudMode) {
      const current = members.find((m) => m.memberId === nextMember.memberId) || {};
      const newest = localDuesPayment(current, nextMember);
      if (newest) {
        try {
          const withId = {
            ...current,
            ...nextMember,
            id: nextMember.id || current.id || memberDbIds[nextMember.memberId],
          };
          const committed = await commitDuesCollection(withId, newest);
          setDbError('');
          setMembers((prev) => prev.map((m) => (
            m.memberId === nextMember.memberId ? { ...m, ...committed.member } : m
          )));
          if (committed.member.id) {
            setMemberDbIds((prev) => ({ ...prev, [committed.member.memberId]: committed.member.id }));
          }
          return committed.member;
        } catch (err) {
          let restored = null;
          try {
            restored = await repos.getMemberByNumber(nextMember.memberId, { withPayments: true });
          } catch {
            restored = null;
          }
          const hadPayment = (restored?.paymentHistory || []).length > (current.paymentHistory || []).length;
          if (restored && hadPayment) {
            setMembers((prev) => prev.map((m) => (
              m.memberId === nextMember.memberId ? { ...m, ...restored } : m
            )));
            setDbError('El cobro quedó registrado. Actualicé la ficha con lo que está en la base.');
            return restored;
          }
          setDbError(err?.message || 'No se pudo registrar el cobro. El saldo no cambió.');
          return;
        }
      }
      try {
        const saved = await repos.upsertMember({ ...current, ...nextMember });
        setDbError('');
        setMembers((prev) =>
          prev.map((m) => (m.memberId === nextMember.memberId ? { ...m, ...saved } : m))
        );
        if (saved.id) {
          setMemberDbIds((prev) => ({ ...prev, [saved.memberId]: saved.id }));
        }
        return saved;
      } catch (err) {
        setDbError(err.message || 'No se pudo guardar el socio');
        return;
      }
    }
    const savedLocal = { ...nextMember };
    setMembers((prev) =>
      prev.map((m) => (m.memberId === nextMember.memberId ? { ...m, ...savedLocal } : m))
    );
    return savedLocal;
  };

  const persistReservation = async (next, { requireCloud = false } = {}) => {
    if (!next?.id && !next?.accessinId) return next;
    const cloudId = String(next.id || '');
    const isCloudId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cloudId);
    if (cloudMode && isCloudId) {
      try {
        const saved = await repos.updateReservation(cloudId, next);
        setReservations((prev) => prev.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)));
        return saved;
      } catch (err) {
        if (requireCloud) throw err;
        setReservations((prev) => (prev || []).map((row) => {
          const same = (next.id && row.id === next.id)
            || (next.accessinId && row.accessinId === next.accessinId);
          return same ? { ...row, ...next } : row;
        }));
        return next;
      }
    }
    if (cloudMode && requireCloud) {
      throw new Error('No se pudo guardar en la base (reserva sin id de nube).');
    }
    setReservations((prev) => (prev || []).map((row) => {
      const same = (next.id && row.id === next.id)
        || (next.accessinId && row.accessinId === next.accessinId);
      return same ? { ...row, ...next } : row;
    }));
    return next;
  };

  /** Administración cambia estado (aprobar / anular) y avisa al socio si anula el club. */
  const updateReservationStatus = async (resId, newStatus) => {
    const current = reservations.find((r) => r.id === resId);
    if (!current) return { ok: false, error: 'No está la reserva.' };
    const prevStatus = String(current.status || '');
    const nextStatus = String(newStatus || '').trim();
    if (!nextStatus || prevStatus === nextStatus) return { ok: true, reservation: current };

    try {
      let saved;
      if (cloudMode && nextStatus === 'cancelled') {
        saved = await repos.cancelReservationByClub(resId);
        setReservations((prev) => prev.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)));
      } else {
        saved = await persistReservation({ ...current, status: nextStatus }, { requireCloud: cloudMode });
      }
      if (nextStatus === 'cancelled' && prevStatus !== 'cancelled') {
        const notice = clubCancelledReservationNotice(saved || current);
        pushReservationMessage({
          id: `res-cancel-${Date.now()}`,
          date: todayAR(),
          sender: 'Reservas · Jockey Club',
          senderId: 'ops',
          recipientId: current.memberId,
          subject: notice.subject,
          content: notice.content,
          isRead: false,
        });
        notifyWaitlistAfterCancel(current);
      }
      return { ok: true, reservation: saved || { ...current, status: nextStatus } };
    } catch (err) {
      const message = err?.message || 'No se pudo actualizar la reserva.';
      setDbError(message);
      return { ok: false, error: message };
    }
  };

  const erp = useErpStore({
    setJournalEntries,
    isZondaActive,
    userId: user?.id,
    // Habilita los snapshots Accessin diferidos (cobranzas, proveedores,
    // bonificaciones). Sin sesión operativa no se bajan.
    canLoadSeeds: canLoadErpSeeds,
  });

  useEffect(() => {
    const extras = accountEntriesFromImputedReservations(reservations);
    extras.forEach((entry) => erp.upsertMemberAccountEntryRecord(entry));
  }, [reservations, erp.upsertMemberAccountEntryRecord]);

  useDailyBackup({
    enabled: true,
    role: userRole,
    isAuthenticated,
    dbReady,
    snapshot: {
      members,
      reservations,
      journalEntries,
      staffMembers,
      claims,
      messages,
      entryLogs,
      surveys,
      expenses: erp.expenses,
      concessions: erp.concessions,
      clubEvents: erp.clubEvents,
      alerts: erp.alerts,
      cashRegisters: erp.cashRegisters,
      suppliers: erp.suppliers,
      retenciones: erp.retenciones,
      newsList,
      canonPayments: erp.canonPayments,
    },
  });

  useEffect(() => {
    if (!isAuthenticated) {
      hydratedRef.current = false;
      membersLoadStartedRef.current = false;
      setDbSyncing(false);
    }
    if (isAuthenticated && !cloudMode) {
      setMembershipApplications(repos.loadLocalMembershipApplications());
      setPortalAccessRequests(repos.loadLocalPortalAccessRequests());
    }
  }, [isAuthenticated, cloudMode]);

  // Hidratar progresivo: abrir UI ya; crítico → diferido → padrón/ERP
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || authLoading || needsDeskChoice || !desk) return undefined;
    if (hydratedRef.current) return undefined;
    let cancelled = false;
    const isOps = canAccessAdmin(role) || role === 'gate_operator';

    const applyAppPatch = (app = {}) => {
      if (Array.isArray(app.reservations)) setReservations(pickReservations(app.reservations));
      if (Array.isArray(app.waitlist)) setWaitlist(app.waitlist);
      if (Array.isArray(app.newsList)) setNewsList(app.newsList);
      if (Array.isArray(app.rsvpList)) setRsvpList(app.rsvpList);
      if (Array.isArray(app.journalEntries) && app.journalEntries.length) {
        setJournalEntries(app.journalEntries);
      }
      if (Array.isArray(app.staffMembers)) setStaffMembers(app.staffMembers);
      if (Array.isArray(app.staffHrRecords)) setStaffHrRecords(app.staffHrRecords);
      if (Array.isArray(app.claims)) setClaims(app.claims);
      if (Array.isArray(app.messages)) {
        setMessages(withRememberedReads(app.messages, messageReaderKey({ userId: user?.id, memberId: user?.memberId })));
      }
      if (Array.isArray(app.entryLogs)) setEntryLogs(app.entryLogs);
      if (Array.isArray(app.poolAccesses)) setPoolAccesses(app.poolAccesses);
      if (Array.isArray(app.surveys)) setSurveys(app.surveys);
      if (Array.isArray(app.guestPasses)) setGuestPasses(app.guestPasses);
      if (typeof app.registeredUsersCount === 'number') {
        setRegisteredUsersCount(app.registeredUsersCount);
      }
      if (Array.isArray(app.membershipApplications)) {
        setMembershipApplications(app.membershipApplications);
      }
      if (Array.isArray(app.portalAccessRequests)) {
        setPortalAccessRequests(app.portalAccessRequests);
      }
      if (typeof app.isZondaActive === 'boolean') setIsZondaActive(app.isZondaActive);
      if (app.clubSettings) {
        const next = mergeClubSettings(app.clubSettings);
        setClubSettings(next);
        setRuntimeClubSettings(next);
      }
      if (app.duesSettings) {
        const next = mergeDuesSettings(app.duesSettings);
        setDuesSettings(next);
        setRuntimeDueDay(next.dueDay);
      }
      if (app.poolSettings) {
        setPoolSettings(mergePoolSettings(app.poolSettings));
      }
      if (app.systemRules) {
        setSystemRules(mergeSystemRules(app.systemRules));
      }
      if (Array.isArray(app.paymentPlans)) {
        setPaymentPlans(mergePaymentPlans(app.paymentPlans));
      }
      if (app.facilityCatalog && typeof app.facilityCatalog === 'object') {
        setFacilityCatalog(app.facilityCatalog);
      }
      if (Array.isArray(app.tierCatalog) && app.tierCatalog.length) {
        const cleaned = mergeOfficialTiers(stripExampleTiers(app.tierCatalog));
        setTierCatalog(cleaned.length ? cleaned : app.tierCatalog);
        setRuntimeTierCatalog(cleaned.length ? cleaned : app.tierCatalog);
      }
      if (Array.isArray(app.disciplineCatalog) && app.disciplineCatalog.length) {
        setDisciplineCatalog(app.disciplineCatalog);
      }
      if (typeof app.membersCount === 'number') setMembersCount(app.membersCount);
    };

    // Solo desbloquea UI si el shell crítico no respondió a tiempo.
    // El padrón/ERP en background no deben disparar alarma roja.
    const watchdog = setTimeout(() => {
      if (cancelled || hydratedRef.current) return;
      setDbReady(true);
      setDbSyncing(false);
    }, 10_000);

    (async () => {
      setDbSyncing(true);
      setDbHydrated(false);
      setDbReady(true); // pintar de inmediato con datos locales/semilla
      setDbError('');
      setMembersLoading(isOps);

      /** Cada cuántos socios pintar React; el contador “N de M” sigue en vivo. */
      const MEMBERS_UI_PAINT_STEP = 1500;
      let lastMembersPainted = 0;

      const paintMembers = (rawMembers, {
        keepCount = true,
        expectedCount = 0,
        attachFamily = false,
        loaded = 0,
        total = 0,
        done = false,
        urgent = false,
      } = {}) => {
        const cleaned = (rawMembers || []).filter((m) => !isDemoMember(m));
        const finished = Boolean(done || attachFamily);
        const apply = () => {
          setMembers((prev) => {
            // El download manda la lista acumulada: reemplazar evita merge O(n²) por lote.
            if (!finished && cleaned.length >= ((prev || []).length || 0)) {
              return cleaned;
            }
            const merged = applyMemberListRefresh(
              (prev || []).filter((m) => !isDemoMember(m)),
              cleaned,
              { done: finished },
            );
            return finished ? attachHouseholdToMembers(merged) : merged;
          });
          // El conteo canónico es el de Supabase (expectedCount/total). Nunca lo
          // pisamos con el tamaño del lote en memoria (p. ej. primera página = 1000).
          setMembersCount((prev) => Math.max(
            Number(prev) || 0,
            Number(expectedCount) || 0,
            Number(total) || 0,
          ));
          // Índices DB: solo al terminar (o primer lote) — no en cada ola.
          if (finished || lastMembersPainted === 0) {
            setMemberDbIds((prev) => {
              const next = { ...(prev || {}) };
              for (const member of cleaned) {
                if (member.memberId && member.id) next[member.memberId] = member.id;
              }
              if (finished) {
                const keep = new Set(cleaned.map((member) => String(member.memberId)));
                for (const key of Object.keys(next)) {
                  if (!keep.has(String(key))) delete next[key];
                }
              }
              return next;
            });
          }
          if (loaded || total) {
            setMembersProgress({ loaded: loaded || cleaned.length, total: total || expectedCount || cleaned.length });
          }
        };
        // Primer lote / cierre: inmediato. Olas intermedias: no bloquean la UI.
        if (urgent || finished || lastMembersPainted === 0) apply();
        else startTransition(apply);
      };

      // En la puerta / registro público no bajamos los 5k socios: satura el pool.
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const skipPadron = path.startsWith('/entrada-pileta') || path.startsWith('/registro');
      const membersJob = isOps && !skipPadron
        ? (() => {
          membersLoadStartedRef.current = true;
          return bootstrapMembersFromDb({
            onProgress: (partial, meta) => {
              if (cancelled) return;
              const loadedNow = meta?.loaded || partial?.length || 0;
              const totalNow = meta?.total || 0;
              if (loadedNow || totalNow) {
                if (totalNow) setMembersCount((prev) => Math.max(prev, totalNow));
                setMembersProgress({ loaded: loadedNow, total: totalNow || loadedNow });
              }
              if (!partial?.length) return;
              const finished = Boolean(meta?.done);
              const firstPage = Boolean(meta?.firstPage);
              // Con el primer lote el panel ya es usable; el resto completa en segundo plano.
              if (firstPage || finished) setMembersLoading(false);
              const shouldPaint = finished
                || firstPage
                || lastMembersPainted === 0
                || (loadedNow - lastMembersPainted >= MEMBERS_UI_PAINT_STEP);
              if (!shouldPaint) {
                if (loadedNow || totalNow) {
                  setMembersProgress({ loaded: loadedNow, total: totalNow || loadedNow });
                }
                return;
              }
              lastMembersPainted = loadedNow;
              paintMembers(partial, {
                keepCount: !finished,
                attachFamily: finished,
                done: finished,
                expectedCount: totalNow,
                loaded: loadedNow,
                total: totalNow,
                urgent: firstPage,
              });
            },
          });
        })()
        : null;
      if (isOps && skipPadron) setMembersLoading(false);

      try {
        const data = await bootstrapShellFromDb({
          role,
          memberNumber: user?.memberId || null,
        });
        if (cancelled) return;

        if (!data) {
          setDbError('No se pudo iniciar la sincronización con la base.');
          setMembersLoading(false);
          setDbSyncing(false);
          clearTimeout(watchdog);
          return;
        }

        const { app, erp: erpData, memberDbIds: shellIds } = data;

        if (isOps) {
          setMembers((prev) => {
            const real = (prev || []).filter((m) => !isDemoMember(m));
            return real.length ? real : [];
          });
          if (app.membersCount) {
            setMembersCount((prev) => Math.max(prev, app.membersCount));
          }
        } else {
          const seeded = Array.isArray(app.members) ? app.members : [];
          if (seeded.length) {
            const withFamily = attachHouseholdToMembers(seeded);
            setMembers(withFamily);
            setMembersCount((prev) => Math.max(
              Number(prev) || 0,
              Number(app.membersCount) || 0,
              withFamily.length || 0,
            ));
            setMemberDbIds(shellIds || {});
          }
          setMembersLoading(false);
        }

        applyAppPatch(app);
        erp.applyErpHydration({
          alerts: erpData.alerts || [],
          alertAcks: erpData.alertAcks || [],
          clubEvents: erpData.clubEvents || [],
          eventRegistrations: erpData.eventRegistrations || [],
          concessions: erpData.concessions || [],
        });
        hydratedRef.current = true;
        setDbHydrated(true);
        if (!cancelled) {
          setDbSyncing(false);
          clearTimeout(watchdog);
        }

        const runDeferred = () => {
          bootstrapDeferredFromDb({ role })
            .then((deferred) => {
              if (cancelled || !deferred) return;
              applyAppPatch(deferred.app || {});
              if (deferred.erp) {
                erp.applyErpHydration({
                  alerts: deferred.erp.alerts,
                  alertAcks: deferred.erp.alertAcks,
                  clubEvents: deferred.erp.clubEvents,
                  eventRegistrations: deferred.erp.eventRegistrations,
                });
              }
            })
            .catch(() => {});
        };

        // Ops: padrón y ERP en paralelo. El dump no debe tapar cajas ni reportes.
        // La 1ª página del padrón va sola (repos/members) para no dejar “0 de N”.
        if (isOps) {
          runDeferred();
          const erpJob = bootstrapErpFromDb({
            onPartial: (partial) => {
              if (cancelled || !partial) return;
              erp.applyErpHydration(partial);
            },
          })
            .then((heavy) => {
              if (cancelled || !heavy) return;
              if (Array.isArray(heavy.journalEntries) && heavy.journalEntries.length) {
                setJournalEntries(heavy.journalEntries);
              }
              erp.applyErpHydration({
                chartOfAccounts: heavy.chartOfAccounts,
                cashRegisters: heavy.cashRegisters,
                cashSessions: heavy.cashSessions,
                cashMovements: heavy.cashMovements,
                expenses: heavy.expenses,
                suppliers: heavy.suppliers,
                retenciones: heavy.retenciones,
                supplierPaymentImports: heavy.supplierPaymentImports,
                expenseImports: heavy.expenseImports,
                supplierEntries: heavy.supplierEntries,
                otherIncomes: heavy.otherIncomes,
                unidentifiedCollections: heavy.unidentifiedCollections,
                galiciaDebits: heavy.galiciaDebits,
                fixedExpenses: heavy.fixedExpenses,
                fixedDiscounts: heavy.fixedDiscounts,
                paymentOrders: heavy.paymentOrders,
                concessions: heavy.concessions,
                canonPayments: heavy.canonPayments,
              });
            })
            .catch(() => {});

          (async () => {
            if (!membersJob) {
              await erpJob;
              return;
            }

            try {
              const { members: rawMembers } = await membersJob;
              if (cancelled) return;

              if (rawMembers?.length) {
                paintMembers(rawMembers, {
                  keepCount: false,
                  attachFamily: true,
                  done: true,
                  expectedCount: app.membersCount || 0,
                  loaded: rawMembers.length,
                  total: app.membersCount || 0,
                });
              } else if ((app.membersCount || 0) > 0) {
                setDbError('No se pudo descargar el padrón de socios. Probá recargar.');
              }
              try {
                const exact = await repos.countMembers('active');
                if (!cancelled && exact) {
                  setMembersCount((prev) => Math.max(Number(prev) || 0, Number(exact) || 0));
                }
              } catch {
                /* el header reconsulta al abrir Socios */
              }
            } catch (membersErr) {
              if (!cancelled) {
                setDbError(friendlyDbError(membersErr, 'No se pudo cargar el padrón completo'));
              }
            } finally {
              if (!cancelled) setMembersLoading(false);
            }

            await erpJob;
          })();
        } else {
          runDeferred();
        }
      } catch (err) {
        if (!cancelled) {
          setDbError(friendlyDbError(err, 'No se pudo cargar la base de datos'));
          setMembersLoading(false);
          setDbSyncing(false);
        }
      } finally {
        clearTimeout(watchdog);
        if (!cancelled) {
          setDbReady(true);
          setDbSyncing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudMode, isAuthenticated, authLoading, role, desk, needsDeskChoice, user?.memberId]);

  // Si entraron por la puerta, el padrón se baja al ir al panel.
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || authLoading || needsDeskChoice || desk !== 'ops') return undefined;
    if (location.pathname.startsWith('/entrada-pileta')) return undefined;
    if (location.pathname.startsWith('/registro')) return undefined;
    const isOps = canAccessAdmin(role) || role === 'gate_operator';
    if (!isOps || membersLoadStartedRef.current) return undefined;
    membersLoadStartedRef.current = true;
    let cancelled = false;
    let lastPainted = 0;
    const PAINT_STEP = 2000;
    setMembersLoading(true);
    (async () => {
      try {
        const { members: rawMembers } = await bootstrapMembersFromDb({
          onProgress: (partial, meta) => {
            if (cancelled) return;
            const loadedNow = meta?.loaded || partial?.length || 0;
            const totalNow = meta?.total || 0;
            if (loadedNow || totalNow) {
              if (totalNow) setMembersCount((prev) => Math.max(prev, totalNow));
              setMembersProgress({ loaded: loadedNow, total: totalNow || loadedNow });
            }
            if (!partial?.length) return;
            const cleaned = partial.filter((m) => !isDemoMember(m));
            const finished = Boolean(meta?.done);
            const firstPage = Boolean(meta?.firstPage);
            if (firstPage || finished) setMembersLoading(false);
            const shouldPaint = finished
              || firstPage
              || lastPainted === 0
              || (loadedNow - lastPainted >= PAINT_STEP);
            if (!shouldPaint) return;
            lastPainted = loadedNow;
            setMembers((prev) => {
              if (!finished && cleaned.length >= ((prev || []).length || 0)) return cleaned;
              const merged = applyMemberListRefresh(
                (prev || []).filter((m) => !isDemoMember(m)),
                cleaned,
                { done: finished },
              );
              return finished ? attachHouseholdToMembers(merged) : merged;
            });
            setMembersCount((prev) => Math.max(Number(prev) || 0, Number(totalNow) || 0));
          },
        });
        if (cancelled) return;
        if (rawMembers?.length) {
          const cleaned = rawMembers.filter((m) => !isDemoMember(m));
          setMembers((prev) => attachHouseholdToMembers(applyMemberListRefresh(
            (prev || []).filter((m) => !isDemoMember(m)),
            cleaned,
            { done: true },
          )));
          setMembersCount((prev) => Math.max(Number(prev) || 0, cleaned.length));
          setMembersProgress((prev) => ({
            loaded: cleaned.length,
            total: Math.max(Number(prev?.total) || 0, cleaned.length),
          }));
        }
      } catch (err) {
        if (!cancelled) setDbError(friendlyDbError(err, 'No se pudo cargar el padrón completo'));
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloudMode, isAuthenticated, authLoading, role, location.pathname]);

  // Wrappers de escritura BD para setters usados en vistas
  const isDbUuid = (id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));

  const setEntryLogsDb = (updater) => {
    setEntryLogs((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next) && next.length > (prev?.length || 0)) {
        const newest = next[0];
        if (newest && !isDbUuid(newest.id)) {
          const dbId = newest.memberDbId || memberDbIds[newest.memberId] || null;
          persistOnce(`access:${newest.id}`, () =>
            repos.insertAccessLog(newest, dbId).then((saved) => {
              setEntryLogs((cur) => [saved, ...cur.filter((x) => x !== newest && String(x.id) !== String(newest.id))]);
            }).then(() => undefined, (err) => {
              // La lectura no se pierde: queda en el equipo y se reintenta sola (ver el efecto de la cola).
              enqueueAccessLog(window.localStorage, newest, dbId);
              setDbError(err?.message || 'No se pudo guardar la lectura de acceso en la base de datos');
              throw err;
            }));
        }
      }
      return next;
    });
  };

  // Lecturas de portería que no llegaron a la base (sin señal): se reintentan cada 20 s y al volver internet.
  useEffect(() => {
    if (!cloudMode || !isAuthenticated) return undefined;
    let alive = true;
    const flush = () => {
      if (!alive || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      void drainAccessOutbox(window.localStorage, (log, dbId) => repos.insertAccessLog(log, dbId)).then(({ sent }) => {
        if (alive && sent > 0) setDbError('');
      });
    };
    flush();
    const timer = window.setInterval(flush, 20000);
    window.addEventListener('online', flush);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [cloudMode, isAuthenticated]);

  const setPoolAccessesDb = (updater) => {
    setPoolAccesses((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevById = new Map((prev || []).map((row) => [String(row.id), row]));
        next.forEach((row) => {
          const before = prevById.get(String(row.id));
          const alreadySaved = isDbUuid(row?.id);
          if (!before && row && !alreadySaved) {
            const dbId = row.memberDbId || memberDbIds[row.memberId] || null;
            persistOnce(`pool:${row.id}`, () =>
              repos.insertPoolAccess(row, dbId).then((saved) => {
                setPoolAccesses((cur) => cur.map((item) => {
                  if (String(item.id) !== String(row.id)) return item;
                  if (item.status === 'revoked') {
                    repos.revokePoolAccess(saved.id).catch((err) => {
                      setDbError(err?.message || 'No se pudo revocar el ingreso de pileta');
                    });
                    return { ...saved, status: 'revoked' };
                  }
                  return saved;
                }));
              }).then(() => undefined, (err) => {
                setPoolAccesses((cur) => cur.filter((item) => String(item.id) !== String(row.id)));
                setDbError(err?.message || 'No se pudo guardar el ingreso de pileta');
                throw err;
              }));
          } else if (before && before.status !== 'revoked' && row.status === 'revoked' && alreadySaved) {
            persistOnce(`pool-rev:${row.id}`, () =>
              repos.revokePoolAccess(row.id).then(() => undefined, (err) => {
                setDbError(err?.message || 'No se pudo revocar el ingreso de pileta');
                throw err;
              }));
          }
        });
      }
      return next;
    });
  };

  const refreshMessages = useCallback(async () => {
    if (!cloudMode || !isAuthenticated) return;
    try {
      const list = await repos.listMessages({
        limit: 120,
        memberNumber: user?.memberId || undefined,
        forStaff: userRole !== 'member',
      });
      setMessages((prev) => {
        const reader = messageReaderKey({ userId: user?.id, memberId: user?.memberId });
        const fromDb = withRememberedReads(list || [], reader, prev);
        const dbIds = new Set(fromDb.map((m) => String(m.id)));
        const dbClientIds = new Set(fromDb.map((m) => m.clientId).filter(Boolean).map(String));
        // Conservar envíos locales aún no confirmados (evita que el poll borre el alta)
        const pending = (prev || []).filter(
          (m) => !isDbUuid(m.id) && !dbIds.has(String(m.id)) && !dbClientIds.has(String(m.id))
        );
        return pending.length ? [...pending, ...fromDb] : fromDb;
      });
    } catch {
      /* silencioso: no pisar bandeja local ante un fallo puntual */
    }
  }, [cloudMode, isAuthenticated, user?.id, user?.memberId, userRole]);

  // Envío garantizado a BD (evita “enviado” fantasma si el insert falla)
  const sendMessage = useCallback(async (msg) => {
    if (!msg) throw new Error('Mensaje vacío');
    if (!cloudMode) {
      setMessages((prev) => [msg, ...(prev || [])]);
      return msg;
    }
    setMessages((prev) => [msg, ...(prev || [])]);
    try {
      const saved = await repos.insertMessage(msg);
      setMessages((cur) => [saved, ...(cur || []).filter((x) => String(x.id) !== String(msg.id))]);
      return saved;
    } catch (err) {
      setMessages((cur) => (cur || []).filter((x) => String(x.id) !== String(msg.id)));
      const message = err?.message || 'No se pudo enviar el mensaje a la base de datos';
      setDbError(message);
      throw new Error(message, { cause: err });
    }
  }, [cloudMode]);

  // Campanita / badge: poll + realtime fuera de /mensajes
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || !dbReady) return undefined;
    void refreshMessages();
    const onFocus = () => { void refreshMessages(); };
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshMessages();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    const timer = window.setInterval(() => { void refreshMessages(); }, 12000);

    let channel = null;
    if (supabase) {
      channel = supabase
        .channel('messages-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages' },
          () => { void refreshMessages(); }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(timer);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [cloudMode, isAuthenticated, dbReady, refreshMessages]);

  const refreshMembershipApplications = useCallback(async () => {
    if (!cloudMode || !isAuthenticated) return;
    if (!allowedAdminTabs(userRole).includes('members')) return;
    try {
      const list = await repos.listMembershipApplications();
      setMembershipApplications(list || []);
    } catch {
      /* la campanita sigue con lo último que había */
    }
  }, [cloudMode, isAuthenticated, userRole]);

  useEffect(() => {
    if (!cloudMode || !isAuthenticated || !dbReady) return undefined;
    if (!allowedAdminTabs(userRole).includes('members')) return undefined;
    void refreshMembershipApplications();
    const onFocus = () => { void refreshMembershipApplications(); };
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshMembershipApplications();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    const timer = window.setInterval(() => { void refreshMembershipApplications(); }, 12000);

    let channel = null;
    if (supabase) {
      channel = supabase
        .channel('membership-applications-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'membership_applications' },
          () => { void refreshMembershipApplications(); }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(timer);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [cloudMode, isAuthenticated, dbReady, userRole, refreshMembershipApplications]);

  const refreshMembersLive = useCallback(async () => {
    if (!cloudMode || !isAuthenticated) return;
    if (!(canAccessAdmin(role) || role === 'gate_operator')) return;
    const gen = membersRefreshGen.current + 1;
    membersRefreshGen.current = gen;
    repos.invalidateMembersListCache();
    try {
      const { members: rawMembers } = await bootstrapMembersFromDb({
        onProgress: (_partial, meta) => {
          if (gen !== membersRefreshGen.current) return;
          const loadedNow = meta?.loaded || 0;
          const totalNow = meta?.total || 0;
          // Con padrón ya en pantalla solo movemos el contador; pintamos al final.
          if (loadedNow || totalNow) {
            if (totalNow) setMembersCount((prev) => Math.max(prev, totalNow));
            setMembersProgress({ loaded: loadedNow, total: totalNow || loadedNow });
          }
        },
      });
      if (gen !== membersRefreshGen.current) return;
      if (rawMembers?.length) {
        const cleaned = rawMembers.filter((m) => !isDemoMember(m));
        setMembers((prev) => attachHouseholdToMembers(applyMemberListRefresh(
          (prev || []).filter((m) => !isDemoMember(m)),
          cleaned,
          { done: true },
        )));
        setMembersCount((prev) => Math.max(Number(prev) || 0, cleaned.length));
        setMembersProgress((prev) => ({
          loaded: cleaned.length,
          total: Math.max(Number(prev?.total) || 0, cleaned.length),
        }));
      }
      try {
        const exact = await repos.countMembers('active');
        if (gen === membersRefreshGen.current && exact) {
          setMembersCount((prev) => Math.max(Number(prev) || 0, Number(exact) || 0));
        }
      } catch {
        /* el conteo exacto se reintenta en el próximo refresh */
      }
    } catch {
      /* el padrón visible se queda con el último corte */
    }
  }, [cloudMode, isAuthenticated, role]);

  useEffect(() => {
    if (!cloudMode || !isAuthenticated || !dbReady) return undefined;
    if (!(canAccessAdmin(role) || role === 'gate_operator')) return undefined;

    let debounce = 0;
    let lastFocusRefresh = 0;
    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { void refreshMembersLive(); }, 2500);
    };
    const refreshIfStale = () => {
      if (Date.now() - lastFocusRefresh < 60_000) return;
      lastFocusRefresh = Date.now();
      void refreshMembersLive();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', onVis);

    let channel = null;
    if (supabase) {
      channel = supabase
        .channel('members-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'members' },
          schedule,
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(debounce);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [cloudMode, isAuthenticated, dbReady, role, refreshMembersLive]);

  const setMessagesDb = useCallback((updater) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (!Array.isArray(next)) return next;
      const reader = messageReaderKey({ userId: user?.id, memberId: user?.memberId });
      next.forEach((m) => {
        const old = prev.find((p) => String(p.id) === String(m.id));
        if (old && !old.isRead && m.isRead) rememberReadMessage(reader, m.id);
      });
      if (!cloudMode) return next;

      // Alta de mensaje nuevo (id local msg-… / numérico → insert en BD)
      // Preferir sendMessage() desde la UI; este camino queda como fallback.
      if (next.length > prev.length) {
        const newest = next[0];
        if (newest && !isDbUuid(newest.id)) {
          const alreadyPending = prev.some((p) => String(p.id) === String(newest.id));
          if (!alreadyPending) {
            repos.insertMessage(newest).then((saved) => {
              setMessages((cur) => [saved, ...cur.filter((x) => String(x.id) !== String(newest.id))]);
            }).catch((err) => {
              setMessages((cur) => cur.filter((x) => String(x.id) !== String(newest.id)));
              setDbError(err?.message || 'No se pudo enviar el mensaje a la base de datos');
            });
          }
        }
      } else {
        next.forEach((m) => {
          const old = prev.find((p) => String(p.id) === String(m.id));
          if (!(old && !old.isRead && m.isRead)) return;
          // is_read de un aviso a todos es compartido: no se pisa para el resto de los socios.
          if (isDbUuid(m.id) && m.recipientId !== 'all') {
            repos.updateMessage(m.id, { isRead: true }).catch((err) => {
              setDbError(err?.message || 'No se pudo marcar el mensaje como leído');
            });
          }
        });
      }
      return next;
    });
  }, [cloudMode, user?.id, user?.memberId]);

  const setClaimsDb = (updater) => {
    setClaims((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        if (next.length > prev.length) {
          const newest = next[0];
          const dbId = memberDbIds[newest.memberId];
          repos.upsertClaim(newest, dbId).then((saved) => {
            setClaims((cur) => [saved, ...cur.filter((x) => x.id !== newest.id)]);
          }).catch(() => {});
        } else {
          next.forEach((c) => {
            const old = prev.find((p) => p.id === c.id);
            if (old && JSON.stringify(old) !== JSON.stringify(c) && String(c.id).includes('-')) {
              repos.upsertClaim(c, memberDbIds[c.memberId]).catch(() => {});
            }
          });
        }
      }
      return next;
    });
  };

  const setGuestPassesDb = (updater) => {
    setGuestPasses((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next) && next.length > prev.length) {
        const newest = next[0];
        const hostDb = memberDbIds[newest.hostMemberId];
        repos.upsertGuestPass(newest, hostDb).catch(() => {});
      }
      return next;
    });
  };

  const setWaitlistDb = (updater) => {
    setWaitlist((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        repos.replaceWaitlist(next, memberDbIds).catch(() => {});
      }
      return next;
    });
  };

  const setStaffMembersDb = (updater) => {
    setStaffMembers((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        next.forEach((emp) => {
          const old = prev.find((p) => p.id === emp.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(emp)) {
            repos.upsertEmployee(emp).catch(() => {});
          }
        });
      }
      return next;
    });
  };

  const setStaffHrDb = (updater) => {
    setStaffHrRecords((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next) && next.length > prev.length) {
        const newest = next[0];
        repos.insertHrRecord(newest).then((saved) => {
          setStaffHrRecords((cur) => [saved, ...cur.filter((x) => x.id !== newest.id)]);
        }).catch(() => {});
      }
      return next;
    });
  };

  const setSurveysDb = (updater) => {
    setSurveys((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevById = new Map(prev.map((s) => [String(s.id), s]));
        const nextIds = new Set(next.map((s) => String(s.id)));

        next.forEach((survey) => {
          const old = prevById.get(String(survey.id));
          if (!old) {
            repos.upsertSurvey(survey).then((saved) => {
              setSurveys((cur) =>
                cur.map((x) => (String(x.id) === String(survey.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo guardar la encuesta'));
            return;
          }
          if (JSON.stringify(old) !== JSON.stringify(survey)) {
            repos.upsertSurvey(survey).then((saved) => {
              setSurveys((cur) =>
                cur.map((x) => (String(x.id) === String(saved.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo actualizar la encuesta'));
          }
        });

        prev.forEach((survey) => {
          if (!nextIds.has(String(survey.id))) {
            repos.deleteSurvey(survey.id).catch(() => {});
          }
        });
      }
      return next;
    });
  };

  const setNewsDb = (updater) => {
    setNewsList((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevById = new Map(prev.map((n) => [String(n.id), n]));
        const nextIds = new Set(next.map((n) => String(n.id)));
        const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(String(id || ''));

        next.forEach((article) => {
          const old = prevById.get(String(article.id));
          if (!old) {
            repos.upsertNews(article).then((saved) => {
              setDbError('');
              setNewsList((cur) =>
                cur.map((x) => (String(x.id) === String(article.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo guardar la noticia'));
            return;
          }
          if (JSON.stringify(old) !== JSON.stringify(article)) {
            repos.upsertNews(article).then((saved) => {
              setDbError('');
              setNewsList((cur) =>
                cur.map((x) => (String(x.id) === String(article.id) ? saved : x))
              );
            }).catch((err) => setDbError(err.message || 'No se pudo actualizar la noticia'));
          }
        });

        prev.forEach((article) => {
          if (!nextIds.has(String(article.id))) {
            const id = article.id;
            if (isUuid(id)) {
              repos.deleteNews(id).catch(() => {});
            }
          }
        });
      }
      return next;
    });
  };

  const setMembersDb = (updater) => {
    setMembers((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (cloudMode && Array.isArray(next)) {
        const prevIds = new Set(prev.map((m) => m.memberId));
        next.forEach((m) => {
          const old = prev.find((p) => p.memberId === m.memberId);
          if (old && JSON.stringify(old) === JSON.stringify(m)) return;
          const newest = localDuesPayment(old, m);
          if (newest) {
            const withId = { ...m, id: m.id || memberDbIds[m.memberId] };
            commitDuesCollection(withId, newest).then((committed) => {
              setDbError('');
              setMembers((cur) => cur.map((x) => (
                x.memberId === m.memberId ? { ...x, ...committed.member } : x
              )));
              if (committed.member.id) {
                setMemberDbIds((ids) => ({ ...ids, [committed.member.memberId]: committed.member.id }));
              }
            }).catch(async (err) => {
              let restored = null;
              try {
                restored = await repos.getMemberByNumber(m.memberId, { withPayments: true });
              } catch {
                restored = null;
              }
              const hadPayment = (restored?.paymentHistory || []).length > (old?.paymentHistory || []).length;
              if (restored && hadPayment) {
                setMembers((cur) => cur.map((x) => (
                  x.memberId === m.memberId ? { ...x, ...restored } : x
                )));
                setDbError('El cobro quedó registrado. Actualicé la ficha con lo que está en la base.');
                return;
              }
              if (old) {
                setMembers((cur) => cur.map((x) => (x.memberId === m.memberId ? old : x)));
              }
              setDbError(err?.message || 'No se pudo registrar el cobro. El saldo no cambió.');
            });
            return;
          }
          const justPaid = isPersistedPaymentId((m.paymentHistory || [])[0]?.id)
            && (m.paymentHistory || []).length > (old?.paymentHistory || []).length;
          repos.upsertMember(m).then((saved) => {
            setMemberDbIds((ids) => ({ ...ids, [saved.memberId]: saved.id }));
            setMembers((cur) => cur.map((x) => {
              if (x.memberId !== saved.memberId) return x;
              if (!prevIds.has(m.memberId)) return { ...x, ...saved };
              return { ...x, id: saved.id || x.id, outstandingBalance: saved.outstandingBalance };
            }));
          }).catch((err) => {
            setDbError(justPaid
              ? 'El cobro quedó registrado, pero no se pudo guardar el resto de la ficha.'
              : (err?.message || 'No se pudo guardar el socio'));
          });
        });
      }
      return next;
    });
  };

  const messageIdentity = {
    userId: user?.id,
    memberId: user?.memberId || null,
    role: userRole,
  };
  const unreadMessages = isAuthenticated ? countUnread(messages, messageIdentity) : 0;

  const [dismissedNotifIds, setDismissedNotifIds] = useState(() => loadDismissedNotificationIds());

  // Lecturas de campanita desde BD
  useEffect(() => {
    if (!cloudMode || !isAuthenticated || !dbReady || !user?.id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const keys = await repos.listNotificationReads();
        if (cancelled) return;
        setDismissedNotifIds((prev) => saveDismissedNotificationIds([...prev, ...(keys || [])]));
      } catch {
        /* local sigue como fallback */
      }
    })();
    return () => { cancelled = true; };
  }, [cloudMode, isAuthenticated, dbReady, user?.id]);

  const sessionMember = user?.memberId
    ? (ownMember || members.find((m) => String(m.memberId) === String(user.memberId)) || null)
    : null;
  const memberSeesCurrentAccount = duesSettings?.showCurrentAccountsToMembers !== false;
  const duesNotice = userRole === 'member' && sessionMember
    ? duesBellItem(sessionMember)
    : null;
  const duesOverdue = Boolean(duesNotice?.id?.startsWith('dues-overdue-'));
  const duesDueSoon = Boolean(duesNotice && !duesOverdue);

  // Campanita: solo datos reales de la sesión (sin semillas / sin socio fallback)
  const notifications = useMemo(() => (
    (!isAuthenticated || (cloudMode && dbSyncing && !dbHydrated))
      ? []
      : buildNotifications({
        role: userRole,
        userId: user?.id,
        memberId: user?.memberId || null,
        member: sessionMember,
        messages,
        waitlist,
        claims,
        reservations,
        membershipApplications,
        unidentifiedCollections: erp.unidentifiedCollections || [],
        alerts: erp.alerts || [],
        alertAcks: erp.alertAcks || [],
        dismissedIds: dismissedNotifIds,
        membersCanViewCurrentAccounts: memberSeesCurrentAccount,
      })
  ), [
    isAuthenticated, cloudMode, dbSyncing, dbHydrated, userRole, user?.id, user?.memberId,
    sessionMember, messages, waitlist, claims, reservations, membershipApplications,
    erp.unidentifiedCollections, erp.alerts, erp.alertAcks, dismissedNotifIds,
    memberSeesCurrentAccount,
  ]);

  const dueNoticeId = notifications.find((n) => /^(dues-upcoming-|dues-due-|dues-overdue-)/.test(String(n.id)))?.id || '';
  useEffect(() => {
    // Avisos de cuota pausados hasta auditoría (dues.noticesPaused).
    if (!dueNoticeId || !cloudMode || !user?.id) return undefined;
    if (duesSettings?.noticesPaused || (duesSettings?.noticeByMessage === false && duesSettings?.noticeByEmail === false)) {
      return undefined;
    }
    repos.requestOwnDueNotice().catch(() => {});
    return undefined;
  }, [dueNoticeId, cloudMode, user?.id, duesSettings?.noticesPaused, duesSettings?.noticeByMessage, duesSettings?.noticeByEmail]);

  const dismissNotification = useCallback((notifId, notif = null) => {
    if (!notifId) return;
    setDismissedNotifIds((prev) => saveDismissedNotificationIds([...prev, notifId]));
    if (cloudMode && user?.id) {
      repos.markNotificationRead(notifId, user.id).catch(() => {});
    }
    if (notif?.kind === 'message' && notif.messageId) {
      setMessagesDb((prev) => markMessageRead(prev, notif.messageId));
    }
  }, [cloudMode, user?.id, setMessagesDb]);

  const handleNotificationOpen = useCallback((notif) => {
    if (!notif) return;
    dismissNotification(notif.id, notif);
    if (notif.path) navigate(notif.path);
    else if (notif.view) setCurrentView(notif.view);
  }, [dismissNotification, navigate, setCurrentView]);

  const handleMarkAllNotificationsRead = useCallback(() => {
    const messagesOnly = notifications.filter((n) => n.kind === 'message');
    const ids = messagesOnly.map((n) => n.id);
    if (!ids.length) return;
    setDismissedNotifIds((prev) => saveDismissedNotificationIds([...prev, ...ids]));
    messagesOnly.forEach((n) => {
      if (n.messageId) setMessagesDb((prev) => markMessageRead(prev, n.messageId));
    });
    if (cloudMode && user?.id) {
      repos.markNotificationsRead(ids, user.id).catch(() => {});
    }
  }, [notifications, cloudMode, user?.id, setMessagesDb]);

  // Confirmar/Desconfirmar asistencia a evento (Socio)
  const toggleEventRSVP = async (eventId) => {
    const memberNumber = activeMember?.memberId;
    setRsvpList((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      // Compat: rsvpList puede ser array de ids o de objetos
      const has = list.some((x) => x === eventId || x?.newsId === eventId);
      if (has) {
        return list.filter((x) => x !== eventId && x?.newsId !== eventId);
      }
      const entry = {
        newsId: eventId,
        memberId: memberNumber,
        memberName: activeMember?.name,
        status: 'going',
      };
      if (cloudMode && memberNumber) {
        repos.upsertRsvp(entry, memberDbIds[memberNumber]).then((saved) => {
          setRsvpList((cur) => {
            const base = Array.isArray(cur) ? cur.filter((x) => x !== eventId && x?.newsId !== eventId) : [];
            return [...base, saved];
          });
        }).catch(() => {});
      }
      return [...list, entry];
    });
  };

  if (authLoading) {
    return (
      <div className="app-container">
        <BrandSplash page message="Cargando sesión…" detail="Validando credenciales.">
          {dbError && <p style={{ color: 'var(--danger-accent)', fontSize: '0.85rem', margin: 0 }}>{dbError}</p>}
        </BrandSplash>
      </div>
    );
  }

  const isPublicRegistro = location.pathname.startsWith('/registro');

  if (needsDeskChoice) {
    return (
      <div className="app-container is-public-login" data-theme="light">
        <div className="ambient-glow ambient-glow-1" />
        <div className="ambient-glow ambient-glow-2" />
        <main className="main-content">
          <SessionDeskGate />
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className={`app-container${isPublicRegistro ? ' is-public-join' : ' is-public-login'}`}
        data-theme="light"
      >
        {!isPublicRegistro ? (
          <>
            <div className="ambient-glow ambient-glow-1" />
            <div className="ambient-glow ambient-glow-2" />
          </>
        ) : null}
        <main
          className="main-content"
          style={isPublicRegistro ? { padding: 0, maxWidth: 'none' } : undefined}
        >
          <PublicRoutes
            pathname={location.pathname}
            concessions={erp.concessions || []}
            canonPayments={erp.canonPayments || []}
          />
        </main>
      </div>
    );
  }

  const isAccessGate = location.pathname.startsWith('/acceso');
  const isPoolGate = location.pathname.startsWith('/pileta') || location.pathname.startsWith('/entrada-pileta');
  const isStandaloneOps = isAccessGate || isPoolGate || isPublicRegistro;

  return (
    <div className={`app-container${isPublicRegistro ? ' is-public-join' : ''}`}>
      {/* Luces de Fondo Decorativas Ambientales */}
      <div className="ambient-glow ambient-glow-1" />
      <div className="ambient-glow ambient-glow-2" />

      {!isStandaloneOps && (
            <Navbar
          currentView={currentView}
          setCurrentView={setCurrentView}
          theme={theme}
          toggleTheme={toggleTheme}
          notifications={notifications}
          unreadMessages={unreadMessages}
          duesOverdue={duesOverdue}
          duesDueSoon={duesDueSoon}
          membersCanViewCurrentAccounts={memberSeesCurrentAccount}
          onOpenNotification={handleNotificationOpen}
          onDismissNotification={(id) => {
            const n = notifications.find((x) => String(x.id) === String(id));
            dismissNotification(id, n || null);
          }}
          onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        />
      )}

      {!isStandaloneOps && (
        <a href="#contenido-principal" className="skip-link">Saltar al contenido</a>
      )}

      {/* Contenido Principal */}
      <main
        id="contenido-principal"
        className="main-content"
        tabIndex={-1}
        style={isStandaloneOps ? { padding: 0, maxWidth: 'none' } : undefined}
      >
        {!isStandaloneOps && (
          <>
            <SessionStatusBar />
            {(() => {
              if (!dbSyncing && !membersLoading) return null;
              const label = dbSyncing
                ? 'Actualizando datos del club…'
                : (membersProgress.total
                  ? `Cargando padrón de socios… ${membersProgress.loaded.toLocaleString('es-AR')} de ${membersProgress.total.toLocaleString('es-AR')}`
                  : (membersProgress.loaded
                    ? `Cargando padrón de socios… ${membersProgress.loaded.toLocaleString('es-AR')}`
                    : 'Cargando padrón de socios…'));
              return (
                <p className="club-load-status" role="status" aria-live="polite">
                  {label}
                </p>
              );
            })()}
            {dbError ? (
              <p className="conc-error" role="alert" aria-live="assertive" style={{ margin: '0 0 0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 12rem' }}>{dbError}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDbError('')}
                >
                  Cerrar
                </button>
              </p>
            ) : null}
            <AlertsBanner
              alerts={erp.alerts}
              alertAcks={erp.alertAcks}
              userRole={userRole}
              onAck={(alert) => erp.ackAlert(alert, user?.id || 'local-user')}
              excludeSources={['concession_expiry', 'concession_docs']}
            />
          </>
        )}
        <ClubRoutes
          activeMember={activeMember}
          addReservation={addReservation}
          attendanceSessions={attendanceSessions}
          cancelReservation={cancelReservation}
          claims={claims}
          cloudMode={cloudMode}
          clubSettings={clubSettings}
          disciplineCatalog={disciplineCatalog}
          duesNotice={duesNotice}
          duesSettings={duesSettings}
          entryLogs={entryLogs}
          erp={erp}
          facilityCatalog={facilityCatalog}
          guestPasses={guestPasses}
          isOnline={isOnline}
          isOperativeRole={isOperativeRole}
          isZondaActive={isZondaActive}
          journalEntries={journalEntries}
          memberSeesCurrentAccount={memberSeesCurrentAccount}
          members={members}
          membersCount={membersCount}
          membersLoading={membersLoading}
          membersProgress={membersProgress}
          membershipApplications={membershipApplications}
          messages={messages}
          newsList={newsList}
          pathForView={pathForView}
          paymentPlans={paymentPlans}
          persistReservation={persistReservation}
          updateReservationStatus={updateReservationStatus}
          poolAccesses={poolAccesses}
          poolSettings={poolSettings}
          portalAccessRequests={portalAccessRequests}
          refreshMessages={refreshMessages}
          registeredUsersCount={registeredUsersCount}
          reservations={reservations}
          rsvpList={rsvpList}
          sendMessage={sendMessage}
          setAttendanceSessions={setAttendanceSessions}
          setClaimsDb={setClaimsDb}
          setClubSettings={saveClubSettings}
          setCurrentView={setCurrentView}
          setDisciplineCatalog={saveDisciplineCatalog}
          setDuesSettings={saveDuesSettings}
          setEntryLogsDb={setEntryLogsDb}
          setFacilityCatalog={saveFacilityCatalog}
          setGuestPassesDb={setGuestPassesDb}
          setIsZondaActive={saveIsZondaActive}
          setJournalEntries={setJournalEntries}
          setMembersDb={setMembersDb}
          setMembershipApplications={setMembershipApplications}
          setMessagesDb={setMessagesDb}
          setNewsDb={setNewsDb}
          setPaymentPlans={savePaymentPlans}
          setPoolAccessesDb={setPoolAccessesDb}
          setPoolSettings={savePoolSettings}
          setPortalAccessRequests={setPortalAccessRequests}
          setRegisteredUsersCount={setRegisteredUsersCount}
          setReservations={setReservations}
          setStaffHrDb={setStaffHrDb}
          setStaffMembersDb={setStaffMembersDb}
          setSurveysDb={setSurveysDb}
          setSyncQueue={setSyncQueue}
          setSystemRules={saveSystemRules}
          setTierCatalog={saveTierCatalog}
          setWaitlistDb={setWaitlistDb}
          staffHrRecords={staffHrRecords}
          staffMembers={staffMembers}
          surveys={surveys}
          syncQueue={syncQueue}
          systemRules={systemRules}
          tierCatalog={tierCatalog}
          toggleEventRSVP={toggleEventRSVP}
          updateMember={updateMember}
          user={user}
          userRole={userRole}
          waitlist={waitlist}
        />
      </main>

      {!isStandaloneOps && (
        <footer className="app-footer">
          <div className="app-footer-brand">
            <span style={{ fontSize: '0.95rem' }}><JockeyWordmark /></span>
          </div>
          <SilksBand height={5} className="app-footer-silks" />
          <p className="serif-font" style={{ fontSize: '1rem', color: 'var(--text-gold)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            {clubSettings.name}
          </p>
          <p style={{ marginBottom: '0.35rem' }}>
            {clubFooterLine(clubSettings)}
          </p>
          <p style={{ fontSize: '0.75rem', marginBottom: '0.35rem' }}>
            Unión de Rugby de Cuyo · Federación Hípica de San Juan
          </p>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Jockey Connect v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
          </p>
        </footer>
      )}
    </div>
  );
}
