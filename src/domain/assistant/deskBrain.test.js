import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESK_RULE_MARK,
  DESK_TOPICS,
  deskRule,
  preferDeskReply,
} from './deskBrain';

describe('escritorio de Jev', () => {
  it('tiene las reglas que el mostrador no puede inventar', () => {
    expect(DESK_TOPICS).toEqual(expect.arrayContaining([
      'cuota', 'mora', 'adelanto', 'exentos', 'reserva', 'grupo', 'comprobante', 'colonia',
    ]));
    expect(deskRule('adelanto')).toContain(DESK_RULE_MARK);
    expect(deskRule('cuota')).toMatch(/40\.000/);
    expect(deskRule('cuota')).toMatch(/70\.000/);
    expect(deskRule('mora')).toMatch(/10 %/);
    expect(deskRule('mora')).toMatch(/débito/i);
    expect(deskRule('exentos')).toMatch(/12\.000/);
    expect(deskRule('reserva')).toMatch(/50 %/);
    expect(deskRule('colonia')).toMatch(/490\.000/);
    expect(deskRule('colonia')).toMatch(/15 %/);
    expect(deskRule('colonia')).toMatch(/diciembre/i);
    const edge = readFileSync(
      new URL('../../../supabase/functions/jev-chat/desk.ts', import.meta.url),
      'utf8',
    );
    const book = readFileSync(
      new URL('../../../supabase/functions/jev-chat/deskBrain.js', import.meta.url),
      'utf8',
    );
    expect(book).toContain(DESK_RULE_MARK);
    expect(book).toContain('490.000');
    expect(edge).toContain('buscar_socio');
    expect(edge).toContain('ficha');
  });

  it('prioriza a Gemini cuando leyó de verdad y si no, el libro', () => {
    const local = {
      verdict: 'Del libro',
      text: 'Activos 10.',
      figures: [{ label: 'Activos', value: '10' }],
      go: 'members',
    };
    const remote = preferDeskReply(local, {
      source: 'gemini',
      text: JSON.stringify({
        verdict: 'Al día',
        text: 'La ficha 111591 no debe noviembre.',
        next: 'El próximo vencimiento es el 10 de diciembre.',
        tab: 'members',
      }),
      lookups: [{ label: 'Ficha 111591', detail: 'Chávez' }],
    });
    expect(remote.source).toBe('gemini');
    expect(remote.text).toMatch(/111591/);
    expect(remote.verdict).toBe('Al día');
    expect(remote.lookups).toHaveLength(1);
    expect(remote.go).toBe('members');

    const fallen = preferDeskReply(local, { source: 'libro', text: '' });
    expect(fallen.source).toBe('libro');
    expect(fallen.text).toBe('Activos 10.');
    expect(fallen.figures[0].value).toBe('10');
  });
});
