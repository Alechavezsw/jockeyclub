import React, { useState } from 'react';
import { 
  Users, Calendar, DollarSign, Activity, CreditCard, Check, X, ShieldAlert, 
  Plus, Search, Filter, Clock, BookOpen, ClipboardList, QrCode, 
  MessageSquare, Phone, FileSpreadsheet, Download, Database, Send, 
  Radio, AlertCircle, Play, Sparkles, CheckCircle2, ChevronDown, 
  ChevronUp, Trash2, UserPlus, Info 
} from 'lucide-react';
import AccountingTab from '../components/AccountingTab';
import StaffTab from '../components/StaffTab';

export default function AdminView({ 
  members, 
  reservations, 
  setMembers, 
  setReservations, 
  latestNews,
  journalEntries = [],
  setJournalEntries,
  addJournalEntry,
  staffMembers = [],
  setStaffMembers,
  claims = [],
  setClaims,
  messages = [],
  setMessages,
  entryLogs = [],
  setEntryLogs,
  surveys = [],
  setSurveys
}) {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Estados para pestaña de Socios
  const [tierFilter, setTierFilter] = useState('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState('gold');
  const [newPhone, setNewPhone] = useState('+54911');
  const [expandedMemberId, setExpandedMemberId] = useState(null);

  // Estados para formulario de Alta de Adherente
  const [showAddAdherentId, setShowAddAdherentId] = useState(null);
  const [adhName, setAdhName] = useState('');
  const [adhRelationship, setAdhRelationship] = useState('Hijo/a');
  const [adhTier, setAdhTier] = useState('gold');

  // Estados para pestaña Control QR
  const [selectedQRMemberId, setSelectedQRMemberId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // 'granted', 'denied'

  // Estados para pestaña Pedidos & Reclamos
  const [editingClaimId, setEditingClaimId] = useState(null);
  const [claimResponseText, setClaimResponseText] = useState('');
  const [claimAssignStaff, setClaimAssignStaff] = useState('');

  // Estados para pestaña Mensajería
  const [msgRecipient, setMsgRecipient] = useState('all');
  const [msgSubject, setMsgSubject] = useState('');
  const [msgContent, setMsgContent] = useState('');
  const [msgSuccess, setMsgSuccess] = useState(false);
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    'Estimado/a *{nombre}*, le saludamos cordialmente de la Comisión Directiva del Jockey Club San Juan (Sede Rivadavia). Le recordamos amablemente que posee un saldo pendiente de cuota social de *{saldo}*. Puede regularizar su situación en la administración central o mediante transferencia al Banco Nación. ¡Muchas gracias!'
  );
  const [virtualSentLogs, setVirtualSentLogs] = useState([]);

  // Estados para consola de Migración Legacy
  const [migrationState, setMigrationState] = useState('idle'); // 'idle', 'running', 'completed'
  const [migrationLogs, setMigrationLogs] = useState([]);

  // Estados para backups de base de datos local
  const [backupSuccessMessage, setBackupSuccessMessage] = useState('');
  const [backupErrorMessage, setBackupErrorMessage] = useState('');

  // Estados para pestaña de Encuestas
  const [newSurveyQuestion, setNewSurveyQuestion] = useState('');
  const [newSurveyCategory, setNewSurveyCategory] = useState('Infraestructura');
  const [newSurveyOpts, setNewSurveyOpts] = useState(['', '', '', '']);
  const [hoveredAdminSegments, setHoveredAdminSegments] = useState({});

  // --- ACCIONES DE ENCUESTAS ---
  const handleSimulateVotes = (surveyId) => {
    if (!setSurveys) return;
    const updated = surveys.map(s => {
      if (s.id === surveyId) {
        let distributedVotes = 500;
        const newOptions = s.options.map((opt, idx) => {
          let added = 0;
          if (idx === s.options.length - 1) {
            added = distributedVotes;
          } else {
            added = Math.floor(Math.random() * distributedVotes);
            distributedVotes -= added;
          }
          return { ...opt, votes: opt.votes + added };
        });
        return { ...s, options: newOptions };
      }
      return s;
    });
    setSurveys(updated);
  };

  const handleToggleSurveyActive = (surveyId) => {
    if (!setSurveys) return;
    const updated = surveys.map(s => {
      if (s.id === surveyId) {
        return { ...s, active: !s.active };
      }
      return s;
    });
    setSurveys(updated);
  };

  const handleDeleteSurvey = (surveyId) => {
    if (!setSurveys) return;
    if (window.confirm('¿Está seguro de que desea eliminar esta encuesta permanentemente?')) {
      const updated = surveys.filter(s => s.id !== surveyId);
      setSurveys(updated);
    }
  };

  const handleCreateSurvey = (e) => {
    e.preventDefault();
    if (!newSurveyQuestion.trim() || !setSurveys) return;
    
    const validOpts = newSurveyOpts.filter(o => o.trim() !== '');
    if (validOpts.length < 2) {
      alert('Debe ingresar al menos 2 opciones.');
      return;
    }

    const newSurvey = {
      id: surveys.length > 0 ? Math.max(...surveys.map(s => s.id)) + 1 : 1,
      question: newSurveyQuestion.trim(),
      category: newSurveyCategory,
      active: true,
      votedBy: [],
      options: validOpts.map((optText, idx) => ({
        id: idx + 1,
        text: optText.trim(),
        votes: 0
      }))
    };

    setSurveys([...surveys, newSurvey]);
    
    // Resetear formulario
    setNewSurveyQuestion('');
    setNewSurveyCategory('Infraestructura');
    setNewSurveyOpts(['', '', '', '']);
  };

  // Exportar copia de seguridad en JSON
  const handleExportBackup = () => {
    try {
      const backupData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        club: 'Jockey Club San Juan - Sede Rivadavia',
        data: {
          members,
          reservations,
          journalEntries,
          staffMembers,
          claims,
          messages,
          entryLogs,
          surveys
        }
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `JCSJ-ERP-Backup-${new Date().toISOString().split('T')[0]}.json`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupSuccessMessage(`Copia de seguridad "${filename}" exportada con éxito.`);
      setBackupErrorMessage('');
      setTimeout(() => setBackupSuccessMessage(''), 4000);
    } catch (err) {
      setBackupErrorMessage('Error al exportar la copia de seguridad: ' + err.message);
      setBackupSuccessMessage('');
    }
  };

  // Importar copia de seguridad en JSON
  const handleImportBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        
        // Validación estructural rigurosa
        if (!parsed || parsed.club !== 'Jockey Club San Juan - Sede Rivadavia' || !parsed.data) {
          throw new Error('El archivo no es una copia de seguridad válida para el Jockey Club San Juan o pertenece a otra aplicación.');
        }

        const { data } = parsed;

        if (
          !Array.isArray(data.members) ||
          !Array.isArray(data.reservations) ||
          !Array.isArray(data.journalEntries) ||
          !Array.isArray(data.staffMembers) ||
          !Array.isArray(data.claims) ||
          !Array.isArray(data.messages) ||
          !Array.isArray(data.entryLogs)
        ) {
          throw new Error('La estructura interna de datos de la copia de seguridad es incorrecta o está incompleta.');
        }

        // Sobreescribir estados en caliente
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

        // Forzar actualización inmediata en LocalStorage para garantizar la persistencia física
        localStorage.setItem('jockey-members', JSON.stringify(data.members));
        localStorage.setItem('jockey-reservations', JSON.stringify(data.reservations));
        localStorage.setItem('jockey-journal-entries', JSON.stringify(data.journalEntries));
        localStorage.setItem('jockey-staff-members', JSON.stringify(data.staffMembers));
        localStorage.setItem('jockey-claims', JSON.stringify(data.claims));
        localStorage.setItem('jockey-messages', JSON.stringify(data.messages));
        localStorage.setItem('jockey-access-logs', JSON.stringify(data.entryLogs));

        const surveysCount = data.surveys ? data.surveys.length : 0;
        setBackupSuccessMessage(`¡Base de datos restaurada con éxito! Se cargaron: ${data.members.length} socios, ${data.reservations.length} reservas, ${data.journalEntries.length} asientos contables y ${surveysCount} encuestas.`);
        setBackupErrorMessage('');
        
        // Limpiar el input para permitir cargar el mismo archivo si es necesario
        e.target.value = '';
        setTimeout(() => setBackupSuccessMessage(''), 8000);
      } catch (err) {
        setBackupErrorMessage('Error al importar la copia de seguridad: ' + err.message);
        setBackupSuccessMessage('');
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      setBackupErrorMessage('Error al leer el archivo de copia de seguridad.');
      setBackupSuccessMessage('');
    };
    reader.readAsText(file);
  };

  // --- CÁLCULOS CONTABLES DINÁMICOS PARA MÉTRICAS ERP ---
  const getAccountBalance = (accountName) => {
    let balance = 0;
    if (!journalEntries) return 0;
    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        if (line.account === accountName) {
          const amt = parseFloat(line.amount) || 0;
          const isAssetOrExpense = [
            'Caja', 'Banco Nación', 'Equipamiento Canchas', 'Caballos Criollos',
            'Sueldos y Jornales', 'Mantenimiento de Canchas', 'Alimento Equino'
          ].includes(accountName);
          
          if (isAssetOrExpense) {
            balance += line.type === 'debit' ? amt : -amt;
          } else {
            balance += line.type === 'credit' ? amt : -amt;
          }
        }
      });
    });
    return balance;
  };

  const getCategoryTotal = (accountsArray) => {
    return accountsArray.reduce((sum, acc) => sum + getAccountBalance(acc), 0);
  };

  const totalActivos = getCategoryTotal(['Caja', 'Banco Nación', 'Equipamiento Canchas', 'Caballos Criollos']);
  const totalPasivos = getCategoryTotal(['Proveedores Hípicos', 'Sueldos a Pagar', 'Impuestos Pendientes']);
  const totalPatrimonioNetoBase = getCategoryTotal(['Capital Social', 'Resultados Acumulados']);
  
  const totalIngresos = getCategoryTotal(['Cuotas Sociales', 'Reservas Gourmet', 'Concesión Golf']);
  const totalGastos = getCategoryTotal(['Sueldos y Jornales', 'Mantenimiento de Canchas', 'Alimento Equino']);
  const utilidadNeta = totalIngresos - totalGastos;
  const totalPatrimonioNetoTotal = totalPatrimonioNetoBase + utilidadNeta;

  const totalMembers = members.length;
  const activeBookingsCount = reservations.filter(res => res.status === 'confirmed').length;
  const pendingBookingsCount = reservations.filter(res => res.status === 'pending').length;
  
  const paidMembers = members.filter(m => m.outstandingBalance === 0).length;
  const paymentCollectionRate = totalMembers > 0 ? Math.round((paidMembers / totalMembers) * 100) : 0;
  const totalOutstanding = members.reduce((sum, m) => sum + m.outstandingBalance, 0);

  // NUEVO: Cálculos para Gráficos Adicionales de la Consola de Reportes
  const countRoyal = members.filter(m => m.tier === 'royal').length;
  const countPlatinum = members.filter(m => m.tier === 'platinum').length;
  const countGold = members.filter(m => m.tier === 'gold').length;
  const totalS = countRoyal + countPlatinum + countGold;
  const pctRoyal = totalS > 0 ? Math.round((countRoyal / totalS) * 100) : 0;
  const pctPlatinum = totalS > 0 ? Math.round((countPlatinum / totalS) * 100) : 0;
  const pctGold = totalS > 0 ? Math.round((countGold / totalS) * 100) : 0;

  const revCuotas = getAccountBalance('Cuotas Sociales');
  const revGourmet = getAccountBalance('Reservas Gourmet');
  const revGolf = getAccountBalance('Concesión Golf');
  const expSueldos = getAccountBalance('Sueldos y Jornales');
  const expMaint = getAccountBalance('Mantenimiento de Canchas');
  const expEquine = getAccountBalance('Alimento Equino');
  const maxVal = Math.max(revCuotas, revGourmet, revGolf, expSueldos, expMaint, expEquine, 10000);

  // Formatear dinero
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);
  };

  // Crear nuevo socio titular
  const handleAddMember = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const randomNum = Math.floor(1000000000000000 + Math.random() * 9000000000000000);
    const newMember = {
      name: newName.trim(),
      memberId: randomNum.toString(),
      phone: newPhone.trim() || '+5491155559999',
      tier: newTier,
      outstandingBalance: newTier === 'royal' ? 45000 : newTier === 'platinum' ? 38000 : 32000, 
      yearsActive: 1,
      status: 'active',
      adherents: []
    };

    setMembers([newMember, ...members]);
    setNewName('');
    setNewPhone('+54911');
    setShowAddForm(false);
  };

  // Cobrar cuota e impactar contabilidad de partida doble automáticamente
  const handleCollectDues = (memberId) => {
    const member = members.find(m => m.memberId === memberId);
    if (!member || member.outstandingBalance <= 0) return;

    const amount = member.outstandingBalance;

    const autoEntry = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      description: `Cobro automático cuota social - Socio: ${member.name} (Credencial: ${member.memberId.slice(0, 6)}...)`,
      lines: [
        { account: 'Caja', type: 'debit', amount: amount },
        { account: 'Cuotas Sociales', type: 'credit', amount: amount }
      ]
    };

    addJournalEntry(autoEntry);

    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return { ...m, outstandingBalance: 0 };
      }
      return m;
    }));
  };

  // Generar cuota/deuda simulada
  const handleGenerateDues = (memberId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        const val = m.tier === 'royal' ? 45000 : m.tier === 'platinum' ? 38000 : 32000;
        return { ...m, outstandingBalance: m.outstandingBalance + val };
      }
      return m;
    }));
  };

  // Gestionar estado de reserva
  const handleUpdateReservationStatus = (resId, newStatus) => {
    setReservations(reservations.map(res => {
      if (res.id === resId) {
        return { ...res, status: newStatus };
      }
      return res;
    }));
  };

  // Filtrar socios por búsqueda y por nivel
  const filteredMembers = members.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.memberId.includes(searchQuery);
    const matchesTier = tierFilter === 'todos' || m.tier.toLowerCase() === tierFilter.toLowerCase();
    return matchesSearch && matchesTier;
  });

  // --- GESTIÓN DE ADHERENTES EN ADMIN ---
  const handleAddAdherent = (memberId) => {
    if (!adhName.trim()) return;
    const newAdherent = {
      id: `adh-${Date.now()}`,
      name: adhName.trim(),
      relationship: adhRelationship,
      tier: adhTier,
      outstandingBalance: 0,
      status: 'active'
    };

    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: [...(m.adherents || []), newAdherent]
        };
      }
      return m;
    }));

    setAdhName('');
    setShowAddAdherentId(null);
  };

  const handleToggleAdherentStatus = (memberId, adherentId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: m.adherents.map(adh => {
            if (adh.id === adherentId) {
              return { ...adh, status: adh.status === 'active' ? 'suspended' : 'active' };
            }
            return adh;
          })
        };
      }
      return m;
    }));
  };

  const handleDeleteAdherent = (memberId, adherentId) => {
    setMembers(members.map(m => {
      if (m.memberId === memberId) {
        return {
          ...m,
          adherents: m.adherents.filter(adh => adh.id !== adherentId)
        };
      }
      return m;
    }));
  };

  // --- ESCÁNER DE CÓDIGO QR SINTÉTICO ---
  const playSynthesizedBeep = (success) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (success) {
        // High frequency friendly beep
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.18);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.18);
      } else {
        // Low buzzy error double beep
        const buzz = (delay) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(140, audioCtx.currentTime + delay);
          gain.gain.setValueAtTime(0.12, audioCtx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + delay + 0.22);
          osc.start(audioCtx.currentTime + delay);
          osc.stop(audioCtx.currentTime + delay + 0.22);
        };
        buzz(0);
        buzz(0.24);
      }
    } catch (e) {
      console.log("AudioContext blocked or not supported in this browser session", e);
    }
  };

  const handleSimulateQRScan = () => {
    if (!selectedQRMemberId) return;
    const targetMember = members.find(m => m.memberId === selectedQRMemberId);
    if (!targetMember) return;

    setScanning(true);
    setScanResult(null);

    setTimeout(() => {
      setScanning(false);
      const isAllowed = targetMember.outstandingBalance === 0;
      const status = isAllowed ? 'granted' : 'denied';
      setScanResult(status);
      playSynthesizedBeep(isAllowed);

      // Escribir en la bitácora de accesos QR
      const newEntryLog = {
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        memberName: targetMember.name,
        memberId: targetMember.memberId,
        role: targetMember.tier === 'royal' ? 'Socio Royal' : targetMember.tier === 'platinum' ? 'Socio Platinum' : 'Socio Gold',
        status: status,
        notes: isAllowed ? 'Acceso aprobado - Sin deuda pendiente' : `Acceso denegado - Deuda pendiente de ${formatCurrency(targetMember.outstandingBalance)}`
      };

      setEntryLogs([newEntryLog, ...entryLogs]);
    }, 1500); // Demora dramática para simular el escaneo láser
  };

  // --- GESTIÓN DE RECLAMOS CON IMPACTO EN BITÁCORA DE PERSONAL ---
  const handleAssignAndResolveClaim = (claimId, newStatus) => {
    const claim = claims.find(c => c.id === claimId);
    if (!claim) return;

    const assignedEmpName = claimAssignStaff || claim.assignedStaff;
    const response = claimResponseText.trim() || claim.response;

    // Si se asigna personal, registrar actividad inmediata en su perfil de personal
    if (assignedEmpName && assignedEmpName !== claim.assignedStaff) {
      const targetEmp = staffMembers.find(s => s.name === assignedEmpName);
      if (targetEmp) {
        const newActivity = {
          id: Date.now(),
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          description: `Asignación de reclamo #${claim.id}: "${claim.title}" por Administración.`
        };

        setStaffMembers(staffMembers.map(s => {
          if (s.id === targetEmp.id) {
            return {
              ...s,
              currentTask: `Atendiendo: ${claim.title.slice(0, 30)}...`,
              activities: [newActivity, ...(s.activities || [])]
            };
          }
          return s;
        }));
      }
    }

    // Actualizar reclamo
    setClaims(claims.map(c => {
      if (c.id === claimId) {
        return {
          ...c,
          status: newStatus,
          assignedStaff: assignedEmpName,
          response: response
        };
      }
      return c;
    }));

    setEditingClaimId(null);
    setClaimResponseText('');
    setClaimAssignStaff('');
  };

  // --- MENSAJERÍA INTERNA Y WHATSAPP ---
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!msgSubject.trim() || !msgContent.trim()) return;

    const newMsg = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      sender: 'Tesorería Jockey Club',
      recipientId: msgRecipient, // 'all' o un id de socio
      subject: msgSubject.trim(),
      content: msgContent.trim(),
      isRead: false
    };

    setMessages([newMsg, ...messages]);
    setMsgSubject('');
    setMsgContent('');
    setMsgSuccess(true);
    setTimeout(() => setMsgSuccess(false), 3000);
  };

  const handleSendWhatsAppRedirect = (memberItem) => {
    let rawMsg = whatsappTemplate
      .replace('{nombre}', memberItem.name)
      .replace('{saldo}', formatCurrency(memberItem.outstandingBalance));
    
    const encodedText = encodeURIComponent(rawMsg);
    const cleanPhone = memberItem.phone.replace(/[+\s-]/g, ''); // Limpiar caracteres
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    // Abrir enlace en pestaña nueva
    window.open(waUrl, '_blank');

    // Agregar un registro local al log de envíos virtuales
    const logItem = {
      id: Date.now(),
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      memberName: memberItem.name,
      phone: memberItem.phone,
      messagePreview: rawMsg.slice(0, 80) + '...',
      status: 'Redirected'
    };
    setVirtualSentLogs([logItem, ...virtualSentLogs]);
  };

  // --- EXPORTACIÓN DE ARCHIVOS CSV REALES ---
  const handleExportJournalCSV = () => {
    let csv = 'Asiento ID;Fecha;Glosa;Cuenta;Debe;Haber\n';
    
    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        const debe = line.type === 'debit' ? line.amount : 0;
        const haber = line.type === 'credit' ? line.amount : 0;
        csv += `${entry.id};"${entry.date}";"${entry.description}";"${line.account}";${debe};${haber}\n`;
      });
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `jockey_club_libro_diario_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportMembersCSV = () => {
    let csv = 'Nombre;Credencial ID;Celular;Categoria;Antigüedad;Estado Cuenta;Saldo Deuda;Adherentes Cantidad\n';

    members.forEach(m => {
      csv += `"${m.name}";"${m.memberId}";"${m.phone || ''}";"${m.tier.toUpperCase()}";${m.yearsActive};"${m.status === 'active' ? 'HABILITADO' : 'SUSPENDIDO'}";${m.outstandingBalance};${m.adherents?.length || 0}\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `jockey_club_padron_socios_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- CONSOLA DE MIGRACIÓN LEGACY MOCK UTILITY (50+ SOCIOS) ---
  const handleRunMigration = () => {
    if (migrationState === 'running') return;

    setMigrationState('running');
    setMigrationLogs([]);

    const logSteps = [
      { text: '[09:44:01] INICIANDO ASISTENTE DE MIGRACIÓN JOCKEY-ERP v3.0.1...', delay: 200 },
      { text: '[09:44:02] Estableciendo túnel seguro SSH con host Sybase SQL Legacy...', delay: 500 },
      { text: '[09:44:03] Autenticación completada. Estado del host remoto: Activo.', delay: 900 },
      { text: '[09:44:04] Ejecutando query: `SELECT * FROM tbl_padron_1990_2025 WHERE estado = "activo"`...', delay: 1300 },
      { text: '[09:44:05] Recuperados 52 registros de socios históricos y 18 registros familiares.', delay: 1800 },
      { text: '[09:44:06] Iniciando mapeo y sanitización de números de credencial...', delay: 2200 },
      { text: '[09:44:07] [MIGRADO] socio: Domingo Faustino Sarmiento (Cred: 2026118833994400) - Categoría: Royal', delay: 2400 },
      { text: '[09:44:08] [MIGRADO] socio: Paula Albarracín (Cred: 2026448833221199) - Categoría: Platinum', delay: 2600 },
      { text: '[09:44:09] [MIGRADO] socio: Federico Cantoni (Cred: 2026887755331122) - Categoría: Royal', delay: 2800 },
      { text: '[09:44:10] Inyectando saldos pendientes y cuotas devengadas en el balance...', delay: 3100 },
      { text: '[09:44:11] Consolidando sub-arreglos de adherentes y teléfonos de contacto...', delay: 3500 },
      { text: '[09:44:12] MIGRACIÓN COMPLETADA EXITOSAMENTE. 52 SOCIOS SEEDADOS.', delay: 4000 }
    ];

    logSteps.forEach((step, idx) => {
      setTimeout(() => {
        setMigrationLogs(prev => [...prev, step.text]);
        
        // Al finalizar
        if (idx === logSteps.length - 1) {
          setMigrationState('completed');

          // Nombres históricos reales de San Juan
          const mockNames = [
            'Domingo Faustino Sarmiento', 'Salvador María del Carril', 'Federico Cantoni', 'Aldo Cantoni',
            'Buenaventura Luna', 'Paula Albarracín de Sarmiento', 'Guillermo Rawson', 'Francisco Narciso de Laprida',
            'Antonino Aberastain', 'Nazario Benavídez', 'Martina Chapanay', 'Victoria Cantoni',
            'Adolfo Sarmiento', 'Bautista Del Carril', 'Isabel Albarracín', 'Marta Aberastain',
            'Leopoldo Bravo', 'Emilio Bloise', 'Viviana Cantoni', 'Juan Carlos Cantoni',
            'Mercedes Aberastain', 'Ignacio de la Roza', 'Celedonio Albarracín', 'Manuelita Sarmiento',
            'Javier Cantoni', 'Avelino Belgrano', 'Santiago Albarracín', 'Eduardo Cantoni',
            'Felipe del Carril', 'Lucía Aberastain', 'Guillermo Cantoni', 'Sofía Sarmiento',
            'Federico Bravo', 'Paula Cantoni', 'María Elvira del Carril', 'Rosita Sarmiento',
            'Estanislao Albarracín', 'Marcos Aberastain', 'Silvia Cantoni', 'Pedro del Carril',
            'Clara Albarracín', 'Augusto Sarmiento', 'Beatriz de la Roza', 'Juana Albarracín',
            'Delfina Aberastain', 'Eusebio Cantoni', 'Tomasa de la Roza', 'Bernardo Sarmiento',
            'Virginia Albarracín', 'Leonor Cantoni', 'José Albarracín', 'Ramón del Carril'
          ];

          const generatedMembers = mockNames.map((name, i) => {
            const randomId = 2026000000000000 + Math.floor(Math.random() * 900000000000);
            const randomPhone = `+549264${Math.floor(4000000 + Math.random() * 5999999)}`;
            const randomTier = i % 10 === 0 ? 'royal' : i % 3 === 0 ? 'platinum' : 'gold';
            const randomBalance = i % 5 === 0 ? (randomTier === 'royal' ? 45000 : 32000) : 0;
            const years = Math.floor(2 + Math.random() * 28);
            
            // Algunos con adherentes
            const adh = [];
            if (i % 4 === 0) {
              adh.push({
                id: `adh-mig-${i}-1`,
                name: `Familiar de ${name.split(' ')[0]}`,
                relationship: 'Hijo/a',
                tier: randomTier,
                outstandingBalance: 0,
                status: 'active'
              });
            }

            return {
              name: name,
              memberId: randomId.toString(),
              phone: randomPhone,
              tier: randomTier,
              outstandingBalance: randomBalance,
              yearsActive: years,
              status: 'active',
              adherents: adh
            };
          });

          // Inyectar en estado
          setMembers(prev => {
            // Filtrar duplicados por nombre
            const existingNames = prev.map(m => m.name.toLowerCase());
            const uniqueNew = generatedMembers.filter(m => !existingNames.includes(m.name.toLowerCase()));
            return [...prev, ...uniqueNew];
          });
        }
      }, step.delay);
    });
  };

  return (
    <div className="fade-in">
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
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Pestañas horizontales */
        .tab-button-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 0.4rem;
          margin-bottom: 1.5rem;
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

      {/* Cabecera del Panel */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Mesa Directiva & Operaciones</h1>
          <p className="page-subtitle">Sistema Integrado de Control General, Contabilidad ERP y Trazabilidad Operativa</p>
        </div>
      </div>

      {/* Tarjetas de Métricas de Administración */}
      <div className="admin-metrics">
        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(207, 161, 58, 0.1)', color: 'var(--primary-gold)' }}>
            <Users size={20} />
          </div>
          <div className="stat-info">
            <h4>Padrón Social</h4>
            <div className="stat-value">{totalMembers}</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Membresías titulares activas</p>
          </div>
        </div>

        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--emerald-accent)' }}>
            <DollarSign size={20} />
          </div>
          <div className="stat-info">
            <h4>Recaudación Cuotas</h4>
            <div className="stat-value" style={{ color: 'var(--emerald-accent)' }}>{paymentCollectionRate}%</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Pendiente: {formatCurrency(totalOutstanding)}</p>
          </div>
        </div>

        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
            <CreditCard size={20} />
          </div>
          <div className="stat-info">
            <h4>Activos Totales</h4>
            <div className="stat-value" style={{ fontSize: '1.2rem', fontWeight: '700', marginTop: '0.2rem' }}>
              {formatCurrency(totalActivos)}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Equilibrio PN: {formatCurrency(totalPasivos + totalPatrimonioNetoTotal)}</p>
          </div>
        </div>

        <div className="glass-card stat-widget">
          <div className="stat-icon" style={{ background: utilidadNeta >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <h4>Utilidad del Ejercicio</h4>
            <div className="stat-value" style={{ color: utilidadNeta >= 0 ? 'var(--emerald-accent)' : 'var(--danger-accent)', fontSize: '1.2rem', fontWeight: '700', marginTop: '0.2rem' }}>
              {formatCurrency(utilidadNeta)}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ingresos del mes de Mayo</p>
          </div>
        </div>
      </div>

      {/* Control de Pestañas Integrado */}
      <div className="glass-panel" style={{ padding: '0.5rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
        <div className="tab-button-grid">
          {[
            { key: 'dashboard', icon: <Activity size={14} />, label: 'Dashboard' },
            { key: 'members', icon: <Users size={14} />, label: 'Socios' },
            { key: 'bookings', icon: <Calendar size={14} />, label: 'Reservas' },
            { key: 'accounting', icon: <BookOpen size={14} />, label: 'Contabilidad' },
            { key: 'staff', icon: <ClipboardList size={14} />, label: 'Personal' },
            { key: 'qr_control', icon: <QrCode size={14} />, label: 'Control QR' },
            { key: 'claims', icon: <MessageSquare size={14} />, label: 'Reclamos' },
            { key: 'messaging', icon: <Phone size={14} />, label: 'Mensajería' },
            { key: 'reports', icon: <FileSpreadsheet size={14} />, label: 'Reportes' },
            { key: 'surveys', icon: <Radio size={14} />, label: 'Encuestas' },
            { key: 'migration', icon: <Database size={14} />, label: 'Migración' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="btn"
              style={{
                background: activeTab === tab.key ? 'var(--primary-gold)' : 'transparent',
                color: activeTab === tab.key ? '#060e0a' : 'var(--text-primary)',
                fontSize: '0.82rem', padding: '0.5rem 0.25rem', borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem'
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- CONTENIDO DE CADA TAB --- */}

      {/* TAB: DASHBOARD (PANEL DE CONTROL) */}

          {activeTab === 'dashboard' && (
            <div className="fade-in">
              
              {/* Botonera Rápida Superior */}
              <div className="action-buttons-row">
                <div className="btn" onClick={() => setActiveTab('messaging')}>
                  <MessageSquare size={24} color="var(--primary-gold)" />
                  <span style={{ fontSize: '0.85rem' }}>Nuevo Mensaje</span>
                </div>
                <div className="btn" onClick={() => setActiveTab('surveys')}>
                  <CheckCircle2 size={24} color="var(--primary-gold)" />
                  <span style={{ fontSize: '0.85rem' }}>Nueva Encuesta</span>
                </div>
                <div className="btn" onClick={() => setActiveTab('reports')}>
                  <Activity size={24} color="var(--primary-gold)" />
                  <span style={{ fontSize: '0.85rem' }}>Nuevo Reporte</span>
                </div>
                <div className="btn" onClick={() => setActiveTab('members')}>
                  <UserPlus size={24} color="var(--primary-gold)" />
                  <span style={{ fontSize: '0.85rem' }}>Mi cuenta</span>
                </div>
              </div>
              
              {/* Grilla Principal */}
              <div className="dashboard-grid">
                
                {/* TARJETA 1: COMUNICACIONES */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
                    <MessageSquare size={16} color="var(--primary-gold)" />
                    <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Comunicaciones</h3>
                  </div>
                  
                  <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>5 Mensajes</span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem', position: 'relative' }}>
                    <div className="donut-chart">
                       <div className="donut-hole"></div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 12, height: 12, background: '#ef4444', borderRadius: 2 }}></div> 0 No respondida</div>
                      <span style={{ color: 'var(--text-muted)' }}>0.00 %</span>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 12, height: 12, background: '#eab308', borderRadius: 2 }}></div> 0 No leída</div>
                      <span style={{ color: 'var(--text-muted)' }}>0.00 %</span>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 12, height: 12, background: 'var(--emerald-accent)', borderRadius: 2 }}></div> 5 En progreso</div>
                      <span style={{ color: 'var(--text-muted)' }}>100.00 %</span>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
                    </div>
                  </div>
                  
                  <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', cursor: 'pointer' }} onClick={() => setActiveTab('messaging')}>Ver todas las comunicaciones &gt;</span>
                  </div>
                </div>
                
                {/* TARJETA 2: CONTABILIDAD */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <BookOpen size={16} color="var(--primary-gold)" />
                      <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Contabilidad</h3>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)' }}>Mayo del 2026 ▾</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
                    <div style={{ width: 90, height: 90, borderRadius: '50%', border: '6px solid var(--border-glass)', borderTopColor: 'var(--emerald-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                      {paymentCollectionRate}%
                    </div>
                    <div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{formatCurrency(totalActivos)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Liquidado en Mayo 2026</div>
                      
                      <div style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '0.5rem' }}>{formatCurrency(getAccountBalance('Cuotas Sociales') + getAccountBalance('Caja') + getAccountBalance('Banco Nación'))}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emerald-accent)' }}>Recaudado en Mayo 2026</div>
                    </div>
                  </div>
                  
                  <div style={{ background: 'var(--emerald-accent)', borderRadius: '8px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#000', cursor: 'pointer', transition: 'transform 0.2s' }} className="hover-scale" onClick={() => setActiveTab('accounting')}>
                    <div style={{ background: 'rgba(255,255,255,0.3)', padding: '0.5rem', borderRadius: '8px' }}>
                      <DollarSign size={24} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{formatCurrency(getAccountBalance('Caja') + getAccountBalance('Banco Nación'))}</div>
                      <div style={{ fontSize: '0.75rem' }}>Total en caja al día de hoy</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                      Ver &gt;
                    </div>
                  </div>
                  
                  <div style={{ marginTop: '1.5rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '1rem' }}>Últimos ingresos al día de hoy</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-glass)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>14 (Trx Diarias)</span>
                      <span>{formatCurrency(totalIngresos)}</span>
                    </div>
                  </div>
                  
                  <div style={{ textAlign: 'right', marginTop: '1rem', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', cursor: 'pointer' }} onClick={() => setActiveTab('members')}>Ver todas las deudas &gt;</span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '1rem', marginTop: 'auto' }}>
                    <button className="btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-glass)' }} onClick={() => setActiveTab('members')}>+ Socios</button>
                    <button className="btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-glass)' }} onClick={() => setActiveTab('accounting')}>+ Proveedores</button>
                  </div>
                </div>
                
                {/* COLUMNA 3: SOCIOS Y NOTIFICACIONES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Tarjeta de Compartir Código */}
                  <div className="glass-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <Users size={16} color="var(--primary-gold)" />
                      <h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Socios</h3>
                    </div>
                    <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>¡Comparte el código de tu club!</p>
                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.75rem 1rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#fca5a5', fontWeight: 'bold', letterSpacing: '2px' }}>JCSJ2026</span>
                      <div style={{ display: 'flex', gap: '0.5rem', color: '#fca5a5' }}>
                        <Phone size={16} style={{ cursor: 'pointer' }} />
                        <ClipboardList size={16} style={{ cursor: 'pointer' }} />
                      </div>
                    </div>
                  </div>
                  
                  {/* Resumen Padron */}
                  <div style={{ background: 'rgba(139, 92, 246, 0.5)', borderRadius: '8px', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setActiveTab('members')}>
                    <div style={{ border: '1px solid rgba(255,255,255,0.5)', padding: '0.5rem', borderRadius: '8px' }}>
                      <Users size={20} color="white" />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{totalMembers}</span>
                      <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', marginLeft: '0.5rem' }}>Socios activos</span>
                    </div>
                  </div>
                  
                  <div style={{ background: 'rgba(99, 102, 241, 0.5)', borderRadius: '8px', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setActiveTab('members')}>
                    <div style={{ border: '1px solid rgba(255,255,255,0.5)', padding: '0.5rem', borderRadius: '8px' }}>
                      <Activity size={20} color="white" />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{members.filter(m => m.outstandingBalance === 0).length}</span>
                      <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', marginLeft: '0.5rem' }}>Socios al día</span>
                    </div>
                  </div>
                  
                  {/* Tarjetas de Pendientes */}
                  <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px' }}>
                        <UserPlus size={16} />
                      </div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>0 Solicitudes de socios</span>
                    </div>
                    <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
                  </div>
                  
                  <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px' }}>
                        <Users size={16} />
                      </div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>0 Adherentes pendientes</span>
                    </div>
                    <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: 4 }}>Ver {'>'}</button>
                  </div>
                  
                </div>
              </div>
            </div>
      )}

      {/* 1. GESTIÓN DE SOCIOS Y ADHERENTES */}
      {activeTab === 'members' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="admin-filters" style={{ width: '100%' }}>
            {/* Buscador */}
            <div style={{ position: 'relative', minWidth: '260px', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Buscar socio por nombre o credencial..."
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.5rem', width: '100%' }}
              />
            </div>

            {/* Filtros */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Filter size={16} style={{ color: 'var(--text-muted)' }} />
              <div className="filter-group">
                {['todos', 'royal', 'platinum', 'gold'].map(tier => (
                  <button
                    key={tier}
                    onClick={() => setTierFilter(tier)}
                    className={`filter-btn ${tierFilter === tier ? 'active' : ''}`}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={() => setShowAddForm(!showAddForm)}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Registrar Socio
            </button>
          </div>

          {/* Formulario Alta de Socio */}
          {showAddForm && (
            <form onSubmit={handleAddMember} className="glass-panel fade-in" style={{ padding: '1.25rem', background: 'rgba(255, 255, 255, 0.01)', borderStyle: 'dashed', borderRadius: '12px' }}>
              <h4 className="serif-font" style={{ fontSize: '1.1rem', marginBottom: '0.8rem', color: 'var(--text-gold)' }}>Formulario de Alta Directa</h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 120px', gap: '1rem', alignItems: 'end' }} className="responsive-form-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Nombre Completo del Socio</label>
                  <input
                    type="text"
                    placeholder="Ej: Domingo F. Sarmiento"
                    className="form-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Teléfono Celular (WhatsApp)</label>
                  <input
                    type="text"
                    placeholder="Ej: +5491155551234"
                    className="form-input"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Categoría Club</label>
                  <select
                    className="form-input"
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value)}
                    style={{ padding: '0.7rem' }}
                  >
                    <option value="gold" style={{ background: 'var(--bg-secondary)' }}>Gold (Estándar)</option>
                    <option value="platinum" style={{ background: 'var(--bg-secondary)' }}>Platinum (VIP)</option>
                    <option value="royal" style={{ background: 'var(--bg-secondary)' }}>Royal (Exclusivo)</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.65rem' }}>
                  Guardar
                </button>
              </div>
            </form>
          )}

          {/* Tabla de Socios */}
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Socio Titular</th>
                  <th>Credencial ID</th>
                  <th>Categoría</th>
                  <th>Contacto</th>
                  <th>Cuota / Saldo</th>
                  <th style={{ textAlign: 'right' }}>Acciones Administrativas</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(m => (
                  <React.Fragment key={m.memberId}>
                    <tr>
                      <td>
                        <div className="member-profile-cell">
                          <button
                            onClick={() => setExpandedMemberId(expandedMemberId === m.memberId ? null : m.memberId)}
                            style={{ background: 'none', border: 'none', color: 'var(--primary-gold)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.2rem' }}
                          >
                            {expandedMemberId === m.memberId ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                          <div className="member-avatar">
                            {m.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div>
                            <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{m.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: m.status === 'active' ? 'var(--emerald-accent)' : 'var(--text-muted)' }}>
                              {m.status === 'active' ? '● Cuenta Habilitada' : '○ Cuenta Suspendida'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {m.memberId.replace(/(\d{4})/g, '$1 ').trim()}
                      </td>
                      <td>
                        <span className={`badge-tier ${m.tier.toLowerCase()}`}>
                          {m.tier}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {m.phone || 'Sin registrar'}
                      </td>
                      <td>
                        <span style={{ 
                          fontWeight: '600',
                          color: m.outstandingBalance > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)'
                         }}>
                          {m.outstandingBalance > 0 ? formatCurrency(m.outstandingBalance) : 'Al Día'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          {m.outstandingBalance > 0 && (
                            <button
                              onClick={() => handleCollectDues(m.memberId)}
                              className="btn btn-secondary btn-sm"
                              style={{ 
                                borderColor: 'var(--emerald-accent)', 
                                color: 'var(--emerald-accent)',
                                background: 'rgba(16, 185, 129, 0.03)',
                                padding: '0.35rem 0.65rem' 
                              }}
                              title="Cobrar Cuota Pendiente"
                            >
                              <Check size={12} /> Cobrar
                            </button>
                          )}
                          <button
                            onClick={() => handleGenerateDues(m.memberId)}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                          >
                            Generar Deuda
                          </button>
                          <button
                            onClick={() => {
                              setMembers(members.map(item => {
                                if (item.memberId === m.memberId) {
                                    return { ...item, status: item.status === 'active' ? 'suspended' : 'active' };
                                }
                                return item;
                              }));
                            }}
                            className="btn btn-danger btn-sm"
                            style={{ 
                              padding: '0.35rem 0.65rem', 
                              fontSize: '0.75rem',
                              background: m.status === 'active' ? 'rgba(239, 68, 68, 0.03)' : 'rgba(16, 185, 129, 0.03)',
                              borderColor: m.status === 'active' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                              color: m.status === 'active' ? 'var(--danger-accent)' : 'var(--emerald-accent)'
                            }}
                          >
                            {m.status === 'active' ? 'Suspender' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Fila Expandida de Adherentes Familiares */}
                    {expandedMemberId === m.memberId && (
                      <tr>
                        <td colSpan="6" style={{ padding: '0 0.5rem 1rem 0.5rem' }}>
                          <div className="adherents-subtable-box">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.4rem' }}>
                              <h5 className="serif-font" style={{ fontSize: '1rem', color: 'var(--text-gold)', display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                                <Users size={14} /> Grupo Familiar de {m.name}
                              </h5>
                              <button 
                                onClick={() => setShowAddAdherentId(showAddAdherentId === m.memberId ? null : m.memberId)}
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                              >
                                <UserPlus size={12} /> Agregar Adherente
                              </button>
                            </div>

                            {/* Formulario de Adherente */}
                            {showAddAdherentId === m.memberId && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 100px', gap: '0.75rem', alignItems: 'end', marginBottom: '1rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                  <label className="form-label" style={{ fontSize: '0.7rem' }}>Nombre Completo</label>
                                  <input 
                                    type="text" 
                                    className="form-input" 
                                    style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                    placeholder="Nombre del familiar"
                                    value={adhName}
                                    onChange={(e) => setAdhName(e.target.value)}
                                  />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                  <label className="form-label" style={{ fontSize: '0.7rem' }}>Parentesco</label>
                                  <select 
                                    className="form-input" 
                                    style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                    value={adhRelationship}
                                    onChange={(e) => setAdhRelationship(e.target.value)}
                                  >
                                    <option value="Hijo/a">Hijo/a</option>
                                    <option value="Cónyuge">Cónyuge</option>
                                    <option value="Adherente Deportivo">Adherente Deportivo</option>
                                  </select>
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                  <label className="form-label" style={{ fontSize: '0.7rem' }}>Categoría</label>
                                  <select 
                                    className="form-input" 
                                    style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                    value={adhTier}
                                    onChange={(e) => setAdhTier(e.target.value)}
                                  >
                                    <option value="gold">Gold</option>
                                    <option value="platinum">Platinum</option>
                                    <option value="royal">Royal</option>
                                  </select>
                                </div>
                                <button 
                                  onClick={() => handleAddAdherent(m.memberId)}
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: '0.45rem', width: '100%', fontSize: '0.8rem' }}
                                >
                                  Cargar
                                </button>
                              </div>
                            )}

                            {/* Listado de adherentes */}
                            {!m.adherents || m.adherents.length === 0 ? (
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', margin: '0.5rem 0' }}>
                                No posee adherentes registrados actualmente.
                              </p>
                            ) : (
                              <table className="admin-table" style={{ background: 'transparent' }}>
                                <thead>
                                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                    <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Familiar</th>
                                    <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Parentesco</th>
                                    <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Nivel</th>
                                    <th style={{ fontSize: '0.75rem', padding: '0.4rem' }}>Estado Credencial</th>
                                    <th style={{ fontSize: '0.75rem', padding: '0.4rem', textAlign: 'right' }}>Acciones</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.adherents.map(adh => (
                                    <tr key={adh.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                      <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}><strong>{adh.name}</strong></td>
                                      <td style={{ fontSize: '0.8rem', padding: '0.4rem', color: 'var(--text-secondary)' }}>{adh.relationship}</td>
                                      <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                        <span className={`badge-tier ${adh.tier}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem' }}>
                                          {adh.tier}
                                        </span>
                                      </td>
                                      <td style={{ fontSize: '0.8rem', padding: '0.4rem' }}>
                                        <span style={{ color: adh.status === 'active' ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                                          {adh.status === 'active' ? '● Activo' : '○ Suspendido'}
                                        </span>
                                      </td>
                                      <td style={{ fontSize: '0.8rem', padding: '0.4rem', textAlign: 'right' }}>
                                        <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                                          <button
                                            onClick={() => handleToggleAdherentStatus(m.memberId, adh.id)}
                                            className="btn btn-secondary btn-sm"
                                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                                          >
                                            {adh.status === 'active' ? 'Suspender' : 'Habilitar'}
                                          </button>
                                          <button
                                            onClick={() => handleDeleteAdherent(m.memberId, adh.id)}
                                            className="btn btn-danger btn-sm"
                                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}
                                          >
                                            <Trash2 size={10} />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. CONTROL DE RESERVAS */}
      {activeTab === 'bookings' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3 className="serif-font" style={{ fontSize: '1.4rem' }}>Libro de Reservas Activo</h3>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Socio</th>
                  <th>Instalación</th>
                  <th>Fecha Reservada</th>
                  <th>Horario hs</th>
                  <th>Acompañantes</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Gestión</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map(res => (
                  <tr key={res.id}>
                    <td>
                      <strong>{res.memberName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {res.memberId.slice(0, 8)}...</div>
                    </td>
                    <td>
                      <span style={{ color: 'var(--text-gold)', fontWeight: '600' }}>{res.facilityName}</span>
                    </td>
                    <td>{res.date}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: '500' }}>
                        <Clock size={12} /> {res.time}
                      </span>
                    </td>
                    <td>
                      {res.guests > 0 ? (
                        <span title={res.guestNames} style={{ cursor: 'help', textDecoration: 'underline dotted var(--text-muted)' }}>
                          {res.guests} ({res.guestNames || 'Sin registrar'})
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Solo</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-tag ${res.status}`}>
                        {res.status === 'confirmed' ? 'Confirmado' : res.status === 'pending' ? 'Pendiente' : 'Cancelado'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                        {res.status === 'pending' && (
                          <button
                            onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                            className="btn btn-secondary btn-sm"
                            style={{ 
                              borderColor: 'var(--emerald-accent)', color: 'var(--emerald-accent)', 
                              background: 'rgba(16, 185, 129, 0.05)', padding: '0.35rem 0.75rem'
                            }}
                          >
                            Aprobar
                          </button>
                        )}
                        {res.status !== 'cancelled' && (
                          <button
                            onClick={() => handleUpdateReservationStatus(res.id, 'cancelled')}
                            className="btn btn-danger btn-sm"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                          >
                            Anular
                          </button>
                        )}
                        {res.status === 'cancelled' && (
                          <button
                            onClick={() => handleUpdateReservationStatus(res.id, 'confirmed')}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                          >
                            Reactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. CONTABILIDAD ERP */}
      {activeTab === 'accounting' && (
        <AccountingTab 
          journalEntries={journalEntries} 
          addJournalEntry={addJournalEntry} 
        />
      )}

      {/* 4. TRAZABILIDAD DE PERSONAL */}
      {activeTab === 'staff' && (
        <StaffTab 
          staffMembers={staffMembers} 
          setStaffMembers={setStaffMembers} 
        />
      )}

      {/* 5. CONTROL DE INGRESO QR (SIMULATOR) */}
      {activeTab === 'qr_control' && (
        <div className="grid-2-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem' }} className="responsive-form-grid">
          {/* Simulador de Scanner */}
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div>
              <h3 className="serif-font" style={{ fontSize: '1.25rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <QrCode size={18} /> Molinete de Sede: Escáner QR
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Simule la lectura de la credencial digital de un socio.
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Seleccione Socio para el Escaneo</label>
              <select
                className="form-input"
                value={selectedQRMemberId}
                onChange={(e) => {
                  setSelectedQRMemberId(e.target.value);
                  setScanResult(null);
                }}
                style={{ padding: '0.6rem', fontSize: '0.9rem' }}
              >
                <option value="">-- Elija un socio para simular --</option>
                {members.map(m => (
                  <option key={m.memberId} value={m.memberId} style={{ background: 'var(--bg-secondary)' }}>
                    {m.name} ({m.outstandingBalance > 0 ? `DEBE: ${formatCurrency(m.outstandingBalance)}` : 'AL DÍA'})
                  </option>
                ))}
              </select>
            </div>

            {selectedQRMemberId && (
              <div className="scanner-visualizer">
                {scanning && <div className="scanner-beam" />}
                
                {/* HUD de resultado */}
                {!scanning && !scanResult && (
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <QrCode size={48} style={{ color: 'var(--primary-gold)', opacity: 0.5, marginBottom: '0.5rem', margin: 'auto' }} />
                    <p style={{ fontSize: '0.85rem' }}>Escáner en espera... Listo para lectura láser.</p>
                  </div>
                )}

                {scanning && (
                  <div style={{ textAlign: 'center', color: 'var(--primary-gold)' }}>
                    <Radio size={32} style={{ animation: 'pulseLed 0.5s infinite alternate', margin: 'auto', marginBottom: '0.5rem' }} />
                    <p style={{ fontSize: '0.85rem', fontWeight: '600', letterSpacing: '0.05em' }}>LEYENDO CREDENCIAL DIGITAL...</p>
                  </div>
                )}

                {!scanning && scanResult === 'granted' && (
                  <div style={{ textAlign: 'center', color: 'var(--emerald-accent)', animation: 'slideDownFast 0.3s ease-out' }}>
                    <CheckCircle2 size={48} style={{ margin: 'auto', marginBottom: '0.5rem', filter: 'drop-shadow(0 0 10px rgba(16,185,129,0.3))' }} />
                    <h4 className="serif-font" style={{ fontSize: '1.25rem', letterSpacing: '0.05em', margin: 0 }}>ACCESO AUTORIZADO</h4>
                    <p style={{ fontSize: '0.75rem', color: '#fff', marginTop: '0.25rem' }}>Molinete Abierto • ¡Bienvenido al Club!</p>
                  </div>
                )}

                {!scanning && scanResult === 'denied' && (
                  <div style={{ textAlign: 'center', color: 'var(--danger-accent)', animation: 'slideDownFast 0.3s ease-out' }}>
                    <AlertCircle size={48} style={{ margin: 'auto', marginBottom: '0.5rem', filter: 'drop-shadow(0 0 10px rgba(239,68,68,0.3))' }} />
                    <h4 className="serif-font" style={{ fontSize: '1.25rem', letterSpacing: '0.05em', margin: 0 }}>ACCESO DENEGADO</h4>
                    <p style={{ fontSize: '0.75rem', color: '#fff', marginTop: '0.25rem' }}>Derivar a Tesorería • Cuota Social con Deuda Activa.</p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleSimulateQRScan}
              disabled={!selectedQRMemberId || scanning}
              className="btn btn-primary"
              style={{ padding: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold' }}
            >
              <Play size={14} /> Simular Lectura de QR
            </button>
          </div>

          {/* Historial de Accesos Recientes */}
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="serif-font" style={{ fontSize: '1.25rem', margin: 0 }}>Historial de Accesos Recientes</h3>
              <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.2rem 0.5rem', borderRadius: '10px' }}>
                Total: {entryLogs.length} lecturas
              </span>
            </div>

            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
              {entryLogs.length === 0 ? (
                <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '2rem' }}>
                  No hay registros de ingresos QR en esta sesión todavía.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {entryLogs.map(log => (
                    <div 
                      key={log.id} 
                      style={{ 
                        background: 'rgba(255,255,255,0.01)', 
                        border: '1px solid var(--border-glass)', 
                        padding: '0.75rem 1rem', 
                        borderRadius: '8px', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        borderLeft: log.status === 'granted' ? '3px solid var(--emerald-accent)' : '3px solid var(--danger-accent)'
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '0.9rem', color: '#fff' }}>{log.memberName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {log.role} • Credencial: {log.memberId.slice(0, 6)}...
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          Nota: {log.notes}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`status-tag ${log.status === 'granted' ? 'confirmed' : 'cancelled'}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>
                          {log.status === 'granted' ? 'Aprobado' : 'Denegado'}
                        </span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          {log.time} ({log.date})
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. PEDIDOS & RECLAMOS DE INSTALACIONES */}
      {activeTab === 'claims' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.4rem', margin: 0 }}>Buzón Ejecutivo de Pedidos, Solicitudes y Reclamos</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Gestione y asigne las solicitudes enviadas por los socios al personal técnico o guardas de área.
            </p>
          </div>

          {claims.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1.5rem' }}>
              No existen solicitudes registradas de los socios de momento.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {claims.map(clm => (
                <div 
                  key={clm.id} 
                  className="glass-panel" 
                  style={{ 
                    padding: '1.25rem', 
                    background: 'rgba(255,255,255,0.01)', 
                    borderColor: editingClaimId === clm.id ? 'var(--primary-gold)' : 'var(--border-glass)',
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '0.6rem' 
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`badge-tier ${clm.type === 'Mantenimiento' ? 'gold' : clm.type === 'Gourmet' ? 'royal' : 'platinum'}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>
                        {clm.type}
                      </span>
                      <strong style={{ fontSize: '1rem', color: '#fff' }}>{clm.title}</strong>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Enviado: {clm.date}</span>
                  </div>

                  <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                    <strong>Socio:</strong> {clm.memberName} (ID: {clm.memberId.slice(0, 8)}...)
                  </p>
                  
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(0,0,0,0.1)', padding: '0.5rem', borderRadius: '4px' }}>
                    "{clm.description}"
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.6rem', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span>
                        <strong>Estado:</strong>{' '}
                        <span style={{ 
                          color: clm.status === 'pending' ? 'var(--warning-accent)' : clm.status === 'in_progress' ? '#3b82f6' : 'var(--emerald-accent)',
                          fontWeight: '600'
                        }}>
                          {clm.status === 'pending' ? 'Pendiente' : clm.status === 'in_progress' ? 'En Proceso' : 'Resuelto'}
                        </span>
                      </span>

                      <span>
                        <strong>Asignado a:</strong>{' '}
                        <span style={{ color: 'var(--text-gold)' }}>
                          {clm.assignedStaff || 'Nadie de Guardia'}
                        </span>
                      </span>
                    </div>

                    {editingClaimId !== clm.id ? (
                      <button 
                        onClick={() => {
                          setEditingClaimId(clm.id);
                          setClaimResponseText(clm.response || '');
                          setClaimAssignStaff(clm.assignedStaff || '');
                        }}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.25rem 0.65rem' }}
                      >
                        Gestionar / Responder
                      </button>
                    ) : (
                      <button 
                        onClick={() => setEditingClaimId(null)}
                        className="btn btn-danger btn-sm"
                        style={{ padding: '0.25rem 0.65rem' }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  {/* Bloque de Edición / Asignación */}
                  {editingClaimId === clm.id && (
                    <div className="glass-panel fade-in" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }} className="responsive-form-grid">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.72rem' }}>Asignar Tarea a Empleado de Guardia</label>
                          <select 
                            className="form-input"
                            style={{ padding: '0.45rem', fontSize: '0.8rem' }}
                            value={claimAssignStaff}
                            onChange={(e) => setClaimAssignStaff(e.target.value)}
                          >
                            <option value="">-- No asignar a nadie --</option>
                            {staffMembers.map(emp => (
                              <option key={emp.id} value={emp.name} style={{ background: 'var(--bg-secondary)' }}>
                                {emp.name} ({emp.role} - {emp.status === 'active' ? 'EN GUARDIA' : 'Fuera de Servicio'})
                              </option>
                            ))}
                          </select>
                        </div>
                        
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.72rem' }}>Respuesta Oficial del Club</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            style={{ padding: '0.45rem', fontSize: '0.8rem' }}
                            placeholder="Ej: Se ha derivado al Greenkeeper para soldar la contención."
                            value={claimResponseText}
                            onChange={(e) => setClaimResponseText(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleAssignAndResolveClaim(clm.id, 'in_progress')}
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.75rem', borderColor: '#3b82f6', color: '#3b82f6' }}
                        >
                          Marcar "En Proceso"
                        </button>
                        <button
                          onClick={() => handleAssignAndResolveClaim(clm.id, 'resolved')}
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: '0.75rem', background: 'var(--emerald-accent)', color: '#060e0a' }}
                        >
                          Resolver e Informar
                        </button>
                      </div>
                    </div>
                  )}

                  {clm.response && (
                    <div style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.1)', padding: '0.5rem 0.75rem', borderRadius: '4px', marginTop: '0.2rem' }}>
                      <strong style={{ color: 'var(--emerald-accent)' }}>Respuesta del Club:</strong> "{clm.response}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 7. MENSAJERÍA INTERNA Y WHATSAPP */}
      {activeTab === 'messaging' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem' }} className="responsive-form-grid">
          {/* Enviar Comunicados */}
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div>
              <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>Mailing & Mensajería Exclusiva</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Envíe avisos institucionales directamente al portal privado del socio.
              </p>
            </div>

            {msgSuccess && (
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--emerald-accent)', color: 'var(--emerald-accent)', padding: '0.6rem', borderRadius: '6px', fontSize: '0.8rem', textAlign: 'center' }}>
                ¡Mensaje inyectado en el portal del socio con éxito!
              </div>
            )}

            <form onSubmit={handleSendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Destinatario del Mensaje</label>
                <select
                  className="form-input"
                  value={msgRecipient}
                  onChange={(e) => setMsgRecipient(e.target.value)}
                  style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                >
                  <option value="all" style={{ background: 'var(--bg-secondary)' }}>Todos los Socios (Broadcast Global)</option>
                  {members.map(m => (
                    <option key={m.memberId} value={m.memberId} style={{ background: 'var(--bg-secondary)' }}>
                      {m.name} (Cred: {m.memberId.slice(0, 6)}...)
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Asunto del Comunicado</label>
                <input
                  type="text"
                  placeholder="Ej: Modificación Horario de Canchas de Polo"
                  className="form-input"
                  value={msgSubject}
                  onChange={(e) => setMsgSubject(e.target.value)}
                  style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Cuerpo del Mensaje</label>
                <textarea
                  placeholder="Escriba las directivas del comunicado..."
                  className="form-input"
                  value={msgContent}
                  onChange={(e) => setMsgContent(e.target.value)}
                  style={{ padding: '0.55rem', fontSize: '0.85rem', minHeight: '80px', fontFamily: 'inherit', resize: 'vertical' }}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold' }}
              >
                <Send size={14} /> Enviar Mensaje Interno
              </button>
            </form>
          </div>

          {/* Módulo WhatsApp Direct Debtors */}
          <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div>
              <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>Cobranza vía WhatsApp</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Envíe recordatorios elegantes y pre-armados directamente a sus celulares.
              </p>
            </div>

            {/* Template editor */}
            <div className="form-group" style={{ marginBottom: 0, background: 'rgba(0,0,0,0.1)', padding: '0.75rem', borderRadius: '6px' }}>
              <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-gold)' }}>Configurar Plantilla de WhatsApp</label>
              <textarea 
                className="form-input"
                style={{ padding: '0.4rem', fontSize: '0.78rem', minHeight: '65px', fontFamily: 'inherit', background: 'rgba(0,0,0,0.2)' }}
                value={whatsappTemplate}
                onChange={(e) => setWhatsappTemplate(e.target.value)}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Variables admitidas: <code>{"{nombre}"}</code> y <code>{"{saldo}"}</code>.
              </span>
            </div>

            {/* Listado de Socios Deudores */}
            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
              <h5 className="serif-font" style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--warning-accent)' }}>Socios con Cuotas Pendientes</h5>
              
              {members.filter(m => m.outstandingBalance > 0).length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                  No existen socios con deuda social de momento. ¡Excelente gestión!
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {members.filter(m => m.outstandingBalance > 0).map(debtor => (
                    <div 
                      key={debtor.memberId}
                      style={{ 
                        background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)',
                        padding: '0.6rem 0.8rem', borderRadius: '6px', display: 'flex', 
                        justifyContent: 'space-between', alignItems: 'center' 
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{debtor.name}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--warning-accent)' }}>Deuda: {formatCurrency(debtor.outstandingBalance)}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Cel: {debtor.phone || 'No registrado'}</div>
                      </div>

                      <button
                        onClick={() => handleSendWhatsAppRedirect(debtor)}
                        disabled={!debtor.phone}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', borderColor: 'var(--emerald-accent)', color: 'var(--emerald-accent)' }}
                      >
                        <Phone size={12} /> WhatsApp
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Historial de envíos virtuales */}
            {virtualSentLogs.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                <h5 className="serif-font" style={{ fontSize: '0.9rem', color: 'var(--text-gold)', marginBottom: '0.4rem' }}>Log de Avisos Enviados (Sesión)</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '110px', overflowY: 'auto' }}>
                  {virtualSentLogs.map(log => (
                    <div key={log.id} style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.01)', padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>A: <strong>{log.memberName}</strong> ({log.phone})</span>
                      <span style={{ color: 'var(--emerald-accent)' }}>{log.time} - {log.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 8. REPORTES & EXPORTACIÓN CSV */}
      {activeTab === 'reports' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.4rem', margin: 0 }}>Consola de Reportes Estadísticos y Exportadores CSV</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Analice el rendimiento operativo de las instalaciones y genere archivos contables reales.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }} className="responsive-form-grid">
            {/* Gráficos / Indicadores visuales */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Ocupación deportiva */}
              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
                <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-gold)', marginBottom: '0.80rem' }}>Ocupación de Turnos por Disciplina</h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {[
                    { label: 'Rugby Cuyano (Masc/Fem)', codes: ['rugby_masc', 'rugby_fem'], color: 'var(--primary-gold)' },
                    { label: 'Hockey sobre Césped', codes: ['hockey_cesped'], color: '#10b981' },
                    { label: 'Deportes Hípicos & Turf', codes: ['equitacion_pistas', 'hipismo_saltos', 'turf_vareo'], color: '#d97706' },
                    { label: 'Tenis, Pádel & Fútbol', codes: ['tenis_trad', 'padel_vidrio', 'futbol_fusion'], color: '#f97316' },
                    { label: 'Salón Saludable, Boxeo & Yoga', codes: ['gimnasio_musc', 'circuito_saludable', 'boxeo_salon', 'yoga_salon', 'tenis_mesa', 'voleibol_trad'], color: '#a855f7' },
                    { label: 'Temporada & Vóley Playa', codes: ['piscina_verano', 'volei_playa'], color: '#3b82f6' },
                    { label: 'Gastronomía (The Pavilion)', codes: ['restaurant'], color: '#ec4899' }
                  ].map(facility => {
                    const count = reservations.filter(r => facility.codes.includes(r.facilityId) && r.status === 'confirmed').length;
                    const maxSimulated = 15;
                    const pct = Math.min(Math.round((count / maxSimulated) * 100), 100);

                    return (
                      <div key={facility.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                          <span style={{ color: '#fff' }}>{facility.label}</span>
                          <strong style={{ color: 'var(--text-secondary)' }}>{count} turnos confirmados</strong>
                        </div>
                        <div className="progress-bar-container">
                          <div 
                            className="progress-bar-fill" 
                            style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: facility.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stacked Balance General */}
              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
                <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-gold)', marginBottom: '0.8rem' }}>Ecuación Patrimonial ERP</h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Activos Totales (Caja + Bancos + Equinos + Maquinaria)</span>
                    <strong style={{ color: 'var(--emerald-accent)' }}>{formatCurrency(totalActivos)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pasivo + Patrimonio Neto (Estructura de Capital)</span>
                    <strong style={{ color: 'var(--primary-gold)' }}>{formatCurrency(totalPasivos + totalPatrimonioNetoTotal)}</strong>
                  </div>

                  <div className="progress-bar-container" style={{ height: '16px', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
                      <div style={{ width: '60%', background: 'var(--emerald-accent)', height: '100%', opacity: 0.8 }} title="Banco / Caja" />
                      <div style={{ width: '30%', background: 'var(--primary-gold)', height: '100%', opacity: 0.8 }} title="Bienes de Uso" />
                      <div style={{ width: '10%', background: '#6b7280', height: '100%' }} title="Pasivos" />
                    </div>
                  </div>
                </div>
              </div>

              {/* NUEVO: Distribución de Socios por Categoría (Gráfico de Torta / Donut) */}
              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
                <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-gold)', marginBottom: '0.8rem' }}>Padrón de Socios por Categoría</h4>
                
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }} className="responsive-form-grid">
                  {/* SVG Donut */}
                  <div style={{ position: 'relative', width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, margin: 'auto' }}>
                    <svg viewBox="0 0 100 100" width="100" height="100">
                      {/* Background circle */}
                      <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.02)" strokeWidth="12" fill="transparent" />
                      
                      {/* Segment 1: Royal */}
                      {pctRoyal > 0 && (
                        <circle 
                          cx="50" 
                          cy="50" 
                          r="38" 
                          stroke="var(--primary-gold)" 
                          strokeWidth="12" 
                          fill="transparent" 
                          strokeDasharray={`${(pctRoyal / 100) * 238.76} 238.76`} 
                          strokeLinecap="round"
                          transform="rotate(-90 50 50)"
                          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                        />
                      )}

                      {/* Segment 2: Platinum */}
                      {pctPlatinum > 0 && (
                        <circle 
                          cx="50" 
                          cy="50" 
                          r="38" 
                          stroke="#94a3b8" 
                          strokeWidth="12" 
                          fill="transparent" 
                          strokeDasharray={`${(pctPlatinum / 100) * 238.76} 238.76`} 
                          strokeLinecap="round"
                          transform={`rotate(${-90 + (pctRoyal / 100) * 360} 50 50)`}
                          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                        />
                      )}

                      {/* Segment 3: Gold */}
                      {pctGold > 0 && (
                        <circle 
                          cx="50" 
                          cy="50" 
                          r="38" 
                          stroke="#b45309" 
                          strokeWidth="12" 
                          fill="transparent" 
                          strokeDasharray={`${(pctGold / 100) * 238.76} 238.76`} 
                          strokeLinecap="round"
                          transform={`rotate(${-90 + ((pctRoyal + pctPlatinum) / 100) * 360} 50 50)`}
                          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                        />
                      )}
                    </svg>
                    
                    {/* Donut Center Label */}
                    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: '800', color: '#fff', lineHeight: 1 }}>{totalS}</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Socios</span>
                    </div>
                  </div>

                  {/* Legend */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexGrow: 1, width: '100%' }}>
                    {[
                      { label: 'Categoría Royal (VIP)', count: countRoyal, pct: pctRoyal, color: 'var(--primary-gold)' },
                      { label: 'Categoría Platinum', count: countPlatinum, pct: pctPlatinum, color: '#94a3b8' },
                      { label: 'Categoría Gold (Familiar)', count: countGold, pct: pctGold, color: '#b45309' }
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color, display: 'inline-block' }} />
                          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                        </div>
                        <strong style={{ color: '#fff' }}>{item.count} ({item.pct}%)</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* NUEVO: Desglose de Ingresos y Gastos (Gráfico de Barras Verticales) */}
              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
                <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-gold)', marginBottom: '0.8rem' }}>Evolución de Flujos Contables por Cuenta</h4>
                
                <div style={{ width: '100%', overflowX: 'auto', padding: '0.5rem 0' }}>
                  <svg viewBox="0 0 340 160" width="100%" height="100%" style={{ minWidth: '320px', overflow: 'visible' }}>
                    {/* Grid horizontal lines */}
                    <line x1="10" y1="20" x2="330" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 3" />
                    <line x1="10" y1="70" x2="330" y2="70" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 3" />
                    <line x1="10" y1="120" x2="330" y2="120" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

                    {/* Bars for Ingresos */}
                    {/* Bar 1: Cuotas */}
                    <g>
                      <rect 
                        x="20" 
                        y={120 - (revCuotas / maxVal) * 90} 
                        width="24" 
                        height={(revCuotas / maxVal) * 90} 
                        fill="url(#gradIngresos)" 
                        rx="4" 
                      />
                      <text x="32" y={115 - (revCuotas / maxVal) * 90} fill="var(--emerald-accent)" fontSize="8" fontWeight="700" textAnchor="middle">
                        {revCuotas > 1000 ? `${Math.round(revCuotas/1000)}k` : revCuotas}
                      </text>
                      <text x="32" y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">Cuotas</text>
                    </g>

                    {/* Bar 2: Gourmet */}
                    <g>
                      <rect 
                        x="55" 
                        y={120 - (revGourmet / maxVal) * 90} 
                        width="24" 
                        height={(revGourmet / maxVal) * 90} 
                        fill="url(#gradIngresos)" 
                        rx="4" 
                      />
                      <text x="67" y={115 - (revGourmet / maxVal) * 90} fill="var(--emerald-accent)" fontSize="8" fontWeight="700" textAnchor="middle">
                        {revGourmet > 1000 ? `${Math.round(revGourmet/1000)}k` : revGourmet}
                      </text>
                      <text x="67" y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">Gourmet</text>
                    </g>

                    {/* Bar 3: Golf */}
                    <g>
                      <rect 
                        x="90" 
                        y={120 - (revGolf / maxVal) * 90} 
                        width="24" 
                        height={(revGolf / maxVal) * 90} 
                        fill="url(#gradIngresos)" 
                        rx="4" 
                      />
                      <text x="102" y={115 - (revGolf / maxVal) * 90} fill="var(--emerald-accent)" fontSize="8" fontWeight="700" textAnchor="middle">
                        {revGolf > 1000 ? `${Math.round(revGolf/1000)}k` : revGolf}
                      </text>
                      <text x="102" y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">Golf</text>
                    </g>

                    {/* Section Label: Ingresos */}
                    <rect x="20" y="142" width="94" height="14" rx="7" fill="rgba(16, 185, 129, 0.05)" stroke="rgba(16, 185, 129, 0.15)" strokeWidth="1" />
                    <text x="67" y="152" fill="var(--emerald-accent)" fontSize="8" fontWeight="700" textAnchor="middle">INGRESOS</text>

                    {/* Bars for Egresos */}
                    {/* Bar 4: Sueldos */}
                    <g>
                      <rect 
                        x="190" 
                        y={120 - (expSueldos / maxVal) * 90} 
                        width="24" 
                        height={(expSueldos / maxVal) * 90} 
                        fill="url(#gradEgresos)" 
                        rx="4" 
                      />
                      <text x="202" y={115 - (expSueldos / maxVal) * 90} fill="var(--danger-accent)" fontSize="8" fontWeight="700" textAnchor="middle">
                        {expSueldos > 1000 ? `${Math.round(expSueldos/1000)}k` : expSueldos}
                      </text>
                      <text x="202" y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">Sueldos</text>
                    </g>

                    {/* Bar 5: Mantenimiento */}
                    <g>
                      <rect 
                        x="225" 
                        y={120 - (expMaint / maxVal) * 90} 
                        width="24" 
                        height={(expMaint / maxVal) * 90} 
                        fill="url(#gradEgresos)" 
                        rx="4" 
                      />
                      <text x="237" y={115 - (expMaint / maxVal) * 90} fill="var(--danger-accent)" fontSize="8" fontWeight="700" textAnchor="middle">
                        {expMaint > 1000 ? `${Math.round(expMaint/1000)}k` : expMaint}
                      </text>
                      <text x="237" y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">Canchas</text>
                    </g>

                    {/* Bar 6: Alimento */}
                    <g>
                      <rect 
                        x="260" 
                        y={120 - (expEquine / maxVal) * 90} 
                        width="24" 
                        height={(expEquine / maxVal) * 90} 
                        fill="url(#gradEgresos)" 
                        rx="4" 
                      />
                      <text x="272" y={115 - (expEquine / maxVal) * 90} fill="var(--danger-accent)" fontSize="8" fontWeight="700" textAnchor="middle">
                        {expEquine > 1000 ? `${Math.round(expEquine/1000)}k` : expEquine}
                      </text>
                      <text x="272" y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">Alimento</text>
                    </g>

                    {/* Section Label: Gastos */}
                    <rect x="190" y="142" width="94" height="14" rx="7" fill="rgba(239, 68, 68, 0.05)" stroke="rgba(239, 68, 68, 0.15)" strokeWidth="1" />
                    <text x="237" y="152" fill="var(--danger-accent)" fontSize="8" fontWeight="700" textAnchor="middle">GASTOS</text>

                    {/* Definitions for Gradients */}
                    <defs>
                      <linearGradient id="gradIngresos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--emerald-accent)" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="var(--emerald-accent)" stopOpacity="0.2" />
                      </linearGradient>
                      <linearGradient id="gradEgresos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--danger-accent)" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="var(--danger-accent)" stopOpacity="0.2" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>
            </div>

            {/* Columna Derecha: Exportadores y Backups */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Exportadores CSV Reales */}
              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', justifyItems: 'center', justifyContent: 'center', gap: '1.5rem', border: '1px dashed var(--primary-gold)', borderRadius: '12px' }}>
                <div style={{ textAlign: 'center' }}>
                  <FileSpreadsheet size={48} style={{ color: 'var(--primary-gold)', margin: 'auto', marginBottom: '0.5rem' }} />
                  <h4 className="serif-font" style={{ fontSize: '1.15rem', color: '#fff', margin: 0 }}>Generación de Datos en CSV</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Descargue los registros del sistema local en un formato compatible con Excel o Google Sheets.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <button
                    onClick={handleExportMembersCSV}
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.65rem' }}
                  >
                    <Download size={14} /> Exportar Padrón de Socios (CSV)
                  </button>

                  <button
                    onClick={handleExportJournalCSV}
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.65rem', borderColor: 'var(--primary-gold)', color: 'var(--primary-gold)' }}
                  >
                    <Download size={14} /> Exportar Libro Diario Legal (CSV)
                  </button>
                </div>
              </div>

              {/* Consola de Backups de Base de Datos */}
              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border-glass)', borderRadius: '12px' }}>
                <div style={{ textAlign: 'center' }}>
                  <Database size={40} style={{ color: 'var(--primary-gold)', margin: 'auto', marginBottom: '0.5rem' }} />
                  <h4 className="serif-font" style={{ fontSize: '1.15rem', color: '#fff', margin: 0 }}>Copias de Seguridad (Backup ERP)</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Resguarde la contabilidad, socios y bitácoras locales en su computadora o restáurelos al instante.
                  </p>
                </div>

                {backupSuccessMessage && (
                  <div style={{ 
                    display: 'flex', 
                    gap: '0.5rem', 
                    alignItems: 'center', 
                    background: 'rgba(16, 185, 129, 0.1)', 
                    color: 'var(--emerald-accent)', 
                    padding: '0.75rem', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(16,185,129,0.2)', 
                    fontSize: '0.8rem' 
                  }}>
                    <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                    <span>{backupSuccessMessage}</span>
                  </div>
                )}

                {backupErrorMessage && (
                  <div style={{ 
                    display: 'flex', 
                    gap: '0.5rem', 
                    alignItems: 'center', 
                    background: 'rgba(239, 68, 68, 0.1)', 
                    color: 'var(--danger-accent)', 
                    padding: '0.75rem', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(239,68,68,0.2)', 
                    fontSize: '0.8rem' 
                  }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{backupErrorMessage}</span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button
                    onClick={handleExportBackup}
                    className="btn btn-secondary"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '0.4rem', 
                      padding: '0.65rem',
                      fontSize: '0.85rem'
                    }}
                  >
                    <Download size={14} /> Respaldar (.json)
                  </button>

                  <label
                    className="btn btn-primary"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '0.4rem', 
                      padding: '0.65rem',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      margin: 0
                    }}
                  >
                    <Database size={14} /> Restaurar
                    <input 
                      type="file" 
                      accept=".json" 
                      onChange={handleImportBackup} 
                      style={{ display: 'none' }} 
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. ENCUESTAS & CONSULTAS POPULARES */}
      {activeTab === 'surveys' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.35rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Radio size={20} style={{ color: 'var(--primary-gold)' }} /> Encuestas & Consultas Colectivas
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Gestione las encuestas populares de la Sede Rivadavia, visualice estadísticas avanzadas con gráficos interactivos y simule participación masiva.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
            {/* Formulario de Alta de Encuesta */}
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <h4 className="serif-font" style={{ fontSize: '1.1rem', color: '#fff', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={16} style={{ color: 'var(--primary-gold)' }} /> Crear Nueva Consulta Popular
              </h4>

              <form onSubmit={handleCreateSurvey} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Pregunta de la Encuesta</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. ¿Qué mejora de infraestructura edilicia prefiere para esta temporada?"
                    value={newSurveyQuestion}
                    onChange={(e) => setNewSurveyQuestion(e.target.value)}
                    className="glass-input"
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Categoría</label>
                  <select
                    value={newSurveyCategory}
                    onChange={(e) => setNewSurveyCategory(e.target.value)}
                    className="glass-input"
                    style={{ fontSize: '0.85rem' }}
                  >
                    <option value="Infraestructura">Infraestructura</option>
                    <option value="Deportes">Deportes</option>
                    <option value="Social">Social</option>
                    <option value="Eventos">Eventos</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Opciones de Respuesta (Mínimo 2)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.50rem' }}>
                    {newSurveyOpts.map((opt, idx) => (
                      <input
                        key={idx}
                        type="text"
                        placeholder={`Opción ${idx + 1} ${idx < 2 ? '(Requerida)' : '(Opcional)'}`}
                        required={idx < 2}
                        value={opt}
                        onChange={(e) => {
                          const updated = [...newSurveyOpts];
                          updated[idx] = e.target.value;
                          setNewSurveyOpts(updated);
                        }}
                        className="glass-input"
                        style={{ fontSize: '0.85rem' }}
                      />
                    ))}
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Sparkles size={14} /> Publicar Encuesta
                </button>
              </form>
            </div>

            {/* Listado y Visualización de Resultados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h4 className="serif-font" style={{ fontSize: '1.1rem', color: '#fff', margin: 0 }}>Consultas Activas & Históricas</h4>
              
              {surveys.length === 0 ? (
                <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No hay encuestas registradas.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {surveys.map((survey) => {
                    const totalVotes = survey.options.reduce((sum, o) => sum + o.votes, 0);
                    const maxVotes = Math.max(...survey.options.map(o => o.votes), 1);
                    let accumulatedFraction = 0;

                    // Hover segment logic
                    const activeHoverOptionId = hoveredAdminSegments[survey.id];
                    const activeHoverOption = survey.options.find(o => o.id === activeHoverOptionId);
                    const hoverPct = activeHoverOption && totalVotes > 0 
                      ? Math.round((activeHoverOption.votes / totalVotes) * 100) 
                      : 0;

                    return (
                      <div key={survey.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        
                        {/* Cabecera de la tarjeta */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <span className="badge-tier platinum" style={{ fontSize: '0.75rem', marginRight: '0.5rem' }}>{survey.category}</span>
                            <span style={{ fontSize: '0.75rem', color: survey.active ? 'var(--emerald-accent)' : 'var(--text-muted)' }}>
                              {survey.active ? '🟢 Activa (Recibiendo Votos)' : '🔴 Finalizada'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              onClick={() => handleToggleSurveyActive(survey.id)}
                              className="btn btn-outline"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--border-glass)' }}
                            >
                              {survey.active ? 'Cerrar Consulta' : 'Abrir Consulta'}
                            </button>
                            <button
                              onClick={() => handleDeleteSurvey(survey.id)}
                              className="btn"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-accent)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                            >
                              <Trash2 size={12} /> Eliminar
                            </button>
                          </div>
                        </div>

                        {/* Pregunta */}
                        <h4 className="serif-font" style={{ fontSize: '1.15rem', color: '#fff', margin: 0 }}>{survey.question}</h4>

                        {/* Contenedor Dual de Gráficos */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', alignItems: 'center' }}>
                          
                          {/* 1. GRÁFICO DONUT (TORTA) SVG */}
                          <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.005)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-gold)', fontWeight: '600' }}>Estructura Porcentual (Donut)</span>
                            
                            <div style={{ position: 'relative', width: '130px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg viewBox="0 0 100 100" width="130" height="130">
                                <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.015)" strokeWidth="12" fill="transparent" />
                                {survey.options.map((opt, optIdx) => {
                                  const votes = opt.votes;
                                  const fraction = totalVotes > 0 ? votes / totalVotes : 0;
                                  if (fraction === 0) return null;

                                  const currentAccumulated = accumulatedFraction;
                                  accumulatedFraction += fraction;

                                  const colors = ['var(--primary-gold)', 'var(--emerald-accent)', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7'];
                                  const segmentColor = colors[optIdx % colors.length];
                                  const isHovered = hoveredAdminSegments[survey.id] === opt.id;

                                  return (
                                    <circle 
                                      key={opt.id} 
                                      cx="50" 
                                      cy="50" 
                                      r="38" 
                                      stroke={segmentColor} 
                                      strokeWidth={isHovered ? 15 : 11} 
                                      fill="transparent" 
                                      strokeDasharray={`${fraction * 238.76} 238.76`} 
                                      strokeLinecap="round"
                                      transform={`rotate(${-90 + currentAccumulated * 360} 50 50)`}
                                      style={{ 
                                        transition: 'stroke-width 0.2s ease, stroke-dashoffset 0.5s ease',
                                        cursor: 'pointer'
                                      }}
                                      onMouseEnter={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: opt.id }))}
                                      onMouseLeave={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: null }))}
                                    />
                                  );
                                })}
                              </svg>

                              {/* Donut Center Label */}
                              <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', width: '90px' }}>
                                {activeHoverOption ? (
                                  <>
                                    <span style={{ fontSize: '1.35rem', fontWeight: '800', color: '#fff', lineHeight: 1 }}>{hoverPct}%</span>
                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '0.1rem' }}>{activeHoverOption.votes} Votos</span>
                                  </>
                                ) : (
                                  <>
                                    <span style={{ fontSize: '1.25rem', fontWeight: '800', color: '#fff', lineHeight: 1 }}>{totalVotes}</span>
                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Votos Totales</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 2. GRÁFICO DE BARRAS VERTICALES SVG */}
                          <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.005)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-gold)', fontWeight: '600' }}>Distribución Nominal (Barras)</span>
                            
                            <div style={{ width: '100%', height: '140px', position: 'relative' }}>
                              <svg viewBox="0 0 240 140" width="100%" height="140" style={{ overflow: 'visible' }}>
                                {/* Defs for gradients */}
                                <defs>
                                  {survey.options.map((opt, optIdx) => {
                                    const colors = ['var(--primary-gold)', 'var(--emerald-accent)', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7'];
                                    const segmentColor = colors[optIdx % colors.length];
                                    return (
                                      <linearGradient key={opt.id} id={`grad-bar-${survey.id}-${opt.id}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={segmentColor} stopOpacity="1" />
                                        <stop offset="100%" stopColor={segmentColor} stopOpacity="0.4" />
                                      </linearGradient>
                                    );
                                  })}
                                </defs>

                                {/* Bottom axis line */}
                                <line x1="30" y1="115" x2="235" y2="115" stroke="var(--border-glass)" strokeWidth="1" />

                                {survey.options.map((opt, optIdx) => {
                                  const chartWidth = 190;
                                  const chartHeight = 90;
                                  const paddingLeft = 35;
                                  const paddingTop = 15;

                                  const barGap = (chartWidth - (survey.options.length * 24)) / (survey.options.length + 1);
                                  const x = paddingLeft + barGap + optIdx * (24 + barGap);
                                  const barHeight = totalVotes > 0 ? (opt.votes / maxVotes) * chartHeight : 0;
                                  const y = paddingTop + chartHeight - barHeight;

                                  const colors = ['var(--primary-gold)', 'var(--emerald-accent)', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7'];
                                  const segmentColor = colors[optIdx % colors.length];
                                  const isHovered = hoveredAdminSegments[survey.id] === opt.id;

                                  return (
                                    <g key={opt.id}>
                                      {/* Bar */}
                                      <rect 
                                        x={x} 
                                        y={y} 
                                        width="20" 
                                        height={Math.max(barHeight, 2)} 
                                        rx="4" 
                                        fill={`url(#grad-bar-${survey.id}-${opt.id})`}
                                        stroke={isHovered ? '#fff' : 'transparent'}
                                        strokeWidth="1"
                                        style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
                                        onMouseEnter={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: opt.id }))}
                                        onMouseLeave={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: null }))}
                                      />
                                      {/* Value label */}
                                      <text 
                                        x={x + 10} 
                                        y={y - 4} 
                                        textAnchor="middle" 
                                        fill={isHovered ? 'var(--primary-gold)' : '#fff'} 
                                        fontSize="8" 
                                        fontWeight="700"
                                        style={{ transition: 'all 0.5s ease', pointerEvents: 'none' }}
                                      >
                                        {opt.votes}
                                      </text>
                                      {/* Short axis label */}
                                      <text 
                                        x={x + 10} 
                                        y="126" 
                                        textAnchor="middle" 
                                        fill="var(--text-secondary)" 
                                        fontSize="7.5"
                                        fontWeight="500"
                                        style={{ pointerEvents: 'none' }}
                                      >
                                        {opt.text.length > 10 ? opt.text.substring(0, 8) + '..' : opt.text}
                                      </text>
                                    </g>
                                  );
                                })}
                              </svg>
                            </div>
                          </div>

                        </div>

                        {/* Leyenda interactiva & Botones de simulación */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                            {survey.options.map((opt, optIdx) => {
                              const fraction = totalVotes > 0 ? opt.votes / totalVotes : 0;
                              const pct = Math.round(fraction * 100);
                              const colors = ['var(--primary-gold)', 'var(--emerald-accent)', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7'];
                              const segmentColor = colors[optIdx % colors.length];
                              const isHovered = hoveredAdminSegments[survey.id] === opt.id;

                              return (
                                <div 
                                  key={opt.id} 
                                  style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between', 
                                    fontSize: '0.8rem',
                                    padding: '0.3rem 0.5rem',
                                    borderRadius: '6px',
                                    background: isHovered ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.005)',
                                    border: '1px solid',
                                    borderColor: isHovered ? segmentColor : 'transparent',
                                    transition: 'all 0.2s ease',
                                    cursor: 'pointer'
                                  }}
                                  onMouseEnter={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: opt.id }))}
                                  onMouseLeave={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: null }))}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '70%' }}>
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: segmentColor, flexShrink: 0 }}></span>
                                    <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.text}</span>
                                  </div>
                                  <span style={{ fontWeight: '700', color: segmentColor }}>{pct}% <span style={{ color: 'var(--text-muted)', fontWeight: '400', fontSize: '0.7rem' }}>({opt.votes} v)</span></span>
                                </div>
                              );
                            })}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Participación total registrada: <strong>{totalVotes} votos</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSimulateVotes(survey.id)}
                              disabled={!survey.active}
                              className="btn btn-outline"
                              style={{ 
                                padding: '0.4rem 0.8rem', 
                                fontSize: '0.8rem', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.3rem', 
                                color: 'var(--primary-gold)', 
                                borderColor: 'var(--primary-gold)',
                                opacity: survey.active ? 1 : 0.4,
                                cursor: survey.active ? 'pointer' : 'not-allowed'
                              }}
                            >
                              <Play size={12} fill="var(--primary-gold)" /> Simular Votación Masiva (+500 votos)
                            </button>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 10. CONSOLA DE MIGRACIÓN LEGACY */}
      {activeTab === 'migration' && (
        <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <h3 className="serif-font" style={{ fontSize: '1.35rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Database size={20} /> Consola de Migración Legacy
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Conecte con bases de datos antiguas de sistemas históricos para poblar masivamente el Jockey Club ERP con socios, cuentas y registros.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem' }} className="responsive-form-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
                <strong style={{ fontSize: '0.9rem', color: 'var(--text-gold)', display: 'block', marginBottom: '0.25rem' }}>¿Qué hace esta herramienta?</strong>
                <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', lineHeight: 1.5 }}>
                  <li>Simula un stream de logs SQL en tiempo real.</li>
                  <li>Inyecta **52 socios históricos** únicos al padrón de datos local.</li>
                  <li>Mapea teléfonos argentinos válidos y adherentes familiares.</li>
                  <li>Crea deudas de cuotas pendientes correspondientes a su categoría social.</li>
                </ul>
              </div>

              <button
                onClick={handleRunMigration}
                disabled={migrationState === 'running'}
                className="btn btn-primary"
                style={{ padding: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <Database size={16} /> {migrationState === 'running' ? 'Migrando Base de Datos...' : 'Ejecutar Migración Legacy (Seed 50+)'}
              </button>
            </div>

            {/* Consola Terminal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className={`led-indicator ${migrationState === 'running' ? 'led-green' : 'led-grey'}`} style={{ width: '8px', height: '8px' }} />
                Terminal de Conexión Activa
              </span>
              
              <div className="terminal-box">
                {migrationLogs.length === 0 ? (
                  <span style={{ color: '#4b5563' }}>-- En espera de ejecución. Presione el botón de la izquierda. --</span>
                ) : (
                  migrationLogs.map((logStr, i) => (
                    <div key={i} style={{ marginBottom: '0.2rem', fontFamily: 'monospace' }}>
                      {logStr}
                    </div>
                  ))
                )}
                {migrationState === 'running' && (
                  <div style={{ display: 'inline-block', width: '8px', height: '15px', background: '#10b981', marginLeft: '3px', animation: 'pulseLed 0.4s infinite alternate' }} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
