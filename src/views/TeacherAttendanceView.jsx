import { useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  Search,
  Users,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import { listMembersForDiscipline } from '../domain/sports/disciplines';
import {
  ATTENDANCE_STATUSES,
  disciplinesForTeacher,
  duesStatus,
  findAttendanceSession,
  markForMember,
  summarizeSession,
  toISODate,
  upsertAttendanceMark,
} from '../domain/sports/attendance';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(amount || 0);
}

function formatDayLabel(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Vista simple para profesores: elegir disciplina, ver si el alumno está al día
 * y marcar asistencia del día.
 */
export default function TeacherAttendanceView({
  members = [],
  disciplineCatalog = [],
  attendanceSessions = [],
  setAttendanceSessions,
  teacher = null,
  teacherDisciplineIds = null,
}) {
  const todayStr = toISODate(new Date());
  const [date, setDate] = useState(todayStr);
  const [disciplineId, setDisciplineId] = useState('');
  const [query, setQuery] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);

  const disciplines = useMemo(
    () => disciplinesForTeacher(disciplineCatalog, teacherDisciplineIds),
    [disciplineCatalog, teacherDisciplineIds]
  );

  const activeDiscipline = useMemo(() => {
    if (!disciplines.length) return null;
    return disciplines.find((d) => d.id === disciplineId) || disciplines[0];
  }, [disciplines, disciplineId]);

  const roster = useMemo(() => {
    if (!activeDiscipline) return [];
    return listMembersForDiscipline(members, activeDiscipline);
  }, [members, activeDiscipline]);

  const session = useMemo(
    () => (activeDiscipline
      ? findAttendanceSession(attendanceSessions, {
        date,
        disciplineId: activeDiscipline.id,
      })
      : null),
    [attendanceSessions, date, activeDiscipline]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((m) => {
      const dues = duesStatus(m);
      if (onlyDebt && dues.ok) return false;
      if (!q) return true;
      const hay = `${m.name || ''} ${m.memberId || ''} ${m.phone || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [roster, query, onlyDebt]);

  const summary = summarizeSession(session, roster.length);

  const setMark = (member, status) => {
    if (!activeDiscipline || typeof setAttendanceSessions !== 'function') return;
    const current = markForMember(session, member.memberId)?.status;
    const nextStatus = current === status ? null : status;
    setAttendanceSessions((prev) => upsertAttendanceMark(prev, {
      date,
      disciplineId: activeDiscipline.id,
      disciplineName: activeDiscipline.name,
      memberId: member.memberId,
      memberName: member.name,
      status: nextStatus,
      takenBy: teacher?.id || null,
      takenByName: teacher?.fullName || teacher?.name || 'Profesor',
    }));
  };

  const markAllPresentOk = () => {
    if (!activeDiscipline || typeof setAttendanceSessions !== 'function') return;
    setAttendanceSessions((prev) => {
      let next = prev;
      for (const m of roster) {
        const dues = duesStatus(m);
        if (!dues.ok) continue;
        next = upsertAttendanceMark(next, {
          date,
          disciplineId: activeDiscipline.id,
          disciplineName: activeDiscipline.name,
          memberId: m.memberId,
          memberName: m.name,
          status: 'present',
          takenBy: teacher?.id || null,
          takenByName: teacher?.fullName || teacher?.name || 'Profesor',
        });
      }
      return next;
    });
  };

  if (!disciplines.length) {
    return (
      <div className="fade-in glass-card" style={{ padding: '1.5rem', textAlign: 'center' }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          No hay disciplinas activas para tomar asistencia.
        </p>
      </div>
    );
  }

  return (
    <section className="fade-in teach-att">
      <header className="teach-att-head">
        <div>
          <h2 className="teach-att-title">
            <Users size={20} /> Asistencia
          </h2>
          <p className="teach-att-sub">
            Elegí la disciplina, mirá quién está al día y marcá presentes.
          </p>
        </div>
        <div className="teach-att-kpis">
          <span><strong>{summary.present}</strong> presentes</span>
          <span><strong>{summary.absent}</strong> ausentes</span>
          <span><strong>{summary.pending}</strong> sin marcar</span>
        </div>
      </header>

      <div className="teach-att-toolbar glass-card">
        <label className="teach-att-field">
          <span>Disciplina</span>
          <select
            value={activeDiscipline?.id || ''}
            onChange={(e) => setDisciplineId(e.target.value)}
          >
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>

        <label className="teach-att-field">
          <span>Fecha</span>
          <input
            type="date"
            value={date}
            max={todayStr}
            onChange={(e) => setDate(e.target.value || todayStr)}
          />
        </label>

        <label className="teach-att-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar alumno…"
            aria-label="Buscar alumno"
          />
        </label>

        <button
          type="button"
          className={`teach-att-chip${onlyDebt ? ' is-active' : ''}`}
          onClick={() => setOnlyDebt((v) => !v)}
        >
          <AlertCircle size={14} /> Solo con deuda
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={markAllPresentOk}
          title="Marca presente a quienes están al día"
        >
          Presentes al día
        </button>
      </div>

      <p className="teach-att-day">
        <Calendar size={14} />
        {' '}
        {activeDiscipline?.name}
        {' · '}
        {formatDayLabel(date)}
        {' · '}
        {roster.length} alumno{roster.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <div className="teach-att-empty glass-card">
          <Users size={28} />
          <p>No hay alumnos con ese criterio en {activeDiscipline?.name}.</p>
        </div>
      ) : (
        <ul className="teach-att-list">
          {filtered.map((member) => {
            const dues = duesStatus(member);
            const mark = markForMember(session, member.memberId);
            const status = mark?.status || null;

            return (
              <li key={member.memberId} className="teach-att-row glass-card">
                <div className="teach-att-who">
                  <strong>{member.name}</strong>
                  <span className="teach-att-meta">
                    Nº {member.memberId}
                    {member.phone ? ` · ${member.phone}` : ''}
                  </span>
                  <span className={`teach-att-dues${dues.ok ? ' is-ok' : ' is-debt'}`}>
                    {dues.ok ? (
                      <><CheckCircle2 size={13} /> Al día</>
                    ) : (
                      <><AlertCircle size={13} /> {dues.label}{dues.balance ? ` · ${formatCurrency(dues.balance)}` : ''}</>
                    )}
                  </span>
                </div>

                <div className="teach-att-marks" role="group" aria-label={`Asistencia de ${member.name}`}>
                  {ATTENDANCE_STATUSES.map((opt) => {
                    const Icon = opt.id === 'present'
                      ? CheckCircle2
                      : opt.id === 'absent'
                        ? XCircle
                        : Clock3;
                    const active = status === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`teach-att-mark teach-att-mark--${opt.id}${active ? ' is-active' : ''}`}
                        onClick={() => setMark(member, opt.id)}
                        aria-pressed={active}
                      >
                        {active ? <Icon size={15} /> : <Circle size={15} />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
