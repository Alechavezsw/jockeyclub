import { buildPostedEntry } from '../accounting/journal';

export const DEFAULT_CLUB_EVENTS = [
  {
    id: 'evt-1',
    title: 'Cena de Gala Socios Royal & Platinum',
    category: 'fiesta',
    description: 'Cena formal con música en vivo en The Pavilion. Dress code: etiqueta.',
    location: 'The Pavilion — Sede Rivadavia',
    startsAt: new Date(Date.now() + 86400000 * 14).toISOString(),
    endsAt: new Date(Date.now() + 86400000 * 14 + 14400000).toISOString(),
    capacity: 180,
    ticketPrice: 45000,
    incomeAccountId: 'coa-4.1.03',
    status: 'published',
    coverImageUrl: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-2',
    title: 'After Match — Tercer Tiempo Regional Cuyano',
    category: 'deportes',
    description: 'Brindis y gastronomía post partido para socios e invitados.',
    location: 'Cantina Principal',
    startsAt: new Date(Date.now() + 86400000 * 2).toISOString(),
    endsAt: new Date(Date.now() + 86400000 * 2 + 10800000).toISOString(),
    capacity: 250,
    ticketPrice: 0,
    incomeAccountId: 'coa-4.1.03',
    status: 'published',
    coverImageUrl: 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
];

export function createClubEvent(payload) {
  return {
    id: `evt-${Date.now()}`,
    title: payload.title.trim(),
    category: payload.category || 'fiesta',
    description: payload.description?.trim() || '',
    location: payload.location?.trim() || 'Sede Rivadavia',
    startsAt: payload.startsAt,
    endsAt: payload.endsAt || null,
    capacity: payload.capacity ? Number(payload.capacity) : null,
    ticketPrice: Number(payload.ticketPrice) || 0,
    incomeAccountId: payload.incomeAccountId || 'coa-4.1.03',
    status: payload.status || 'published',
    coverImageUrl: payload.coverImageUrl || '',
    createdAt: new Date().toISOString(),
  };
}

export function registerForEvent({
  event,
  memberId,
  guestName = '',
  guestsCount = 1,
  cashAccountId = 'coa-1.1.01',
  chart,
}) {
  const count = Math.max(1, Number(guestsCount) || 1);
  const amount = (Number(event.ticketPrice) || 0) * count;
  const registration = {
    id: `ereg-${Date.now()}`,
    eventId: event.id,
    memberId,
    guestName,
    guestsCount: count,
    amountPaid: amount,
    paymentStatus: amount > 0 ? 'paid' : 'waived',
    registeredAt: new Date().toISOString(),
    journalEntryId: null,
  };

  let journalEntry = null;
  if (amount > 0) {
    journalEntry = buildPostedEntry({
      date: new Date().toISOString().slice(0, 10),
      description: `Inscripción evento: ${event.title} (${count} persona/s)`,
      lines: [
        { accountId: cashAccountId, debit: amount, credit: 0 },
        { accountId: event.incomeAccountId || 'coa-4.1.03', debit: 0, credit: amount },
      ],
      sourceModule: 'eventos',
      sourceId: registration.id,
      chart,
    });
    registration.journalEntryId = journalEntry.id;
  }

  return { registration, journalEntry };
}

export function countRegistrations(registrations, eventId) {
  return registrations
    .filter((r) => r.eventId === eventId)
    .reduce((sum, r) => sum + (Number(r.guestsCount) || 1), 0);
}
