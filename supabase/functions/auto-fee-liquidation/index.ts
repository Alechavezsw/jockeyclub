import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Liquidación automática de cuota social (día 1 AR → Pendiente;
 * día siguiente 00 h → Procesada + imputación de saldos).
 * Auth: Bearer = service_role o token de dues_cron_config (igual que send-due-notices).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AR_TZ = "America/Argentina/San_Juan";
const APP_DUES_FROM = { year: 2026, month: 11 };
const DUES_DUE_DAY = 10;
const DUES_AMET_DUE_DAY = 18;
const DUES_LATE_TIER_IDS = new Set(["socio_familiar", "socio_individual"]);
const DUES_ADD_ON_TIER_IDS = new Set(["abono_tenis"]);
const EMPTY_CUOTA_RE = /^(–|—|-|−|\.|s\/d|sd|n\/a|na|sin\s*categor[ií]a)$/i;

const MONTHLY_DUES: Record<string, number> = {
  socio_individual: 40000,
  socio_individual_amet: 39000,
  socio_familiar: 70000,
  socio_familiar_amet: 68250,
  abono_tenis: 12000,
  interes_por_transaccion_25_grupo_familiar_amet: 1750,
  interes_por_transaccion_25_socio_individual_amet: 1000,
  grupo_familiar_familiar: 0,
  grupo_familiar_amet: 0,
  grupo_familiar_vitalicio: 0,
  grupo_familiar_fundador: 0,
  socio_vitalicio: 0,
  fundador: 0,
  comision: 0,
};

const TIER_NAMES: Record<string, string> = {
  socio_individual: "SOCIO INDIVIDUAL",
  socio_individual_amet: "SOCIO INDIVIDUAL (AMET)",
  socio_familiar: "SOCIO FAMILIAR",
  socio_familiar_amet: "SOCIO FAMILIAR (AMET)",
  abono_tenis: "ABONO TENIS",
  interes_por_transaccion_25_grupo_familiar_amet: "INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)",
  interes_por_transaccion_25_socio_individual_amet: "INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)",
  socio_vitalicio: "SOCIO (Vitalicio)",
  fundador: "FUNDADOR",
  comision: "COMISION",
};

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type DiscountRule = {
  category: string;
  memberIds: string[];
  memberNumber: string;
  feeCategories: string[];
  familyGroup: string;
  valueType: "percent" | "amount";
  value: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
};

type Charge = {
  memberId: string;
  addAmount: number;
  tierId: string;
  category: string;
  dueOn: string;
};

