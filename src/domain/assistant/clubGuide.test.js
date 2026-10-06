import { describe, expect, it } from 'vitest';
import {
  answerFromBrief,
  buildJevBrief,
  composeInsight,
  matchGuideTopics,
  monthReading,
  teachFromQuery,
} from './clubGuide';

describe('clubGuide', () => {
  it('enseña a liquidar desde Cuotas', () => {
    expect(teachFromQuery('cómo liquido las cuotas')).toMatch(/Cuotas/);
    expect(matchGuideTopics('padrón del socio')[0].id).toBe('socios');
  });

  it('conoce el resto del club, no solo cuotas', () => {
    expect(matchGuideTopics('dónde está el personal')[0].id).toBe('personal');
    expect(matchGuideTopics('libro diario')[0].id).toBe('diario');
    expect(matchGuideTopics('acceso qr molinete')[0].id).toBe('acceso-qr');
    expect(matchGuideTopics('concesiones del club')[0].id).toBe('concesiones');
    expect(matchGuideTopics('portal del socio reserva')[0].id).toBe('portal-socio');
    expect(teachFromQuery('cómo publico una novedad')).toMatch(/Revista|Novedades/);
    expect(matchGuideTopics('configuración del sistema sede')[0].id).toBe('configuracion');
  });

  it('si piden el manual, abre el oficio y no un recuento', () => {
    const manual = composeInsight('manual de la app', {});
    expect(manual.room).toBe('manual');
    const cobrar = composeInsight('cómo cobro un socio', {});
    expect(cobrar.go).toBe('members');
    expect(cobrar.text).toMatch(/1\./);
  });

  it('lleva reclamos y caja a su sección', () => {
    expect(composeInsight('cuántos reclamos hay', { reclamosAbiertos: 4 }).go).toBe('claims');
    expect(composeInsight('dónde está la tesorería de caja', {}).go).toBe('accounting');
    expect(composeInsight('dónde está la tesorería de caja', {}).focus).toBe('cash');
    expect(composeInsight('dónde está la tesorería de caja', {}).text).toMatch(/1\./);
  });

  it('arma un dato del mes sin inventar', () => {
    const text = answerFromBrief('cuánto se recaudó y liquidó', {
      monthLabel: 'octubre de 2026',
      collected: 1167600,
      liquidated: 63233000,
      today: '2026-10-03',
    });
    expect(text).toMatch(/1\.167\.600|1167600/);
    expect(text).toMatch(/63\.233\.000|63233000/);
  });

  it('lee el mes con avance y hueco', () => {
    const reading = monthReading({
      monthLabel: 'octubre de 2026',
      collected: 34415933,
      liquidated: 63233000,
      today: '2026-10-03',
    });
    expect(reading.pct).toBe(54);
    expect(reading.rest).toBe(28817067);
    expect(reading.verdict).toMatch(/tiempo|54%/);
  });

  it('prioriza cobrar si el mes está abierto', () => {
    const insight = composeInsight('qué conviene mirar ahora', {
      monthLabel: 'octubre de 2026',
      collected: 34415933,
      liquidated: 63233000,
      today: '2026-10-03',
      fichas: 1461,
      deudores: 564,
    });
    expect(insight.go).toBe('dues');
    expect(insight.verdict).toMatch(/hueco|cobrar/i);
  });

  it('cuenta el día de reservas y reclamos sin inventar', () => {
    const brief = buildJevBrief({
      today: '2026-10-03',
      reservations: [
        { date: '2026-10-03', status: 'confirmed' },
        { date: '2026-10-03', status: 'cancelled' },
        { date: '2026-10-02', status: 'confirmed' },
      ],
      claims: [{ status: 'open' }, { status: 'closed' }],
    });
    expect(brief.reservasHoy).toBe(1);
    expect(brief.reclamosAbiertos).toBe(1);
  });
});
