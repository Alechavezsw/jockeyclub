import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users, Calendar, DollarSign, Activity, CreditCard, Check, ShieldAlert,
  Clock, BookOpen, ClipboardList, MessageSquare, Phone,
  FileSpreadsheet, Radio, Database, BellRing, PartyPopper, Trophy, Store, DoorOpen, QrCode, Newspaper,
  LayoutDashboard, ChevronRight, Briefcase, Headset, Settings,
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
import DuesControlTab from '../components/admin/DuesControlTab';
import DisciplinesTab from '../components/admin/DisciplinesTab';
import AccessLogsTab from '../components/admin/AccessLogsTab';
import ClubFacilitiesPanel from '../components/admin/ClubFacilitiesPanel';
import NewsCmsTab from '../components/admin/NewsCmsTab';
import SystemAdminTab from '../components/admin/SystemAdminTab';
import PortalUserProfilePanel from '../components/admin/PortalUserProfilePanel';
import { DEFAULT_CHART_OF_ACCOUNTS, resolveAccountId } from '../domain/accounting/chartOfAccounts';
import { getAccountBalance as domainAccountBalance } from '../domain/accounting/journal';
import { allowedAdminTabs, allowedAdminTabsForRoles, canAccessConcessions, canAccessQrGate, ROLE_LABELS, ROLE_PANEL_META } from '../domain/auth/roles';
import { getOverdueMembers, getUpcomingDuesMembers } from '../domain/members/dues';
import { useAuth } from '../context/AuthContext';

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
  erp = {},
  latestNews = [],
  setNewsList,
  disciplineCatalog = [],
  setDisciplineCatalog,
  tierCatalog = [],
  setTierCatalog,
  userRole = 'admin',
  isZondaActive = false,
}) {
  const { user } = useAuth();
  const chartOfAccounts = erp.chartOfAccounts || DEFAULT_CHART_OF_ACCOUNTS;
  const permittedTabs = allowedAdminTabsForRoles(user?.roles?.length ? user.roles : userRole);
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

  const profileMember = activeTab === 'members' && routeEntityId
    ? members.find((m) => m.memberId === routeEntityId) || null
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

  const totalActivos = getCategoryTotal(['Caja General', 'Caja Cantina', 'Banco Nación', 'Equipamiento Canchas', 'Caballos Criollos']);
  const totalPasivos = getCategoryTotal(['Proveedores Hípicos', 'Sueldos a Pagar', 'Impuestos Pendientes']);
  const totalPatrimonioNetoBase = getCategoryTotal(['Capital Social', 'Resultados Acumulados']);

  const totalIngresos = getCategoryTotal(['Cuotas Sociales', 'Reservas e Instalaciones', 'Concesión Gastronómica', 'Eventos y Fiestas']);
  const totalGastos = getCategoryTotal(['Sueldos y Jornales', 'Mantenimiento de Canchas', 'Alimento Equino', 'Servicios e Insumos']);
  const utilidadNeta = totalIngresos - totalGastos;
  const totalPatrimonioNetoTotal = totalPatrimonioNetoBase + utilidadNeta;

  const totalMembers = members.length;
  const activeBookingsCount = reservations.filter(res => res.status === 'confirmed').length;
  const pendingBookingsCount = reservations.filter(res => res.status === 'pending').length;

  const paidMembers = members.filter(m => (Number(m.outstandingBalance) || 0) === 0).length;
  const overdueMembers = getOverdueMembers(members);
  const overdueMembersCount = overdueMembers.length;
  const upcomingDuesCount = getUpcomingDuesMembers(members, { withinDays: 15 }).length;
  const paymentCollectionRate = totalMembers > 0 ? Math.round((paidMembers / totalMembers) * 100) : 0;
  const totalOutstanding = members.reduce((sum, m) => sum + (Number(m.outstandingBalance) || 0), 0);

  // Indicadores operativos para dashboards por rol
  const totalCashOnHand = getCategoryTotal(['Caja General', 'Caja Cantina', 'Banco Nación']);
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
          box-shadow: 0 0 15px rgba(207, 161, 58, 0.2);
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
          background-color: #10b981;
          color: #10b981;
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
          color: #10b981;
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
      {activeTab !== 'dashboard' && (
        <div className="page-header">
          <div>
            <h1 className="page-title">{panelMeta.title}</h1>
            <p className="page-subtitle">{panelMeta.subtitle}</p>
          </div>
        </div>
      )}

      {/* Tarjetas de Métricas según el rol (ocultas en Inicio: el dashboard ya las resume) */}
      {activeTab !== 'dashboard' && (
      <div className="admin-metrics">
        {(() => {
          const metricsByRole = {
            staff: [
              { icon: <Calendar size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Reservas Activas', value: activeBookingsCount, valueColor: 'var(--emerald-accent)', sub: 'Turnos confirmados de canchas' },
              { icon: <Clock size={20} />, bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', title: 'Reservas Pendientes', value: pendingBookingsCount, valueColor: '#f59e0b', sub: 'A la espera de confirmación' },
              { icon: <MessageSquare size={20} />, bg: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', title: 'Reclamos Abiertos', value: pendingClaimsCount, valueColor: '#818cf8', sub: 'Pedidos de socios sin resolver' },
              { icon: <ClipboardList size={20} />, bg: 'rgba(207, 161, 58, 0.1)', color: 'var(--primary-gold)', title: 'Personal en Servicio', value: activeStaffCount, sub: 'Empleados activos hoy' },
            ],
            cashier: [
              { icon: <DollarSign size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Total en Caja y Bancos', value: formatCurrency(totalCashOnHand), valueColor: 'var(--emerald-accent)', compact: true, sub: 'Caja General + Cantina + Banco Nación' },
              { icon: <Check size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Recaudación Cuotas', value: `${paymentCollectionRate}%`, valueColor: 'var(--emerald-accent)', sub: `${paidMembers} de ${totalMembers} socios al día` },
              { icon: <ShieldAlert size={20} />, bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', title: 'Deuda Pendiente', value: formatCurrency(totalOutstanding), valueColor: '#f59e0b', compact: true, sub: 'Cuotas sociales a cobrar' },
              { icon: <Users size={20} />, bg: 'rgba(207, 161, 58, 0.1)', color: 'var(--primary-gold)', title: 'Padrón Social', value: totalMembers, sub: 'Membresías titulares activas' },
            ],
            accountant: [
              { icon: <CreditCard size={20} />, bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', title: 'Activos Totales', value: formatCurrency(totalActivos), compact: true, sub: `Pasivos: ${formatCurrency(totalPasivos)}` },
              { icon: <BookOpen size={20} />, bg: 'rgba(207, 161, 58, 0.1)', color: 'var(--primary-gold)', title: 'Patrimonio Neto', value: formatCurrency(totalPatrimonioNetoTotal), compact: true, sub: 'Incluye resultado del ejercicio' },
              { icon: <Activity size={20} />, bg: utilidadNeta >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', title: 'Resultado del Ejercicio', value: formatCurrency(utilidadNeta), valueColor: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', compact: true, sub: `Ingresos ${formatCurrency(totalIngresos)} · Gastos ${formatCurrency(totalGastos)}` },
              { icon: <DollarSign size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Recaudación Cuotas', value: `${paymentCollectionRate}%`, valueColor: 'var(--emerald-accent)', sub: `Pendiente: ${formatCurrency(totalOutstanding)}` },
            ],
            admin: [
              { icon: <Users size={20} />, bg: 'rgba(207, 161, 58, 0.1)', color: 'var(--primary-gold)', title: 'Padrón Social', value: totalMembers, sub: 'Membresías titulares activas' },
              { icon: <DollarSign size={20} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)', title: 'Recaudación Cuotas', value: `${paymentCollectionRate}%`, valueColor: 'var(--emerald-accent)', sub: `Pendiente: ${formatCurrency(totalOutstanding)}` },
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
              { icon: <CreditCard size={20} />, bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', title: 'Activos Totales', value: formatCurrency(totalActivos), compact: true, sub: `Equilibrio PN: ${formatCurrency(totalPasivos + totalPatrimonioNetoTotal)}` },
              { icon: <Activity size={20} />, bg: utilidadNeta >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', title: 'Utilidad del Ejercicio', value: formatCurrency(utilidadNeta), valueColor: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', compact: true, sub: 'Ingresos del mes de Mayo' },
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
          onAckAlert={erp.ackAlert}
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
          registeredUsersCount={registeredUsersCount}
          membershipApplications={membershipApplications}
        />
      )}

      {activeTab === 'dues' && (
        <DuesControlTab
          members={members}
          setMembers={setMembers}
          addJournalEntry={addJournalEntry}
          formatCurrency={formatCurrency}
          tierCatalog={tierCatalog}
        />
      )}

      {activeTab === 'members' && (
        routeEntityId ? (
          <MemberProfilePanel
            member={profileMember}
            onBack={() => navigate('/panel/members')}
            formatCurrency={formatCurrency}
            journalEntries={journalEntries}
            entryLogs={entryLogs}
            reservations={reservations}
            claims={claims}
            messages={messages}
            tierCatalog={tierCatalog}
          />
        ) : (
          <MembersTab
            members={members}
            setMembers={setMembers}
            addJournalEntry={addJournalEntry}
            formatCurrency={formatCurrency}
            onOpenProfile={(id) => navigate(`/panel/members/${id}`)}
            disciplineOptions={(disciplineCatalog || []).filter((d) => d.isActive !== false).map((d) => d.name)}
            tierCatalog={tierCatalog}
            setTierCatalog={setTierCatalog}
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

      {activeTab === 'access' && (
        <AccessLogsTab
          entryLogs={entryLogs}
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
          paymentOrders={erp.paymentOrders}
          upsertPaymentOrder={erp.upsertPaymentOrder}
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

      {activeTab === 'events' && (
        <div className="glass-card fade-in" style={{ padding: '1.25rem' }}>
          <ClubEventsPanel
            clubEvents={erp.clubEvents || []}
            eventRegistrations={erp.eventRegistrations || []}
            members={members}
            addClubEvent={erp.addClubEvent}
            registerMemberToEvent={erp.registerMemberToEvent}
          />
        </div>
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
            membershipApplications={membershipApplications}
            setMembershipApplications={setMembershipApplications}
            registeredUsersCount={registeredUsersCount}
            setRegisteredUsersCount={setRegisteredUsersCount}
          />
        )
      )}

      {activeTab === 'migration' && (
        <MigrationTab setMembers={setMembers} />
      )}

      {activeTab === 'bookings' && (
        <ClubFacilitiesPanel reservations={reservations} isZondaActive={isZondaActive} />
      )}
      </div>
    </div>
  );
}
