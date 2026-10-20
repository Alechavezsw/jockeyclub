import { describe, expect, it } from 'vitest';
import {
  APP_MANUAL,
  lessonInsight,
  matchManualLessons,
  manualOverview,
  manualPromptFor,
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

  it('explica la cuota vigente: reglas, anulación y Mercado Pago', () => {
    const ids = new Set(APP_MANUAL.map((lesson) => lesson.id));
    expect(ids.has('reglas-cuota')).toBe(true);
    expect(ids.has('anular-cobro')).toBe(true);
    expect(ids.has('mercado-pago')).toBe(true);
    expect(matchManualLessons('anular un cobro mal cargado')[0].id).toBe('anular-cobro');
    expect(matchManualLessons('mercado pago suscripción')[0].id).toBe('mercado-pago');
    expect(matchManualLessons('cuota amet vence mora recargo')[0].id).toBe('reglas-cuota');
    const reglas = APP_MANUAL.find((lesson) => lesson.id === 'reglas-cuota');
    const text = reglas.steps.join(' ');
    expect(text).toMatch(/día 10/);
    expect(text).toMatch(/18/);
    expect(text).toMatch(/Vitalicio, fundador y comisión/);
  });

  it('encuentra la duda, no solo el oficio', () => {
    expect(matchManualLessons('por qué no deja pasar a un socio en la puerta')[0].id).toBe('no-pasa-puerta');
    expect(matchManualLessons('por qué un socio no puede pagar pileta')[0].id).toBe('no-puede-pagar');
    expect(matchManualLessons('me equivoqué en un cobro, cómo lo anulo')[0].id).toBe('anular-cobro');
    expect(matchManualLessons('cómo mando un comunicado a todos los socios')[0].id).toBe('mensajeria');
    expect(matchManualLessons('cómo hago un asiento')[0].id).toBe('asiento');
    expect(matchManualLessons('socio sin carnet').map((lesson) => lesson.id)).toContain('credencial-qr');
    expect(matchManualLessons('el qr no lo lee').map((lesson) => lesson.id)).toContain('credencial-qr');
  });

  it('una palabra corta no es prefijo de una larga: «por» no es «portal»', () => {
    expect(matchManualLessons('por qué').length).toBe(0);
  });

  it('el manual que ve Gemini entra en el límite y no corta lecciones a la mitad', () => {
    const limit = 9000;
    const text = manualPromptFor('por qué no deja pasar a un socio en la puerta', { limit });
    expect(text.length).toBeLessThanOrEqual(limit);
    // la lección de la duda viaja completa, con todos sus pasos
    const puerta = APP_MANUAL.find((lesson) => lesson.id === 'no-pasa-puerta');
    expect(text).toContain(puerta.steps.at(-1));
    // y las reglas de las que cuelga casi cualquier duda
    const reglas = APP_MANUAL.find((lesson) => lesson.id === 'reglas-cuota');
    expect(text).toContain(reglas.steps[0]);
  });

  it('ninguna sección queda afuera: o viaja completa o está en el índice', () => {
    const text = manualPromptFor('cobrar un socio', { limit: 9000 });
    APP_MANUAL.forEach((lesson) => {
      expect(text, lesson.id).toContain(lesson.title);
    });
  });

  it('si pedís el manual entero, te lleva a la sala', () => {
    const overview = manualOverview();
    expect(overview.room).toBe('manual');
    expect(overview.go).toBe('jev');
    expect(overview.text).toMatch(/Cobrar|Liquidar|portería/i);
  });
});
