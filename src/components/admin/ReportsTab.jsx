import { useState } from 'react';
import { FileSpreadsheet, Download, Database, CheckCircle2, AlertCircle } from 'lucide-react';

/** Consola de reportes estadísticos, exportadores CSV y backups del ERP local. */
export default function ReportsTab({
  members,
  reservations,
  journalEntries,
  staffMembers,
  claims,
  messages,
  entryLogs,
  surveys,
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
  totalActivos,
  totalPasivos,
  totalPatrimonioNetoTotal,
}) {
  const [backupSuccessMessage, setBackupSuccessMessage] = useState('');
  const [backupErrorMessage, setBackupErrorMessage] = useState('');

  // Distribución de socios por categoría
  const countRoyal = members.filter(m => m.tier === 'royal').length;
  const countPlatinum = members.filter(m => m.tier === 'platinum').length;
  const countGold = members.filter(m => m.tier === 'gold').length;
  const totalS = countRoyal + countPlatinum + countGold;
  const pctRoyal = totalS > 0 ? Math.round((countRoyal / totalS) * 100) : 0;
  const pctPlatinum = totalS > 0 ? Math.round((countPlatinum / totalS) * 100) : 0;
  const pctGold = totalS > 0 ? Math.round((countGold / totalS) * 100) : 0;

  // Flujos contables por cuenta para el gráfico de barras
  const revCuotas = getAccountBalance('Cuotas Sociales');
  const revGourmet = getAccountBalance('Reservas e Instalaciones');
  const revGolf = getAccountBalance('Concesión Gastronómica');
  const expSueldos = getAccountBalance('Sueldos y Jornales');
  const expMaint = getAccountBalance('Mantenimiento de Canchas');
  const expEquine = getAccountBalance('Alimento Equino');
  const maxVal = Math.max(revCuotas, revGourmet, revGolf, expSueldos, expMaint, expEquine, 10000);

  const handleExportJournalCSV = () => {
    let csv = 'Asiento ID;Fecha;Glosa;Cuenta;Debe;Haber\n';

    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        const debe = line.type === 'debit' ? line.amount : 0;
        const haber = line.type === 'credit' ? line.amount : 0;
        csv += `${entry.id};"${entry.date}";"${entry.description}";"${line.account}";${debe};${haber}\n`;
      });
    });

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
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

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `jockey_club_padron_socios_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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

  return (
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
                      <span style={{ color: 'var(--text-strong)' }}>{facility.label}</span>
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

          {/* Distribución de Socios por Categoría (Donut) */}
          <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
            <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-gold)', marginBottom: '0.8rem' }}>Padrón de Socios por Categoría</h4>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }} className="responsive-form-grid">
              {/* SVG Donut */}
              <div style={{ position: 'relative', width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, margin: 'auto' }}>
                <svg viewBox="0 0 100 100" width="100" height="100">
                  <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.02)" strokeWidth="12" fill="transparent" />

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

                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-strong)', lineHeight: 1 }}>{totalS}</span>
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
                    <strong style={{ color: 'var(--text-strong)' }}>{item.count} ({item.pct}%)</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Desglose de Ingresos y Gastos (Barras) */}
          <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
            <h4 className="serif-font" style={{ fontSize: '1.05rem', color: 'var(--text-gold)', marginBottom: '0.8rem' }}>Evolución de Flujos Contables por Cuenta</h4>

            <div style={{ width: '100%', overflowX: 'auto', padding: '0.5rem 0' }}>
              <svg viewBox="0 0 340 160" width="100%" height="100%" style={{ minWidth: '320px', overflow: 'visible' }}>
                <line x1="10" y1="20" x2="330" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="10" y1="70" x2="330" y2="70" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="10" y1="120" x2="330" y2="120" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

                {[
                  { x: 20, value: revCuotas, label: 'Cuotas', kind: 'ingreso' },
                  { x: 55, value: revGourmet, label: 'Gourmet', kind: 'ingreso' },
                  { x: 90, value: revGolf, label: 'Golf', kind: 'ingreso' },
                  { x: 190, value: expSueldos, label: 'Sueldos', kind: 'gasto' },
                  { x: 225, value: expMaint, label: 'Canchas', kind: 'gasto' },
                  { x: 260, value: expEquine, label: 'Alimento', kind: 'gasto' },
                ].map((bar) => (
                  <g key={bar.label}>
                    <rect
                      x={bar.x}
                      y={120 - (bar.value / maxVal) * 90}
                      width="24"
                      height={(bar.value / maxVal) * 90}
                      fill={bar.kind === 'ingreso' ? 'url(#gradIngresos)' : 'url(#gradEgresos)'}
                      rx="4"
                    />
                    <text x={bar.x + 12} y={115 - (bar.value / maxVal) * 90} fill={bar.kind === 'ingreso' ? 'var(--emerald-accent)' : 'var(--danger-accent)'} fontSize="8" fontWeight="700" textAnchor="middle">
                      {bar.value > 1000 ? `${Math.round(bar.value / 1000)}k` : bar.value}
                    </text>
                    <text x={bar.x + 12} y="132" fill="var(--text-secondary)" fontSize="7.5" fontWeight="600" textAnchor="middle">{bar.label}</text>
                  </g>
                ))}

                <rect x="20" y="142" width="94" height="14" rx="7" fill="rgba(16, 185, 129, 0.05)" stroke="rgba(16, 185, 129, 0.15)" strokeWidth="1" />
                <text x="67" y="152" fill="var(--emerald-accent)" fontSize="8" fontWeight="700" textAnchor="middle">INGRESOS</text>

                <rect x="190" y="142" width="94" height="14" rx="7" fill="rgba(239, 68, 68, 0.05)" stroke="rgba(239, 68, 68, 0.15)" strokeWidth="1" />
                <text x="237" y="152" fill="var(--danger-accent)" fontSize="8" fontWeight="700" textAnchor="middle">GASTOS</text>

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
              <h4 className="serif-font" style={{ fontSize: '1.15rem', color: 'var(--text-strong)', margin: 0 }}>Generación de Datos en CSV</h4>
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
              <h4 className="serif-font" style={{ fontSize: '1.15rem', color: 'var(--text-strong)', margin: 0 }}>Copias de Seguridad (Backup ERP)</h4>
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
  );
}
