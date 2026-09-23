import { describe, expect, it } from 'vitest';
import { buildPadronExcelAoA, PADRON_EXCEL_HEADERS } from './exportMembersExcel';

describe('buildPadronExcelAoA', () => {
  const titular = {
    memberId: '10009',
    name: 'Titular Rojo',
    familyPrincipalNumber: 10009,
    status: 'active',
    outstandingBalance: 0,
    joinDate: '2020-01-15',
    city: 'San Juan',
  };
  const baja = {
    memberId: '3368',
    name: 'Daniela Paola Rojas',
    status: 'inactive',
    outstandingBalance: 0,
    documentNumber: '29507901',
  };

  it('arma cabecera y una fila por socio único', () => {
    const { aoa, total } = buildPadronExcelAoA([titular, baja, { ...titular }]);
    expect(aoa[0]).toEqual(PADRON_EXCEL_HEADERS);
    expect(aoa).toHaveLength(3);
    expect(total).toBe(2);
  });

  it('no marca «Al día» a una baja del padrón', () => {
    const { aoa } = buildPadronExcelAoA([baja]);
    const cuotaIdx = PADRON_EXCEL_HEADERS.indexOf('Cuota');
    const estadoIdx = PADRON_EXCEL_HEADERS.indexOf('Estado');
    expect(aoa[1][estadoIdx]).toBe('Baja del padrón');
    expect(aoa[1][cuotaIdx]).toBe('Sin cuota');
    expect(aoa[1][cuotaIdx]).not.toBe('Al día');
  });
});
