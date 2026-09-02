/**
 * Usuarios demo para modo local (sin Supabase).
 * En producción se reemplazan por auth.users + profiles.
 */
export const DEMO_USERS = [
  {
    id: 'local-member-1',
    email: 'socio@jockey.sj',
    password: 'jockey2026',
    role: 'member',
    fullName: 'Alejandro Chávez',
    memberId: '2026887744320988',
  },
  {
    id: 'local-cashier-1',
    email: 'caja@jockey.sj',
    password: 'jockey2026',
    role: 'cashier',
    fullName: 'Martina Benítez',
    memberId: null,
  },
  {
    id: 'local-accountant-1',
    email: 'contabilidad@jockey.sj',
    password: 'jockey2026',
    role: 'accountant',
    fullName: 'Tesorería JCSJ',
    memberId: null,
  },
  {
    id: 'local-staff-1',
    email: 'personal@jockey.sj',
    password: 'jockey2026',
    role: 'staff',
    fullName: 'Juan Pérez',
    memberId: null,
  },
  {
    id: 'local-teacher-1',
    email: 'profesor@jockey.sj',
    password: 'jockey2026',
    role: 'teacher',
    fullName: 'Laura Méndez',
    memberId: null,
    /** Disciplinas que dicta (ids del catálogo). Vacío = todas. */
    disciplineIds: ['tenis', 'padel'],
  },
  {
    id: 'local-admin-1',
    email: 'admin@jockey.sj',
    password: 'jockey2026',
    role: 'admin',
    fullName: 'Comisión Directiva',
    memberId: null,
  },
  {
    id: 'local-superadmin-1',
    email: 'superadmin@jockey.sj',
    password: 'jockey2026',
    role: 'superadmin',
    fullName: 'Superadministrador',
    memberId: null,
  },
];

export const DEMO_PASSWORD_HINT = 'jockey2026';
