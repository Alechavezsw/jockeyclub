/** Manual de uso del panel: el paso concreto, no el menú. */

export const MANUAL_GROUPS = [
  { id: 'dia', label: 'El día' },
  { id: 'entrar', label: 'Entrar' },
  { id: 'ops', label: 'Operación' },
  { id: 'club', label: 'Club' },
  { id: 'gestion', label: 'Gestión' },
  { id: 'conta', label: 'Contabilidad' },
  { id: 'com', label: 'Comunicación' },
  { id: 'admin', label: 'Administración' },
  { id: 'sys', label: 'Sistema' },
  { id: 'afuera', label: 'Afuera del rail' },
];

export const MANUAL_SHOTS = {
  dashboard: { src: '/manual/dashboard.jpg', caption: 'Inicio' },
  search: { src: '/manual/search.jpg', caption: 'Buscador del panel' },
  members: { src: '/manual/members.jpg', caption: 'Socios' },
  dues: { src: '/manual/dues.jpg', caption: 'Cuotas' },
  bookings: { src: '/manual/bookings.jpg', caption: 'Reservas' },
  access: { src: '/manual/access.jpg', caption: 'Ingresos' },
  qr: { src: '/manual/qr.jpg', caption: 'Acceso QR' },
  pool: { src: '/manual/pool.jpg', caption: 'Pileta' },
  'pool-gate': { src: '/manual/pool-gate.jpg', caption: 'Entrada pileta' },
  disciplines: { src: '/manual/disciplines.jpg', caption: 'Disciplinas' },
  events: { src: '/manual/events.jpg', caption: 'Fiestas' },
  concessions: { src: '/manual/concessions.jpg', caption: 'Concesiones' },
  accounting: { src: '/manual/accounting.jpg', caption: 'Contabilidad' },
  cash: { src: '/manual/cash.jpg', caption: 'Cajas' },
  diary: { src: '/manual/diary.jpg', caption: 'Libro Diario' },
  reports: { src: '/manual/reports.jpg', caption: 'Reportes' },
  news: { src: '/manual/news.jpg', caption: 'Novedades' },
  surveys: { src: '/manual/surveys.jpg', caption: 'Encuestas' },
  alerts: { src: '/manual/alerts.jpg', caption: 'Alertas' },
  claims: { src: '/manual/claims.jpg', caption: 'Reclamos' },
  messaging: { src: '/manual/messaging.jpg', caption: 'Mensajería' },
  staff: { src: '/manual/staff.jpg', caption: 'Personal' },
  teachers: { src: '/manual/teachers.jpg', caption: 'Profesores' },
  users: { src: '/manual/users.jpg', caption: 'Usuarios y altas' },
  settings: { src: '/manual/settings.jpg', caption: 'Configuración' },
  migration: { src: '/manual/migration.jpg', caption: 'Migración' },
  jev: { src: '/manual/jev.jpg', caption: 'Consulta de Jev' },
  portal: { src: '/manual/portal.jpg', caption: 'Portal del socio' },
};

const LESSON_SHOT = {
  'abrir-dia': 'dashboard',
  'cobrar-socio': 'members',
  'liquidar-mes': 'dues',
  'pasar-porteria': 'qr',
  'cobrar-pileta': 'pool',
  'preguntar-jev': 'jev',
  roles: 'users',
  buscar: 'dashboard',
  inicio: 'dashboard',
  socios: 'members',
  cuotas: 'dues',
  reservas: 'bookings',
  ingresos: 'access',
  'acceso-qr': 'qr',
  'entrada-pileta': 'pool-gate',
  pileta: 'pool',
  disciplinas: 'disciplines',
  fiestas: 'events',
  concesiones: 'concessions',
  contabilidad: 'accounting',
  reportes: 'reports',
  diario: 'diary',
  mayor: 'diary',
  asiento: 'diary',
  caja: 'cash',
  gastos: 'cash',
  'libre-deuda': 'accounting',
  descuentos: 'accounting',
  galicia: 'cash',
  novedades: 'news',
  encuestas: 'surveys',
  alertas: 'alerts',
  reclamos: 'claims',
  mensajeria: 'messaging',
  personal: 'staff',
  profesores: 'teachers',
  usuarios: 'users',
  configuracion: 'settings',
  migracion: 'migration',
  'portal-socio': 'dashboard',
  asistencia: 'teachers',
};

