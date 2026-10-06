import { describe, expect, it } from 'vitest';
import {
  clubFooterLine,
  getClubSettings,
  mergeClubSettings,
  mergeDuesSettings,
  mergeSystemRules,
  setRuntimeClubSettings,
} from './clubSettings';

describe('clubSettings', () => {
  it('completa la sede con el teléfono y el correo de Lila', () => {
    const club = mergeClubSettings({ name: '  Jockey Club San Juan  ' });
    expect(club.name).toBe('Jockey Club San Juan');
    expect(club.cuit).toBe('30-53106908-7');
    expect(club.postalCode).toBe('J5400');
    expect(club.phone).toBe('264 561-0373');
    expect(club.email).toBe('jockeyclubsj@gmail.com');
  });

  it('deja el vencimiento de cuotas entre el 1 y el 28', () => {
    const dues = mergeDuesSettings({ dueDay: 10 });
    expect(dues.dueDay).toBe(10);
    expect(dues.paymentTolerance).toBe(1000);
    expect(dues.gracePeriodDays).toBe(5);
    expect(mergeDuesSettings({ dueDay: 0 }).dueDay).toBe(10);
    expect(mergeDuesSettings({ dueDay: 31 }).dueDay).toBe(10);
  });

  it('arma el pie con la sede real', () => {
    setRuntimeClubSettings({
      address: 'República del Líbano 1799 Oeste',
      city: 'Rivadavia, San Juan',
    });
    expect(clubFooterLine(getClubSettings(), 2026)).toBe(
      'República del Líbano 1799 Oeste · Rivadavia · © 2026',
    );
    setRuntimeClubSettings(null);
  });

  it('deja editar teléfonos, motivos y categorías de Lila', () => {
    const rules = mergeSystemRules({
      maxTutorsPerFamily: 4,
      showPaymentTicket: false,
      guardCanOverridePool: true,
      usefulPhones: [{ name: 'Bomberos', phone: '100' }],
      communicationReasons: [{ description: 'Consulta', responseDays: 5 }],
      expenseCategories: ['Seguridad'],
    });
    expect(rules.maxTutorsPerFamily).toBe(4);
    expect(rules.showPaymentTicket).toBe(false);
    expect(rules.guardCanOverridePool).toBe(true);
    expect(rules.usefulPhones).toEqual([{ name: 'Bomberos', phone: '100' }]);
    expect(rules.communicationReasons[0].responseDays).toBe(5);
    expect(rules.expenseCategories).toEqual(['Seguridad']);
  });
});
