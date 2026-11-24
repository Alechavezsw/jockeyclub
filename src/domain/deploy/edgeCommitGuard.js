/**
 * El despliegue solo puede usar un commit que ya esté en main.
 * No alcanza con “parecer” el SHA: tiene que ser ancestro de main.
 */
export function normalizeCommitSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return '';
  return sha;
}

export function authorizeMainCommit({ sha, mainTips = [], isAncestor } = {}) {
  const problems = [];
  const normalized = normalizeCommitSha(sha);
  if (!normalized) {
    problems.push('El commit autorizado no es un SHA válido.');
    return { ok: false, problems, sha: '' };
  }
  const tips = (Array.isArray(mainTips) ? mainTips : [])
    .map((tip) => normalizeCommitSha(tip))
    .filter(Boolean);
  if (!tips.length) {
    problems.push('No hay referencia de main para autorizar el commit.');
    return { ok: false, problems, sha: normalized };
  }
  if (typeof isAncestor !== 'function') {
    problems.push('No hay verificador de ancestro de main. No se publica.');
    return { ok: false, problems, sha: normalized };
  }
  let onMain = false;
  for (const tip of tips) {
    if (normalized === tip || isAncestor(normalized, tip)) {
      onMain = true;
      break;
    }
  }
  if (!onMain) {
    problems.push('El commit autorizado no pertenece a main. No se publica.');
  }
  return { ok: problems.length === 0, problems, sha: normalized };
}