export function shotForLesson(lesson) {
  const key = lesson?.shot || LESSON_SHOT[lesson?.id];
  return key ? MANUAL_SHOTS[key] || null : null;
}

export const APP_MANUAL = [
  {
    id: 'abrir-dia',
    group: 'dia',
    title: 'Abrir el día',
    tab: 'dashboard',
    keywords: 'abrir dia inicio tablero agenda alertas',
    who: 'Quien entra al panel.',
    steps: [
      'Abrí Inicio. Arriba está el número de cuotas del mes, una sola vez.',
      'Leé el vencimiento, lo recaudado y la caja.',
      'Si hay una alerta viva (Zonda, concesión), acusala ahí o en Alertas.',
      'La agenda de la semana está en el mismo tablero. No hace falta abrir Reservas para ver el día.',
    ],
    dont: 'No busques el total de cuotas en otro lado: el número grande vive en Inicio.',
  },
  {
    id: 'cobrar-socio',
    group: 'dia',
    title: 'Cobrar un socio',
    tab: 'members',
    keywords: 'cobrar pago cuota socio ficha caja boleto',
    who: 'Caja, administración, contador, superadmin.',
    steps: [
      'Operación → Socios. Buscá por número de socio, DNI o apellido.',
      'Abrí la ficha. El saldo y el vencimiento están en la cabecera.',
      'Cobrás desde la ficha o desde Cuotas → Saldos. El boleto sale si está prendido en Configuración.',
      'Si te pidió WhatsApp de vencimiento, sale desde Cuotas, no desde Mensajería.',
    ],
    dont: 'No re-liquidés el mes para cobrar a uno. Cobrá la ficha.',
  },
  {
    id: 'liquidar-mes',
    group: 'dia',
    title: 'Liquidar el mes',
    tab: 'dues',
    keywords: 'liquidar periodo mes cuotas excel pdf',
    who: 'Solo superadmin y contador.',
    steps: [
      'Operación → Cuotas. El borrador del mes siguiente se arma durante el mes en curso.',
      'Revisá cantidad de socios y monto unitario por categoría. Si hace falta, Editar y guardá.',
      'Liquidar recién en el mes en curso. El período cerrado no se vuelve a abrir.',
      'Excel y PDF salen de esa misma pantalla.',
    ],
    dont: 'Hasta octubre de 2026 la liquidación es la de LILA (octubre: $ 63.233.000). Desde noviembre liquida esta app, solo el mes en curso.',
  },
  {
    id: 'pasar-porteria',
    group: 'dia',
    title: 'Dejar pasar en portería',
    tab: 'qr_gate',
    keywords: 'porteria molinete qr credencial denegado dni',
    who: 'Portería, caja, personal, admin, superadmin.',
    steps: [
      'Acceso QR abre /acceso: es el molinete de la sede, no el libro.',
      'Escaneá la credencial o buscá DNI / apellido / número a mano.',
      'Si niega, el motivo queda en Ingresos. No inventes un pase.',
      'El libro del día se lee en Operación → Ingresos.',
    ],
    dont: 'No uses Pileta para la puerta de la sede. Pileta es otra caja.',
  },
  {
    id: 'cobrar-pileta',
    group: 'dia',
    title: 'Cobrar pileta',
    tab: 'pool',
    keywords: 'pileta canon invitado apto entrada ticket',
    who: 'Caja de pileta, admin, superadmin.',
    steps: [
      'El ingreso se controla en Entrada pileta (/entrada-pileta).',
      'La caja del día y el canon están en Operación → Pileta (/pileta).',
      'El canon de socio e invitado se cambia en Sistema → Configuración → Pileta.',
      'Si portería puede autorizar sin apto, eso también se prende en Reglas del club.',
    ],
    dont: 'No mezcles la caja de pileta con Tesorería. Son cajas distintas.',
  },
  {
    id: 'preguntar-jev',
    group: 'dia',
    title: 'Preguntarle a Jev',
    tab: 'jev',
    keywords: 'jev consulta ia gemini dictamen manual',
    who: 'Personal del club con sesión.',
    steps: [
      'IA → Consulta. Escribí un número de socio, el mes, o cómo se hace algo.',
      'Revisión es el padrón sucio. Predicciones proyecta el 10 y la pileta.',
      'Este Manual es la sala de al lado: el paso escrito. Jev no escribe en el libro.',
    ],
    dont: 'No le pidas a Jev que cobre, liquide o publique. Lee y te lleva.',
  },
  {
    id: 'roles',
    group: 'entrar',
    title: 'Quién ve qué',
    tab: 'system',
    keywords: 'rol permiso perfil superadmin cajero porteria profesor socio',
    who: 'Solo el superadmin crea y edita perfiles.',
    steps: [
      'Socio: portal (Inicio, Reservar, Mi Cuenta, Novedades). No ve el rail.',
      'Profesor: /asistencia. Marca presentes. No entra al panel.',
      'Portería y cajero: puerta, caja. Cajero no ve libros enteros.',
      'Operario de pileta: /entrada-pileta y /pileta. Cobra el canon. No ve padrón ni contabilidad.',
      'Administrador: el club, sin Contabilidad.',
      'Contador y superadmin: liquidan cuotas. Superadmin es el único que invita usuarios.',
    ],
    dont: 'Si no ves una sección, no está rota: tu perfil no la abre.',
  },
  {
    id: 'buscar',
    group: 'entrar',
    title: 'Buscar en el panel',
    tab: 'dashboard',
    keywords: 'buscar buscador ctrl seccion socio herramienta',
    who: 'Cualquiera con panel.',
    steps: [
      'Arriba a la izquierda está el buscador (Ctrl /).',
      'Escribí la sección (caja, socios, diario) o el nombre / número de socio.',
      'El menú de la izquierda se agrupa: Operación, Club, Gestión, Comunicación, Administración, Sistema.',
    ],
    dont: 'No recorras el rail entero si sabés el nombre: buscá.'
  },
  {
    id: 'inicio',
    group: 'ops',
    title: 'Inicio',
    tab: 'dashboard',
    keywords: 'inicio tablero panel agenda semana',
    who: 'Todo el personal.',
    steps: [
      'Vencimiento del mes, recaudado, caja y alertas vivas.',
      'La semana está abajo. Un click te lleva a Reservas o a la ficha.',
      'Las altas pendientes del padrón también se acusan acá.',
    ],
    dont: 'El número grande de cuotas no se repite en otras pantallas.',
  },
  {
    id: 'socios',
    group: 'ops',
    title: 'Socios',
    tab: 'members',
    keywords: 'socio padron ficha adherente grupo familiar titular editar',
    who: 'Operación y administración.',
    steps: [
      'El padrón está en Operación → Socios. El número de socio es la llave.',
      'Abrí la ficha: Editar, Tarjeta, Invitados, Documentos, Grupo familiar, Movimientos, Entradas, Asistencia, Reclamos.',
      'El ojo de la fila abre el resumen de cuenta.',
      'PDF y Excel del padrón salen de la barra de Socios.',
    ],
    dont: 'Personal no es el padrón. Los docentes están en Profesores.',
  },
  {
    id: 'cuotas',
    group: 'ops',
    title: 'Cuotas y saldos',
    tab: 'dues',
    keywords: 'cuota saldos mora excel pdf whatsapp importar cobranza',
    who: 'Saldos: caja y admin. Liquidar: contador y superadmin.',
    steps: [
      'Si tu perfil no liquida, la sección se llama Saldos.',
      'Consultar: Saldos, CC detalladas, Créditos, Deudas mes a mes.',
      'Operar: Importar cobranzas (Excel), Imputar eventos, Control de mora.',
      'WhatsApp de vencimiento sale de la franja de mora, con el teléfono de la ficha.',
      'Avisos reales: 5 días antes, el 10 y el 15. Mensaje interno y mail, con las consecuencias de mora. La regla está en Configuración.',
    ],
    dont: 'No importes un Excel de LILA que ya está en el libro.',
  },
  {
    id: 'reservas',
    group: 'ops',
    title: 'Reservas',
    tab: 'bookings',
    keywords: 'reserva cancha turno salon tenis paddle pileta',
    who: 'Operación. El socio reserva desde su portal.',
    steps: [
      'Operación → Reservas: canchas, salones y pileta del club.',
      'El socio entra a Reservar Canchas (/reservas), no al rail.',
      'Fiestas no es esta agenda: Fiestas son eventos con inscripción.',
    ],
    dont: 'No cargues una fiesta acá. Eso va a Club → Fiestas.',
  },
  {
    id: 'ingresos',
    group: 'ops',
    title: 'Ingresos (libro)',
    tab: 'access',
    keywords: 'ingresos porteria lecturas denegados credencial libro',
    who: 'Portería y administración.',
    steps: [
      'Operación → Ingresos es el libro: lecturas, denegados y el día.',
      'Para controlar la puerta usá Acceso QR (/acceso).',
      'Jev cruza portería, reservas y pileta del día si se lo pedís.',
    ],
    dont: 'Ingresos no escanea. Solo lee lo que ya pasó.',
  },
  {
    id: 'acceso-qr',
    group: 'ops',
    title: 'Acceso QR',
    tab: 'qr_gate',
    keywords: 'acceso qr molinete escaner control sede jcsj',
    who: 'Portería, caja, personal, admin, superadmin.',
    steps: [
      'Rail Acceso QR o /acceso.',
      'Escaneá o escribí DNI, apellido, número o código JCSJ.',
      'Los pases y denegados quedan anotados. El detalle se ve en Ingresos.',
    ],
    dont: 'No es la entrada de pileta.',
  },
  {
    id: 'entrada-pileta',
    group: 'ops',
    title: 'Entrada pileta',
    tab: 'pool_gate',
    keywords: 'entrada pileta ticket invitado pase apto',
    who: 'Control de pileta.',
    steps: [
      'Rail Entrada pileta o /entrada-pileta.',
      'Controla apto, canon e invitados. Distinto de la caja del día.',
      'En temporada, desde el 10, sin la cuota del mes no entra. La regla está en Configuración → Pileta.',
      'La temporada y los montos se editan en Configuración → Pileta.',
    ],
    dont: 'Si falta el apto y portería no está autorizada, no se inventa el pase.',
  },
  {
    id: 'pileta',
    group: 'ops',
    title: 'Pileta (caja)',
    tab: 'pool',
    keywords: 'pileta caja dia canon natacion',
    who: 'Caja de pileta.',
    steps: [
      'Operación → Pileta (/pileta): caja del día y canon cobrado.',
      'Invitados por socio y si el socio carga el apto: Configuración.',
      'Temporada oficial: diciembre a marzo.',
    ],
    dont: 'No uses esta pantalla para el molinete de la sede.',
  },
  {
    id: 'disciplinas',
    group: 'club',
    title: 'Disciplinas',
    tab: 'disciplines',
    keywords: 'disciplina deporte cancha instalacion catalogo',
    who: 'Administración del club.',
    steps: [
      'Club → Disciplinas: catálogo de deportes e instalaciones.',
      'El profesor toma asistencia en /asistencia, no acá.',
      'Altas de docentes: Administración → Profesores.',
    ],
    dont: 'No marques presentes desde el panel.',
  },
  {
    id: 'fiestas',
    group: 'club',
    title: 'Fiestas',
    tab: 'events',
    keywords: 'fiesta evento inscripcion catering salon imputar',
    who: 'Administración.',
    steps: [
      'Club → Fiestas: cargá el evento, cupo e inscripción.',
      'La imputación a la cuenta del socio se hace desde Cuotas → Imputar eventos.',
      'No es la reserva de cancha ni el salón suelto.',
    ],
    dont: 'Un cumpleaños de cancha va a Reservas. Una cena del club, a Fiestas.',
  },
  {
    id: 'concesiones',
    group: 'gestion',
    title: 'Concesiones',
    tab: 'concessions',
    keywords: 'concesion canon local gastronomia contrato',
    who: 'Admin, superadmin y contador.',
    steps: [
      'Gestión → Concesiones o /concesiones.',
      'Alta: datos, vigencia y canon, documentos, cierre.',
      'El vencimiento de un contrato aparece en Alertas.',
    ],
    dont: 'No es un proveedor. Proveedores vive en Contabilidad.',
  },
  {
    id: 'contabilidad',
    group: 'gestion',
    title: 'Contabilidad (mapa)',
    tab: 'accounting',
    keywords: 'contabilidad tesoreria libros asiento mapa',
    who: 'Contador y superadmin. Cajero y portería solo caja. Administrador no entra.',
    steps: [
      'Gestión → Contabilidad. Cajero entra directo a Cajas.',
      'Libros: Diario, Mayor, Crear asiento, Plan de cuentas.',
      'Informes: Balance, Resultados, Libre deuda, Grupo familiar, Bonificaciones, SIAP.',
      'Operación: Cajas, Gastos, Proveedores, Órdenes, Intereses, Galicia, Sin identificar.',
    ],
    dont: 'Si sos administrador y no ves Contabilidad, es el perfil. Pedile al superadmin.',
  },
  {
    id: 'reportes',
    group: 'gestion',
    title: 'Reportes',
    tab: 'reports',
    keywords: 'reporte informe excel pdf backup respaldo padron',
    who: 'Administración y contador.',
    steps: [
      'Gestión → Reportes: padrones, diarios y el respaldo del club.',
      'El Excel y el PDF de un período también salen desde Cuotas.',
      'El padrón también se exporta desde Socios.',
    ],
    dont: 'El respaldo no reemplaza Migración. Migración son los cortes de LILA.',
  },
  {
    id: 'diario',
    group: 'conta',
    title: 'Libro Diario',
    tab: 'accounting',
    focus: 'diary',
    keywords: 'diario asientos legal',
    who: 'Contador y superadmin.',
    steps: [
      'Contabilidad → Libros → Diario.',
      'Ahí se leen los asientos. Para cargar uno nuevo, Crear asiento.',
    ],
    dont: 'No edites un asiento cerrado de LILA. La cuenta protegida está en Configuración.',
  },
  {
    id: 'mayor',
    group: 'conta',
    title: 'Libro Mayor',
    tab: 'accounting',
    focus: 'mayor',
    keywords: 'mayor cuentas haberes',
    who: 'Contador y superadmin.',
    steps: [
      'Contabilidad → Libros → Mayor.',
      'Elegí la cuenta y leé el movimiento.',
    ],
    dont: 'El plan de cuentas es otra herramienta: Catálogo.',
  },
  {
    id: 'asiento',
    group: 'conta',
    title: 'Crear asiento',
    tab: 'accounting',
    focus: 'create',
    keywords: 'crear asiento legal nuevo',
    who: 'Cajero, portería, contador, superadmin.',
    steps: [
      'Contabilidad → Libros → Crear asiento.',
      'Cargá debe y haber. Guardá. Queda en el Diario.',
    ],
    dont: 'Un cobro de socio habitual se carga en la ficha o en Saldos, no como asiento suelto.',
  },
  {
    id: 'caja',
    group: 'conta',
    title: 'Cajas / Tesorería',
    tab: 'accounting',
    focus: 'cash',
    keywords: 'caja tesoreria efectivo arqueo',
    who: 'Cajero y portería entran directo. Contador ve todo.',
    steps: [
      'Contabilidad → Operación → Cajas.',
      'Ahí está el arqueo y el movimiento de tesorería.',
      'La caja de pileta es Operación → Pileta, otra pantalla.',
    ],
    dont: 'No arquees pileta desde tesorería.',
  },
  {
    id: 'gastos',
    group: 'conta',
    title: 'Gastos y proveedores',
    tab: 'accounting',
    focus: 'expenses',
    keywords: 'gasto egreso factura proveedor orden',
    who: 'Tesorería y contador.',
    steps: [
      'Gastos: Contabilidad → Operación → Gastos. Las categorías se editan en Configuración → Reglas.',
      'Proveedores y Órdenes de pago son las dos herramientas de al lado.',
      'Gastos fijos es el recurrente. No lo cargues dos veces como gasto suelto.',
    ],
    dont: 'Una factura de socio no es un gasto. Va a la ficha.',
  },
  {
    id: 'libre-deuda',
    group: 'conta',
    title: 'Libre deuda y familia',
    tab: 'accounting',
    focus: 'libre_deuda',
    keywords: 'libre deuda certificado grupo familiar saldos',
    who: 'Administración y contador.',
    steps: [
      'Libre deuda: Contabilidad → Informes. Emite el certificado del socio.',
      'Grupo familiar (saldos) está en Informes. La ficha familiar se edita en Socios.',
    ],
    dont: 'No armes el grupo familiar desde Contabilidad.',
  },
  {
    id: 'descuentos',
    group: 'conta',
    title: 'Descuentos y bonificaciones',
    tab: 'accounting',
    focus: 'bonificaciones',
    keywords: 'descuento extra bonificacion lila categoria',
    who: 'Contador y superadmin.',
    steps: [
      'Bonificaciones: el listado que vino de LILA. Informes.',
      'Descuentos extras: los que carga el club ahora. Otra lista.',
    ],
    dont: 'No mezcles las dos listas. LILA no se reescribe.',
  },
  {
    id: 'galicia',
    group: 'conta',
    title: 'Galicia, intereses y sin identificar',
    tab: 'accounting',
    focus: 'galicia',
    keywords: 'galicia debito automatico interes recargo sin identificar',
    who: 'Tesorería y contador.',
    steps: [
      'Galicia: débitos automáticos. Contabilidad → Operación.',
      'Intereses: se generan y se imputan. No corren solos.',
      'Sin identificar: cobranzas que no tienen socio. Ahí se imputan.',
    ],
    dont: 'No dejes un débito Galicia sin socio si ya sabés el número.',
  },
  {
    id: 'novedades',
    group: 'com',
    title: 'Novedades / Revista',
    tab: 'news',
    keywords: 'novedades revista nota portada cms publicar',
    who: 'Comunicación y admin.',
    steps: [
      'Comunicación → Novedades. En el panel se siente como Revista.',
      'Publicá con foto de portada. El socio la ve en /revista.',
    ],
    dont: 'Un aviso urgente de Zonda va a Alertas, no a una nota.',
  },
  {
    id: 'encuestas',
    group: 'com',
    title: 'Encuestas',
    tab: 'surveys',
    keywords: 'encuesta votacion opinion formulario',
    who: 'Comunicación.',
    steps: [
      'Comunicación → Encuestas: armá la consulta y leé las respuestas.',
      'Es al padrón, no un formulario interno de personal.',
    ],
    dont: 'Un reclamo no es una encuesta. Eso va a Reclamos.',
  },
  {
    id: 'alertas',
    group: 'com',
    title: 'Alertas y Zonda',
    tab: 'alerts',
    keywords: 'alerta aviso zonda vencimiento concesion declarar',
    who: 'Administración. Zonda también se declara en Configuración.',
    steps: [
      'Comunicación → Alertas: Zonda, vencimientos, concesiones.',
      'Lo vivo se acusa en Inicio.',
      'Declarar Zonda está en Sistema → Configuración, al pie.',
    ],
    dont: 'No dejes un Zonda declarado si ya pasó el viento.',
  },
  {
    id: 'reclamos',
    group: 'com',
    title: 'Reclamos',
    tab: 'claims',
    keywords: 'reclamo queja ticket atencion',
    who: 'Atención al socio.',
    steps: [
      'Comunicación → Reclamos: abiertos y pendientes.',
      'También se ven desde la ficha del socio.',
      'Lo abierto queda en el tablero de Inicio.',
    ],
    dont: 'Un mensaje interno no es un reclamo. Eso es Mensajería.',
  },
  {
    id: 'mensajeria',
    group: 'com',
    title: 'Mensajería',
    tab: 'messaging',
    keywords: 'mensajeria mensaje correo interno mail comunicado masivo jev',
    who: 'Personal del panel.',
    steps: [
      'Comunicación → Mensajería: mensaje interno, mail, o los dos.',
      'Un socio o todos. La IA puede redactar el texto.',
      'WhatsApp de cuota sale desde Cuotas.',
    ],
    dont: 'No mandes el vencimiento desde acá.',
  },
  {
    id: 'personal',
    group: 'admin',
    title: 'Personal',
    tab: 'staff',
    keywords: 'personal empleado rrhh legajo sueldo',
    who: 'RR.HH. y superadmin.',
    steps: [
      'Administración → Personal: legajos y RR.HH.',
      'Está junto a Profesores y Usuarios, no en Gestión.',
    ],
    dont: 'Un socio no se da de alta acá.',
  },
  {
    id: 'profesores',
    group: 'admin',
    title: 'Profesores y asistencia',
    tab: 'teachers',
    keywords: 'profesor docente clase alumno asistencia',
    who: 'Admin crea el docente. El profesor usa /asistencia.',
    steps: [
      'Administración → Profesores: alta, disciplina y clave.',
      'El profesor entra a /asistencia, marca presentes y ve si el alumno tiene la cuota al día.',
    ],
    dont: 'El profesor no entra al rail.',
  },
  {
    id: 'usuarios',
    group: 'admin',
    title: 'Usuarios y altas',
    tab: 'system',
    keywords: 'usuario permiso rol invitar perfil portal alta registro',
    who: 'Solo superadmin crea y edita perfiles.',
    steps: [
      'Administración → Usuarios y altas.',
      'El socio entra con el correo de su ficha. Si pide clave, aparece acá.',
      'El alta pública del padrón está en /registro. Las solicitudes se ven acá y en Inicio.',
    ],
    dont: 'No le armes un usuario de panel a un socio. Le corresponde el portal.',
  },
  {
    id: 'configuracion',
    group: 'sys',
    title: 'Configuración',
    tab: 'settings',
    keywords: 'configuracion sistema sede pileta zonda vencimiento cuit reglas tutores boleto mercado pago avisos mora',
    who: 'Superadmin.',
    steps: [
      'Sistema → Configuración. Todo se guarda en el libro.',
      'Sede: nombre, domicilio, CUIT, teléfono, correo. Sale en el pie del portal.',
      'Cuotas: día de vencimiento (hoy el 10), tolerancia, gracia de credencial, deuda máxima, cuenta protegida.',
      'Avisos de cuota: regla fija. Mensaje y mail el día 5 (por vencer), el 10 (vence) y el 15 (mora), con recargo del 10 %, sin ingreso ni pileta hasta regularizar.',
      'Pileta: canon socio/invitado, apto, invitados, temporada, si el socio carga el apto, y si la mora desde el 10 bloquea el ingreso.',
      'Mercado Pago: se prende acá. El token va en las secretas (MP_ACCESS_TOKEN) de la cuenta del club. Online = Checkout Pro en el portal. En el lugar = QR dinámico en caja y pileta. Suscripción = débito mensual.',
      'Reglas del club: tutores, recordatorio, boleto, teléfonos útiles, motivos, categorías de gasto. Todo editable.',
      'Zonda se declara al pie de esa misma pantalla.',
    ],
    dont: 'No inventes una clave nueva. Si no está acá, no se usa.',
  },
  {
    id: 'migracion',
    group: 'sys',
    title: 'Migración LILA',
    tab: 'migration',
    keywords: 'migracion lila datita societas empalme snapshot',
    who: 'Superadmin.',
    steps: [
      'Sistema → Migración: cortes de LILA y Societas.',
      'Empalme: 1 de octubre de 2026. Octubre ya liquidó.',
    ],
    dont: 'No reimportes lo que ya está en el libro.',
  },
  {
    id: 'portal-socio',
    group: 'afuera',
    title: 'Portal del socio',
    tab: 'members',
    keywords: 'portal socio reservar canchas mi cuenta perfil registro',
    who: 'El socio, con el correo de su ficha.',
    steps: [
      'Inicio, Reservar Canchas (/reservas), Mi Cuenta (/cuenta: Mercado Pago o débito automático), Novedades (/revista), Perfil (/perfil).',
      'Alta pública: /registro. Queda pendiente hasta que administración la apruebe.',
      'No ve el rail ni a Jev.',
    ],
    dont: 'Si no le llega el acceso, Usuarios y altas → pedido de clave. Pasale la contraseña por WhatsApp si el mail no sale.',
  },
  {
    id: 'asistencia',
    group: 'afuera',
    title: 'Asistencia del profesor',
    tab: 'teachers',
    keywords: 'asistencia profesor lista alumnos cuota',
    who: 'El profesor.',
    steps: [
      'Entra a /asistencia, no al panel.',
      'Marca presentes. El sistema le dice si el alumno tiene la cuota al día.',
    ],
    dont: 'No le pidas al profesor que cobre. Eso es caja.',
  },
];

