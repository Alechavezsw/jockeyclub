import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileSpreadsheet, Download, Database, CheckCircle2, AlertCircle, FileText,
  TrendingUp, Users, Calendar, Wallet, Store, ClipboardList, Shield, Radio,
  BellRing, PartyPopper, DoorOpen, Briefcase, BarChart3, Trash2, RefreshCw,
} from 'lucide-react';
import { exportMembersPdf } from '../../domain/members/exportMembersPdf';
import { exportJournalPdf } from '../../domain/accounting/exportJournalPdf';
import { exportExecutiveReportPdf } from '../../domain/reports/exportExecutiveReportPdf';
import { buildClubReportStats } from '../../domain/reports/buildClubReportStats';
import { downloadCsv, stampDate } from '../../domain/reports/downloadCsv';
import {
  buildBackupPayload,
  downloadBackupJson,
  validateBackupPayload,
} from '../../domain/reports/backupPayload';
import {
  deleteDailyBackup,
  formatBytes,
  getDailyBackup,
  isDailyBackupEnabled,
  listDailyBackups,
  saveDailyBackup,
  setDailyBackupEnabled,
} from '../../domain/reports/dailyBackupStore';
import { getTierDisplayName, TIER_COLORS } from '../../domain/members/tiers';

const SECTIONS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'economico', label: 'Económico' },
  { id: 'operativo', label: 'Operativo' },
  { id: 'exportar', label: 'Todos los reportes' },
  { id: 'backup', label: 'Backup' },
];

