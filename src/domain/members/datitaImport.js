/**
 * Transformación padrón datita (CSV/staging) → shape de members del portal.
 * Usado por scripts/migrate-datita-socios.mjs y MigrationTab (dry-run / lote).
 */

export function emptyToNull(v) {
  const s = String(v ?? '').trim();
  if (!s || /^no definido$/i.test(s) || s === '-' || s === 'None') return null;
  return s;
}

export function parseIntSafe(v) {
  const n = Number.parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(v) {
  const s = emptyToNull(v);
  if (!s) return null;
  // ISO o YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function mapGender(sexo) {
  const s = emptyToNull(sexo);
  if (!s) return null;
  if (/^no definido$/i.test(s)) return null;
  return s;
}

export function mapStatus(socioActivo, fechaBaja) {
  if (fechaBaja) return 'inactive';
  const s = String(socioActivo || '').trim().toLowerCase();
  if (!s) return 'pending';
  // Check deshabilitado BEFORE habilitado (substring "habilit" matches both)
  if (s.includes('deshabilit') || s.includes('baja') || s.includes('inactiv')) return 'inactive';
  if (s.includes('habilit')) return 'active';
  return 'pending';
}

export function looksLikeBloodType(v) {
  return /^[ABO]{1,2}\s*[+-]$/i.test(String(v || '').trim())
    || /^(A|B|AB|O)\s*(positivo|negativo|\+|−|-)$/i.test(String(v || '').trim());
}

export function looksLikeCardNumber(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19;
}

/**
 * Deriva tier del enum actual a partir de categorías literales de cuota.
 * Vitalicio/FUNDADOR → vitalicio; familiar → platinum; resto → gold.
 */
export function deriveTier(categories) {
  const cats = (categories || []).map((c) => String(c).toUpperCase());
  if (cats.some((c) => c.includes('VITALICIO') || c.includes('FUNDADOR'))) return 'vitalicio';
  if (cats.some((c) => c.includes('SOCIO FAMILIAR') || c.includes('GRUPO FAMILIAR') || c.includes('(FAMILIAR)'))) {
    return 'platinum';
  }
  if (cats.some((c) => c.includes('SOCIO INDIVIDUAL') || c === 'SOCIO' || c.startsWith('SOCIO ('))) {
    return 'gold';
  }
  return 'gold';
}

export function yearsFromJoin(joinDate) {
  if (!joinDate) return 0;
  const d = new Date(`${joinDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y -= 1;
  return Math.max(0, y);
}

/** CSV parser mínimo con comillas (UTF-8 text). */
export function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || (c === '\r' && src[i + 1] === '\n')) {
      row.push(field);
      field = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
      i += c === '\r' ? 2 : 1;
      continue;
    }
    if (c === '\r') {
      row.push(field);
      field = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] != null ? String(cols[idx]).trim() : '';
    });
    return obj;
  });
}

export function buildCuotasIndex(cuotasRows) {
  const catsByNro = new Map();
  for (const c of cuotasRows || []) {
    const nro = parseIntSafe(c.nro_socio);
    const cat = emptyToNull(c.categoria_cuota);
    if (!nro || !cat) continue;
    if (!catsByNro.has(nro)) catsByNro.set(nro, []);
    catsByNro.get(nro).push(cat);
  }
  return catsByNro;
}

/**
 * @param {Record<string, string>} row fila socios.csv / staging
 * @param {string[]} categories categorías de socio_cuotas
 */
export function socioToMember(row, categories = []) {
  const nro = parseIntSafe(row.nro_socio);
  const nombre = emptyToNull(row.nombre) || '';
  const apellido = emptyToNull(row.apellido) || '';
  const fullName = [nombre, apellido].filter(Boolean).join(' ').trim() || `Socio ${nro}`;

  const prismaRaw = emptyToNull(row.tarjeta_prisma);
  const prismaSuspect = prismaRaw && looksLikeBloodType(prismaRaw);
  const cardNumber = prismaRaw && looksLikeCardNumber(prismaRaw) && !prismaSuspect
    ? prismaRaw.replace(/\s+/g, '')
    : null;

  const joinDateRaw = parseDate(row.fecha_alta);
  const birthDate = parseDate(row.fecha_nacimiento);
  const fechaBaja = parseDate(row.fecha_baja);
  const cats = categories || [];
  // members.joined_at es NOT NULL
  const joinDate = joinDateRaw || birthDate || '1900-01-01';

  const meta = {
    source: 'datita',
    importedAt: new Date().toISOString(),
    autorizacion: emptyToNull(row.autorizacion),
    anioNacimiento: parseIntSafe(row.anio_nacimiento),
    vencimientoAutorizacion: parseDate(row.vencimiento_autorizacion),
    bloodType: emptyToNull(row.grupo_sanguineo),
    healthInsurance: emptyToNull(row.obra_social),
    emergencyClinic: emptyToNull(row.clinica_emergencia),
    prismaId: prismaSuspect ? null : prismaRaw,
    prismaTipoDebito: emptyToNull(row.tipo_debito_prisma),
    prismaSuspectBloodType: prismaSuspect ? prismaRaw : null,
    familyPrincipalNumber: parseIntSafe(row.nro_socio_principal_grupo_familiar),
    familyGroupName: emptyToNull(row.nombre_grupo_familiar),
    cuotaCategories: cats,
    cuotaMissing: cats.length === 0,
    bajaFecha: fechaBaja,
    bajaMotivo: emptyToNull(row.motivo_baja),
    socioActivoRaw: emptyToNull(row.socio_activo),
    joinedAtFallback: joinDateRaw ? null : true,
    fechaAltaRaw: joinDateRaw,
  };

  Object.keys(meta).forEach((k) => {
    if (meta[k] == null || meta[k] === '') delete meta[k];
  });

  return {
    memberId: String(nro),
    name: fullName,
    firstName: nombre || null,
    lastName: apellido || null,
    email: emptyToNull(row.email),
    phone: emptyToNull(row.telefono_personal),
    address: emptyToNull(row.direccion),
    documentType: emptyToNull(row.documento_tipo) || 'Arg-DNI',
    documentNumber: emptyToNull(row.documento_numero),
    gender: mapGender(row.sexo),
    birthDate,
    joinDate,
    emergencyContact: emptyToNull(row.contacto_emergencia),
    emergencyPhone: emptyToNull(row.numero_emergencia),
    cardNumber,
    tier: deriveTier(cats),
    status: mapStatus(row.socio_activo, fechaBaja),
    yearsActive: yearsFromJoin(joinDateRaw),
    outstandingBalance: 0,
    meta,
  };
}

/** Fila DB public.members (upsert). */
export function memberToDbRow(member) {
  return {
    member_number: member.memberId,
    full_name: member.name,
    phone: member.phone || null,
    email: member.email || null,
    address: member.address || null,
    document_type: member.documentType || null,
    document_number: member.documentNumber || null,
    birth_date: member.birthDate || null,
    gender: member.gender || null,
    joined_at: member.joinDate || '1900-01-01',
    emergency_contact: member.emergencyContact || null,
    emergency_phone: member.emergencyPhone || null,
    tier: member.tier || 'gold',
    status: member.status || 'active',
    outstanding_balance: 0,
    years_active: Number(member.yearsActive) || 0,
    card_number: member.cardNumber || null,
    meta: member.meta || {},
  };
}

export function summarizeMembers(members) {
  const tiers = {};
  const statuses = {};
  let cuotaMissing = 0;
  let joinedAtFallback = 0;
  for (const m of members) {
    tiers[m.tier] = (tiers[m.tier] || 0) + 1;
    statuses[m.status] = (statuses[m.status] || 0) + 1;
    if (m.meta?.cuotaMissing) cuotaMissing += 1;
    if (m.meta?.joinedAtFallback) joinedAtFallback += 1;
  }
  return {
    total: members.length,
    tiers,
    statuses,
    cuotaMissing,
    joinedAtFallback,
    sample: members.slice(0, 5).map((m) => ({
      memberId: m.memberId,
      name: m.name,
      tier: m.tier,
      status: m.status,
      documentNumber: m.documentNumber,
      cuotaCategories: m.meta?.cuotaCategories || [],
    })),
  };
}

export function sociosRowsToMembers(sociosRows, cuotasRows, { limit = null } = {}) {
  const catsByNro = buildCuotasIndex(cuotasRows);
  let list = (sociosRows || [])
    .map((row) => {
      const nro = parseIntSafe(row.nro_socio);
      return { row, nro, cats: nro ? (catsByNro.get(nro) || []) : [] };
    })
    .filter((x) => x.nro);
  if (limit) list = list.slice(0, limit);
  return list.map(({ row, cats }) => socioToMember(row, cats));
}