const MANUAL_STOP = new Set([
  'como', 'para', 'esta', 'este', 'esto', 'aqui', 'alla', 'desde', 'hasta',
  'tiene', 'solo', 'todo', 'toda', 'cada', 'otra', 'otro', 'unas', 'unos',
  'donde', 'abrir', 'usar', 'paso', 'pasa', 'hace', 'hago', 'tengo', 'esa',
  'ese', 'las', 'los', 'del', 'una', 'por', 'con', 'que', 'app', 'uso',
]);

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function wordsOf(value) {
  return fold(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function tokenMatchesWord(token, word) {
  if (word === token || word.startsWith(token) || token.startsWith(word)) return true;
  const stem = token.slice(0, 4);
  return stem.length >= 4 && word.startsWith(stem);
}

function countTokenHits(tokens, words) {
  return tokens.filter((token) => words.some((word) => tokenMatchesWord(token, word))).length;
}

export function lessonTeach(lesson) {
  if (!lesson) return '';
  const first = lesson.steps?.[0] || '';
  return [first, lesson.dont].filter(Boolean).join(' ');
}

export function matchManualLessons(query = '') {
  const tokens = wordsOf(query).filter((token) => token.length >= 4 && !MANUAL_STOP.has(token));
  if (!tokens.length) return [];
  return APP_MANUAL
    .map((lesson) => {
      const titleWords = wordsOf(`${lesson.title} ${lesson.keywords}`);
      const stepWords = wordsOf(`${lesson.who} ${lesson.steps.join(' ')} ${lesson.dont}`);
      const titleHits = countTokenHits(tokens, titleWords);
      const stepHits = countTokenHits(tokens, stepWords);
      const hits = titleHits * 3 + stepHits;
      return { ...lesson, hits };
    })
    .filter((lesson) => lesson.hits > 0)
    .toSorted((a, b) => b.hits - a.hits || a.title.localeCompare(b.title, 'es'));
}

export function manualOverview() {
  return {
    verdict: 'El manual está en IA → Manual.',
    text: APP_MANUAL.filter((lesson) => lesson.group === 'dia').map((lesson) => lesson.title).join(' · '),
    figures: MANUAL_GROUPS.map((group) => ({
      label: 'Capítulo',
      value: group.label,
    })),
    next: 'Pedime un oficio: cobrar, liquidar, puerta, pileta, alta o caja. O abrí la sala Manual.',
    go: 'jev',
    room: 'manual',
  };
}

export function lessonInsight(query = '') {
  const hits = matchManualLessons(query);
  if (!hits.length) return manualOverview();
  const top = hits[0];
  return {
    verdict: top.title,
    text: `${top.who} ${top.steps.map((step, index) => `${index + 1}. ${step}`).join(' ')}`,
    figures: [],
    next: top.dont,
    go: top.tab,
    focus: top.focus || null,
    room: 'manual',
  };
}

export function manualForPrompt() {
  return APP_MANUAL.map((lesson) => {
    const where = lesson.focus
      ? `${lesson.title} (${lesson.tab} → ${lesson.focus})`
      : lesson.title;
    return `- ${where}: ${lesson.steps.join(' ')} ${lesson.dont}`;
  }).join('\n');
}
