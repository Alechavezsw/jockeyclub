import { describe, expect, it } from 'vitest';
import { authorizeMainCommit, normalizeCommitSha } from './edgeCommitGuard.js';

describe('autorización de commit en main', () => {
  it('rechaza un SHA inválido o ausente', () => {
    expect(normalizeCommitSha('')).toBe('');
    expect(authorizeMainCommit({ sha: 'nope' }).ok).toBe(false);
    expect(authorizeMainCommit({ sha: 'abc1234', mainTips: [] }).problems.join(' ')).toMatch(/main/);
  });

  it('acepta un tip de main o un ancestro', () => {
    const main = '6bf0eb38ec1c71778b7529debba581ddd9b9bac8';
    const older = '85009f186b135fb57353e5201af9bd158aa57688';
    expect(authorizeMainCommit({
      sha: main,
      mainTips: [main],
      isAncestor: () => false,
    }).ok).toBe(true);
    expect(authorizeMainCommit({
      sha: older,
      mainTips: [main],
      isAncestor: (a, tip) => a === older && tip === main,
    }).ok).toBe(true);
  });

  it('bloquea un commit que no está en main', () => {
    const result = authorizeMainCommit({
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mainTips: ['6bf0eb38ec1c71778b7529debba581ddd9b9bac8'],
      isAncestor: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/no pertenece a main/);
  });
});
