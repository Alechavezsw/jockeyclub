/** Asistencia de disciplinas — toma simple por clase / día. */

export const ATTENDANCE_STATUSES = [
  { id: 'present', label: 'Presente', short: 'P' },
  { id: 'absent', label: 'Ausente', short: 'A' },
  { id: 'late', label: 'Tarde', short: 'T' },
];

export function toISODate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function duesStatus(member) {
  const balance = Number(member?.outstandingBalance) || 0;
  if (member?.status === 'suspended') {
    return { id: 'suspended', label: 'Suspendido', ok: false };
  }
  if (balance > 0) {
    return { id: 'debt', label: 'Con deuda', ok: false, balance };
  }
  return { id: 'ok', label: 'Al día', ok: true, balance: 0 };
}

export function attendanceSessionKey(dateStr, disciplineId) {
  return `${dateStr}::${disciplineId}`;
}

export function findAttendanceSession(sessions = [], { date, disciplineId }) {
  const key = attendanceSessionKey(date, disciplineId);
  return (sessions || []).find((s) => attendanceSessionKey(s.date, s.disciplineId) === key) || null;
}

export function upsertAttendanceMark(sessions = [], {
  date,
  disciplineId,
  disciplineName,
  memberId,
  memberName,
  status,
  takenBy = null,
  takenByName = '',
} = {}) {
  if (!date || !disciplineId || !memberId) return sessions || [];
  const list = [...(sessions || [])];
  const idx = list.findIndex(
    (s) => s.date === date && String(s.disciplineId) === String(disciplineId)
  );
  const nowIso = new Date().toISOString();
  const mark = {
    memberId: String(memberId),
    memberName: memberName || '',
    status: status || null,
    updatedAt: nowIso,
  };

  if (idx < 0) {
    if (!status) return list;
    list.unshift({
      id: `att-${Date.now().toString(36)}`,
      date,
      disciplineId,
      disciplineName: disciplineName || disciplineId,
      takenBy,
      takenByName,
      updatedAt: nowIso,
      marks: [mark],
    });
    return list;
  }

  const session = { ...list[idx], marks: [...(list[idx].marks || [])] };
  const mIdx = session.marks.findIndex((m) => String(m.memberId) === String(memberId));
  if (!status) {
    if (mIdx >= 0) session.marks.splice(mIdx, 1);
  } else if (mIdx >= 0) {
    session.marks[mIdx] = { ...session.marks[mIdx], ...mark };
  } else {
    session.marks.push(mark);
  }
  session.updatedAt = nowIso;
  session.takenBy = takenBy ?? session.takenBy;
  session.takenByName = takenByName || session.takenByName;
  list[idx] = session;
  return list;
}

export function markForMember(session, memberId) {
  if (!session) return null;
  return (session.marks || []).find((m) => String(m.memberId) === String(memberId)) || null;
}

export function summarizeSession(session, rosterSize = 0) {
  const marks = session?.marks || [];
  let present = 0;
  let absent = 0;
  let late = 0;
  for (const m of marks) {
    if (m.status === 'present') present += 1;
    else if (m.status === 'absent') absent += 1;
    else if (m.status === 'late') late += 1;
  }
  const marked = present + absent + late;
  return {
    present,
    absent,
    late,
    marked,
    pending: Math.max(0, rosterSize - marked),
  };
}

/** Disciplinas visibles para un profesor (si no tiene filtro, todas las activas). */
export function disciplinesForTeacher(catalog = [], teacherDisciplineIds = null) {
  const active = (catalog || []).filter((d) => d.isActive !== false);
  if (!Array.isArray(teacherDisciplineIds) || !teacherDisciplineIds.length) return active;
  const allowed = new Set(teacherDisciplineIds.map(String));
  return active.filter((d) => allowed.has(String(d.id)) || allowed.has(String(d.name)));
}
