import { useState } from 'react';
import { Database } from 'lucide-react';

/** Consola de migración legacy: siembra masiva de socios históricos. */
export default function MigrationTab({ setMembers }) {
  const [migrationState, setMigrationState] = useState('idle'); // 'idle', 'running', 'completed'
  const [migrationLogs, setMigrationLogs] = useState([]);

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

          // Inyectar en estado, filtrando duplicados por nombre
          setMembers(prev => {
            const existingNames = prev.map(m => m.name.toLowerCase());
            const uniqueNew = generatedMembers.filter(m => !existingNames.includes(m.name.toLowerCase()));
            return [...prev, ...uniqueNew];
          });
        }
      }, step.delay);
    });
  };

  return (
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
  );
}
