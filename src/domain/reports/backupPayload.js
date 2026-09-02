export const BACKUP_CLUB = 'Jockey Club San Juan - Sede Rivadavia';
export const BACKUP_VERSION = '1.1.0';

/** Arma el payload de respaldo ERP. */
export function buildBackupPayload(snapshot = {}, { source = 'manual' } = {}) {
  return {
    version: BACKUP_VERSION,
    timestamp: new Date().toISOString(),
    club: BACKUP_CLUB,
    source,
    data: {
      members: snapshot.members || [],
      reservations: snapshot.reservations || [],
      journalEntries: snapshot.journalEntries || [],
      staffMembers: snapshot.staffMembers || [],
      claims: snapshot.claims || [],
      messages: snapshot.messages || [],
      entryLogs: snapshot.entryLogs || [],
      surveys: snapshot.surveys || [],
      expenses: snapshot.expenses || [],
      concessions: snapshot.concessions || [],
      clubEvents: snapshot.clubEvents || [],
      alerts: snapshot.alerts || [],
      cashRegisters: snapshot.cashRegisters || [],
      suppliers: snapshot.suppliers || [],
      retenciones: snapshot.retenciones || [],
      newsList: snapshot.newsList || [],
      canonPayments: snapshot.canonPayments || [],
    },
  };
}

/** Valida estructura mínima de un backup. */
export function validateBackupPayload(parsed) {
  if (!parsed || parsed.club !== BACKUP_CLUB || !parsed.data) {
    throw new Error('El archivo no es una copia de seguridad válida del Jockey Club San Juan.');
  }
  const { data } = parsed;
  const required = [
    'members', 'reservations', 'journalEntries', 'staffMembers',
    'claims', 'messages', 'entryLogs',
  ];
  for (const key of required) {
    if (!Array.isArray(data[key])) {
      throw new Error('La estructura interna de la copia de seguridad es incorrecta o está incompleta.');
    }
  }
  return parsed;
}

export function backupDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function downloadBackupJson(payload, filename) {
  const stamp = backupDayKey();
  const name = filename || `JCSJ-ERP-Backup-${stamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return name;
}
