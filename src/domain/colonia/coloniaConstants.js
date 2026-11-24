/**
 * Escuela de Natación y Colonia de Verano — constantes y medios de pago.
 * Independiente de cuota social / tenis / reservas.
 */

export const COLONIA_INCOME_CODE = '4.1.06';
export const COLONIA_INCOME_NAME = 'Colonia de Verano';
export const COLONIA_SOURCE_MODULE = 'colonia';

/** Medios ya operativos en Jockey Connect (caja / pileta / otros ingresos). */
export const COLONIA_PAYMENT_METHODS = Object.freeze([
  { key: 'efectivo', label: 'Efectivo', confirmsImmediately: true },
  { key: 'tarjeta', label: 'Tarjeta', confirmsImmediately: false },
  { key: 'pos', label: 'POSNET', confirmsImmediately: false },
  { key: 'debito', label: 'Débito', confirmsImmediately: false },
  { key: 'mercadopago', label: 'Mercado Pago', confirmsImmediately: false, requiresProvider: true },
  { key: 'transferencia', label: 'Transferencia', confirmsImmediately: false, startsPending: true },
]);

export const COLONIA_PAYMENT_METHOD_KEYS = COLONIA_PAYMENT_METHODS.map((m) => m.key);

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
  'confirmada',
  'cancelada',
]);

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
  { key: 'resumen', label: 'Resumen' },
  { key: 'inscripciones', label: 'Inscripciones' },
  { key: 'alumnos', label: 'Alumnos' },
  { key: 'hermanos', label: 'Hermanos y promociones' },
  { key: 'cobranzas', label: 'Cobranzas' },
  { key: 'asistencia', label: 'Asistencia' },
  { key: 'grupos', label: 'Grupos' },
  { key: 'actividades', label: 'Actividades' },
  { key: 'reportes', label: 'Reportes' },
  { key: 'configuracion', label: 'Configuración' },
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
  return COLONIA_PAYMENT_METHODS.find((m) => m.key === String(method || '').toLowerCase()) || null;
}

export function coloniaMethodLabel(method) {
  return coloniaMethodMeta(method)?.label || String(method || '—');
}
