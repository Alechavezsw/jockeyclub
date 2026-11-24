/**
 * Repositorio Colonia — solo tablas/RPC colonia_*. Nunca dues ni outstanding_balance.
 */
import { isSupabaseConfigured } from '../../lib/supabase';
import { sb } from './shared.js';

function requireCloud() {
  if (!isSupabaseConfigured) {
    const err = new Error('Colonia requiere cloud (Supabase).');
    err.code = 'COLONIA_CLOUD_REQUIRED';
    throw err;
  }
}

function mapRpcMissing(error, fallbackMessage) {
  const code = String(error?.code || '');
  if (code === 'PGRST202' || code === '42883' || code === '42P01') {
    const err = new Error('El módulo Colonia aún no está publicado en la base (migración pendiente).');
    err.code = 'COLONIA_RPC_MISSING';
    throw err;
  }
  throw new Error(error?.message || fallbackMessage);
}

export async function listColoniaSeasons() {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_seasons')
    .select('*')
    .order('enrollment_opens_on', { ascending: false });
  if (error) mapRpcMissing(error, 'No se pudieron cargar temporadas de Colonia');
  return data || [];
}

export async function listColoniaTariffs(seasonId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_tariffs')
    .select('*')
    .eq('season_id', seasonId)
    .order('version', { ascending: false });
  if (error) mapRpcMissing(error, 'No se pudieron cargar tarifas');
  return data || [];
}

export async function listColoniaEnrollments(seasonId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_enrollments')
    .select('*, student:colonia_students(*), guardian:colonia_guardians(*)')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });
  if (error) mapRpcMissing(error, 'No se pudieron cargar inscripciones');
  return data || [];
}

export async function listColoniaStudents(seasonId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_enrollments')
    .select('id, status, plan_key, student:colonia_students(*)')
    .eq('season_id', seasonId);
  if (error) mapRpcMissing(error, 'No se pudieron cargar alumnos');
  return (data || []).map((row) => ({
    enrollmentId: row.id,
    status: row.status,
    planKey: row.plan_key,
    ...(row.student || {}),
  }));
}

export async function upsertColoniaGuardian(payload) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_guardians')
    .upsert(payload)
    .select('*')
    .single();
  if (error) mapRpcMissing(error, 'No se pudo guardar el responsable');
  return data;
}

export async function upsertColoniaStudent(payload) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_students')
    .upsert(payload)
    .select('*')
    .single();
  if (error) mapRpcMissing(error, 'No se pudo guardar el alumno');
  return data;
}

export async function createColoniaEnrollment(payload) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_enrollments')
    .insert(payload)
    .select('*, student:colonia_students(*), guardian:colonia_guardians(*)')
    .single();
  if (error) mapRpcMissing(error, 'No se pudo crear la inscripción');
  return data;
}

export async function listColoniaSiblingGroups(seasonId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_sibling_groups')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });
  if (error) mapRpcMissing(error, 'No se pudieron cargar grupos de hermanos');
  return data || [];
}

export async function createColoniaSiblingGroup(payload) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_sibling_groups')
    .insert(payload)
    .select('*')
    .single();
  if (error) mapRpcMissing(error, 'No se pudo crear el grupo de hermanos');
  return data;
}

export async function listColoniaCharges(enrollmentId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_charges')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: false });
  if (error) mapRpcMissing(error, 'No se pudieron cargar cargos');
  return data || [];
}

export async function listColoniaPayments(enrollmentId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_payments')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: false });
  if (error) mapRpcMissing(error, 'No se pudieron cargar pagos');
  return data || [];
}

export async function coloniaPostCharge({ enrollmentId, concept, planKey, amount, note }) {
  requireCloud();
  const { data, error } = await sb().rpc('colonia_post_charge', {
    p_enrollment_id: enrollmentId,
    p_concept: concept,
    p_plan_key: planKey,
    p_amount: amount,
    p_note: note || null,
  });
  if (error) mapRpcMissing(error, 'No se pudo registrar el cargo de Colonia');
  return data;
}

export async function coloniaRecordPayment({
  enrollmentId,
  method,
  amount,
  status,
  externalReference,
  idempotencyKey,
  operatorName,
}) {
  requireCloud();
  const { data, error } = await sb().rpc('colonia_record_payment', {
    p_enrollment_id: enrollmentId,
    p_method: method,
    p_amount: amount,
    p_status: status,
    p_external_reference: externalReference || null,
    p_idempotency_key: idempotencyKey || null,
    p_operator_name: operatorName || null,
  });
  if (error) mapRpcMissing(error, 'No se pudo registrar el pago de Colonia');
  return data;
}

export async function coloniaUpsertAttendance({ enrollmentId, day, status, operatorName, note }) {
  requireCloud();
  const { data, error } = await sb().rpc('colonia_upsert_attendance', {
    p_enrollment_id: enrollmentId,
    p_day: day,
    p_status: status,
    p_operator_name: operatorName || null,
    p_note: note || null,
  });
  if (error) mapRpcMissing(error, 'No se pudo guardar la asistencia');
  return data;
}

export async function coloniaDashboardStats(seasonId) {
  requireCloud();
  const { data, error } = await sb().rpc('colonia_dashboard_stats', {
    p_season_id: seasonId,
  });
  if (error) mapRpcMissing(error, 'No se pudo cargar el resumen de Colonia');
  return data || {};
}

export async function listColoniaGroups(seasonId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_groups')
    .select('*')
    .eq('season_id', seasonId)
    .order('name');
  if (error) mapRpcMissing(error, 'No se pudieron cargar grupos');
  return data || [];
}

export async function listColoniaActivities(seasonId) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_activities')
    .select('*')
    .eq('season_id', seasonId)
    .order('activity_date', { ascending: true });
  if (error) mapRpcMissing(error, 'No se pudieron cargar actividades');
  return data || [];
}

export async function updateColoniaSeason(id, patch) {
  requireCloud();
  const { data, error } = await sb()
    .from('colonia_seasons')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) mapRpcMissing(error, 'No se pudo actualizar la temporada');
  return data;
}
