import { describe, expect, it } from 'vitest';
import {
  APP_MANUAL,
  lessonInsight,
  matchManualLessons,
  manualOverview,
  shotForLesson,
} from './appManual';

describe('appManual', () => {
  it('cubre el rail, la caja y lo que está afuera', () => {
    const ids = new Set(APP_MANUAL.map((lesson) => lesson.id));
    expect(ids.has('cobrar-socio')).toBe(true);
    expect(ids.has('liquidar-mes')).toBe(true);
    expect(ids.has('acceso-qr')).toBe(true);
    expect(ids.has('configuracion')).toBe(true);
    expect(ids.has('portal-socio')).toBe(true);
    expect(ids.has('caja')).toBe(true);
  });

  it('encuentra el oficio por cómo se habla en el club', () => {
    expect(matchManualLessons('cómo liquido las cuotas')[0].id).toBe('liquidar-mes');
    expect(matchManualLessons('acceso qr molinete')[0].id).toBe('acceso-qr');
    expect(matchManualLessons('portal del socio reserva')[0].id).toBe('portal-socio');
    expect(matchManualLessons('declarar zonda')[0].id).toBe('alertas');
    expect(matchManualLessons('tesorería de caja')[0].id).toBe('caja');
  });

  it('devuelve pasos concretos, no solo el nombre de la sección', () => {
    const insight = lessonInsight('cómo cobro un socio');
    expect(insight.verdict).toMatch(/Cobrar/i);
    expect(insight.text).toMatch(/número de socio|ficha/i);
    expect(insight.go).toBe('members');
    expect(insight.next).toMatch(/re-liquid/i);
  });

  it('cada oficio tiene una captura de su pantalla', () => {
    const shot = shotForLesson(APP_MANUAL.find((lesson) => lesson.id === 'liquidar-mes'));
    expect(shot.src).toMatch(/dues\.jpg/);
    expect(shot.caption).toMatch(/Cuotas/);
  });

  it('si pedís el manual entero, te lleva a la sala', () => {
    const overview = manualOverview();
    expect(overview.room).toBe('manual');
    expect(overview.go).toBe('jev');
    expect(overview.text).toMatch(/Cobrar|Liquidar|portería/i);
  });
});
