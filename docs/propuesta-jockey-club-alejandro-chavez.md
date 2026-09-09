# Propuesta comercial — Portal institucional y ERP
## Jockey Club San Juan · Sede Rivadavia

---

## Datos generales

**Fecha:** 01/09/2026  

### Oferente
| Campo | Dato |
|--------|------|
| Nombre | Alejandro Chávez |
| DNI | 31.888.184 |
| Domicilio | Av. Libertador San Martín 2450, Rivadavia, San Juan (CP 5400) |
| Correo | socio@jockey.sj |
| Teléfono | +54 9 264 555-1234 |
| CUIT/CUIL | 20-31888184-3 |

### Cliente
| Campo | Dato |
|--------|------|
| Institución | Jockey Club San Juan |
| Sede | Rivadavia |
| Domicilio de referencia | República del Líbano / instalaciones Sede Rivadavia, San Juan |
| Contacto institucional | Coordinación del Club |
| Correo | (a designar por la institución) |
| Teléfono | (a designar por la institución) |

---

## Propuesta económica

| Etapa | Descripción | Precio |
|------|-------------|--------|
| 1 | Análisis de requerimientos, diseño de arquitectura y prototipo de interfaz (portal socio + panel operativo) | $11.500.000 |
| 2 | Desarrollo del portal, ERP operativo, automatización de procesos, integración con base de datos en la nube e importación de padrón/reservas | $21.800.000 |
| 3 | Pruebas funcionales y de rendimiento, control de acceso QR, despliegue, capacitación y puesta en marcha | $13.800.000 |
| **Total** | | **$47.100.000** |

**Total general en letras:** cuarenta y siete millones cien mil pesos.

---

## Objetivo del proyecto

Proveer una **plataforma integral** (portal de socios + ERP operativo) que permita al **Jockey Club San Juan** digitalizar la gestión institucional, mejorar la experiencia del socio y unificar operaciones de administración, reservas, cuotas, accesos y concesiones.

El sistema centraliza datos del padrón, reservas de espacios (salones, canchas, pileta), contabilidad, alertas, mensajería y control de ingreso, con una operación eficiente, trazable y escalable.

---

## Descripción del proyecto

La solución está diseñada para las necesidades reales del Club (Sede Rivadavia): socios, staff, cajeros, contadores, portería y administración, cada uno con roles y permisos diferenciados.

### Módulos incluidos

1. **Portal del socio**  
   Dashboard personal, credencial digital, reservas de instalaciones, historial de cuotas, noticias/revista, mensajes, reclamos y pases de invitados.

2. **Reservas y espacios reales**  
   Salones (Anhelo, Bustos, Maurin, Refugio), Espacio Verde/parrilla, canchas y pileta; calendario de disponibilidad, lista de espera y reglas de conflicto por jornada.

3. **Padrón y administración de socios**  
   Alta/edición, credenciales, suspensión, adherentes/grupo familiar, datos de emergencia, auditoría de acciones y carga masiva desde padrón (Datita).

4. **ERP operativo**  
   Contabilidad (plan de cuentas, asientos), cajas y movimientos, gastos, proveedores, órdenes de pago, alertas y reportes exportables.

5. **Concesiones**  
   Contratos, vencimientos, checklist documental, canon y portal de consulta para el concesionario.

6. **Pileta y eventos**  
   Control médico, arancel diario, invitados; eventos del club con inscripciones/RSVP.

7. **Control de acceso QR**  
   Validación en portería (deuda/estado), registro de ingresos y trazabilidad.

8. **Roles y seguridad**  
   Socio, staff, cajero, contador, operador de acceso, admin y superadmin, con vistas y permisos según perfil.

---

## Tecnologías que se utilizarán

| Tecnología | Uso |
|------------|-----|
| **React + Vite** | Frontend moderno, rápido y orientado a dispositivos desktop y móvil. |
| **Supabase (PostgreSQL + Auth + RLS)** | Backend en la nube: autenticación, base de datos, políticas de acceso y sincronización. |
| **React Router** | Navegación por roles (portal socio / panel operativo / accesos / concesiones). |
| **jsPDF / exportes** | Comprobantes, reportes y respaldos. |
| **Lectura QR (jsQR / ZXing)** | Ingreso y validación en portería. |

Arquitectura pensada para **carga progresiva**: la interfaz abre enseguida y los datos críticos se sincronizan primero; el padrón completo y el ERP pesado llegan en segundo plano, sin saturar el pool de conexiones.

---

## Equipo de desarrollo

**Project Manager**  
Planificación, seguimiento, prioridades con el Club y cumplimiento de entregables, tiempos y presupuesto.

**Desarrolladores frontend — React**  
Interfaz del portal socio y del panel operativo; experiencia clara para socios y staff.

**Desarrolladores backend — Supabase / PostgreSQL**  
Modelo de datos, autenticación, RLS, repositorios, importaciones (padrón y reservas) y lógica de negocio.

