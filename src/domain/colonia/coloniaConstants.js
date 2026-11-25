/**
 * Escuela de Natación y Colonia de Verano — constantes y medios de pago.
 * Independiente de cuota social / tenis / reservas.
 */

export const COLONIA_INCOME_CODE = '4.1.06';
export const COLONIA_INCOME_NAME = 'Colonia de Verano';
export const COLONIA_SOURCE_MODULE = 'colonia';

/** Mismos medios que caja, cuotas y pileta. Pago POS cubre tarjeta y el cupón. */
export const COLONIA_PAYMENT_METHODS = Object.freeze([
  { key: 'efectivo', label: 'Efectivo', confirmsImmediately: true },
  { key: 'transferencia', label: 'Transferencia', confirmsImmediately: true, usesBank: true },
  { key: 'tarjeta', label: 'Pago POS', confirmsImmediately: false },
  { key: 'debito', label: 'Débito', confirmsImmediately: true, usesBank: true },
  { key: 'mercadopago', label: 'Mercado Pago', confirmsImmediately: false, requiresProvider: true },
]);

export const COLONIA_PAYMENT_METHOD_KEYS = Object.freeze([
  'efectivo',
  'transferencia',
  'tarjeta',
  'pos',
  'debito',
  'mercadopago',
]);

export const COLONIA_CHARGE_CONCEPTS = Object.freeze({
  colonia_inscripcion: 'Inscripción',
  colonia_cuota: 'Cuota Colonia',
  colonia_temporada: 'Temporada completa',
  colonia_promocion: 'Promoción hermanos',
  colonia_ajuste: 'Ajuste',
});

export const COLONIA_PLAN_KEYS = Object.freeze({
  cuota: 'cuota',
  temporada: 'temporada',
  promo_2: 'promo_2',
  promo_3: 'promo_3',
  hermano_4: 'hermano_4',
});

export const COLONIA_ENROLLMENT_STATUSES = Object.freeze([
  'borrador',
  'pendiente',
  'pendiente_pago',
  'confirmada',
  'observada',
  'cancelada',
]);

export const COLONIA_ENROLLMENT_SOURCES = Object.freeze([
  'admin',
  'portal',
  'external',
]);

/** Mercado Pago Colonia: preparado en frontend, cobros reales deshabilitados. */
export const COLONIA_MP_ENABLED = true;

export const COLONIA_ATTENDANCE_STATUSES = Object.freeze([
  'presente',
  'ausente',
  'justificada',
  'retiro_anticipado',
]);

export const COLONIA_ACTIVITY_KINDS = Object.freeze([
  'natacion',
  'recreacion',
  'excursion',
  'campamento',
]);

export const COLONIA_SECTIONS = Object.freeze([
  { key: 'hoy', label: 'Hoy' },
  { key: 'inscripciones', label: 'Inscripciones' },
  { key: 'alumnos', label: 'Alumnos' },
  { key: 'cuenta', label: 'Cuenta' },
  { key: 'hermanos', label: 'Hermanos y promociones' },
  { key: 'asistencia', label: 'Asistencia' },
  { key: 'grupos', label: 'Grupos' },
  { key: 'actividades', label: 'Actividades' },
  { key: 'reportes', label: 'Reportes' },
  { key: 'resumen', label: 'Resumen' },
]);

/** Temporada oficial publicada (valores iniciales; fin configurable). */
export const COLONIA_SEASON_2026_2027 = Object.freeze({
  code: '2026-2027',
  name: 'Escuela de Natación y Colonia de Verano 2026/2027',
  enrollmentOpensOn: '2026-11-24',
  enrollmentClosesOn: '2026-11-30',
  activitiesStartOn: '2026-11-30',
  activitiesEndOn: null,
  scheduleDays: 'lunes_a_viernes',
  scheduleHours: '09:00-13:00',
  ageMin: 3,
  ageMax: 15,
  contacts: ['2644584263', '2644170053', '2646273314'],
  /** null = promociones ambiguas bloqueadas hasta configurar. */
  promotionPeriodicity: null,
});

export function coloniaMethodMeta(method) {
  const key = String(method || '').trim().toLowerCase();
  const normalized = key === 'pos' || key === 'pago pos' || key === 'card' ? 'tarjeta' : key;
  return COLONIA_PAYMENT_METHODS.find((m) => m.key === normalized) || null;
}

export function coloniaMethodLabel(method) {
  return coloniaMethodMeta(method)?.label || String(method || '—');
}
