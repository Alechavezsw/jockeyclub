import { useState } from 'react';
import { Database, CloudUpload } from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';

const LOCAL_KEYS = [
  'jockey-members',
  'jockey-reservations',
  'jockey-claims',
  'jockey-messages',
  'jockey-news',
  'jockey-surveys',
  'jockey-guest-passes',
  'jockey-waitlist',
  'jockey-entry-logs',
];

/** Consola de migración: localStorage → Supabase (o siembra demo local). */
export default function MigrationTab({ setMembers }) {
  const [migrationState, setMigrationState] = useState('idle');
  const [migrationLogs, setMigrationLogs] = useState([]);

  const pushLog = (text) => setMigrationLogs((prev) => [...prev, text]);

  const handlePushLocalToDb = async () => {
    if (!isSupabaseConfigured) {
      pushLog('Supabase no está configurado. Configurá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (migrationState === 'running') return;
    setMigrationState('running');
    setMigrationLogs([]);
    pushLog('Iniciando importación localStorage → Supabase…');

    try {
      const rawMembers = localStorage.getItem('jockey-members');
      const members = rawMembers ? JSON.parse(rawMembers) : [];
      let ok = 0;
      let fail = 0;
      for (const m of members) {
        try {
          await repos.upsertMember(m);
          ok += 1;
          pushLog(`[OK] Socio ${m.memberId} · ${m.name}`);
        } catch (err) {
          fail += 1;
          pushLog(`[ERROR] ${m.memberId || m.name}: ${err.message}`);
        }
      }

      const rawRes = localStorage.getItem('jockey-reservations');
      const reservations = rawRes ? JSON.parse(rawRes) : [];
      for (const r of reservations) {
        try {
          if (r.status === 'cancelled') continue;
          const dbId = await repos.findMemberDbIdByNumber(r.memberId);
          await repos.createReservation(r, dbId);
          pushLog(`[OK] Reserva ${r.facilityId} ${r.date} ${r.time}`);
        } catch (err) {
          pushLog(`[WARN] Reserva omitida: ${err.message}`);
        }
      }

      const rawClaims = localStorage.getItem('jockey-claims');
      const claims = rawClaims ? JSON.parse(rawClaims) : [];
      for (const c of claims) {
        try {
          const dbId = await repos.findMemberDbIdByNumber(c.memberId);
          await repos.upsertClaim(c, dbId);
        } catch {
          /* skip */
        }
      }
      pushLog(`Reclamos procesados: ${claims.length}`);

      const rawMsg = localStorage.getItem('jockey-messages');
      const messages = rawMsg ? JSON.parse(rawMsg) : [];
      for (const m of messages.slice(0, 100)) {
        try {
          await repos.insertMessage(m);
        } catch {
          /* skip */
        }
      }
      pushLog(`Mensajes importados (máx 100): ${Math.min(messages.length, 100)}`);

      // Refrescar padrón en UI
      const fresh = await repos.listMembers();
      if (fresh.length) setMembers(fresh);

      pushLog(`COMPLETADO · socios OK=${ok} fallidos=${fail}`);
      setMigrationState('completed');
    } catch (err) {
      pushLog(`FALLO: ${err.message}`);
      setMigrationState('idle');
    }
  };

  const handleSeedLocalDemo = () => {
    if (migrationState === 'running') return;
    setMigrationState('running');
    setMigrationLogs([]);
    pushLog('Sembrando socios demo en estado local (sin BD)…');

    const mockNames = [
      'Domingo Faustino Sarmiento', 'Federico Cantoni', 'Paula Albarracín',
      'Buenaventura Luna', 'Guillermo Rawson', 'Antonino Aberastain',
    ];
    const generated = mockNames.map((name, i) => ({
      name,
      memberId: String(2026000000000000 + i * 111 + Date.now() % 1000),
      phone: `+549264${4000000 + i}`,
      tier: i % 3 === 0 ? 'royal' : 'gold',
      outstandingBalance: i % 2 === 0 ? 32000 : 0,
      yearsActive: 5 + i,
      status: 'active',
      adherents: [],
    }));
    setMembers((prev) => {
      const names = new Set(prev.map((m) => m.name.toLowerCase()));
      return [...prev, ...generated.filter((m) => !names.has(m.name.toLowerCase()))];
    });
    pushLog(`Agregados ${generated.length} socios demo locales.`);
    LOCAL_KEYS.forEach((k) => {
      if (localStorage.getItem(k)) pushLog(`localStorage tiene: ${k}`);
    });
    setMigrationState('completed');
  };

  return (
    <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h3 className="serif-font" style={{ fontSize: '1.35rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Database size={20} /> Migración de datos
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          Importá datos de prueba desde localStorage hacia Supabase, o sembrá demos locales.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={migrationState === 'running' || !isSupabaseConfigured}
          onClick={handlePushLocalToDb}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <CloudUpload size={16} />
          {migrationState === 'running' ? 'Importando…' : 'Subir localStorage → BD'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={migrationState === 'running'}
          onClick={handleSeedLocalDemo}
        >
          Semilla demo local
        </button>
      </div>

      {!isSupabaseConfigured && (
        <p style={{ fontSize: '0.8rem', color: 'var(--danger-accent)', margin: 0 }}>
          Supabase no configurado: la importación a BD está deshabilitada.
        </p>
      )}

      <div
        className="glass-panel"
        style={{
          padding: '0.85rem 1rem',
          minHeight: 160,
          maxHeight: 320,
          overflow: 'auto',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.72rem',
          color: 'var(--text-secondary)',
        }}
      >
        {migrationLogs.length === 0 ? (
          <span style={{ opacity: 0.6 }}>Sin actividad aún.</span>
        ) : (
          migrationLogs.map((line, i) => (
            <div key={`${i}-${line.slice(0, 12)}`}>{line}</div>
          ))
        )}
      </div>
    </div>
  );
}
