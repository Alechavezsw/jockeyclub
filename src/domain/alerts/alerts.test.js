import { describe, it, expect } from 'vitest';
import {
  acknowledgeAlert,
  createAlert,
  filterAlertsForRole,
  isAlertAcknowledged,
  mergeAlertAcknowledgements,
  syncZondaAlert,
} from './alerts';

describe('filterAlertsForRole', () => {
  const alerts = [
    createAlert({ title: 'Global', body: 'x', audience: 'all' }),
    createAlert({ title: 'Solo socios', body: 'x', audience: 'members' }),
    createAlert({ title: 'Solo staff', body: 'x', audience: 'staff' }),
    createAlert({ title: 'Solo admin', body: 'x', audience: 'admin' }),
  ];

  it('el socio ve globales y de socios', () => {
    const titles = filterAlertsForRole(alerts, 'member').map((a) => a.title);
    expect(titles).toContain('Global');
    expect(titles).toContain('Solo socios');
    expect(titles).not.toContain('Solo staff');
    expect(titles).not.toContain('Solo admin');
  });

  it('el admin ve todo', () => {
    expect(filterAlertsForRole(alerts, 'admin')).toHaveLength(4);
  });

  it('las alertas inactivas no se muestran', () => {
    const inactive = [{ ...alerts[0], isActive: false }];
    expect(filterAlertsForRole(inactive, 'admin')).toHaveLength(0);
  });
});

describe('acknowledgeAlert', () => {
  it('guarda el acuse y no lo duplica', () => {
    const once = acknowledgeAlert([], 'alert-1', 'user-a', 'ASAMBLEA');
    const twice = acknowledgeAlert(once, 'alert-1', 'user-a', 'ASAMBLEA');
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
    expect(once[0].alertCode).toBe('ASAMBLEA');
  });

  it('oculta por id o por código estable', () => {
    const acks = acknowledgeAlert([], 'alert-1', 'user-a', 'CONC-9');
    expect(isAlertAcknowledged({ id: 'alert-1' }, acks)).toBe(true);
    expect(isAlertAcknowledged({ id: 'alert-nuevo', code: 'CONC-9' }, acks)).toBe(true);
    expect(isAlertAcknowledged({ id: 'otra', code: 'OTRA' }, acks)).toBe(false);
  });

  it('sigue oculta si la concesión vuelve con otro id de alerta', () => {
    const alert = {
      id: 'alert-conc-9',
      code: 'CONC-9',
      source: 'concession_expiry',
      metadata: { concessionId: '9' },
    };
    const acks = acknowledgeAlert([], alert.id, 'user-a', alert.code, { alert });
    expect(isAlertAcknowledged({
      id: 'uuid-nuevo',
      code: 'CONC-9',
      source: 'concession_expiry',
      metadata: { concessionId: '9' },
    }, acks)).toBe(true);
    expect(isAlertAcknowledged({
      id: 'uuid-docs',
      source: 'concession_docs',
      metadata: { concessionId: '9' },
    }, acks)).toBe(false);
  });

  it('fusiona acuses locales y de nube sin perder los locales', () => {
    const local = acknowledgeAlert([], 'alert-local', 'local-user');
    const remote = acknowledgeAlert([], 'alert-cloud', 'user-a');
    const merged = mergeAlertAcknowledgements(local, remote);
    expect(merged).toHaveLength(2);
    expect(mergeAlertAcknowledgements(merged, remote)).toHaveLength(2);
  });
});

describe('syncZondaAlert', () => {
  it('crea la alerta Zonda al activarse y la apaga al desactivarse', () => {
    const withZonda = syncZondaAlert([], true);
    expect(withZonda.some((a) => a.source === 'zonda' && a.isActive)).toBe(true);

    const cleared = syncZondaAlert(withZonda, false);
    expect(cleared.some((a) => a.source === 'zonda' && a.isActive)).toBe(false);
  });

  it('no duplica la alerta si ya está activa', () => {
    const once = syncZondaAlert([], true);
    const twice = syncZondaAlert(once, true);
    expect(twice.filter((a) => a.source === 'zonda')).toHaveLength(1);
  });
});
