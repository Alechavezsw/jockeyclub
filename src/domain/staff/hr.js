/** Novedades de personal: faltas, tardanzas, permisos y solicitudes. */

export const HR_RECORD_TYPES = {
  novedad: { id: 'novedad', label: 'Novedades', tone: 'gold' },
  falta: { id: 'falta', label: 'Faltas', tone: 'danger' },
  tardanza: { id: 'tardanza', label: 'Tardanzas', tone: 'warn' },
  permiso: { id: 'permiso', label: 'Permisos', tone: 'ok' },
  solicitud: { id: 'solicitud', label: 'Solicitudes', tone: 'neutral' },
};

export const HR_TYPE_ORDER = ['novedad', 'falta', 'tardanza', 'permiso', 'solicitud'];

export const HR_STATUS = {
  registered: 'Registrado',
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
};

export function createHrRecord({
  type,
  employeeId,
  employeeName,
  date,
  time,
  title,
  detail,
  status,
}) {
  const needsApproval = type === 'permiso' || type === 'solicitud';
  return {
    id: `hr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    employeeId: employeeId || null,
    employeeName: employeeName || (type === 'novedad' ? 'General' : ''),
    date: date || new Date().toISOString().slice(0, 10),
    time: time || new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    title: (title || '').trim(),
    detail: (detail || '').trim(),
    status: status || (needsApproval ? 'pending' : 'registered'),
    createdAt: new Date().toISOString(),
  };
}

export function filterHrByType(records, type) {
  if (!type || type === 'all') return records;
  return records.filter((r) => r.type === type);
}

export function filterHrByEmployee(records, employeeId) {
  if (!employeeId) return records;
  return records.filter((r) => r.employeeId === employeeId || r.type === 'novedad');
}

export function countHrByType(records) {
  return HR_TYPE_ORDER.reduce((acc, type) => {
    acc[type] = records.filter((r) => r.type === type).length;
    return acc;
  }, {});
}
