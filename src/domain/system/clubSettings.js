/** Configuración viva del club. Vive en app_settings; acá solo se normaliza. */

import { DUES_DUE_DAY } from '../members/dues';
import {
  DUES_NOTICE_ADVANCE_DAYS,
  MORA_CONSEQUENCES,
  duesNoticeCalendar,
} from '../members/duesNotices';
import { DEFAULT_POOL_SETTINGS, mergePoolSettings } from '../pool/poolAccess';
import { DEFAULT_MP_SETTINGS, mergeMercadoPagoSettings } from '../payments/mercadoPago';

export const SETTINGS_KEYS = {
  club: 'club',
  pool: 'pool',
  dues: 'dues',
  zonda: 'zonda',
  system: 'system',
  mercadopago: 'mercadopago',
  paymentPlans: 'paymentPlans',
};

export const DEFAULT_CLUB_SETTINGS = {
  name: 'Jockey Club San Juan',
  legalName: 'JOCKEY CLUB SAN JUAN',
  address: 'República del Líbano 1799 Oeste',
  city: 'Rivadavia, San Juan',
  postalCode: 'J5400',
  cuit: '30-53106908-7',
  phone: '264 561-0373',
  email: 'jockeyclubsj@gmail.com',
};

function noticeRuleForDueDay(dueDay) {
  const cal = duesNoticeCalendar(dueDay, DUES_NOTICE_ADVANCE_DAYS);
  return {
    noticeAdvanceDays: cal.advanceDays,
    noticeMoraDay: cal.moraDay,
    noticeByMessage: true,
    noticeByEmail: true,
    moraConsequences: [...MORA_CONSEQUENCES],
  };
}

export const DEFAULT_DUES_SETTINGS = {
  dueDay: DUES_DUE_DAY,
  paymentTolerance: 1000,
  gracePeriodDays: 5,
  maxGroupDebt: 0,
  accountProtectDate: '2026-09-29',
  showCurrentAccountsToMembers: true,
  ...noticeRuleForDueDay(DUES_DUE_DAY),
};

/** Si el socio puede ver saldo, extracto y Mi cuenta. Administración siempre ve. */
export function membersCanViewCurrentAccounts(dues = {}) {
  return mergeDuesSettings(dues).showCurrentAccountsToMembers;
}

/** Reglas de configuración de Lila que el panel usa y no entran en sede, cuotas o pileta. */
export const DEFAULT_SYSTEM_RULES = {
  maxTutorsPerFamily: 2,
  communicationsReminderDays: 10,
  addTitularToCommunications: true,
  showPaymentTicket: true,
  showMemberNameOnTicket: true,
  showSurchargesOnTicket: true,
  paymentNoticesRequireApproval: false,
  allowFamilyDebitChoice: false,
  guardCanOverridePool: false,
  guardOverrides: [],
  communicationReasons: [
    { description: 'Informar pago', responseDays: 3 },
    { description: 'Denuncia', responseDays: 3 },
    { description: 'Reclamo', responseDays: 3 },
    { description: 'Comunicado', responseDays: 3 },
    { description: 'Asamblea', responseDays: 3 },
    { description: 'Otros', responseDays: 3 },
    { description: 'Comprobante de pago', responseDays: 3 },
  ],
  usefulPhones: [
    { name: 'Policia', phone: '911' },
  ],
  expenseCategories: [
    'Sueldos y Jornales',
    'Cargas Sociales',
    'Gastos de Administración',
    'Tasas y Servicios',
    'Mantenimiento y Reparaciones',
    'Otros Ingresos',
    'Seguridad',
  ],
};