type MemberLite = {
  dbId: string;
  memberId: string;
  tier: string;
  status: string;
  cuotaCategories: unknown;
  familyPrincipalNumber: string | null;
  familyGroupName: string;
  bajaFecha: string;
  duesFreeThrough: string;
  adherents: Array<{
    memberId?: string;
    name?: string;
    tier?: string;
    status?: string;
    cuotaCategories?: unknown;
    familyGroupName?: string;
  }>;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function arISODate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fold(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugifyTierId(name = "") {
  const base = fold(name).replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return base || "sin_categoria";
}

function parseCuotaCategories(input: unknown) {
  const values = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  for (const raw of values) {
    for (const part of String(raw ?? "").split(/\s*[;/|]\s*|,(?!\s*\d)/)) {
      const text = part.replace(/\s+/g, " ").trim();
      if (!text || EMPTY_CUOTA_RE.test(text)) continue;
      out.push(text);
    }
  }
  return [...new Set(out)];
}

function billedTierIds(member: { cuotaCategories?: unknown; tier?: string }) {
  const fromCategories = parseCuotaCategories(member?.cuotaCategories).map((name) => slugifyTierId(name));
  if (fromCategories.length) return [...new Set(fromCategories)];
  const tier = String(member?.tier || "").trim().toLowerCase();
  return tier ? [tier] : [];
}

function isExemptDuesTierId(id: string) {
  const t = String(id || "").trim().toLowerCase();
  return /vitalicio|fundador|^comision$/.test(t);
}

function isDuesExemptMember(member: MemberLite) {
  const ids = billedTierIds(member);
  const tier = String(member?.tier || "").trim().toLowerCase();
  const pool = ids.length ? ids : (tier ? [tier] : []);
  if (!pool.length) return false;
  if (pool.some((id) => /vitalicio/.test(id)) || /vitalicio/i.test(String(member?.tier || ""))) {
    return true;
  }
  return pool.every((id) => isExemptDuesTierId(id));
}

function isFamilyDependent(member: MemberLite) {
  const principal = String(member.familyPrincipalNumber || "").replace(/\D/g, "");
  const self = String(member.memberId || "").replace(/\D/g, "");
  if (!principal || !self) return false;
  return principal !== self;
}

function isMemberBillingActive(member: MemberLite, todayIso: string) {
  if (String(member.status || "active").toLowerCase() !== "active") return false;
  const baja = String(member.bajaFecha || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(baja) && baja <= todayIso) return false;
  return true;
}

function isAmetDuesMember(member: MemberLite) {
  const ids = billedTierIds(member);
  const pool = ids.length ? ids : [String(member.tier || "").trim().toLowerCase()].filter(Boolean);
  return pool.some((id) => id.includes("amet") && /socio_(familiar|individual)/.test(id));
}

function duesDueDayForMember(member: MemberLite) {
  return isAmetDuesMember(member) ? DUES_AMET_DUE_DAY : DUES_DUE_DAY;
}

function memberKey(value: unknown) {
  return String(value || "").trim().replace(/^0+/, "");
}

function ruleCoversDate(rule: DiscountRule, onIso: string) {
  if (!rule || rule.isActive === false) return false;
  if (rule.validFrom && rule.validFrom > onIso) return false;
  if (rule.validTo && rule.validTo < onIso) return false;
  return true;
}

function ruleMatchesFee(
  rule: DiscountRule,
  member: { memberId?: string; familyGroupName?: string; cuotaCategories?: unknown; tier?: string },
  context: { categoryName?: string; tierId?: string },
) {
  const category = rule.category || "members";
  const number = memberKey(member?.memberId);
  if (category === "general") return true;
  if (category === "members" || category === "member_fee") {
    const nums = new Set([...(rule.memberIds || []), rule.memberNumber].map(memberKey).filter(Boolean));
    if (!nums.has(number)) return false;
    if (category === "members" || !context.categoryName) return true;
    const names = [
      ...parseCuotaCategories(member?.cuotaCategories),
      member?.tier,
    ].map(fold).filter(Boolean);
    const primary = names[0] || fold(context.categoryName);
    return fold(context.categoryName) === primary || slugifyTierId(context.categoryName) === slugifyTierId(primary);
  }
  if (category === "fee_category") {
    const wanted = (rule.feeCategories || []).map(fold).filter(Boolean);
    const line = fold(context.categoryName || "");
    const lineSlug = slugifyTierId(context.categoryName || context.tierId || "");
    return wanted.some((name) => name === line || slugifyTierId(name) === lineSlug);
  }
  if (category === "family") {
    const wanted = fold(rule.familyGroup);
    if (!wanted) return false;
    const group = fold(member?.familyGroupName || "");
    return Boolean(group) && (group === wanted || group.includes(wanted) || wanted.includes(group));
  }
  return false;
}

function discountOnAmount(
  gross: number,
  rules: DiscountRule[],
  member: MemberLite,
  context: { on: string; categoryName: string; tierId: string },
) {
  const base = Math.max(0, money(gross));
  if (!base) return 0;
  let percent = 0;
  let fixed = 0;
  for (const rule of rules || []) {
    if (!ruleCoversDate(rule, context.on)) continue;
    if (!ruleMatchesFee(rule, member, context)) continue;
    const value = Number(rule.value) || 0;
    if (value <= 0) continue;
    if (rule.valueType === "amount") fixed += value;
    else percent += value;
  }
  percent = Math.min(100, Math.max(0, percent));
  return Math.max(0, money(base * (1 - percent / 100) - fixed));
}

function tierAmount(id: string) {
  const key = String(id || "").trim().toLowerCase();
  return MONTHLY_DUES[key] ?? 0;
}

function tierDisplayName(id: string) {
  const key = String(id || "").trim().toLowerCase();
  return TIER_NAMES[key] || String(id || "—").replace(/_/g, " ").toUpperCase();
}

function chargeSlicesForMember(member: MemberLite, onIso: string, rules: DiscountRule[]) {
  if (isDuesExemptMember(member) || isFamilyDependent(member)) return [] as Array<{ tierId: string; category: string; amount: number }>;
  const slices = new Map<string, { tierId: string; category: string; amount: number }>();
  const push = (person: MemberLite | MemberLite["adherents"][0], id: string) => {
    const gross = tierAmount(id);
    if (!gross) return;
    const amount = discountOnAmount(gross, rules, {
      ...member,
      memberId: (person as MemberLite).memberId || member.memberId,
      cuotaCategories: person.cuotaCategories ?? (person.tier ? [person.tier] : member.cuotaCategories),
      familyGroupName: person.familyGroupName || member.familyGroupName,
      tier: person.tier || member.tier,
    } as MemberLite, {
      on: onIso,
      categoryName: tierDisplayName(id),
      tierId: id,
    });
    if (amount <= 0) return;
    const prev = slices.get(id);
    if (prev) prev.amount = money(prev.amount + amount);
    else slices.set(id, { tierId: id, category: tierDisplayName(id), amount });
  };

  for (const id of billedTierIds(member)) push(member, id);
  for (const row of member.adherents || []) {
    if (!row || row.status === "inactive") continue;
    const person = {
      ...row,
      memberId: row.memberId || member.memberId,
      cuotaCategories: row.cuotaCategories || (row.tier ? [row.tier] : undefined),
      familyGroupName: row.familyGroupName || member.familyGroupName,
    };
    for (const id of billedTierIds(person)) {
      if (!DUES_ADD_ON_TIER_IDS.has(id)) continue;
      push(person, id);
    }
  }
  return [...slices.values()];
}

function buildCharges(members: MemberLite[], year: number, month: number, todayIso: string, rules: DiscountRule[]) {
  const onIso = `${year}-${pad2(month)}-10`;
  const charges: Charge[] = [];
  for (const member of members) {
    if (!member || !isMemberBillingActive(member, todayIso) || isFamilyDependent(member)) continue;
    if (isDuesExemptMember(member)) continue;
    const freeThrough = String(member.duesFreeThrough || "").slice(0, 7);
    const periodKey = `${year}-${pad2(month)}`;
    if (/^\d{4}-\d{2}$/.test(freeThrough) && periodKey <= freeThrough) continue;
    const dueOn = `${year}-${pad2(month)}-${pad2(duesDueDayForMember(member))}`;
    for (const slice of chargeSlicesForMember(member, onIso, rules)) {
      charges.push({
        memberId: member.memberId,
        addAmount: slice.amount,
        tierId: slice.tierId,
        category: slice.category,
        dueOn,
      });
    }
  }
  return charges;
}

function aggregateDeltas(charges: Charge[]) {
  const byId = new Map<string, { memberId: string; amount: number; periods: Map<string, { dueOn: string; capital: number; lateBase: number }> }>();
  for (const charge of charges) {
    const memberId = String(charge.memberId || "").trim();
    const amount = Number(charge.addAmount) || 0;
    if (!memberId || !(amount > 0)) continue;
    const row = byId.get(memberId) || { memberId, amount: 0, periods: new Map() };
    row.amount += amount;
    const dueOn = String(charge.dueOn || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
      const tierId = String(charge.tierId || "").trim().toLowerCase();
      const late = !tierId || DUES_LATE_TIER_IDS.has(tierId) ? amount : 0;
      const period = row.periods.get(dueOn) || { dueOn, capital: 0, lateBase: 0 };
      period.capital += amount;
      period.lateBase += late;
      row.periods.set(dueOn, period);
    }
    byId.set(memberId, row);
  }
  return [...byId.values()].map((row) => ({
    memberId: row.memberId,
    amount: money(row.amount),
    periods: [...row.periods.values()].map((period) => ({
      dueOn: period.dueOn,
      capital: money(period.capital),
      lateBase: money(period.lateBase),
    })),
  }));
}

function packLinesFromCharges(charges: Charge[]) {
  const byTier = new Map<string, { identifier: string; tierId: string; name: string; holders: number; unit: number; total: number }>();
  for (const charge of charges) {
    const id = String(charge.tierId || "otro").toLowerCase();
    const row = byTier.get(id) || {
      identifier: id,
      tierId: id,
      name: charge.category || tierDisplayName(id),
      holders: 0,
      unit: 0,
      total: 0,
    };
    row.holders += 1;
    row.total = money(row.total + (Number(charge.addAmount) || 0));
    row.unit = row.holders ? money(row.total / row.holders) : 0;
    byTier.set(id, row);
  }
  return [...byTier.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function mapDiscountRule(row: Record<string, unknown>): DiscountRule | null {
  if (!row || row.is_active === false) return null;
  const memberIds = String(row.member_numbers || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const feeCategories = String(row.fee_categories || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    category: String(row.category || "members"),
    memberIds,
    memberNumber: memberIds[0] || "",
    feeCategories,
    familyGroup: String(row.family_group || ""),
    valueType: row.value_type === "amount" ? "amount" : "percent",
    value: Number(row.value) || 0,
    validFrom: String(row.valid_from || "").slice(0, 10),
    validTo: String(row.valid_to || "").slice(0, 10),
    isActive: row.is_active !== false,
  };
}

function attachHousehold(members: MemberLite[]) {
  const byPrincipal = new Map<string, MemberLite[]>();
  for (const m of members) {
    if (!isFamilyDependent(m)) continue;
    const p = String(m.familyPrincipalNumber || "").replace(/\D/g, "");
    if (!p) continue;
    if (!byPrincipal.has(p)) byPrincipal.set(p, []);
    byPrincipal.get(p)!.push(m);
  }
  if (!byPrincipal.size) return members;
  return members.map((m) => {
    const self = String(m.memberId || "").replace(/\D/g, "");
    const household = self ? (byPrincipal.get(self) || []) : [];
    if (!household.length) return m;
    const extras = household.map((h) => ({
      memberId: h.memberId,
      name: undefined,
      tier: h.tier,
      status: h.status,
      cuotaCategories: h.cuotaCategories,
      familyGroupName: h.familyGroupName,
    }));
    return { ...m, adherents: [...(m.adherents || []), ...extras] };
  });
}

async function loadMembers(admin: SupabaseClient): Promise<MemberLite[]> {
  const pageSize = 1000;
  const members: MemberLite[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("members")
      .select("id, member_number, tier, status, meta")
      .eq("status", "active")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const row of rows) {
      const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
      members.push({
        dbId: row.id,
        memberId: String(row.member_number || "").trim(),
        tier: String(row.tier || ""),
        status: String(row.status || "active"),
        cuotaCategories: meta.cuotaCategories ?? null,
        familyPrincipalNumber: meta.familyPrincipalNumber != null
          ? String(meta.familyPrincipalNumber)
          : null,
        familyGroupName: String(meta.familyGroupName || ""),
        bajaFecha: String(meta.bajaFecha || "").slice(0, 10),
        duesFreeThrough: String(meta.duesFreeThrough || "").slice(0, 7),
        adherents: [],
      });
    }
    if (rows.length < pageSize) break;
  }

  const byDb = new Map(members.map((m) => [m.dbId, m]));
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("member_adherents")
      .select("member_id, full_name, tier, status, meta")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) break;
    const rows = data || [];
    for (const row of rows) {
      const parent = byDb.get(row.member_id);
      if (!parent) continue;
      if (String(row.status || "").toLowerCase() === "inactive") continue;
      const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
      parent.adherents.push({
        memberId: parent.memberId,
        name: row.full_name || undefined,
        tier: String(row.tier || ""),
        status: String(row.status || "active"),
        cuotaCategories: meta.cuotaCategories ?? (row.tier ? [row.tier] : undefined),
        familyGroupName: parent.familyGroupName,
      });
    }
    if (rows.length < pageSize) break;
  }

  return attachHousehold(members);
}

async function loadDiscountRules(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("discount_rules")
    .select("*")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => mapDiscountRule(row as Record<string, unknown>)).filter(Boolean) as DiscountRule[];
}

async function ensurePeriodRow(
  admin: SupabaseClient,
  year: number,
  month: number,
) {
  const id = `fp-${year}-${pad2(month)}`;
  const { data: existing } = await admin
    .from("fee_period_closures")
    .select("id, year, month, status, amount, generated_at, lines, pack, accessin_id")
    .eq("id", id)
    .maybeSingle();
  if (existing) return existing;
  const stub = {
    id,
    accessin_id: null,
    year,
    month,
    amount: 0,
    generated_at: null,
    status: "draft",
    lines: [],
    pack: { title: `Liquidación - ${MONTHS_ES[month - 1]} del ${year}`, source: "app" },
  };
  const { data, error } = await admin
    .from("fee_period_closures")
    .upsert(stub, { onConflict: "id" })
    .select("id, year, month, status, amount, generated_at, lines, pack, accessin_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function generateDayOne(admin: SupabaseClient, todayIso: string) {
  const day = Number(todayIso.slice(8, 10));
  if (day !== 1) return { ran: false, reason: "not_day_one" as const };

  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  if (year * 12 + month < APP_DUES_FROM.year * 12 + APP_DUES_FROM.month) {
    return { ran: false, reason: "before_app_dues" as const };
  }

  const period = await ensurePeriodRow(admin, year, month);
  if (period.status === "processed" || period.status === "pending") {
    return { ran: false, reason: "already_generated" as const, periodId: period.id, status: period.status };
  }

  const [members, rules] = await Promise.all([
    loadMembers(admin),
    loadDiscountRules(admin),
  ]);
  const charges = buildCharges(members, year, month, todayIso, rules);
  const lines = packLinesFromCharges(charges);
  const packTotal = money(charges.reduce((sum, row) => sum + (Number(row.addAmount) || 0), 0));
  const availableAt = addDaysISO(todayIso, 1);
  const pack = {
    ...(period.pack && typeof period.pack === "object" ? period.pack as Record<string, unknown> : {}),
    title: `Liquidación - ${MONTHS_ES[month - 1]} del ${year}`,
    total: packTotal,
    concepts: lines.map((row) => ({
      id: row.identifier,
      label: row.name,
      holders: row.holders,
      amount: row.unit,
      total: row.total,
    })),
    charges,
    availableAt,
    autoFromPadronAt: todayIso,
    preparedFrom: "padron_auto_cron",
    history: [
      ...((period.pack as { history?: unknown[] } | null)?.history || []),
      {
        type: "auto_generated",
        at: new Date().toISOString(),
        amount: packTotal,
        availableAt,
        status: "pending",
        by: "Cron · día 1",
        note: "Día 1 · altas y bajas del padrón",
      },
    ],
  };

  const { data: saved, error } = await admin
    .from("fee_period_closures")
    .upsert({
      id: period.id,
      accessin_id: period.accessin_id ?? Number(String(Date.now()).slice(-4)),
      year,
      month,
      amount: packTotal,
      generated_at: todayIso,
      status: "pending",
      lines,
      pack,
    }, { onConflict: "id" })
    .select("id, status, amount, generated_at")
    .single();
  if (error) throw new Error(error.message);

  return {
    ran: true,
    reason: "generated" as const,
    periodId: saved.id,
    status: saved.status,
    amount: Number(saved.amount) || 0,
    charges: charges.length,
    members: members.length,
    availableAt,
  };
}

async function promoteAvailable(admin: SupabaseClient, todayIso: string) {
  const { data: pending, error } = await admin
    .from("fee_period_closures")
    .select("id, year, month, status, amount, generated_at, lines, pack, accessin_id")
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  const promoted: Array<Record<string, unknown>> = [];
  const allCharges: Charge[] = [];

  for (const period of pending || []) {
    const pack = period.pack && typeof period.pack === "object" ? period.pack as Record<string, unknown> : {};
    const availableAt = String(pack.availableAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(availableAt) || todayIso < availableAt) continue;

    const charges = Array.isArray(pack.charges) ? pack.charges as Charge[] : [];
    for (const charge of charges) {
      if ((Number(charge.addAmount) || 0) > 0) allCharges.push(charge);
    }

    const nextPack = {
      ...pack,
      processedAt: todayIso,
      history: [
        ...((pack.history as unknown[]) || []),
        {
          type: "auto_processed",
          at: new Date().toISOString(),
          amount: Number(period.amount) || 0,
          status: "processed",
          by: "Cron · 00 h",
        },
      ],
    };

    const { data: saved, error: upErr } = await admin
      .from("fee_period_closures")
      .update({
        status: "processed",
        pack: nextPack,
      })
      .eq("id", period.id)
      .eq("status", "pending")
      .select("id, status, amount")
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);
    if (saved) promoted.push(saved);
  }

  let deltasApplied = 0;
  if (allCharges.length && promoted.length) {
    const deltas = aggregateDeltas(allCharges);
    if (deltas.length) {
      const { error: deltaErr } = await admin.rpc("apply_member_balance_deltas", {
        p_deltas: deltas,
      });
      if (deltaErr) throw new Error(deltaErr.message);
      deltasApplied = deltas.length;
    }
  }

  return {
    promoted: promoted.length,
    periodIds: promoted.map((row) => row.id),
    charges: allCharges.length,
    deltasApplied,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) {
      return json(500, { error: "Falta la configuración de Supabase." });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: cronRow } = await admin.from("dues_cron_config").select("token").eq("id", 1).maybeSingle();
    const isService = token === serviceKey || (Boolean(cronRow?.token) && token === cronRow?.token);
    if (!isService) return json(401, { error: "No autorizado" });

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const todayIso = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : arISODate();

    const forceGenerate = body.forceGenerate === true;
    const skipPromote = body.skipPromote === true;

    const generate = forceGenerate || Number(todayIso.slice(8, 10)) === 1
      ? await (async () => {
        if (forceGenerate && Number(todayIso.slice(8, 10)) !== 1) {
          // Solo tests: forzar día 1 lógico
          return generateDayOne(admin, `${todayIso.slice(0, 8)}01`);
        }
        return generateDayOne(admin, todayIso);
      })()
      : { ran: false, reason: "not_day_one" as const };

    const promote = skipPromote
      ? { promoted: 0, periodIds: [] as unknown[], charges: 0, deltasApplied: 0 }
      : await promoteAvailable(admin, todayIso);

    return json(200, {
      ok: true,
      today: todayIso,
      generate,
      promote,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
