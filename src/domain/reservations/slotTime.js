import { nowTimeAR, todayISODateAR } from '../../lib/arDate.js';

/** El turno ya empezó (o el día ya pasó) en el reloj del club. */
export function isSlotPast(dateStr, slot, now = new Date()) {
  const day = String(dateStr || '').slice(0, 10);
  const today = todayISODateAR(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (day < today) return true;
  if (day > today) return false;
  const start = String(slot || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(start)) return false;
  return start <= nowTimeAR(now);
}