**Especialistas en datos e integración**  
Migración Datita, normalización de socios/reservas, calidad de datos y reportes.

**Ingenieros DevOps**  
Despliegue (p. ej. Vercel), variables de entorno, monitoreo de sync y respaldos.

**Diseñadores UX/UI**  
Identidad del Club, flujos de reserva, dashboard socio y pantallas operativas usables.

**QA — Quality Assurance**  
Pruebas por rol, reservas/conflictos, accesos QR, contabilidad y regresión de carga.

---

## Metodología de desarrollo

Enfoque **ágil** con entregas parciales y un **MVP** usable desde las primeras etapas.

### Definición del MVP
- Login y roles  
- Portal socio básico (credencial, reservas, cuotas)  
- Panel admin con padrón y reservas  
- Sincronización con base en la nube  

### Desarrollo en sprints
Ciclos de **2 a 3 semanas**, con revisión de entregables al cierre de cada sprint.

### Pruebas y validación continua
QA en cada sprint: funcionalidad, permisos por rol y rendimiento de arranque.

### Implementación y feedback
Piloto con usuarios reales del Club; ajustes antes del despliegue amplio.

### Despliegue final y capacitación
Producción, capacitación a administración/portería/caja y manuales breves por rol.

### Mantenimiento y soporte
Soporte post-puesta en marcha, mejoras evolutivas y estabilidad de sync/carga.

---

## Conclusión

El portal y ERP del **Jockey Club San Juan** digitalizan la operación institucional, dan al socio una experiencia clara y dan al staff herramientas unificadas (padrón, reservas, caja, concesiones, accesos).

La arquitectura es **escalable** y permite incorporar módulos sin romper lo ya operativo. El oferente se compromete a desarrollar cada etapa con estándares altos de calidad, seguridad y usabilidad.

---

## Anexo 1: procedimiento detallado de desarrollo

**Fecha del anexo:** 01/09/2026  

### Etapa 1

| Tarea y actividad | Puesto | Horas | Monto |
|-------------------|--------|------:|------:|
| Relevamiento con el Club: socios, staff, portería y administración | PM | 70 | $1.120.000 |
| Documentación de requerimientos (roles, reservas, cuotas, accesos) | Analista de requerimientos | 60 | $840.000 |
| Arquitectura React + Supabase y modelo de datos | Arquitecto de software | 160 | $3.360.000 |
| Prototipos UI: portal socio y panel operativo | Diseñador UX/UI | 250 | $4.000.000 |
| Validación de prototipos con devolución del Club | QA | 70 | $980.000 |
| Planificación de sprints y backlog | PM | 40 | $640.000 |
| Documentación técnica inicial | PM | 35 | $560.000 |
| **Total** | | **685** | **$11.500.000** |

### Etapa 2

| Tarea y actividad | Puesto | Horas | Monto |
|-------------------|--------|------:|------:|
| Portal socio: dashboard, reservas, carnet, cuotas, mensajes | Desarrollador frontend | 380 | $7.220.000 |
| Panel ERP: padrón, contabilidad, cajas, alertas, concesiones | Desarrollador backend | 440 | $8.360.000 |
| Integraciones nube (Auth, tablas, RLS) e importación Datita | Desarrollador backend | 80 | $1.520.000 |
| Modelo y performance de base (padrón, reservas, pagos) | DBA | 70 | $1.000.000 |
| Reglas de negocio: conflictos de reserva, dues, waitlist | Desarrollador backend | 110 | $2.090.000 |
| Normalización y calidad de datos migrados | Analista | 40 | $560.000 |
| Optimización de carga (shell crítico / diferido) | QA / Dev | 35 | $490.000 |
| Pruebas de módulos integrados por rol | QA | 40 | $560.000 |
| **Total** | | **1.195** | **$21.800.000** |

### Etapa 3

| Tarea y actividad | Puesto | Horas | Monto |
|-------------------|--------|------:|------:|
| Pruebas de carga y arranque multi-rol | QA | 140 | $1.960.000 |
| Pruebas de usabilidad (socio y panel) | QA | 70 | $1.470.000 |
| Validación de seguridad (RLS, roles, sesión) | QA | 80 | $1.280.000 |
| Control de acceso QR y registro de ingresos | Desarrollador backend | 110 | $2.090.000 |
| Ajustes de reservas reales (salones/parrilla) y calendario | Desarrollador backend | 60 | $840.000 |
| Despliegue productivo (Vercel + Supabase) | DevOps | 80 | $1.200.000 |
| Capacitación a administración, caja y portería | PM | 80 | $1.280.000 |
| Documentación final y manuales por rol | PM | 160 | $2.560.000 |
| Soporte de lanzamiento | Técnico | 80 | $1.120.000 |
| **Total** | | **860** | **$13.800.000** |

---

## Firma

Documento firmado por:

**Alejandro Chávez**  
DNI **31.888.184**  

En carácter de oferente de la presente propuesta para el desarrollo del portal institucional y ERP del **Jockey Club San Juan**.
