import { useRef, useState } from 'react';
import { Database, CloudUpload, Users, Play, Eye, RefreshCw, CalendarDays } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { repos } from '../../data/bootstrap';
import {
  parseCsv,
  sociosRowsToMembers,
  summarizeMembers,
} from '../../domain/members/datitaImport';
import {
  rowsToReservations,
  summarizeReservations,
} from '../../domain/reservations/datitaReservasImport';

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

const BATCH = 200;

async function readFileText(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 20) text = new TextDecoder('latin1').decode(buf);
  return text.replace(/^\uFEFF/, '');
}

/** Consola de migración: localStorage → Supabase + padrón datita. */
export default function MigrationTab({ setMembers, setReservations }) {
  const [migrationState, setMigrationState] = useState('idle');
  const [migrationLogs, setMigrationLogs] = useState([]);
  const [datitaLimit, setDatitaLimit] = useState('50');
  const [datitaSummary, setDatitaSummary] = useState(null);
  const [datitaStats, setDatitaStats] = useState(null);
  const [reservasSummary, setReservasSummary] = useState(null);
  const sociosFileRef = useRef(null);
  const cuotasFileRef = useRef(null);
  const reservasFileRef = useRef(null);
  const preparedRef = useRef(null);
  const preparedReservasRef = useRef(null);

  const pushLog = (text) => setMigrationLogs((prev) => [...prev, text]);
  const busy = migrationState === 'running';

  const handlePushLocalToDb = async () => {
    if (!isSupabaseConfigured) {
      pushLog('Supabase no está configurado. Configurá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (busy) return;
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
    if (busy) return;
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
      tier: i % 3 === 0 ? 'socio_vitalicio' : 'socio_individual',
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

  const loadDatitaFiles = async () => {
    const sociosFile = sociosFileRef.current?.files?.[0];
    const cuotasFile = cuotasFileRef.current?.files?.[0];
    if (!sociosFile || !cuotasFile) {
      throw new Error('Seleccioná socios.csv y socio_cuotas.csv (carpeta datita/).');
    }
    pushLog(`Leyendo ${sociosFile.name} + ${cuotasFile.name}…`);
    const [sociosText, cuotasText] = await Promise.all([
      readFileText(sociosFile),
      readFileText(cuotasFile),
    ]);
    const sociosRows = parseCsv(sociosText);
    const cuotasRows = parseCsv(cuotasText);
    const limitRaw = String(datitaLimit || '').trim();
    const limit = limitRaw === '' || limitRaw === '0' || /^all|full$/i.test(limitRaw)
      ? null
      : Number(limitRaw) || 50;
    const members = sociosRowsToMembers(sociosRows, cuotasRows, { limit });
    const summary = summarizeMembers(members);
    preparedRef.current = { members, summary, sociosCount: sociosRows.length, cuotasCount: cuotasRows.length, limit };
    setDatitaSummary(summary);
    pushLog(`CSV socios=${sociosRows.length} cuotas=${cuotasRows.length} → a procesar=${members.length}${limit ? ` (límite ${limit})` : ''}`);
    return preparedRef.current;
  };

  const handleDatitaDryRun = async () => {
    if (busy) return;
    setMigrationState('running');
    setMigrationLogs([]);
    try {
      const prep = await loadDatitaFiles();
      pushLog(`Tiers: ${JSON.stringify(prep.summary.tiers)}`);
      pushLog(`Estados: ${JSON.stringify(prep.summary.statuses)}`);
      pushLog(`Sin cuota: ${prep.summary.cuotaMissing} · alta fallback: ${prep.summary.joinedAtFallback}`);
      prep.summary.sample.forEach((s) => {
        pushLog(`  #${s.memberId} ${s.name} · ${s.tier} · ${s.status} · ${s.cuotaCategories.join(' | ') || '—'}`);
      });
      pushLog('DRY-RUN listo (sin escribir en BD).');
      setMigrationState('completed');
    } catch (err) {
      pushLog(`FALLO dry-run: ${err.message}`);
      setMigrationState('idle');
    }
  };

  const handleDatitaImport = async () => {
    if (!isSupabaseConfigured) {
      pushLog('Supabase no configurado.');
      return;
    }
    if (busy) return;
    setMigrationState('running');
    setMigrationLogs([]);
    try {
      const prep = await loadDatitaFiles();
      const { members } = prep;
      let inserted = 0;
      let updated = 0;
      let failed = 0;

      for (let i = 0; i < members.length; i += BATCH) {
        const chunk = members.slice(i, i + BATCH);
        for (const m of chunk) {
          try {
            const { data: existing, error: findErr } = await supabase
              .from('members')
              .select('id')
              .eq('member_number', m.memberId)
              .maybeSingle();
            if (findErr) throw findErr;
            await repos.upsertMember({
              ...m,
              id: existing?.id || undefined,
              meta: m.meta || {},
            });
            if (existing?.id) updated += 1;
            else inserted += 1;
          } catch (err) {
            failed += 1;
            if (failed <= 15) pushLog(`[ERROR] #${m.memberId}: ${err.message}`);
          }
        }
        pushLog(`Lote ${Math.min(i + BATCH, members.length)}/${members.length} · ok=${inserted + updated} fail=${failed}`);
      }

      const fresh = await repos.listMembers();
      if (fresh.length) setMembers(fresh);
      await refreshDatitaStats();
      pushLog(`COMPLETADO datita · insertados≈${inserted} actualizados≈${updated} errores=${failed}`);
      setMigrationState('completed');
    } catch (err) {
      pushLog(`FALLO import: ${err.message}`);
      setMigrationState('idle');
    }
  };

  const handleReservasDryRun = async () => {
    if (busy) return;
    setMigrationState('running');
    setMigrationLogs([]);
    try {
      const file = reservasFileRef.current?.files?.[0];
      if (!file) throw new Error('Seleccioná reservas.csv (generado con npm run import:reservas).');
      pushLog(`Leyendo ${file.name}…`);
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const { reservations, skipped } = rowsToReservations(rows);
      const summary = summarizeReservations(reservations);
      preparedReservasRef.current = reservations;
      setReservasSummary({ ...summary, skipped });
      pushLog(`Dry-run reservas: ${summary.total} · omitidas ${skipped}`);
      pushLog(`Espacios: ${JSON.stringify(summary.byFacility)}`);
      pushLog(`Estados: ${JSON.stringify(summary.byStatus)}`);
      setMigrationState('completed');
    } catch (err) {
      pushLog(`FALLO dry-run reservas: ${err.message}`);
      setMigrationState('idle');
    }
  };

  const handleReservasImportLocal = async () => {
    if (busy) return;
    setMigrationState('running');
    setMigrationLogs([]);
    try {
      let list = preparedReservasRef.current;
      if (!list?.length) {
        const file = reservasFileRef.current?.files?.[0];
        if (!file) throw new Error('Seleccioná reservas.csv o corré dry-run antes.');
        const text = await readFileText(file);
        const { reservations } = rowsToReservations(parseCsv(text));
        list = reservations;
        preparedReservasRef.current = list;
      }
      localStorage.setItem('jockey-reservations', JSON.stringify(list));
      if (typeof setReservations === 'function') setReservations(list);
      const summary = summarizeReservations(list);
      setReservasSummary(summary);
      pushLog(`Reservas cargadas en local: ${summary.total}`);
      pushLog(`Espacios: ${JSON.stringify(summary.byFacility)}`);
      setMigrationState('completed');
    } catch (err) {
      pushLog(`FALLO import reservas: ${err.message}`);
      setMigrationState('idle');
    }
  };

  const handleReservasPushDb = async () => {
    if (!isSupabaseConfigured) {
      pushLog('Supabase no está configurado.');
      return;
    }
    if (busy) return;
    setMigrationState('running');
    setMigrationLogs([]);
    try {
      let list = preparedReservasRef.current;
      if (!list?.length) {
        const file = reservasFileRef.current?.files?.[0];
        if (!file) throw new Error('Seleccioná reservas.csv o corré dry-run / carga local antes.');
        const text = await readFileText(file);
        const { reservations } = rowsToReservations(parseCsv(text));
        list = reservations;
      }
      let ok = 0;
      let skip = 0;
      let fail = 0;
      for (const r of list) {
        if (r.status === 'cancelled') {
          skip += 1;
          continue;
        }
        try {
          const dbId = await repos.findMemberDbIdByNumber(r.memberId);
          await repos.createReservation(r, dbId);
          ok += 1;
        } catch (err) {
          fail += 1;
          if (fail <= 12) pushLog(`[WARN] ${r.id}: ${err.message}`);
        }
      }
      pushLog(`COMPLETADO reservas → BD · ok=${ok} canceladas omitidas=${skip} fallos=${fail}`);
      setMigrationState('completed');
    } catch (err) {
      pushLog(`FALLO push reservas: ${err.message}`);
      setMigrationState('idle');
    }
  };

  const refreshDatitaStats = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { count: total, error: tErr } = await supabase
        .from('members')
        .select('*', { count: 'exact', head: true });
      if (tErr) throw tErr;

      const { count: datitaCount, error: dErr } = await supabase
        .from('members')
        .select('*', { count: 'exact', head: true })
        .contains('meta', { source: 'datita' });
      if (dErr) throw dErr;

      const tierIds = [
        'grupo_familiar_familiar',
        'socio_familiar',
        'socio_vitalicio',
        'grupo_familiar_vitalicio',
        'socio_individual',
        'fundador',
        'abono_tenis',
      ];
      const tiers = {};
      for (const tier of tierIds) {
        const { count, error } = await supabase
          .from('members')
          .select('*', { count: 'exact', head: true })
          .contains('meta', { source: 'datita' })
          .eq('tier', tier);
        if (!error && count) tiers[tier] = count;
      }

      const pickOne = async (builder) => {
        const { data, error } = await builder.limit(1).maybeSingle();
        if (error) return null;
        return data;
      };

      const spotBase = () => supabase
        .from('members')
        .select('member_number, full_name, tier, status, document_number, meta')
        .contains('meta', { source: 'datita' });

      const [socio1, vitalicio, familiar, sinCuota] = await Promise.all([
        pickOne(spotBase().eq('member_number', '1')),
        pickOne(spotBase().eq('tier', 'socio_vitalicio')),
        pickOne(spotBase().eq('tier', 'grupo_familiar_familiar')),
        pickOne(
          supabase
            .from('members')
            .select('member_number, full_name, tier, status, document_number, meta')
            .contains('meta', { source: 'datita', cuotaMissing: true })
        ),
      ]);

      let stagingSocios = null;
      let stagingCuotas = null;
      const st = await supabase.from('socios').select('*', { count: 'exact', head: true });
      if (!st.error) stagingSocios = st.count;
      const sc = await supabase.from('socio_cuotas').select('*', { count: 'exact', head: true });
      if (!sc.error) stagingCuotas = sc.count;

      const spot = [socio1, vitalicio, familiar, sinCuota].filter(Boolean);

      setDatitaStats({
        membersTotal: total,
        datitaCount,
        tiers,
        stagingSocios,
        stagingCuotas,
        spot: spot.map((r) => ({
          nro: r.member_number,
          name: r.full_name,
          tier: r.tier,
          status: r.status,
          doc: r.document_number,
        })),
      });
      pushLog(`Estado: members=${total} datita=${datitaCount} staging socios=${stagingSocios ?? 'n/d'} cuotas=${stagingCuotas ?? 'n/d'}`);
    } catch (err) {
      pushLog(`No se pudo leer estado: ${err.message}`);
    }
  };

  return (
    <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h3 className="serif-font" style={{ fontSize: '1.35rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Database size={20} /> Migración de datos
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          Importá datos de prueba desde localStorage hacia Supabase, o el padrón histórico desde datita/.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !isSupabaseConfigured}
          onClick={handlePushLocalToDb}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <CloudUpload size={16} />
          {busy ? 'Importando…' : 'Subir localStorage → BD'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={handleSeedLocalDemo}
        >
          Semilla demo local
        </button>
      </div>

      <section
        className="glass-panel"
        style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
      >
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-gold)' }}>
          <Users size={18} /> Importar padrón datita
        </h4>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Seleccioná los CSV de <code>datita/</code> (no el xlsx). Dry-run no escribe; el lote upserta por n° de socio.
          También: <code>npm run migrate:datita</code> / <code>npm run verify:datita</code>.
          Staging SQL: <code>supabase/migrations/20260829110000_datita_socios_staging.sql</code>.
        </p>

        <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
            socios.csv
            <input ref={sociosFileRef} type="file" accept=".csv,text/csv" disabled={busy} />
          </label>
          <label style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
            socio_cuotas.csv
            <input ref={cuotasFileRef} type="file" accept=".csv,text/csv" disabled={busy} />
          </label>
          <label style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Límite (vacío / all = completo)
            <input
              type="text"
              value={datitaLimit}
              disabled={busy}
              onChange={(e) => setDatitaLimit(e.target.value)}
              placeholder="50"
              style={{ padding: '0.4rem 0.55rem' }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleDatitaDryRun} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Eye size={15} /> Dry-run
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !isSupabaseConfigured}
            onClick={handleDatitaImport}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Play size={15} /> Ejecutar lote → members
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy || !isSupabaseConfigured} onClick={refreshDatitaStats} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={15} /> Estado
          </button>
        </div>

        {datitaSummary && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Último dry-run/prep: {datitaSummary.total} socios · tiers {JSON.stringify(datitaSummary.tiers)} · sin cuota {datitaSummary.cuotaMissing}
          </p>
        )}

        {datitaStats && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>
              BD: members={datitaStats.membersTotal} · origen datita={datitaStats.datitaCount}
              {' · '}staging socios={datitaStats.stagingSocios ?? '—'} cuotas={datitaStats.stagingCuotas ?? '—'}
            </div>
            <div>Tiers datita: {JSON.stringify(datitaStats.tiers)}</div>
            {datitaStats.spot?.length > 0 && (
              <div>
                Spot-check:{' '}
                {datitaStats.spot.map((s) => `#${s.nro} ${s.name} (${s.tier}/${s.status})`).join(' · ')}
              </div>
            )}
          </div>
        )}
      </section>

      <section
        className="glass-panel"
        style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
      >
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-gold)' }}>
          <CalendarDays size={18} /> Importar reservas datita
        </h4>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Export Mi Socio (salones / espacio verde). Generá el CSV con{' '}
          <code>npm run import:reservas</code> desde <code>datita/reservas/*.xlsx</code>.
        </p>
        <label style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 360 }}>
          reservas.csv
          <input ref={reservasFileRef} type="file" accept=".csv,text/csv" disabled={busy} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleReservasDryRun} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Eye size={15} /> Dry-run
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleReservasImportLocal} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Play size={15} /> Cargar en local
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy || !isSupabaseConfigured} onClick={handleReservasPushDb} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CloudUpload size={15} /> Subir a BD
          </button>
        </div>
        {reservasSummary && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Último lote: {reservasSummary.total} reservas · {JSON.stringify(reservasSummary.byStatus)}
            {reservasSummary.skipped != null ? ` · omitidas ${reservasSummary.skipped}` : ''}
          </p>
        )}
      </section>

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
