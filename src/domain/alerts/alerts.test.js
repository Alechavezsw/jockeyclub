import { describe, it, expect } from 'vitest';
import { filterAlertsForRole, syncZondaAlert, createAlert } from './alerts';

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