function text(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

export function mergeClubSettings(raw = {}) {
  return {
    name: text(raw.name, DEFAULT_CLUB_SETTINGS.name),
    legalName: text(raw.legalName, DEFAULT_CLUB_SETTINGS.legalName),
    address: text(raw.address, DEFAULT_CLUB_SETTINGS.address),
    city: text(raw.city, DEFAULT_CLUB_SETTINGS.city),
    cuit: text(raw.cuit, DEFAULT_CLUB_SETTINGS.cuit),
    postalCode: text(raw.postalCode, DEFAULT_CLUB_SETTINGS.postalCode),
    phone: text(raw.phone, DEFAULT_CLUB_SETTINGS.phone),
    email: text(raw.email, DEFAULT_CLUB_SETTINGS.email),
  };
}

function money(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function mergeDuesSettings(raw = {}) {
  const day = Number(raw?.dueDay);
  const protect = text(raw?.accountProtectDate, DEFAULT_DUES_SETTINGS.accountProtectDate);
  const dueDay = Number.isInteger(day) && day >= 1 && day <= 28 ? day : DUES_DUE_DAY;
  return {
    dueDay,
    paymentTolerance: money(raw?.paymentTolerance, DEFAULT_DUES_SETTINGS.paymentTolerance),
    gracePeriodDays: money(raw?.gracePeriodDays, DEFAULT_DUES_SETTINGS.gracePeriodDays),
    maxGroupDebt: money(raw?.maxGroupDebt, DEFAULT_DUES_SETTINGS.maxGroupDebt),
    accountProtectDate: /^\d{4}-\d{2}-\d{2}$/.test(protect)
      ? protect
      : DEFAULT_DUES_SETTINGS.accountProtectDate,
    showCurrentAccountsToMembers: raw?.showCurrentAccountsToMembers !== false,
    ...noticeRuleForDueDay(dueDay),
  };
}

export function mergeSystemRules(raw = {}) {
  const reasons = Array.isArray(raw?.communicationReasons)
    ? raw.communicationReasons
      .map((row) => ({
        description: text(row?.description),
        responseDays: Math.max(0, money(row?.responseDays, 3)),
      }))
      .filter((row) => row.description)
    : DEFAULT_SYSTEM_RULES.communicationReasons;
  const phones = Array.isArray(raw?.usefulPhones)
    ? raw.usefulPhones
      .map((row) => ({ name: text(row?.name), phone: text(row?.phone) }))
      .filter((row) => row.name || row.phone)
    : DEFAULT_SYSTEM_RULES.usefulPhones;
  const categories = Array.isArray(raw?.expenseCategories)
    ? raw.expenseCategories.map((row) => text(row)).filter(Boolean)
    : DEFAULT_SYSTEM_RULES.expenseCategories;
  const guardOn = raw?.guardCanOverridePool === true
    || (Array.isArray(raw?.guardOverrides) && raw.guardOverrides.length > 0);
  return {
    maxTutorsPerFamily: money(raw?.maxTutorsPerFamily, DEFAULT_SYSTEM_RULES.maxTutorsPerFamily),
    communicationsReminderDays: money(raw?.communicationsReminderDays, DEFAULT_SYSTEM_RULES.communicationsReminderDays),
    addTitularToCommunications: raw?.addTitularToCommunications !== false,
    showPaymentTicket: raw?.showPaymentTicket !== false,
    showMemberNameOnTicket: raw?.showMemberNameOnTicket !== false,
    showSurchargesOnTicket: raw?.showSurchargesOnTicket !== false,
    paymentNoticesRequireApproval: raw?.paymentNoticesRequireApproval === true,
    allowFamilyDebitChoice: raw?.allowFamilyDebitChoice === true,
    guardCanOverridePool: guardOn,
    guardOverrides: guardOn ? (Array.isArray(raw?.guardOverrides) && raw.guardOverrides.length ? raw.guardOverrides : ['pileta']) : [],
    communicationReasons: reasons,
    usefulPhones: phones,
    expenseCategories: categories,
  };
}

export { DEFAULT_POOL_SETTINGS, mergePoolSettings, DEFAULT_MP_SETTINGS, mergeMercadoPagoSettings };

let runtimeClub = null;

export function setRuntimeClubSettings(next) {
  runtimeClub = next ? mergeClubSettings(next) : null;
}

export function getClubSettings() {
  return runtimeClub || DEFAULT_CLUB_SETTINGS;
}

export function clubFooterLine(club = getClubSettings(), year = new Date().getFullYear()) {
  const city = String(club.city || '').split(',')[0].trim();
  return `${club.address}${city ? ` · ${city}` : ''} · © ${year}`;
}