function Kpi({ icon: Icon, label, value, tone = 'default' }) {
  const color =
    tone === 'good' ? 'var(--emerald-accent)'
      : tone === 'bad' ? 'var(--danger-accent)'
        : tone === 'gold' ? 'var(--primary-gold)'
          : 'var(--text-strong)';
  return (
    <div className="reports-kpi">
      <div className="reports-kpi-icon"><Icon size={16} /></div>
      <div>
        <div className="reports-kpi-label">{label}</div>
        <div className="reports-kpi-value" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

function ReportCard({ icon: Icon, title, description, actions }) {
  return (
    <div className="reports-export-card">
      <div className="reports-export-card-head">
        <div className="reports-export-card-icon"><Icon size={18} /></div>
        <div>
          <h5>{title}</h5>
          <p>{description}</p>
        </div>
      </div>
      <div className="reports-export-card-actions">{actions}</div>
    </div>
  );
}

/** Consola integral de estadísticas, reportes económicos y exportaciones. */
export default function ReportsTab({
  members = [],
  reservations = [],
  journalEntries = [],
  chartOfAccounts = null,
  staffMembers = [],
  claims = [],
  messages = [],
  entryLogs = [],
  surveys = [],
  setMembers,
  setReservations,
  setJournalEntries,
  setStaffMembers,
  setClaims,
  setMessages,
  setEntryLogs,
  setSurveys,
  formatCurrency,
  getAccountBalance,
  totalActivos = 0,
  totalPasivos = 0,
  totalPatrimonioNetoTotal = 0,
  totalIngresos = 0,
  totalGastos = 0,
  utilidadNeta = 0,
  expenses = [],
  concessions = [],
  clubEvents = [],
  alerts = [],
  cashRegisters = [],
  cashSessions = [],
  canonPayments = [],
  newsList = [],
  suppliers = [],
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get('section');
  const [section, setSectionState] = useState(() =>
    SECTIONS.some((s) => s.id === sectionFromUrl) ? sectionFromUrl : 'resumen'
  );
  const setSection = (id) => {
    setSectionState(id);
    const next = new URLSearchParams(searchParams);
    if (id === 'resumen') next.delete('section');
    else next.set('section', id);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (sectionFromUrl && SECTIONS.some((s) => s.id === sectionFromUrl) && sectionFromUrl !== section) {
      setSectionState(sectionFromUrl);
    }
  }, [sectionFromUrl, section]);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState('');
  const [backupErrorMessage, setBackupErrorMessage] = useState('');
  const [dailyEnabled, setDailyEnabled] = useState(() => isDailyBackupEnabled());
  const [dailyList, setDailyList] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);

  const backupSnapshot = useMemo(() => ({
    members,
    reservations,
    journalEntries,
    staffMembers,
    claims,
    messages,
    entryLogs,
    surveys,
    expenses,
    concessions,
    clubEvents,
    alerts,
    cashRegisters,
    suppliers,
    newsList,
    canonPayments,
  }), [
    members, reservations, journalEntries, staffMembers, claims, messages,
    entryLogs, surveys, expenses, concessions, clubEvents, alerts,
    cashRegisters, suppliers, newsList, canonPayments,
  ]);

  const refreshDailyList = async () => {
    setDailyLoading(true);
    try {
      setDailyList(await listDailyBackups());
    } catch (err) {
      setBackupErrorMessage(err.message || 'No se pudo leer el historial de backups.');
    } finally {
      setDailyLoading(false);
    }
  };

  useEffect(() => {
    if (section !== 'backup') return undefined;
    void refreshDailyList();
    return undefined;
  }, [section]);

  const applyBackupData = (data) => {
    setMembers(data.members);
    setReservations(data.reservations);
    setJournalEntries(data.journalEntries);
    setStaffMembers(data.staffMembers);
    setClaims(data.claims);
    setMessages(data.messages);
    setEntryLogs(data.entryLogs);
    if (data.surveys && setSurveys) {
      setSurveys(data.surveys);
      localStorage.setItem('jockey-surveys', JSON.stringify(data.surveys));
    }
    localStorage.setItem('jockey-members', JSON.stringify(data.members));
    localStorage.setItem('jockey-reservations', JSON.stringify(data.reservations));
    localStorage.setItem('jockey-journal-entries', JSON.stringify(data.journalEntries));
    localStorage.setItem('jockey-staff-members', JSON.stringify(data.staffMembers));
    localStorage.setItem('jockey-claims', JSON.stringify(data.claims));
    localStorage.setItem('jockey-messages', JSON.stringify(data.messages));
    localStorage.setItem('jockey-access-logs', JSON.stringify(data.entryLogs));
  };

  const stats = useMemo(
    () => buildClubReportStats({
      members,
      reservations,
      journalEntries,
      staffMembers,
      claims,
      messages,
      entryLogs,
      surveys,
      expenses,
      concessions,
      clubEvents,
      alerts,
      cashRegisters,
      cashSessions,
      canonPayments,
      newsList,
      totalIngresos,
      totalGastos,
      utilidadNeta,
      totalActivos,
      totalPasivos,
      totalPatrimonioNetoTotal,
    }),
    [
      members, reservations, journalEntries, staffMembers, claims, messages,
      entryLogs, surveys, expenses, concessions, clubEvents, alerts,
      cashRegisters, cashSessions, canonPayments, newsList,
      totalIngresos, totalGastos, utilidadNeta, totalActivos, totalPasivos,
      totalPatrimonioNetoTotal,
    ]
  );

  const { members: m, economic: e, operations: o } = stats;
  const totalS = m.total || 1;
  const tierBreakdown = Object.entries(m.byTier || {})
    .map(([id, count], i) => ({
      id,
      label: getTierDisplayName(id),
      count,
      pct: Math.round((count / totalS) * 100),
      color: TIER_COLORS[i % TIER_COLORS.length],
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const revCuotas = getAccountBalance('Cuotas Sociales');
  const revGourmet = getAccountBalance('Reservas e Instalaciones');
  const revGolf = getAccountBalance('Concesión Gastronómica');
  const revEventos = getAccountBalance('Eventos y Fiestas');
  const expSueldos = getAccountBalance('Sueldos y Jornales');
  const expMaint = getAccountBalance('Mantenimiento de Canchas');
  const expEquine = getAccountBalance('Alimento Equino');
  const expServicios = getAccountBalance('Servicios e Insumos');
  const maxVal = Math.max(
    revCuotas, revGourmet, revGolf, revEventos,
    expSueldos, expMaint, expEquine, expServicios, 10000
  );

  const fail = (err, fallback) => {
    setBackupErrorMessage(err?.message || fallback);
    setBackupSuccessMessage('');
  };

  const lineAmounts = (line) => {
    if (line.debit != null || line.credit != null) {
      return { debe: Number(line.debit) || 0, haber: Number(line.credit) || 0 };
    }
    const amount = Number(line.amount) || 0;
    return {
      debe: line.type === 'debit' ? amount : 0,
      haber: line.type === 'credit' ? amount : 0,
    };
  };

  const handleExportJournalCSV = () => {
    downloadCsv(
      `jockey_club_libro_diario_${stampDate()}.csv`,
      ['Asiento ID', 'Fecha', 'Glosa', 'Cuenta', 'Debe', 'Haber'],
      journalEntries.flatMap((entry) =>
        (entry.lines || []).map((line) => {
          const { debe, haber } = lineAmounts(line);
          return [
            entry.id,
            entry.date,
            entry.description,
            line.account || line.accountId || '',
            debe,
            haber,
          ];
        })
      )
    );
  };

  const handleExportMembersCSV = () => {
    downloadCsv(
      `jockey_club_padron_socios_${stampDate()}.csv`,
      ['Nombre', 'Credencial ID', 'Celular', 'Email', 'Categoria', 'Antigüedad', 'Estado', 'Saldo Deuda', 'Adherentes'],
      members.map((mem) => [
        mem.name,
        mem.memberId,
        mem.phone || '',
        mem.email || '',
        String(mem.tier || '').toUpperCase(),
        mem.yearsActive ?? '',
        mem.status === 'active' ? 'HABILITADO' : 'SUSPENDIDO',
        mem.outstandingBalance ?? 0,
        mem.adherents?.length || 0,
      ])
    );
  };

  const handleExportDebtorsCSV = () => {
    const debtors = members.filter((mem) => (Number(mem.outstandingBalance) || 0) > 0);
    downloadCsv(
      `jockey_club_deudores_${stampDate()}.csv`,
      ['Nombre', 'Credencial', 'Categoria', 'Telefono', 'Saldo', 'Estado'],
      debtors.map((mem) => [
        mem.name,
        mem.memberId,
        String(mem.tier || '').toUpperCase(),
        mem.phone || '',
        mem.outstandingBalance,
        mem.status === 'active' ? 'HABILITADO' : 'SUSPENDIDO',
      ])
    );
  };

  const handleExportReservationsCSV = () => {
    downloadCsv(
      `jockey_club_reservas_${stampDate()}.csv`,
      ['ID', 'Socio', 'Credencial', 'Instalacion', 'Fecha', 'Hora', 'Estado'],
      reservations.map((r) => [
        r.id,
        r.memberName || r.name || '',
        r.memberId || '',
        r.facilityName || r.facilityId || '',
        r.date || '',
        r.time || r.slot || '',
        r.status || '',
      ])
    );
  };

  const handleExportStaffCSV = () => {
    downloadCsv(
      `jockey_club_personal_${stampDate()}.csv`,
      ['Nombre', 'Area', 'Cargo', 'Estado', 'Telefono', 'Email'],
      staffMembers.map((s) => [
        s.name || s.fullName || '',
        s.area || s.department || '',
        s.role || s.position || s.cargo || '',
        s.status || (s.active === false ? 'Inactivo' : 'Activo'),
        s.phone || '',
        s.email || '',
      ])
    );
  };

  const handleExportClaimsCSV = () => {
    downloadCsv(
      `jockey_club_reclamos_${stampDate()}.csv`,
      ['ID', 'Socio', 'Asunto', 'Categoria', 'Estado', 'Fecha'],
      claims.map((c) => [
        c.id,
        c.memberName || c.memberId || '',
        c.subject || c.title || '',
        c.category || '',
        c.status || '',
        c.createdAt || c.date || '',
      ])
    );
  };

  const handleExportAccessCSV = () => {
    downloadCsv(
      `jockey_club_accesos_${stampDate()}.csv`,
      ['Fecha/Hora', 'Socio', 'Credencial', 'Tipo', 'Resultado', 'Puerta'],
      entryLogs.map((l) => [
        l.timestamp || l.createdAt || l.date || '',
        l.memberName || l.name || '',
        l.memberId || '',
        l.type || l.direction || '',
        l.result || l.status || '',
        l.gate || l.door || l.location || '',
      ])
    );
  };

  const handleExportSurveysCSV = () => {
    downloadCsv(
      `jockey_club_encuestas_${stampDate()}.csv`,
      ['Pregunta', 'Categoria', 'Estado', 'Opciones', 'Votos totales', 'Participantes'],
      surveys.map((s) => {
        const opts = s.options || [];
        const votes = opts.reduce((sum, opt) => sum + (Number(opt.votes) || 0), 0);
        return [
          s.question || s.title || '',
          s.category || '',
          s.active ? 'Activa' : 'Cerrada',
          opts.map((opt) => opt.text).join(' | '),
          votes,
          (s.votedBy || []).length,
        ];
      })
    );
  };

  const handleExportExpensesCSV = () => {
    downloadCsv(
      `jockey_club_gastos_${stampDate()}.csv`,
      ['Nro', 'Fecha', 'Proveedor', 'Concepto', 'Importe', 'Estado', 'Factura'],
      expenses.map((exp) => [
        exp.expenseNumber || exp.id,
        exp.expenseDate || '',
        exp.vendorName || '',
        exp.concept || '',
        exp.amount ?? 0,
        exp.status || '',
        exp.invoiceNumber || '',
      ])
    );
  };

  const handleExportConcessionsCSV = () => {
    downloadCsv(
      `jockey_club_concesiones_${stampDate()}.csv`,
      ['Nombre', 'Concesionario', 'Tipo', 'Estado', 'Canon', 'Vencimiento', 'Nro'],
      concessions.map((c) => [
        c.name || '',
        c.concessionaire || '',
        c.type || '',
        c.status || '',
        c.canonAmount ?? c.monthlyCanon ?? '',
        c.endsAt || c.endDate || '',
        c.concessionaireNumber || c.portalCode || '',
      ])
    );
  };

  const handleExportEventsCSV = () => {
    downloadCsv(
      `jockey_club_eventos_${stampDate()}.csv`,
      ['Titulo', 'Fecha', 'Lugar', 'Estado', 'Capacidad', 'Precio'],
      clubEvents.map((ev) => [
        ev.title || ev.name || '',
        ev.date || ev.startsAt || '',
        ev.location || ev.venue || '',
        ev.status || '',
        ev.capacity ?? '',
        ev.price ?? ev.ticketPrice ?? '',
      ])
    );
  };

  const handleExportMessagesCSV = () => {
    downloadCsv(
      `jockey_club_mensajes_${stampDate()}.csv`,
      ['Fecha', 'De', 'Para', 'Asunto', 'Leido'],
      messages.map((msg) => [
        msg.createdAt || msg.date || '',
        msg.senderName || msg.senderId || '',
        msg.recipientName || msg.recipientId || '',
        msg.subject || msg.title || (msg.body || '').slice(0, 80),
        msg.isRead ? 'Si' : 'No',
      ])
    );
  };

  const handleExportAlertsCSV = () => {
    downloadCsv(
      `jockey_club_alertas_${stampDate()}.csv`,
      ['Titulo', 'Severidad', 'Estado', 'Fecha', 'Modulo'],
      alerts.map((a) => [
        a.title || a.message || '',
        a.severity || a.level || '',
        a.active === false ? 'Inactiva' : (a.status || 'Activa'),
        a.createdAt || a.date || '',
        a.module || a.source || '',
      ])
    );
  };

  const handleExportCashCSV = () => {
    downloadCsv(
      `jockey_club_cajas_${stampDate()}.csv`,
      ['Caja', 'Codigo', 'Saldo', 'Estado', 'Cuenta contable'],
      cashRegisters.map((r) => [
        r.name || '',
        r.code || r.id || '',
        r.currentBalance ?? r.balance ?? 0,
        r.status || (r.active === false ? 'Inactiva' : 'Activa'),
        r.accountId || r.accountName || '',
      ])
    );
  };

  const handleExportSuppliersCSV = () => {
    downloadCsv(
      `jockey_club_proveedores_${stampDate()}.csv`,
      ['Nombre', 'CUIT', 'Rubro', 'Estado', 'Telefono', 'Email'],
      suppliers.map((s) => [
        s.name || '',
        s.cuit || '',
        s.category || s.rubro || '',
        s.active === false ? 'Inactivo' : 'Activo',
        s.phone || '',
        s.email || '',
      ])
    );
  };

  const handleExportBalanceCSV = () => {
    downloadCsv(
      `jockey_club_balance_${stampDate()}.csv`,
      ['Concepto', 'Importe'],
      [
        ['Ingresos operativos', totalIngresos],
        ['Gastos operativos', totalGastos],
        ['Utilidad neta', utilidadNeta],
        ['Activos totales', totalActivos],
        ['Pasivos totales', totalPasivos],
        ['Patrimonio neto', totalPatrimonioNetoTotal],
        ['Deuda de socios', m.debtTotal],
        ['Gastos ERP pagados', e.expensePaidTotal],
        ['Gastos ERP pendientes', e.expensePendingTotal],
        ['Canon cobrado', e.canonCollected],
        ['Saldo en cajas', e.cashBalance],
      ]
    );
  };

  const handleExportCanonCSV = () => {
    downloadCsv(
      `jockey_club_canon_${stampDate()}.csv`,
      ['Recibo', 'Concesion', 'Periodo', 'Fecha', 'Importe', 'Medio'],
      canonPayments.map((p) => [
        p.receipt || p.id || '',
        p.concessionName || p.concessionId || '',
        p.period || '',
        p.date || '',
        p.amount ?? 0,
        p.method || '',
      ])
    );
  };

  const handleExportNewsCSV = () => {
    downloadCsv(
      `jockey_club_noticias_${stampDate()}.csv`,
      ['Titulo', 'Categoria', 'Fecha', 'Resumen'],
      newsList.map((n) => [
        n.title || '',
        n.category || '',
        n.date || n.eventDate || '',
        n.excerpt || n.summary || '',
      ])
    );
  };

  const handleExportMembersPDF = () => {
    void exportMembersPdf(members, { formatCurrency }).catch((err) => fail(err, 'No se pudo generar el PDF del padrón.'));
  };

  const handleExportDebtorsPDF = () => {
    const debtors = members.filter((mem) => (Number(mem.outstandingBalance) || 0) > 0);
    void exportMembersPdf(debtors, {
      formatCurrency,
      filterLabel: 'Deudores',
      fileName: `jockey_club_deudores_${stampDate()}.pdf`,
    }).catch((err) => fail(err, 'No se pudo generar el PDF de deudores.'));
  };

  const handleExportJournalPDF = () => {
    void exportJournalPdf(journalEntries, { formatCurrency, chart: chartOfAccounts }).catch((err) => fail(err, 'No se pudo generar el PDF del libro diario.'));
  };

  const handleExportExecutivePDF = () => {
    void exportExecutiveReportPdf(stats, { formatCurrency }).catch((err) => fail(err, 'No se pudo generar el informe ejecutivo.'));
  };

  const handleExportBackup = async () => {
    try {
      const backupData = buildBackupPayload(backupSnapshot, { source: 'manual' });
      await saveDailyBackup(backupData, { source: 'manual' });
      const filename = downloadBackupJson(backupData);
      await refreshDailyList();
      setBackupSuccessMessage(`Backup del día guardado y descargado: ${filename}`);
      setBackupErrorMessage('');
      setTimeout(() => setBackupSuccessMessage(''), 4000);
    } catch (err) {
      fail(err, 'Error al exportar la copia de seguridad.');
    }
  };

  const handleToggleDaily = (checked) => {
    setDailyEnabled(setDailyBackupEnabled(checked));
    setBackupSuccessMessage(
      checked
        ? 'Backups diarios activados. Se guardará uno automáticamente al ingresar al panel.'
        : 'Backups diarios desactivados.'
    );
    setBackupErrorMessage('');
    setTimeout(() => setBackupSuccessMessage(''), 4000);
  };

  const handleSaveTodayNow = async () => {
    try {
      const payload = buildBackupPayload(backupSnapshot, { source: 'manual' });
      await saveDailyBackup(payload, { source: 'manual' });
      await refreshDailyList();
      setBackupSuccessMessage(`Backup de hoy (${stampDate()}) actualizado en el historial.`);
      setBackupErrorMessage('');
      setTimeout(() => setBackupSuccessMessage(''), 4000);
    } catch (err) {
      fail(err, 'No se pudo guardar el backup del día.');
    }
  };

  const handleDownloadDaily = async (id) => {
    try {
      const row = await getDailyBackup(id);
      if (!row?.payload) throw new Error('Backup no encontrado.');
      downloadBackupJson(row.payload, `JCSJ-ERP-Backup-${id}.json`);
    } catch (err) {
      fail(err, 'No se pudo descargar el backup.');
    }
  };

  const handleRestoreDaily = async (id) => {
    if (!window.confirm(`¿Restaurar el backup del ${id}? Se reemplazarán los datos actuales del navegador.`)) return;
    try {
      const row = await getDailyBackup(id);
      const parsed = validateBackupPayload(row?.payload);
      applyBackupData(parsed.data);
      setBackupSuccessMessage(
        `Restaurado ${id}: ${parsed.data.members.length} socios, ${parsed.data.reservations.length} reservas, ${parsed.data.journalEntries.length} asientos.`
      );
      setBackupErrorMessage('');
      setTimeout(() => setBackupSuccessMessage(''), 8000);
    } catch (err) {
      fail(err, 'No se pudo restaurar el backup.');
    }
  };

  const handleDeleteDaily = async (id) => {
    if (!window.confirm(`¿Eliminar el backup del ${id}?`)) return;
    try {
      await deleteDailyBackup(id);
      await refreshDailyList();
      setBackupSuccessMessage(`Backup ${id} eliminado.`);
      setBackupErrorMessage('');
      setTimeout(() => setBackupSuccessMessage(''), 3000);
    } catch (err) {
      fail(err, 'No se pudo eliminar el backup.');
    }
  };

  const handleImportBackup = (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = validateBackupPayload(JSON.parse(event.target.result));
        applyBackupData(parsed.data);
        await saveDailyBackup(parsed, { source: 'manual' });
        await refreshDailyList();
        setBackupSuccessMessage(
          `Base restaurada: ${parsed.data.members.length} socios, ${parsed.data.reservations.length} reservas, ${parsed.data.journalEntries.length} asientos.`
        );
        setBackupErrorMessage('');
        ev.target.value = '';
        setTimeout(() => setBackupSuccessMessage(''), 8000);
      } catch (err) {
        fail(err, 'Error al importar la copia de seguridad.');
        ev.target.value = '';
      }
    };
    reader.onerror = () => fail(null, 'Error al leer el archivo de copia de seguridad.');
    reader.readAsText(file);
  };

  const exportCatalog = [
    {
      icon: BarChart3,
      title: 'Informe ejecutivo',
      description: 'Resumen económico y operativo completo del club.',
      actions: (
        <button type="button" className="btn btn-primary" onClick={handleExportExecutivePDF}>
          <FileText size={14} /> PDF
        </button>
      ),
    },
    {
      icon: Wallet,
      title: 'Balance económico',
      description: 'Ingresos, gastos, utilidad, activos, pasivos y cajas.',
      actions: (
        <>
          <button type="button" className="btn btn-primary" onClick={handleExportBalanceCSV}><Download size={14} /> CSV</button>
          <button type="button" className="btn btn-secondary" onClick={handleExportExecutivePDF}><FileText size={14} /> PDF</button>
        </>
      ),
    },
    {
      icon: FileSpreadsheet,
      title: 'Libro Diario Legal',
      description: 'Asientos contables con debe/haber.',
      actions: (
        <>
          <button type="button" className="btn btn-primary" onClick={handleExportJournalCSV}><Download size={14} /> CSV</button>
          <button type="button" className="btn btn-secondary" onClick={handleExportJournalPDF}><FileText size={14} /> PDF</button>
        </>
      ),
    },
    {
      icon: Users,
      title: 'Padrón de socios',
      description: 'Titulares, categoría, estado y saldos.',
      actions: (
        <>
          <button type="button" className="btn btn-primary" onClick={handleExportMembersCSV}><Download size={14} /> CSV</button>
          <button type="button" className="btn btn-secondary" onClick={handleExportMembersPDF}><FileText size={14} /> PDF</button>
        </>
      ),
    },
    {
      icon: TrendingUp,
      title: 'Socios deudores',
      description: 'Morosos con saldo pendiente de cuotas.',
      actions: (
        <>
          <button type="button" className="btn btn-primary" onClick={handleExportDebtorsCSV}><Download size={14} /> CSV</button>
          <button type="button" className="btn btn-secondary" onClick={handleExportDebtorsPDF}><FileText size={14} /> PDF</button>
        </>
      ),
    },
    {
      icon: ClipboardList,
      title: 'Gastos ERP',
      description: 'Comprobantes, proveedores e importes.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportExpensesCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Wallet,
      title: 'Cajas',
      description: 'Saldos y estado de cajas registradoras.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportCashCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Store,
      title: 'Concesiones',
      description: 'Contratos, concesionarios y vigencia.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportConcessionsCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Store,
      title: 'Cobros de canon',
      description: 'Pagos registrados de concesiones.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportCanonCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Briefcase,
      title: 'Proveedores',
      description: 'Padron de proveedores del ERP.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportSuppliersCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Calendar,
      title: 'Reservas',
      description: 'Turnos por instalación y estado.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportReservationsCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Briefcase,
      title: 'Personal',
      description: 'Plantel, áreas y contactos.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportStaffCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Shield,
      title: 'Reclamos',
      description: 'Tickets de socios y estado.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportClaimsCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: DoorOpen,
      title: 'Bitácora de accesos',
      description: 'Ingresos por credencial QR.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportAccessCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: Radio,
      title: 'Encuestas',
      description: 'Consultas colectivas y participación.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportSurveysCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: PartyPopper,
      title: 'Eventos del club',
      description: 'Agenda social y deportiva.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportEventsCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: BellRing,
      title: 'Alertas operativas',
      description: 'Avisos activos del ERP.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportAlertsCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: ClipboardList,
      title: 'Mensajería',
      description: 'Bandeja de mensajes admin ↔ socios.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportMessagesCSV}><Download size={14} /> CSV</button>,
    },
    {
      icon: FileText,
      title: 'Noticias / mural',
      description: 'Publicaciones del club.',
      actions: <button type="button" className="btn btn-primary" onClick={handleExportNewsCSV}><Download size={14} /> CSV</button>,
    },
  ];

  return (
    <div className="glass-card fade-in reports-console">
      <div className="reports-console-head">
        <div>
          <h3 className="serif-font">Estadísticas y reportes</h3>
          <p>
            Tablero económico, indicadores operativos y exportación de todos los módulos del club.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleExportExecutivePDF}>
          <FileText size={14} /> Informe ejecutivo PDF
        </button>
      </div>

      <div className="reports-section-nav" role="tablist">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={`reports-section-pill${section === item.id ? ' is-active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {(backupSuccessMessage || backupErrorMessage) && section !== 'backup' && (
        <div className={`reports-toast ${backupErrorMessage ? 'is-error' : 'is-ok'}`}>
          {backupErrorMessage || backupSuccessMessage}
        </div>
      )}

      {section === 'resumen' && (
        <>
          <div className="reports-kpi-grid">
            <Kpi icon={TrendingUp} label="Utilidad neta" value={formatCurrency(e.utilidadNeta)} tone={e.utilidadNeta >= 0 ? 'good' : 'bad'} />
            <Kpi icon={Wallet} label="Ingresos" value={formatCurrency(e.totalIngresos)} tone="good" />
            <Kpi icon={Wallet} label="Gastos" value={formatCurrency(e.totalGastos)} tone="bad" />
            <Kpi icon={Users} label="Socios / deudores" value={`${m.total} · ${m.debtors}`} tone="gold" />
            <Kpi icon={Calendar} label="Reservas confirmadas" value={o.confirmed} />
            <Kpi icon={Store} label="Concesiones vigentes" value={o.concessionsActive} />
            <Kpi icon={DoorOpen} label="Accesos hoy" value={o.accessToday} />
            <Kpi icon={Shield} label="Reclamos abiertos" value={o.openClaims} tone={o.openClaims ? 'bad' : 'good'} />
          </div>

          <div className="reports-two-col">
            <div className="glass-panel reports-panel">
              <h4 className="serif-font">Ocupación de turnos por disciplina</h4>
              <div className="reports-bars">
                {[
                  { label: 'Rugby Cuyano (Masc/Fem)', codes: ['rugby_masc', 'rugby_fem'], color: 'var(--primary-gold)' },
                  { label: 'Hockey sobre Césped', codes: ['hockey_cesped'], color: '#10b981' },
                  { label: 'Deportes Hípicos & Turf', codes: ['equitacion_pistas', 'hipismo_saltos', 'turf_vareo'], color: '#d97706' },
                  { label: 'Tenis, Pádel & Fútbol', codes: ['tenis_trad', 'padel_vidrio', 'futbol_fusion'], color: '#f97316' },
                  { label: 'Salón Saludable, Boxeo & Yoga', codes: ['gimnasio_musc', 'circuito_saludable', 'boxeo_salon', 'yoga_salon', 'tenis_mesa', 'voleibol_trad'], color: '#a855f7' },
                  { label: 'Temporada & Vóley Playa', codes: ['piscina_verano', 'volei_playa'], color: '#3b82f6' },
                  { label: 'Gastronomía (The Pavilion)', codes: ['restaurant'], color: '#ec4899' },
                ].map((facility) => {
                  const count = reservations.filter((r) => facility.codes.includes(r.facilityId) && r.status === 'confirmed').length;
                  const pct = Math.min(Math.round((count / 15) * 100), 100);
                  return (
                    <div key={facility.label} className="reports-bar-row">
                      <div className="reports-bar-meta">
                        <span>{facility.label}</span>
                        <strong>{count} turnos</strong>
                      </div>
                      <div className="progress-bar-container">
                        <div className="progress-bar-fill" style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: facility.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="glass-panel reports-panel">
              <h4 className="serif-font">Padrón por categoría</h4>
              <div className="reports-donut-wrap">
                <div className="reports-donut">
                  <svg viewBox="0 0 100 100" width="110" height="110">
                    <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.02)" strokeWidth="12" fill="transparent" />
                    {tierBreakdown.reduce((acc, item) => {
                      const start = acc.angle;
                      const sweep = (item.pct / 100) * 360;
                      acc.nodes.push(
                        item.pct > 0 ? (
                          <circle
                            key={item.id}
                            cx="50"
                            cy="50"
                            r="38"
                            stroke={item.color}
                            strokeWidth="12"
                            fill="transparent"
                            strokeDasharray={`${(item.pct / 100) * 238.76} 238.76`}
                            transform={`rotate(${-90 + start} 50 50)`}
                          />
                        ) : null
                      );
                      acc.angle = start + sweep;
                      return acc;
                    }, { angle: 0, nodes: [] }).nodes}
                  </svg>
                  <div className="reports-donut-center">
                    <strong>{m.total}</strong>
                    <span>Socios</span>
                  </div>
                </div>
                <div className="reports-legend">
                  {tierBreakdown.map((item) => (
                    <div key={item.id}>
                      <span style={{ background: item.color }} />
                      {item.label}
                      <strong>{item.count} ({item.pct}%)</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="reports-mini-stats">
                <div><span>Al día</span><strong>{m.alDia}</strong></div>
                <div><span>Deudores</span><strong>{m.debtors}</strong></div>
                <div><span>Deuda total</span><strong>{formatCurrency(m.debtTotal)}</strong></div>
                <div><span>Adherentes</span><strong>{m.adherents}</strong></div>
              </div>
            </div>
          </div>
        </>
      )}

      {section === 'economico' && (
        <div className="reports-stack">
          <div className="reports-kpi-grid">
            <Kpi icon={TrendingUp} label="Utilidad neta" value={formatCurrency(e.utilidadNeta)} tone={e.utilidadNeta >= 0 ? 'good' : 'bad'} />
            <Kpi icon={Wallet} label="Activos" value={formatCurrency(e.totalActivos)} tone="good" />
            <Kpi icon={Wallet} label="Pasivos" value={formatCurrency(e.totalPasivos)} />
            <Kpi icon={Wallet} label="Patrimonio neto" value={formatCurrency(e.totalPatrimonioNetoTotal)} tone="gold" />
            <Kpi icon={Users} label="Deuda socios" value={formatCurrency(m.debtTotal)} tone="bad" />
            <Kpi icon={Store} label="Canon cobrado" value={formatCurrency(e.canonCollected)} tone="good" />
            <Kpi icon={Wallet} label="Saldo en cajas" value={formatCurrency(e.cashBalance)} />
            <Kpi icon={ClipboardList} label="Gastos ERP pendientes" value={formatCurrency(e.expensePendingTotal)} tone="bad" />
          </div>

          <div className="glass-panel reports-panel">
            <h4 className="serif-font">Ecuación patrimonial</h4>
            <div className="reports-balance-lines">
              <div><span>Activos totales</span><strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(totalActivos)}</strong></div>
              <div><span>Pasivo + Patrimonio neto</span><strong style={{ color: 'var(--primary-gold)' }}>{formatCurrency(totalPasivos + totalPatrimonioNetoTotal)}</strong></div>
              <div><span>Ingresos − Gastos</span><strong>{formatCurrency(totalIngresos)} − {formatCurrency(totalGastos)}</strong></div>
            </div>
          </div>

          <div className="glass-panel reports-panel">
            <h4 className="serif-font">Flujos contables por cuenta</h4>
            <div className="reports-chart-scroll">
              <svg viewBox="0 0 400 170" width="100%" style={{ minWidth: 360 }}>
                <line x1="10" y1="20" x2="390" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="10" y1="70" x2="390" y2="70" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="10" y1="120" x2="390" y2="120" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                {[
                  { x: 20, value: revCuotas, label: 'Cuotas', kind: 'ingreso' },
                  { x: 55, value: revGourmet, label: 'Reservas', kind: 'ingreso' },
                  { x: 90, value: revGolf, label: 'Canon', kind: 'ingreso' },
                  { x: 125, value: revEventos, label: 'Eventos', kind: 'ingreso' },
                  { x: 220, value: expSueldos, label: 'Sueldos', kind: 'gasto' },
                  { x: 255, value: expMaint, label: 'Canchas', kind: 'gasto' },
                  { x: 290, value: expEquine, label: 'Equinos', kind: 'gasto' },
                  { x: 325, value: expServicios, label: 'Servicios', kind: 'gasto' },
                ].map((bar) => (
                  <g key={bar.label}>
                    <rect
                      x={bar.x}
                      y={120 - (bar.value / maxVal) * 90}
                      width="24"
                      height={(bar.value / maxVal) * 90}
                      fill={bar.kind === 'ingreso' ? 'url(#gradIngresosR)' : 'url(#gradEgresosR)'}
                      rx="4"
                    />
                    <text x={bar.x + 12} y={115 - (bar.value / maxVal) * 90} fill={bar.kind === 'ingreso' ? 'var(--emerald-accent)' : 'var(--danger-accent)'} fontSize="8" fontWeight="700" textAnchor="middle">
                      {bar.value > 1000 ? `${Math.round(bar.value / 1000)}k` : bar.value}
                    </text>
                    <text x={bar.x + 12} y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">{bar.label}</text>
                  </g>
                ))}
                <defs>
                  <linearGradient id="gradIngresosR" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--emerald-accent)" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="var(--emerald-accent)" stopOpacity="0.2" />
                  </linearGradient>
                  <linearGradient id="gradEgresosR" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--danger-accent)" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="var(--danger-accent)" stopOpacity="0.2" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </div>
      )}

      {section === 'operativo' && (
        <div className="reports-stack">
          <div className="reports-kpi-grid">
            <Kpi icon={Calendar} label="Reservas totales" value={o.reservations} />
            <Kpi icon={Calendar} label="Confirmadas / Pendientes" value={`${o.confirmed} / ${o.pending}`} tone="gold" />
            <Kpi icon={Shield} label="Reclamos abiertos" value={`${o.openClaims}/${o.claimsTotal}`} tone={o.openClaims ? 'bad' : 'good'} />
            <Kpi icon={Briefcase} label="Personal" value={o.staff} />
            <Kpi icon={Store} label="Concesiones" value={`${o.concessionsActive}/${o.concessionsTotal}`} />
            <Kpi icon={PartyPopper} label="Eventos próximos" value={o.eventsUpcoming} />
            <Kpi icon={Radio} label="Encuestas activas" value={o.activeSurveys} />
            <Kpi icon={DoorOpen} label="Accesos (hoy/total)" value={`${o.accessToday}/${o.accessTotal}`} />
            <Kpi icon={BellRing} label="Alertas abiertas" value={o.alertsOpen} tone={o.alertsOpen ? 'bad' : 'good'} />
            <Kpi icon={ClipboardList} label="Mensajes sin leer" value={o.unreadMessages} />
            <Kpi icon={FileText} label="Noticias" value={o.news} />
            <Kpi icon={Users} label="Adherentes" value={m.adherents} />
          </div>
        </div>
      )}

      {section === 'exportar' && (
        <div className="reports-export-grid">
          {exportCatalog.map((item) => (
            <ReportCard key={item.title} icon={item.icon} title={item.title} description={item.description} actions={item.actions} />
          ))}
        </div>
      )}

      {section === 'backup' && (
        <div className="reports-backup-layout">
          <div className="glass-panel reports-panel reports-backup">
            <div style={{ textAlign: 'center' }}>
              <Database size={40} style={{ color: 'var(--primary-gold)', margin: 'auto', marginBottom: '0.5rem' }} />
              <h4 className="serif-font" style={{ margin: 0 }}>Backups diarios</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Se guarda automáticamente un respaldo por día en este navegador (últimos 30 días).
                También puede descargar o restaurar un archivo .json.
              </p>
            </div>

            <label className="reports-daily-toggle">
              <input
                type="checkbox"
                checked={dailyEnabled}
                onChange={(ev) => handleToggleDaily(ev.target.checked)}
              />
              <span>Generar backup automático diario al ingresar al panel</span>
            </label>

            {backupSuccessMessage && (
              <div className="reports-toast is-ok"><CheckCircle2 size={16} /> {backupSuccessMessage}</div>
            )}
            {backupErrorMessage && (
              <div className="reports-toast is-error"><AlertCircle size={16} /> {backupErrorMessage}</div>
            )}

            <div className="reports-backup-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { void handleExportBackup(); }}>
                <Download size={14} /> Descargar hoy (.json)
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { void handleSaveTodayNow(); }}>
                <RefreshCw size={14} /> Guardar hoy
              </button>
              <label className="btn btn-primary" style={{ margin: 0, cursor: 'pointer' }}>
                <Database size={14} /> Restaurar archivo
                <input type="file" accept=".json" onChange={handleImportBackup} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          <div className="glass-panel reports-panel">
            <div className="reports-backup-list-head">
              <h4 className="serif-font">Historial (30 días)</h4>
              <button type="button" className="btn btn-outline" onClick={() => { void refreshDailyList(); }} disabled={dailyLoading}>
                <RefreshCw size={14} /> Actualizar
              </button>
            </div>

            {dailyLoading && dailyList.length === 0 ? (
              <p className="reports-backup-empty">Cargando historial…</p>
            ) : dailyList.length === 0 ? (
              <p className="reports-backup-empty">
                Todavía no hay backups diarios. Active la opción automática o pulse “Guardar hoy”.
              </p>
            ) : (
              <div className="reports-backup-list">
                {dailyList.map((row) => (
                  <div key={row.id} className="reports-backup-row">
                    <div>
                      <strong>{row.id}</strong>
                      <span>
                        {row.source === 'auto' ? 'Automático' : 'Manual'}
                        {' · '}
                        {formatBytes(row.bytes)}
                        {row.createdAt ? ` · ${new Date(row.createdAt).toLocaleString('es-AR')}` : ''}
                      </span>
                    </div>
                    <div className="reports-backup-row-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => { void handleDownloadDaily(row.id); }}>
                        <Download size={12} /> JSON
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => { void handleRestoreDaily(row.id); }}>
                        Restaurar
                      </button>
                      <button type="button" className="btn btn-outline" onClick={() => { void handleDeleteDaily(row.id); }} aria-label={`Eliminar backup ${row.id}`}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
