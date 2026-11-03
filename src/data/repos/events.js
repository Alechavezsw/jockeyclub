import * as M from '../mappers';
import { unwrap } from '../errors';
import { sb } from './shared.js';

// ---- Events / Alerts ----
export async function listClubEvents() {
  const rows = await unwrap(sb().from('club_events').select('*').order('starts_at', { ascending: false }));
  return (rows || []).map(M.clubEventFromRow);
}

export async function upsertClubEvent(ev) {
  const row = {
    title: ev.title,
    slug: ev.slug || null,
    category: ev.category || 'fiesta',
    description: ev.description || null,
    location: ev.location || null,
    starts_at: ev.startsAt,
    ends_at: ev.endsAt || null,
    capacity: ev.capacity ?? null,
    ticket_price: Number(ev.ticketPrice) || 0,
    status: ev.status || 'draft',
    cover_image_url: ev.coverImageUrl || null,
  };
  if (ev.id && String(ev.id).includes('-')) {
    const saved = await unwrap(sb().from('club_events').update(row).eq('id', ev.id).select().single());
    return M.clubEventFromRow(saved);
  }
  const saved = await unwrap(sb().from('club_events').insert(row).select().single());
  return M.clubEventFromRow(saved);
}

export async function listEventRegistrations() {
  const rows = await unwrap(sb().from('event_registrations').select('*'));
  return (rows || []).map((r) => ({
    id: r.id,
    eventId: r.event_id,
    memberId: r.member_id,
    guestName: r.guest_name,
    guestsCount: r.guests_count,
    amountPaid: Number(r.amount_paid) || 0,
    paymentStatus: r.payment_status,
  }));
}

export async function listAlerts({ limit } = {}) {
  let q = sb().from('alerts').select('*').order('created_at', { ascending: false });
  if (limit && Number(limit) > 0) q = q.limit(Number(limit));
  const rows = await unwrap(q);
  return (rows || []).map(M.alertFromRow);
}

export async function upsertAlert(alert) {
  const row = {
    code: alert.code || null,
    title: alert.title,
    body: alert.body || '',
    severity: alert.severity || 'info',
    audience: alert.audience || 'all',
    source: alert.source || 'manual',
    starts_at: alert.startsAt || new Date().toISOString(),
    ends_at: alert.endsAt || null,
    is_active: alert.isActive !== false,
    requires_ack: Boolean(alert.requiresAck),
    metadata: alert.metadata || {},
  };
  if (alert.id && String(alert.id).includes('-')) {
    const saved = await unwrap(sb().from('alerts').update(row).eq('id', alert.id).select().single());
    return M.alertFromRow(saved);
  }
  const saved = await unwrap(sb().from('alerts').insert(row).select().single());
  return M.alertFromRow(saved);
}

export async function listAlertAcks() {
  const rows = await unwrap(sb().from('alert_acknowledgements').select('*'));
  return (rows || []).map((r) => ({
    id: r.id,
    alertId: r.alert_id,
    profileId: r.profile_id,
    acknowledgedAt: r.acknowledged_at,
  }));
}

export async function ackAlert(alertId, profileId) {
  const saved = await unwrap(
    sb().from('alert_acknowledgements').upsert({
      alert_id: alertId,
      profile_id: profileId,
    }).select().single()
  );
  return {
    id: saved.id,
    alertId: saved.alert_id,
    profileId: saved.profile_id,
    acknowledgedAt: saved.acknowledged_at,
  };
}

/** Lecturas de campanita (por usuario). */
export async function listNotificationReads() {
  const rows = await unwrap(
    sb().from('notification_reads').select('notif_key, read_at').order('read_at', { ascending: false }),
    'No se pudieron cargar lecturas de notificaciones'
  );
  return (rows || []).map((r) => String(r.notif_key));
}

export async function markNotificationRead(notifKey, profileId) {
  if (!notifKey || !profileId) return null;
  const saved = await unwrap(
    sb().from('notification_reads').upsert(
      { profile_id: profileId, notif_key: String(notifKey) },
      { onConflict: 'profile_id,notif_key' }
    ).select('notif_key').single(),
    'No se pudo marcar la notificación como leída'
  );
  return saved?.notif_key ? String(saved.notif_key) : String(notifKey);
}

export async function markNotificationsRead(notifKeys, profileId) {
  if (!profileId || !Array.isArray(notifKeys) || notifKeys.length === 0) return [];
  const rows = notifKeys.map((k) => ({
    profile_id: profileId,
    notif_key: String(k),
  }));
  const saved = await unwrap(
    sb().from('notification_reads').upsert(rows, { onConflict: 'profile_id,notif_key' }).select('notif_key'),
    'No se pudieron marcar las notificaciones como leídas'
  );
  return (saved || []).map((r) => String(r.notif_key));
}
