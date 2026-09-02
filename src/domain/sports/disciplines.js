/** Catálogo y estadísticas de disciplinas deportivas del club. */

export const DISCIPLINE_COLORS = [
  '#10b981', '#3b82f6', '#cfa13a', '#a855f7', '#22c55e',
  '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

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

export function normalizeLabel(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function slugifyDisciplineId(name = '') {
  const base = normalizeLabel(name).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return base || `disc_${Date.now()}`;
}

export function normalizeDiscipline(input = {}) {
  const name = String(input.name || '').trim();
  const id = String(input.id || slugifyDisciplineId(name) || `disc_${Date.now()}`);
  const fromArray = Array.isArray(input.aliases)
    ? input.aliases.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const fromText = String(input.aliasesText || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const aliases = [...new Set([name, ...fromArray, ...fromText].filter(Boolean))];
  return {
    id,
    name,
    aliases: aliases.length ? aliases : [name || id],
    facilityIds: Array.isArray(input.facilityIds)
      ? [...new Set(input.facilityIds.filter(Boolean))]
      : [],
    coachRole: String(input.coachRole || '').trim() || (name ? `Profesor ${name}` : ''),
    color: input.color || DISCIPLINE_COLORS[0],
    isActive: input.isActive !== false,
  };
}

export function getDisciplineOptions(catalog = DISCIPLINE_CATALOG) {
  return (catalog || [])
    .filter((d) => d.isActive !== false)
    .map((d) => d.name);
}

/** Compat: opciones del catálogo por defecto. */
export const DISCIPLINE_OPTIONS = getDisciplineOptions(DISCIPLINE_CATALOG);

export function loadDisciplineCatalog(fallback = DISCIPLINE_CATALOG) {
  try {
    const raw = localStorage.getItem('jockey-disciplines-catalog');
    if (!raw) return fallback.map((d) => normalizeDiscipline(d));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      return fallback.map((d) => normalizeDiscipline(d));
    }
    return parsed.map((d) => normalizeDiscipline(d));
  } catch {
    return fallback.map((d) => normalizeDiscipline(d));
  }
}

export function upsertDiscipline(catalog, draft) {
  const next = normalizeDiscipline(draft);
  if (!next.name) return catalog;
  const list = Array.isArray(catalog) ? catalog : [];
  const idx = list.findIndex((d) => d.id === next.id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [...list, next];
}

export function removeDiscipline(catalog, id) {
  return (catalog || []).filter((d) => d.id !== id);
}

export function resolveDiscipline(label, catalog = DISCIPLINE_CATALOG) {
  const key = normalizeLabel(label);
  if (!key) return null;
  return (
    (catalog || []).find(
      (d) => normalizeLabel(d.name) === key || (d.aliases || []).some((a) => normalizeLabel(a) === key)
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
  return (discipline.aliases || []).some((a) => labels.includes(normalizeLabel(a)))
    || labels.includes(normalizeLabel(discipline.name));
}

/** Socios activos inscritos en una disciplina (titulares). */
export function listMembersForDiscipline(members = [], discipline, { includeInactive = false } = {}) {
  if (!discipline) return [];
  const disc = normalizeDiscipline(discipline);
  return (members || [])
    .filter((m) => includeInactive || m.status !== 'inactive')
    .filter((m) => memberPracticesDiscipline(m, disc))
    .toSorted((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
}

export { memberPracticesDiscipline };

function reservationMatchesDiscipline(res, discipline) {
  if ((discipline.facilityIds || []).includes(res.facilityId)) return true;
  const name = normalizeLabel(res.facilityName || '');
  return (discipline.aliases || []).some((a) => name.includes(normalizeLabel(a)))
    || name.includes(normalizeLabel(discipline.name));
}

/**
 * Reescribe etiquetas de disciplina en el padrón (p. ej. tras renombrar).
 */
export function remapMemberDisciplines(members, { fromLabels = [], toLabel } = {}) {
  if (!toLabel || !fromLabels.length) return members;
  const fromKeys = fromLabels.map(normalizeLabel).filter(Boolean);

  const mapList = (list) => {
    if (!Array.isArray(list) || !list.length) return list;
    let changed = false;
    const next = list.map((label) => {
      if (fromKeys.includes(normalizeLabel(label))) {
        changed = true;
        return toLabel;
      }
      return label;
    });
    return changed ? [...new Set(next)] : list;
  };

  return (members || []).map((m) => ({
    ...m,
    disciplines: mapList(m.disciplines) || m.disciplines,
    preferredSports: mapList(m.preferredSports) || m.preferredSports,
    adherents: (m.adherents || []).map((a) => ({
      ...a,
      disciplines: mapList(a.disciplines) || a.disciplines,
    })),
  }));
}

/**
 * Inscribe o da de baja a un socio titular en una disciplina.
 */
export function toggleMemberDiscipline(members, memberId, disciplineName, enroll = true) {
  const key = normalizeLabel(disciplineName);
  if (!key) return members;
  return (members || []).map((m) => {
    if (String(m.memberId) !== String(memberId) && String(m.id) !== String(memberId)) return m;
    const current = Array.isArray(m.disciplines) ? m.disciplines : [];
    const has = current.some((d) => normalizeLabel(d) === key);
    if (enroll && !has) return { ...m, disciplines: [...current, disciplineName] };
    if (!enroll && has) {
      return { ...m, disciplines: current.filter((d) => normalizeLabel(d) !== key) };
    }
    return m;
  });
}

/**
 * Estadísticas agregadas por disciplina.
 */
export function buildDisciplineStats({
  members = [],
  reservations = [],
  staffMembers = [],
  catalog = DISCIPLINE_CATALOG,
  today = new Date(),
} = {}) {
  const todayIso = today.toISOString().slice(0, 10);
  const activeMembers = members.filter((m) => m.status !== 'inactive');
  const activeCatalog = (catalog || [])
    .map((d) => normalizeDiscipline(d))
    .filter((d) => d.isActive !== false);

  const rows = activeCatalog.map((discipline) => {
    const enrolled = activeMembers.filter((m) => memberPracticesDiscipline(m, discipline));
    const adherentCount = enrolled.reduce(
      (n, m) => n + (m.adherents || []).filter((a) => {
        const labels = (a.disciplines || []).map(normalizeLabel);
        return (discipline.aliases || []).some((al) => labels.includes(normalizeLabel(al)))
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

    const byTier = {};
    enrolled.forEach((m) => {
      const t = String(m.tier || 'other').toLowerCase();
      byTier[t] = (byTier[t] || 0) + 1;
    });

    const coaches = (staffMembers || []).filter((s) => {
      const role = normalizeLabel(s.role || s.position || '');
      return role.includes(normalizeLabel(discipline.name))
        || normalizeLabel(discipline.coachRole).split(' ').some((w) => w.length > 3 && role.includes(w));
    });

    const capacityHint = Math.max((discipline.facilityIds || []).length * 40, 20);
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
