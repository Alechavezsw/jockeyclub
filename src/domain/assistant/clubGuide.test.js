import { describe, expect, it } from 'vitest';
import {
  answerFromBrief,
  buildJevBrief,
  composeInsight,
  guideForPrompt,
  matchGuideTopics,
  mergeJevReply,
  monthReading,
  teachFromQuery,
} from './clubGuide';
import { memberFacts } from './memberFacts';

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

  it('una duda se contesta con la lección, no con un recuento del día', () => {
    const duda = composeInsight('por qué no deja pasar a un socio en la puerta', { porteriaHoy: 40 });
    expect(duda.text).toMatch(/MORA/);
    expect(duda.go).toBe('qr_gate');
    const pileta = composeInsight('por qué un socio no puede pagar pileta', {});
    expect(pileta.text).toMatch(/mora/i);
  });

  it('con un socio consultado contesta desde su ficha', () => {
    const facts = memberFacts({
      memberId: '1001',
      name: 'Ana Pérez',
      status: 'active',
      tier: 'socio_familiar',
      outstandingBalance: 70000,
      nextDueDate: '2026-10-10',
      lastPaymentDate: '2026-08-12',
    }, { today: '2026-10-20' });
    const insight = composeInsight('por qué no puede pagar pileta', {}, { member: facts });
    expect(insight.verdict).toMatch(/1001/);
    expect(insight.text).toMatch(/pileta/i);
  });

  it('el prompt de Gemini entra en el límite del servidor y trae las reglas de contestación', () => {
    const facts = memberFacts({
      memberId: '1002',
      name: 'Luis Pérez',
      status: 'active',
      tier: 'socio_familiar',
      familyPrincipalNumber: '1001',
    }, { today: '2026-10-20' });
    const guide = guideForPrompt('por qué el socio 1002 no puede reservar', { member: facts });
    expect(guide.length).toBeLessThanOrEqual(12000);
    expect(guide).toMatch(/CÓMO CONTESTAR/);
    expect(guide).toMatch(/SOCIO CONSULTADO/);
    expect(guide).toMatch(/ADHERENTE/);
    expect(guide).toMatch(/reservas las hace el titular/);
    expect(guideForPrompt('cobrar').length).toBeLessThanOrEqual(12000);
  });

  it('si Gemini contestó bien, manda su respuesta; si no, queda la del libro', () => {
    const local = composeInsight('cómo cobro un socio', {});
    const bien = mergeJevReply(local, { source: 'gemini', text: 'Abrí la ficha y tocá Cobrar.', tab: 'members' });
    expect(bien.text).toBe('Abrí la ficha y tocá Cobrar.');
    expect(bien.go).toBe('members');
    const roto = mergeJevReply(local, { source: 'gemini', text: '{"verdict":' });
    expect(roto.text).toBe(local.text);
    const sinIa = mergeJevReply(local, { source: 'libro', text: 'otra cosa' });
    expect(sinIa.text).toBe(local.text);
  });
});
