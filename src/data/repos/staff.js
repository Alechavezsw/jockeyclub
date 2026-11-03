import * as M from '../mappers';
import { unwrap } from '../errors';
import { todayAR } from '../../lib/arDate';
import { sb } from './shared.js';

// ---- Staff ----
export async function listEmployees() {
  const rows = await unwrap(sb().from('employees').select('*').order('full_name'));
  const logs = await unwrap(
    sb().from('employee_activity_logs').select('*').order('logged_at', { ascending: false })
  );
  const byEmp = {};
  (logs || []).forEach((l) => {
    (byEmp[l.employee_id] ||= []).push({
      id: l.id,
      at: l.logged_at,
      description: l.description,
    });
  });
  return (rows || []).map((r) => M.employeeFromRow(r, byEmp[r.id] || []));
}

export async function upsertEmployee(emp) {
  const row = {
    employee_number: emp.employeeNumber || emp.id,
    full_name: emp.name,
    role_title: emp.role || emp.roleTitle || 'Personal',
    department: emp.department || null,
    specialty: emp.specialty || null,
    status: emp.status === 'inactive' ? 'terminated' : (emp.status || 'active'),
    hire_date: emp.hireDate || todayAR(),
    phone: emp.phone || null,
    email: emp.email || null,
    current_task: emp.currentTask || null,
    on_duty: Boolean(emp.onDuty),
  };
  if (emp.id && String(emp.id).includes('-')) {
    const saved = await unwrap(sb().from('employees').update(row).eq('id', emp.id).select().single());
    return M.employeeFromRow(saved, emp.activities || []);
  }
  const existing = await unwrap(
    sb().from('employees').select('id').eq('employee_number', row.employee_number).maybeSingle()
  );
  if (existing?.id) {
    const saved = await unwrap(sb().from('employees').update(row).eq('id', existing.id).select().single());
    return M.employeeFromRow(saved, emp.activities || []);
  }
  const saved = await unwrap(sb().from('employees').insert(row).select().single());
  return M.employeeFromRow(saved, emp.activities || []);
}

export async function listHrRecords() {
  const rows = await unwrap(
    sb().from('employee_hr_records').select('*').order('created_at', { ascending: false })
  );
  return (rows || []).map(M.hrRecordFromRow);
}

export async function insertHrRecord(rec) {
  const row = {
    employee_id: rec.employeeId || null,
    employee_code: rec.employeeCode || null,
    record_type: rec.type || 'novedad',
    title: rec.title || null,
    details: rec.details || null,
    starts_on: rec.startsOn || null,
    ends_on: rec.endsOn || null,
    amount: rec.amount ?? null,
    status: rec.status || 'open',
    meta: rec.meta || {},
  };
  const saved = await unwrap(sb().from('employee_hr_records').insert(row).select().single());
  return M.hrRecordFromRow(saved);
}
