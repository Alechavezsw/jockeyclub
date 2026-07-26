/** Catálogo y estadísticas de disciplinas deportivas del club. */

export const DISCIPLINE_CATALOG = [
  {
    id: 'rugby',
    name: 'Rugby',
    aliases: ['rugby'],
    facilityIds: ['rugby_masc', 'rugby_fem'],
    coachRole: 'Entrenador Rugby',
    color: '#10b981',
  },
  {
    id: 'hockey',
    name: 'Hockey',
    aliases: ['hockey'],
    facilityIds: ['hockey_cesped'],
    coachRole: 'Entrenador Hockey',
    color: '#3b82f6',
  },
  {
    id: 'tenis',
    name: 'Tenis',
    aliases: ['tenis', 'tennis'],
    facilityIds: ['tenis_trad', 'tenis_mesa'],
    coachRole: 'Profesor Tenis',
    color: '#cfa13a',
  },
  {
    id: 'padel',
    name: 'Pádel',
    aliases: ['padel', 'pádel'],
    facilityIds: ['padel_vidrio'],
    coachRole: 'Profesor Pádel',
    color: '#a855f7',
  },
  {
    id: 'futbol',
    name: 'Fútbol',
    aliases: ['futbol', 'fútbol', 'football'],
    facilityIds: ['futbol_fusion'],
    coachRole: 'Entrenador Fútbol',
    color: '#22c55e',
  },
  {
    id: 'hipica',
    name: 'Hípica',
    aliases: ['hípica', 'hipica', 'equitación', 'equitacion', 'hipismo', 'turf'],
    facilityIds: ['equitacion_pistas', 'hipismo_saltos', 'turf_vareo'],
    coachRole: 'Directora Hípica y Turf',
    color: '#f59e0b',
  },
  {
    id: 'fitness',
    name: 'Fitness',
    aliases: ['fitness', 'gimnasio', 'yoga', 'boxeo'],
    facilityIds: ['gimnasio_musc', 'circuito_saludable', 'boxeo_salon', 'yoga_salon'],
    coachRole: 'Instructor Fitness',
    color: '#ef4444',
  },
  {
    id: 'natacion',
    name: 'Natación',
    aliases: ['natación', 'natacion', 'pileta', 'piscina'],
    facilityIds: ['piscina_verano'],
    coachRole: 'Profesor Natación',
    color: '#06b6d4',
  },
  {
    id: 'voleibol',
    name: 'Voleibol',
    aliases: ['voleibol', 'vóley', 'voley', 'vólei'],
    facilityIds: ['voleibol_trad', 'volei_playa'],
    coachRole: 'Entrenador Vóley',
    color: '#ec4899',
  },
  {
    id: 'golf',
    name: 'Golf',
    aliases: ['golf'],
    facilityIds: [],
    coachRole: 'Profesor Golf',
    color: '#84cc16',
  },
];

export const DISCIPLINE_OPTIONS = DISCIPLINE_CATALOG.map((d) => d.name);

function normalizeLabel(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function resolveDiscipline(label) {
  const key = normalizeLabel(label);
  if (!key) return null;
  return (
    DISCIPLINE_CATALOG.find(
      (d) => normalizeLabel(d.name) === key || d.aliases.some((a) => normalizeLabel(a) === key)
    ) || null
  );
}

function memberDisciplineLabels(member) {
  const fromPreferred = member?.preferredSports || [];
  const fromDisc = member?.disciplines || [];
  const fromAdherents = (member?.adherents || []).flatMap((a) => a.disciplines || []);
  return [...fromPreferred, ...fromDisc, ...fromAdherents];
}

function memberPracticesDiscipline(member, discipline) {
  const labels = memberDisciplineLabels(member).map(normalizeLabel);
  return discipline.aliases.some((a) => labels.includes(normalizeLabel(a)))
    || labels.includes(normalizeLabel(discipline.name));
}

function reservationMatchesDiscipline(res, discipline) {
  if (discipline.facilityIds.includes(res.facilityId)) return true;
  const name = normalizeLabel(res.facilityName || '');
  return discipline.aliases.some((a) => name.includes(normalizeLabel(a)))
    || name.includes(normalizeLabel(discipline.name));
}

/**
 * Estadísticas agregadas por disciplina.
 */
export function buildDisciplineStats({
  members = [],
  reservations = [],
  staffMembers = [],
  today = new Date(),
} = {}) {
  const todayIso = today.toISOString().slice(0, 10);
  const activeMembers = members.filter((m) => m.status !== 'inactive');

  const rows = DISCIPLINE_CATALOG.map((discipline) => {
    const enrolled = activeMembers.filter((m) => memberPracticesDiscipline(m, discipline));
    const adherentCount = enrolled.reduce(
      (n, m) => n + (m.adherents || []).filter((a) => {
        const labels = (a.disciplines || []).map(normalizeLabel);
        return discipline.aliases.some((al) => labels.includes(normalizeLabel(al)))
          || labels.includes(normalizeLabel(discipline.name));
      }).length,
      0
    );

    const relatedRes = reservations.filter(
      (r) => r.status !== 'cancelled' && reservationMatchesDiscipline(r, discipline)
    );
    const upcoming = relatedRes.filter((r) => r.date >= todayIso);
    const past30 = relatedRes.filter((r) => {
      const d = new Date(`${r.date}T12:00:00`);
      const diff = (today - d) / 86400000;
      return diff >= 0 && diff <= 30;
    });

    const byTier = { royal: 0, platinum: 0, gold: 0, other: 0 };
    enrolled.forEach((m) => {
      const t = (m.tier || 'other').toLowerCase();
      if (byTier[t] != null) byTier[t] += 1;
      else byTier.other += 1;
    });

    const coaches = (staffMembers || []).filter((s) => {
      const role = normalizeLabel(s.role || s.position || '');
      return role.includes(normalizeLabel(discipline.name))
        || normalizeLabel(discipline.coachRole).split(' ').some((w) => w.length > 3 && role.includes(w));
    });

    const capacityHint = Math.max(discipline.facilityIds.length * 40, 20);
    const occupancyPct = Math.min(100, Math.round((enrolled.length / capacityHint) * 100));

    return {
      ...discipline,
      enrolledCount: enrolled.length,
      adherentCount,
      totalPeople: enrolled.length + adherentCount,
      upcomingBookings: upcoming.length,
      bookingsLast30: past30.length,
      byTier,
      coaches: coaches.map((c) => c.name || c.fullName || 'Staff'),
      occupancyPct,
      members: enrolled
        .map((m) => ({
          memberId: m.memberId,
          name: m.name,
          tier: m.tier,
          phone: m.phone,
          status: m.status,
          outstandingBalance: m.outstandingBalance || 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    };
  });

  const withActivity = rows.filter((r) => r.enrolledCount > 0 || r.bookingsLast30 > 0);
  const totalEnrolled = rows.reduce((s, r) => s + r.enrolledCount, 0);
  const totalBookings30 = rows.reduce((s, r) => s + r.bookingsLast30, 0);
  const top = [...rows].sort((a, b) => b.enrolledCount - a.enrolledCount || b.bookingsLast30 - a.bookingsLast30)[0];

  return {
    rows: rows.sort((a, b) => b.enrolledCount - a.enrolledCount || a.name.localeCompare(b.name, 'es')),
    summary: {
      disciplinesActive: withActivity.length,
      disciplinesTotal: rows.length,
      totalEnrolled,
      totalBookings30,
      topDiscipline: top?.name || '—',
      membersWithoutDiscipline: activeMembers.filter((m) => !(m.disciplines || []).length).length,
    },
  };
}
