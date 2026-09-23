# Jockey Club San Juan — Portal Institucional

Sistema de socios y ERP operativo para la **Sede Rivadavia**: reservas, contabilidad de partida doble, cajas, gastos, personal, eventos, alertas y control de acceso.

**Versión:** 1.0.0

## Stack

- React 19 + Vite 8 + React Router
- Dominio contable y permisos por rol (`src/domain`)
- Supabase listo (Auth, Postgres, RLS) vía migraciones en `supabase/migrations`
- Tests de dominio con Vitest

## Arranque

```bash
npm install
npm run dev
```

Build de producción:

```bash
npm run build
npm run preview
```

Tests:

```bash
npm test
```

## Acceso

El portal exige login. En desarrollo, los accesos de prueba están **ocultos** detrás de un enlace discreto en la pantalla de ingreso (la clave de desarrollo está en `src/domain/auth/demoUsers.js`, que no entra en el build):

| Email | Rol |
|-------|-----|
| `socio@jockey.sj` | Socio |
| `caja@jockey.sj` | Cajero |
| `contabilidad@jockey.sj` | Contador |
| `personal@jockey.sj` | Personal |
| `admin@jockey.sj` | Administrador |

Para ocultarlos del todo: `VITE_SHOW_DEMO_LOGINS=false` en `.env`.

## Producción (Supabase)

1. Crear un proyecto Supabase **dedicado** al club.
2. Copiar `.env.example` → `.env` y completar URL + anon key.
3. Aplicar migraciones: `npx supabase db push`
4. Crear usuarios reales en Auth y perfiles con rol (`member`, `cashier`, `accountant`, `staff`, `admin`).
5. Subir los datos exportados de LILA: `npm run upload:snapshots` (ver abajo).

## Datos exportados de LILA / Societas

Los exports de LILA/Accessin y Societas (padrón con DNI, cuentas corrientes, caja,
proveedores) **no van en el build ni en el repo**. Los `npm run import:*` los generan en
`src/data/seed/*.js`, y desde ahí:

- **Desarrollo y tests** leen esos archivos directamente.
- **Producción** los baja del bucket privado `club-snapshots` de Supabase Storage con la
  sesión del usuario. Solo pueden leerlos los roles que ven Cuotas o Contabilidad
  (migración `20260916090000_club_snapshots_storage.sql`).

Después de regenerar un export, subilo:

```bash
npm run upload:snapshots:dry
npm run upload:snapshots
```

El script toma `SUPABASE_SERVICE_ROLE_KEY` del entorno, o `JC_ADMIN_EMAIL` y
`JC_ADMIN_PASSWORD` de un superadmin. Ninguna credencial tiene valor por defecto.

## Seguridad operativa

- Sin toggle de rol en la UI: el perfil lo define la sesión.
- Admin y submódulos contables filtrados por permiso.
- `ErrorBoundary` ante fallos de interfaz.
- PWA / Service Worker solo en build de producción.
- Meta `noindex` (portal privado).

## Rutas

| Ruta | Uso |
|------|-----|
| `/` | Inicio socio (u redirección al panel operativo) |
| `/reservas` | Reservas de instalaciones |
| `/revista` | Revista / noticias |
| `/panel/:tab?` | ERP interno (según rol) |
