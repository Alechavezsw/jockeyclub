import { describe, expect, it } from 'vitest';
import { portalIdentityConflict } from './identityConflict.js';

const cintia = {
  memberNumber: '100689',
  memberEmail: 'morita2274@gmail.com',
  memberDocument: '30542907',
};

describe('conflicto de identidad al vincular un acceso', () => {
  it('acepta la ficha cuando el correo y el DNI son los de esa socia', () => {
    expect(portalIdentityConflict({
      ...cintia,
      accountEmail: 'morita2274@gmail.com',
      accountDocument: '30.542.907',
      emailOwnerNumber: '100689',
      documentOwnerNumber: '100689',
    })).toBe('');
  });

  it('frena dos personas con el mismo nombre y distinto DNI', () => {
    expect(portalIdentityConflict({
      memberNumber: '100689',
      memberEmail: 'morita2274@gmail.com',
      memberDocument: '30542907',
      accountEmail: 'morita2274@gmail.com',
      accountDocument: '36588359',
    })).toMatch(/DNI no es el de la ficha/);
  });

  it('frena un correo que ya es de otra ficha', () => {
    expect(portalIdentityConflict({
      memberNumber: '101453',
      memberEmail: 'cintiagarciagrigolo@hotmail.com',
      memberDocument: '36588359',
      accountEmail: 'morita2274@gmail.com',
      accountDocument: '36588359',
      emailOwnerNumber: '100689',
    })).toMatch(/correo/);
  });

  it('frena un pedido con el DNI de otra persona', () => {
    expect(portalIdentityConflict({
      memberNumber: '100689',
      memberDocument: '30542907',
      accountDocument: '36423900',
      documentOwnerNumber: '101452',
    })).toMatch(/DNI/);
  });

  it('no vincula por el nombre: sin DNI y sin correo coincidentes no inventa un conflicto vacío', () => {
    expect(portalIdentityConflict({
      memberNumber: '100689',
      memberEmail: '',
      memberDocument: '',
      accountEmail: '',
      accountDocument: '',
    })).toBe('');
  });
});
