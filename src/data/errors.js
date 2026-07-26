export class DbError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DbError';
    this.cause = cause;
  }
}

export function throwOnError(error, fallback = 'Error de base de datos') {
  if (!error) return;
  throw new DbError(error.message || fallback, error);
}

export async function unwrap(promise, fallback) {
  const { data, error } = await promise;
  throwOnError(error, fallback);
  return data;
}
