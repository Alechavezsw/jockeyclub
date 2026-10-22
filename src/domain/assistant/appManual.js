/** Manual de uso del panel: el paso concreto, no el menú. */

export const MANUAL_GROUPS = [
  { id: 'dia', label: 'El día' },
  { id: 'ayuda', label: 'Si algo no anda' },
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
  'anular-cobro': 'members',
  'reglas-cuota': 'dues',
  'mercado-pago': 'settings',
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
      'Abrí Inicio. Arriba está la franja del vencimiento: el 10 de cada mes (AMET, el 18). Dice cuántos días faltan o cuántos pasaron.',
      'Recaudado del mes suma cuota del mes, atrasadas, adelantos, recargos y reservas de salón. No entra portería, estacionamiento ni transferencias sin imputar. El anillo es recaudado / liquidado.',
      'Leé también la caja y las altas pendientes del padrón.',
      'Si hay una alerta viva (Zonda, concesión), acusala ahí o en Alertas.',
      'La agenda de la semana está en el mismo tablero. No hace falta abrir Reservas para ver el día.',
    ],
    dont: 'No busques el total de cuotas en otro lado: el número grande vive en Inicio. Portería y transferencias sin imputar no entran al anillo.',
  },
  {
    id: 'cobrar-socio',
    group: 'dia',
    title: 'Cobrar un socio',
    tab: 'members',
    keywords: 'cobrar pago cuota socio ficha caja boleto',
    who: 'Caja, administración, contador, superadmin.',
    steps: [
      'Operación → Socios. Buscá por número de socio, DNI, apellido, mail o teléfono.',
      'Abrí la ficha. El saldo y el vencimiento están en la cabecera. Tocá Cobrar (también se cobra desde Cuotas → Saldos).',
      'El cobro separa Cuota, Recargo y Total. El recargo del 10 % corre desde el día siguiente al vencimiento y solo en socio familiar e individual; AMET no lleva.',
      'Elegí el medio: Efectivo, Transferencia (el comprobante es obligatorio) o Mercado Pago por QR. Confirmá: el saldo de la ficha y la caja se actualizan.',
      'Si cobrás a un adherente, el pago entra en la cuenta del titular y el aviso del cobro lo dice.',
      'Tesorería, contador y superadmin ven la casilla Perdonar recargo: cobra solo la cuota y deja anotado el recargo perdonado.',
      'El recibo en PDF le llega al socio por mensaje interno. Si el envío falla, el cobro igual queda registrado. El boleto de pago sale si está prendido en Configuración.',
    ],
    dont: 'No re-liquidés el mes para cobrar a uno. Cobrá la ficha. Vitalicio, fundador y comisión no abonan cuota: la ficha no deja cobrarles.',
  },
  {
    id: 'anular-cobro',
    group: 'dia',
    title: 'Anular un cobro mal cargado',
    tab: 'members',
    keywords: 'anular anulacion error equivocado devolver revertir cobro recibo movimientos',
    who: 'Tesorería (cargo de Tesorero), contador y superadmin. Caja y administración no ven el botón Anular: pasan el pedido a Tesorería.',
    steps: [
      'Socios → ficha del socio → Movimientos. Cada cobro de cuota tiene un botón Anular.',
      'Confirmá. El cobro queda tachado con la marca Anulado y quién lo anuló: no se borra, queda el rastro.',
      'Vuelven el saldo, el último pago y el vencimiento que había antes, y la caja registra el contraasiento.',
      'Después cobrá de nuevo con el importe y el medio correctos.',
    ],
    dont: 'No lo uses para perdonar un recargo: eso se hace al cobrar, con Perdonar recargo.',
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
      'La liquidación cobra una sola cuota por grupo familiar, la del titular. Si un integrante tiene abono de tenis, ese abono se suma a la cuenta del titular.',
      'Vitalicio, fundador y comisión quedan en cero: no liquidan.',
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
      'Escaneá la credencial o buscá DNI / apellido / número a mano. No hace falta esperar a que se vaya el cartel: la credencial siguiente lo reemplaza al instante.',
      'ACCESO AUTORIZADO: dejalo pasar. ACCESO CON DEUDA: pasa igual; invitalo a regularizar en Caja.',
      'Si aparece un aviso amarillo «Ya ingresó hace N min», esa misma credencial entró hace poco. Puede haber salido y vuelto, pero también puede ser un QR prestado o mandado por WhatsApp: mirá que la persona sea el socio. El aviso no bloquea; decidís vos.',
      'ACCESO DENEGADO · MORA aparece solo en temporada de pileta (diciembre a marzo), desde el 10, si no pagó la cuota del mes. Fuera de temporada la deuda se informa pero no cierra la puerta. Un adherente queda igual que su titular: si el titular está en mora, el grupo también.',
      'NO SE PUDO VERIFICAR (cartel amarillo): se cortó la conexión y no se puede comprobar la firma. No es un rechazo ni una acusación: buscá al socio por DNI o número y dejalo pasar a mano. La lectura queda anotada como «Sin verificar».',
      'Suspendido siempre se deniega. Si niega, el motivo queda en Ingresos. No inventes un pase.',
      'El libro del día se lee en Operación → Ingresos. Cada lectura guarda quién la hizo. Si falla la conexión, las lecturas se guardan en la tablet y se envían solas cuando vuelve internet.',
    ],
    dont: 'No uses Pileta para la puerta de la sede. Pileta es otra caja.',
  },
  {
    id: 'cobrar-pileta',
    group: 'dia',
    title: 'Cobrar pileta',
    tab: 'pool',
    keywords: 'pileta canon invitado apto entrada ticket abrir caja del dia cobro',
    who: 'Caja de pileta, admin, superadmin.',
    steps: [
      'El ingreso se controla en Entrada pileta (/entrada-pileta).',
      'La caja del día se abre una vez por día en Operación → Pileta (/pileta). Sin caja abierta no se cobra el canon.',
      'Se cobra en efectivo o con Mercado Pago (QR en el lugar). Cada socio puede llevar invitados hasta el tope configurado; hoy son 3 por día.',
      'Un socio en mora (desde el 10, o con saldo) no puede pagar pileta hasta regularizar la cuota. La ficha lo dice: Puede pagar pileta / No puede pagar pileta.',
      'Vitalicio, fundador y comisión no tienen cuota, así que nunca quedan en mora.',
      'El canon de socio e invitado, el apto y el tope de invitados se cambian en Sistema → Configuración → Pileta.',
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
      'IA → Consulta. Escribí un número de socio, el mes, o cómo se hace algo. Los atajos de arriba (El mes, Qué conviene, La puerta, Enseñame) hacen la pregunta por vos.',
      'Para un socio, escribí su número, su DNI o nombre y apellido: «¿por qué el socio 1234 no puede pagar pileta?». Jev contesta con las mismas reglas que usan la caja y la puerta: categoría, titular o adherente, mora y recargo, si entra hoy y si puede pagar pileta. Podés repreguntar sobre el mismo socio.',
      'También contesta dudas: «¿por qué no lo deja pasar?», «¿qué pasa si entra en mora?», «¿qué significa AMET?». Si el manual no lo cubre, te lo dice y te manda a Secretaría; no inventa.',
      'Revisión es el padrón sucio: lo que falta, lo que se repite y lo que no cierra. Se baja a Excel.',
      'Predicciones proyecta el 10 y la pileta.',
      'Manual es la sala de al lado: el paso escrito de cada oficio, con captura y botón Ir a esa sección.',
      'Jev lee el club entero (cuotas, portería, reservas, pileta, reclamos) y te dice qué falta. No escribe en el libro.',
    ],
    dont: 'No le pidas a Jev que cobre, liquide o publique. Lee y te lleva.',
  },
  {
    id: 'transferencia-socio',
    group: 'dia',
    title: 'Registrar una transferencia que avisó el socio',
    tab: 'members',
    keywords: 'transferencia comprobante aviso banco acreditar imputar cbu alias deposito',
    who: 'Caja, administración, contador, superadmin.',
    steps: [
      'El aviso del socio llega como mensaje a la bandeja de Operaciones (Comunicación → Mensajería → MD), con el comprobante adjunto.',
      'Verificá en el banco que la plata esté acreditada. El aviso solo avisa: no cobra ni cambia el saldo.',
      'Abrí la ficha del socio y tocá Cobrar. Elegí Transferencia, el banco del club y adjuntá el comprobante: sin comprobante no deja confirmar.',
      'Confirmá. El saldo se actualiza, la caja registra el ingreso y el recibo le llega al socio por mensaje.',
      'Si el socio no es el titular, el cobro entra en la cuenta del titular.',
    ],
    dont: 'No cobres solo porque llegó el aviso: primero mirá que el dinero esté en el banco.',
  },
  {
    id: 'no-pasa-puerta',
    group: 'ayuda',
    title: 'Por qué no lo deja pasar en la puerta',
    tab: 'qr_gate',
    keywords: 'puerta denegado rechazado no pasa no entra no deja entrar molinete qr mora suspendido invalido anfitrion bloqueado',
    who: 'Portería, caja, personal.',
    steps: [
      'Leé el título del resultado: dice el motivo.',
      'ACCESO DENEGADO · MORA: es temporada de pileta (diciembre a marzo), pasó el 10 y no pagó la cuota del mes. Que regularice en Caja o en Mi Cuenta; cuando se acredita, pasa. Fuera de temporada, la deuda no cierra la puerta.',
      'En un adherente, la mora es la de su titular: si el titular no pagó, el grupo no ingresa en temporada. Regulariza el titular.',
      'ACCESO DENEGADO: cuenta suspendida u otro bloqueo. Se rehabilita en la ficha, con motivo, desde Socios.',
      'NO SE PUDO VERIFICAR (amarillo): no hay conexión para comprobar la firma. No es un rechazo: buscá al socio por DNI o número y dejalo pasar a mano.',
      'QR no válido o adulterado: es un QR que no es del club, uno cortado, o de un carnet viejo sin firma. Que abra la app de nuevo, o buscalo por DNI, apellido o número.',
      'Socio no encontrado: el número no está en el padrón. Avisá a Secretaría; no improvises un pase.',
      'Invitado: ANFITRIÓN EN MORA significa que el socio que lo invitó está bloqueado; PASE INVÁLIDO es un pase vencido, anulado o con anfitrión suspendido. Los pases valen solo el día.',
      'Aviso amarillo «Ya ingresó hace N min» sobre un ACCESO AUTORIZADO: la misma credencial entró hace poco. Puede ser un QR prestado; confirmá que sea el socio.',
      'El motivo de cada lectura queda en Operación → Ingresos.',
    ],
    dont: 'No dejes pasar a un denegado por mora “por esta vez” ni inventes un pase. La regla de mora se prende o apaga en Configuración → Pileta, no en la puerta.',
  },
  {
    id: 'credencial-qr',
    group: 'ayuda',
    title: 'Credencial, QR y socio sin carnet',
    tab: 'qr_gate',
    keywords: 'credencial carnet tarjeta qr virtual firmado sin carnet sin celular no lo lee no lee foto celular codigo manual jcsj dni',
    who: 'Portería, caja, personal y atención al socio.',
    steps: [
      'La credencial del socio es la tarjeta virtual de su Inicio: nombre, número y un QR firmado. El personal también la ve en la ficha, sección Tarjeta.',
      'El QR no se puede inventar con el número, pero sí se puede copiar: una captura del QR vigente pasa. Por eso el molinete avisa en amarillo «Ya ingresó hace N min» si la misma credencial entra dos veces en 20 minutos.',
      'Si el lector no toma el QR: subir el brillo del celular, acercarlo, o buscarlo por DNI, apellido o número en Acceso QR. Un carnet impreso de antes de la firma no vale.',
      'El QR es más simple que antes (menos puntos) y se lee más rápido y desde más lejos. Los QR de antes que un socio tenga guardados siguen valiendo.',
      'Socio sin carnet ni celular: en Acceso QR escribí el DNI, el apellido, el número o el código JCSJ en Código manual. Se aplican las mismas reglas que con el QR.',
      'Un QR no válido o adulterado queda registrado en Ingresos.',
    ],
    dont: 'No dejes pasar sin buscar al socio. Si no figura en el padrón, que lo resuelva Secretaría. Pedile al socio que no mande su QR por WhatsApp.',
  },
  {
    id: 'no-puede-pagar',
    group: 'ayuda',
    title: 'Por qué un socio no puede pagar',
    tab: 'members',
    keywords: 'no puede pagar pago boton mercado pago exento adherente pileta mora cuenta checkout debito sin botones',
    who: 'Caja y atención al socio.',
    steps: [
      'Mi Cuenta sin botones de pago: es exento (vitalicio, fundador o comisión), es adherente (paga el titular) o el estado de la cuota todavía se está confirmando; esperar unos segundos.',
      'Mercado Pago no abre: si Cobros habilitados está en No (Configuración → Mercado Pago), se apagan el cobro online, el QR y la adhesión de todos.',
      'Un exento o un adherente no pueden pagar ni adherirse al débito mensual.',
      'Pileta: en mora (desde el 10 sin la cuota del mes, o con saldo) no puede pagar pileta hasta regularizar. También si está suspendido, de baja o con la cuenta no habilitada. La cabecera de la ficha lo dice.',
      'Cobro en caja a un adherente: entra en la cuenta del titular. Si el titular no está en el padrón, el sistema no deja cobrar.',
      'Transferencia: sin comprobante adjunto no se confirma.',
    ],
    dont: 'No le cargues una deuda a un exento ni a un adherente para que “le aparezca el botón”.',
  },
  {
    id: 'no-puede-reservar',
    group: 'ayuda',
    title: 'Por qué un socio no puede reservar',
    tab: 'bookings',
    keywords: 'no puede reservar reserva rechazada turno cancha anticipacion invitados categoria titular adherente zonda lleno ocupado',
    who: 'Atención al socio y administración.',
    steps: [
      '“Las reservas las hace el titular de la cuenta”: es adherente. Que reserve el titular.',
      '“Ese turno ya está reservado” o “ya empezó”: elegir otro horario. Si el turno ya empezó, no se puede tomar.',
      '“Se puede reservar hasta N días antes” y “Hay que reservar con al menos N horas de anticipación”: lo fija cada espacio.',
      '“El máximo de invitados es N”: tope del espacio.',
      '“Tu categoría de cuota no puede reservar este espacio”: el espacio restringe por categoría; se edita en el espacio, en Reservas.',
      '“Ya tenés una reserva vigente en este espacio”: una por espacio.',
      '“Ese espacio no está disponible”: suspendido, en mantenimiento o no disponible. Con Zonda declarado se suspende lo que está al aire libre.',
    ],
    dont: 'No fuerces una reserva cargándola a mano para saltar una regla: cambiá la regla del espacio si corresponde.',
  },
  {
    id: 'no-veo-pantalla',
    group: 'ayuda',
    title: 'Por qué no veo una pantalla',
    tab: 'system',
    keywords: 'no veo pantalla seccion permiso rol menu falta contabilidad cuotas saldos acceso restringido perfil',
    who: 'Todo el personal.',
    steps: [
      'El menú muestra solo lo que abre tu perfil. Si falta una sección, no está rota: tu perfil no la habilita.',
      'Cuotas o Saldos: se llama Cuotas solo si tu perfil liquida (contador y superadmin). Para el resto es Saldos.',
      'Contabilidad: solo contador y superadmin. Cajero y portería ven solo Cajas y Otros ingresos. El administrador no entra.',
      'Crear y editar usuarios y perfiles es solo del superadmin. Configuración y Migración también se manejan con él.',
      'Un usuario puede tener más de un rol y los permisos se suman. El superadmin los cambia en Usuarios y altas.',
      'Un socio no ve el panel. Un adherente no puede reservar ni pagar.',
    ],
    dont: 'No pidas un rol más alto “para probar”: pedí el permiso que necesitás.',
  },
  {
    id: 'numeros-no-cierran',
    group: 'ayuda',
    title: 'Por qué los números no coinciden',
    tab: 'dashboard',
    keywords: 'numeros no coinciden no cierra no cierran diferencia recaudado liquidado saldo corte lila total distinto cobrabilidad caja',
    who: 'Tesorería, contador y administración.',
    steps: [
      'El saldo vivo de un socio es el de su ficha. Los reportes “Corte LILA” son fotos de un día anterior al empalme (1 de octubre de 2026): no son el saldo de hoy.',
      'Recaudado del mes en Inicio incluye cuota, atrasadas, adelantos, recargos y salón. Portería, estacionamiento y transferencias sin imputar no entran; por eso puede diferir de toda la caja.',
      'La liquidación cobra una cuota por grupo familiar, la del titular. Los adherentes no suman cuota (el abono de tenis sí).',
      'Un cobro anulado no desaparece: deja el cobro tachado y su contraasiento.',
      'El mensual, la cuenta corriente y la caja de otro corte pueden dar distinto: son fotos de días distintos. Anotá la fecha de cada uno.',
    ],
    dont: 'No iguales dos reportes a mano. Mirá primero la fecha del corte.',
  },
  {
    id: 'portal-no-entra',
    group: 'ayuda',
    title: 'El socio no puede entrar al portal',
    tab: 'system',
    keywords: 'socio no puede entrar portal clave contrasena usuario olvido recuperar acceso mail registro login ficha vinculada',
    who: 'Secretaría y superadmin.',
    steps: [
      'El socio entra con el correo de su ficha y su contraseña. Verificá que el mail de la ficha sea el correcto.',
      'Si no tiene usuario o olvidó la clave, en la pantalla de ingreso usa “Ya soy socio y no tengo usuario / olvidé la contraseña” (/registro). El pedido llega a Usuarios y altas y a Inicio.',
      'Secretaría verifica la ficha y contacta al socio. Por esa pantalla nunca se entrega una clave.',
      'Si el mail con el acceso no sale, se le pasa la contraseña por WhatsApp.',
      'Si entra pero no le carga su ficha, el usuario no está vinculado al padrón: el superadmin pega el número de socio al perfil en Usuarios y altas.',
    ],
    dont: 'No le prestes tu usuario ni crees uno con el mail de otra persona.',
  },
  {
    id: 'mora-que-pasa',
    group: 'ayuda',
    title: 'Qué pasa cuando un socio entra en mora',
    tab: 'dues',
    keywords: 'mora vencimiento recargo aviso pileta puerta regularizar atrasado deuda consecuencias que pasa suspender',
    who: 'Caja, administración, contador.',
    steps: [
      'El día 10 (AMET, el 18) vence la cuota. Hasta ese día no lleva recargo.',
      'Desde el día siguiente (el 11; AMET, el 19) es mora. En socio familiar e individual corre el recargo del 10 %; AMET no lleva recargo.',
      'El socio recibe aviso por mensaje interno y por mail, con las consecuencias.',
      'No puede pagar pileta hasta regularizar. En temporada de pileta (diciembre a marzo), tampoco ingresa al club.',
      'Se regulariza cobrando en la ficha o con Mercado Pago en Mi Cuenta. Tesorería, contador y superadmin pueden perdonar el recargo al cobrar.',
      'Control de mora, en Cuotas, lista a quien debe, cuántos meses y cuánto. Un exento o un adherente nunca entra en mora.',
    ],
    dont: 'Mora no es suspensión. Suspender es otra acción: pide un motivo y queda en la trazabilidad de la ficha.',
  },
  {
    id: 'alta-baja-socio',
    group: 'ayuda',
    title: 'Alta, suspensión y baja de un socio',
    tab: 'members',
    keywords: 'alta baja suspender reactivar activar habilitar socio nuevo solicitud aprobar motivo trazabilidad pendiente duplicado',
    who: 'Administración y caja con permiso.',
    steps: [
      'Alta: Operación → Socios, alta de socio titular. Las solicitudes que llegan de /registro quedan pendientes hasta que Secretaría las apruebe.',
      'Suspender y Activar: botones en la fila del socio y en la ficha. Piden un motivo (mora, conducta, documentación, pedido del socio, otro) y queda en la Trazabilidad.',
      'Un suspendido no ingresa y su cuota queda en pausa: no se liquida.',
      'Dar de baja pide un motivo (renuncia, fallecimiento, mora irrecuperable, duplicado, corrección de padrón, otro). Queda auditado y no factura más; la deuda previa se informa pero no se liquida.',
      'Un adherente se suspende o se habilita desde el desglose del grupo familiar, en la fila del titular.',
    ],
    dont: 'No des de baja un duplicado sin revisar cuál es la ficha buena: la baja queda auditada.',
  },
  {
    id: 'invitados',
    group: 'ayuda',
    title: 'Invitados: pase del día y pileta',
    tab: 'members',
    keywords: 'invitado invitados pase qr dia pileta cupo anfitrion tope',
    who: 'Portería, pileta y atención al socio.',
    steps: [
      'Pase de invitado (puerta de la sede): el socio lo genera en Inicio con el nombre del invitado. Máximo 3 activos por día y por socio; vale solo ese día.',
      'Si el anfitrión está suspendido o en mora (en temporada), el invitado no entra.',
      'Invitados de pileta: es otro cupo, el que fija Configuración → Pileta (hoy 3 por día), con un canon por invitado que se cobra en la caja de pileta, después de habilitar al socio.',
      'En la ficha del socio, la sección Invitados muestra y genera los pases.',
    ],
    dont: 'No confundas los dos cupos: el pase de la sede y el invitado de pileta son cosas distintas.',
  },
  {
    id: 'glosario',
    group: 'ayuda',
    title: 'Qué significa cada palabra del club',
    tab: 'dashboard',
    keywords: 'glosario significa que es palabra termino padron ficha titular adherente exento amet mora recargo imputar liquidar corte lila empalme apto zonda',
    who: 'Cualquiera.',
    steps: [
      'Padrón: la lista oficial de socios. Ficha: la pantalla completa de una persona.',
      'Titular: lleva la cuenta del grupo. Adherente: familiar a cargo; no paga ni reserva por su cuenta.',
      'Exento: vitalicio, fundador o comisión. No abonan cuota social.',
      'AMET: categoría que vence el 18, con la cuota en base menos 2,5 %; ese 2,5 % es tarifa, no mora, y no lleva recargo.',
      'Mora: cuota vencida y sin pagar, desde el día siguiente al vencimiento. Recargo: 10 % sobre la cuota en mora, solo familiar e individual.',
      'Imputar: asignar un cobro o un evento a la cuenta de un socio. Liquidar: cerrar el período y generar las cuotas del mes (contador y superadmin).',
      'Corte LILA: foto de un Excel de un día anterior al 1 de octubre de 2026, no el ahora. Empalme: la fecha en que el portal pasó a ser el libro vivo.',
      'Apto: la revisación médica para usar la pileta. QR firmado: código de la app que no se puede inventar con el número.',
      'Zonda: viento fuerte; se cierran las canchas al aire libre.',
    ],
    dont: 'Si una palabra no está acá, preguntale a Secretaría antes de suponer.',
  },
  {
    id: 'roles',
    group: 'entrar',
    title: 'Quién ve qué',
    tab: 'system',
    keywords: 'rol permiso perfil superadmin cajero porteria profesor socio',
    who: 'Solo el superadmin crea y edita perfiles.',
    steps: [
      'Socio: portal (Inicio, Reservar Canchas, Mi Cuenta, Novedades). No ve el rail. Si es adherente, no paga ni reserva: lo hace el titular.',
      'Profesor: /asistencia. Marca presentes. No entra al panel.',
      'Portería (operador de portería): puerta, Ingresos, pileta, consulta de padrón y la caja. Cajero: consulta de padrón, Saldos, pileta, ingresos, Fiestas y Caja. Ninguno de los dos ve los libros enteros ni edita fichas.',
      'Empleado de administración y Operario de pileta ven lo mismo: consulta de padrón, saldos, reservas, pileta y atención (reclamos, mensajería, novedades, encuestas). No liquidan ni editan fichas. El operario de pileta además abre en la puerta (/entrada-pileta) y cobra el canon.',
      'Personal: reservas, disciplinas, pileta, ingresos, personal, fiestas, alertas, reclamos y novedades. Recursos humanos: Personal y Alertas. Tampoco editan el padrón.',
      'Administrador: el club entero sin Contabilidad; con el superadmin son los únicos que editan fichas del padrón.',
      'Contador: Cuotas (liquida), Contabilidad, Reportes y Fiestas; consulta el padrón pero no lo edita. Superadmin: todo, y es el único que crea usuarios y perfiles.',
      'Cargos como Tesorero no cambian los permisos de pantalla, pero Tesorero, contador y superadmin pueden perdonar el recargo al cobrar.',
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
      'Vencimiento del mes (10; AMET, 18), recaudado del mes con su cobrabilidad, caja y alertas vivas.',
      'Si hoy es el vencimiento o ya pasó, la franja marca mora o que vence hoy.',
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
    keywords: 'socio padron ficha adherente grupo familiar titular editar imprimir excel pdf exportar',
    who: 'Consultan varios roles. Editar ficha solo administrador y superadministrador.',
    steps: [
      'El padrón está en Operación → Socios. El número de socio es la llave. La lista es liviana a propósito: el domicilio y el resto de la ficha se leen al abrir al socio.',
      'Abrí la ficha: Ficha, Editar (solo admin/super), Tarjeta, Invitados, Documentos, Grupo familiar, Movimientos, Entradas, Asistencia, Reclamos, Mensajes y Trazabilidad.',
      'Movimientos muestra cada cobro con su Cuota y su Recargo, y el botón Anular para un cobro mal cargado.',
      'Grupo familiar: el titular lleva la cuenta. El adherente no paga ni reserva por su cuenta; su cobro y sus reservas son del titular.',
      'La cabecera de la ficha dice si el socio puede pagar pileta (en mora no puede) y si la cuenta está habilitada, pendiente, suspendida o dada de baja.',
      'El ojo de la fila abre el resumen de cuenta.',
      'PDF y Excel del padrón salen de la barra de Socios.',
    ],
    dont: 'Personal no es el padrón. Los docentes están en Profesores. No borres datos de la ficha porque no los ves en la lista: están en el perfil.',
  },
  {
    id: 'cuotas',
    group: 'ops',
    title: 'Cuotas y saldos',
    tab: 'dues',
    keywords: 'cuota saldos mora excel pdf whatsapp importar cobranza',
    who: 'Saldos (solo consulta): caja, administración y pileta. Operar y liquidar: contador y superadmin.',
    steps: [
      'Si tu perfil no liquida, la sección se llama Saldos y es solo de consulta.',
      'Consultar: Saldos, CC detalladas, Créditos, Deudas mes a mes.',
      'Operar (solo contador y superadmin): Importar cobranzas (Excel), Imputar eventos, Control de mora.',
      'Control de mora lista a quien venció, con meses atrasados y lo que debe. Desde el día siguiente al vencimiento corre el recargo del 10 % (familiar e individual).',
      'WhatsApp de vencimiento sale de la franja de mora, con el teléfono de la ficha.',
      'Avisos reales, uno de cada etapa por socio: desde 5 días antes del vencimiento, el día que vence y desde el día siguiente (mora). Para casi todos eso es desde el 5, el 10 y desde el 11; para AMET, desde el 13, el 18 y desde el 19. Llegan por mensaje interno y mail, con las consecuencias de mora. La regla está en Configuración.',
      'Los avisos van solo a quien debe, y nunca a vitalicio, fundador ni comisión. Un socio que apagó el aviso en su ficha tampoco lo recibe.',
      'Cobrar desde acá usa el mismo cobro de la ficha: Cuota, Recargo y Total, y Perdonar recargo para tesorería.',
    ],
    dont: 'No importes un Excel de LILA que ya está en el libro.',
  },
  {
    id: 'reglas-cuota',
    group: 'ops',
    title: 'Reglas de la cuota social',
    tab: 'dues',
    keywords: 'cuota regla vencimiento mora recargo amet exento vitalicio fundador comision grupo familiar adherente tenis',
    who: 'Todo el que cobra o explica una cuota.',
    steps: [
      'La cuota social vence el día 10 de cada mes. Desde el 11 el socio está en mora.',
      'AMET (socio familiar AMET y socio individual AMET) vence el 18. Su cuota es la base menos 2,5 %; ese 2,5 % es tarifa, no mora ni recargo.',
      'El recargo es del 10 %, corre desde el día siguiente al vencimiento y solo en socio familiar e individual. AMET no lleva recargo.',
      'Vitalicio, fundador y comisión no abonan cuota. Para todo el padrón: sin mora, sin saldo, sin avisos, sin Mercado Pago y sin cobro en caja ni en el portal.',
      'En un grupo familiar la cuota es una sola, la del titular. El adherente no tiene cuenta propia. Un abono de tenis de un integrante sí se suma a la cuenta del titular.',
      'La mora del titular alcanza al grupo: en temporada el adherente no ingresa ni paga pileta si el titular está en mora.',
      'Un pago cubre el mes en que se hizo: si el último pago fue en agosto, el próximo vencimiento es el 10 de septiembre.',
      'Tesorería, contador y superadmin pueden perdonar el recargo al cobrar.',
      'La tarifa vigente desde octubre de 2026 y la liquidación de cada mes están en Cuotas; el día de vencimiento se ve en Configuración.',
    ],
    dont: 'No le armes una deuda a un exento ni le cobres a un adherente: la cuenta es del titular.',
  },
  {
    id: 'reservas',
    group: 'ops',
    title: 'Reservas',
    tab: 'bookings',
    keywords: 'reserva cancha turno salon tenis paddle pileta',
    who: 'Operación. El socio reserva desde su portal.',
    steps: [
      'Operación → Reservas: canchas, salones y pileta del club. Acá sí se ve quién reservó, el importe, y se puede anular o reactivar.',
      'El socio entra a Reservar Canchas (/reservas), no al rail. Elige espacio, día y horario libre. Del turno ocupado ve solo que está ocupado.',
      'Las reservas las hace el titular de la cuenta. Un adherente que intenta reservar recibe “Las reservas las hace el titular de la cuenta”.',
      'Cada espacio tiene su regla, que se edita desde el espacio: hasta cuántos días antes se reserva, horas mínimas de anticipación, máximo de invitados, qué categorías pueden, una reserva vigente por espacio, si queda confirmada o pendiente de aprobación y si se carga a la cuenta corriente del socio.',
      'Con Zonda declarado se suspende lo que está al aire libre; lo cubierto sigue.',
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
      'Operación → Ingresos es el libro: lecturas, denegados y el día. Cada lectura guarda quién la hizo; las «Sin verificar» son las que se leyeron sin conexión.',
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
      'Rail Acceso QR o /acceso. La pantalla de la tablet queda encendida mientras está abierta.',
      'Escaneá o escribí DNI, apellido, número o código JCSJ. El lector sigue leyendo mientras se muestra el cartel: pasá la credencial siguiente sin esperar.',
      'Resultados: ACCESO AUTORIZADO, ACCESO CON DEUDA, ACCESO DENEGADO (suspendido o mora en temporada), INVITADO AUTORIZADO, ANFITRIÓN EN MORA, PASE INVÁLIDO, QR no válido, QR adulterado, Socio no encontrado y NO SE PUDO VERIFICAR (sin conexión).',
      'El adherente se evalúa con su titular: si el titular está en mora, el grupo no ingresa en temporada.',
      'Los pases de invitado se consultan en el momento: uno que el socio generó hace un rato vale aunque la tablet haya abierto antes.',
      'Los pases y denegados quedan anotados, con quién los leyó. El detalle se ve en Ingresos.',
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
      'Controla apto médico, canon e invitados. Distinto de la caja del día.',
      'En temporada (diciembre a marzo), desde el 10, sin la cuota del mes no entra al club: aparece “En mora · no abonó la cuota del mes”. La regla está en Configuración → Pileta.',
      'Un socio en mora tampoco puede pagar pileta, esté o no en temporada, hasta regularizar.',
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
      'Gestión → Contabilidad. Cajero y portería entran directo a Cajas.',
      'Libros: Libro Diario, Libro Mayor y Crear asiento legal.',
      'Informes: Balance (mensual, resumido, cuenta corriente, patrimonial), Estado de resultados, Reportes y gráficos, Reportes.',
      'Padrón: Libre deuda, Grupo familiar, Descuentos extras, Bonificaciones, SIAP e Impuestos.',
      'Operación → Tesorería: Cajas, Gastos, Proveedores, Retenciones, Otros ingresos, Intereses, Sin identificar, Galicia, Gastos fijos, Saldos, Órdenes y Créditos socios.',
      'Catálogo: Plan de cuentas.',
      'Informes, tesorería e impuestos leen el corte vivo del club; lo anterior al empalme (1 de octubre de 2026) viene de los cortes de LILA y lleva la leyenda Corte LILA con su fecha.',
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
      'El diario, el mayor y el asiento legal usan el libro vivo del club: cuotas, caja y cobros de hoy, no una foto vieja de LILA.',
      'Un cobro anulado deja su contraasiento: el original no se borra.',
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
      'Ahí está el arqueo y el movimiento de tesorería. Efectivo + bancos + cheques = total al día.',
      'Saldos (Operación) resume tesorería, deuda de socios y proveedores al mismo corte.',
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
      'Gastos: Contabilidad → Operación → Gastos. Se pide, se aprueba y al pagar baja caja o banco.',
      'Proveedores: la cuenta corriente es el saldo de apertura más entradas y pagos. Positivo = deuda del club.',
      'Retenciones: Contabilidad → Operación. Se registran sobre la orden de pago y entran en Impuestos del mes.',
      'Órdenes de pago son la herramienta de al lado. Gastos fijos es el recurrente: no lo cargues dos veces como gasto suelto.',
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
      'Libre deuda: Contabilidad → Padrón. Emite el certificado del socio.',
      'Grupo familiar (saldos) está en Padrón. La ficha familiar se edita en Socios.',
    ],
    dont: 'No armes el grupo familiar desde Contabilidad.',
  },
  {
    id: 'descuentos',
    group: 'conta',
    title: 'Descuentos y bonificaciones',
    tab: 'accounting',
    focus: 'bonificaciones',
    keywords: 'descuento extra bonificacion categoria',
    who: 'Contador y superadmin.',
    steps: [
      'Contabilidad → Padrón. Descuentos extras: las reglas que se cargan (socio, categoría, grupo).',
      'Bonificaciones: a quién le bajan la cuota viva este mes.',
      'El descuento se aplica sobre la cuota antes del recargo: cobrar y liquidar ya lo toman.',
    ],
    dont: 'No edites una bonificación acá: la regla se carga en Descuentos extras.',
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
    keywords: 'mensajeria mensaje correo interno mail md whatsapp comunicado masivo ia',
    who: 'Personal del panel.',
    steps: [
      'Comunicación → Mensajería: tres salas, Mail, MD y WhatsApp.',
      'Mail: Bandeja de mail con Recibidos (lo que llega a socios@jockeyclubsj.com.ar, con el contador de sin leer; se puede responder) y Enviados (los comunicados que salieron de acá).',
      'MD: la bandeja interna, la que ve el socio en Mensajes del portal.',
      'WhatsApp: cobranza con plantilla, con el teléfono de la ficha.',
      'Para un comunicado, elegí a un socio o a todos y si va por mensaje interno, por mail o por los dos. La IA puede redactar el texto; revisalo antes de enviar.',
      'Los mensajes de pagos (comprobantes de transferencia, pedidos de débito, avisos de Mercado Pago) llegan a la bandeja de Operaciones.',
    ],
    dont: 'No mezcles el vencimiento de Cuotas con un comunicado. Un comunicado a todos llega a todo el padrón: releelo.',
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
    keywords: 'usuario usuarios permiso rol invitar perfil portal alta registro crear creo crea nuevo personal',
    who: 'Solo superadmin crea y edita perfiles y da roles. El administrador solo da o quita el rol Profesor, desde Profesores.',
    steps: [
      'Administración → Usuarios y altas.',
      'El socio entra con el correo de su ficha. Si pide clave, aparece acá.',
      'El alta pública del padrón está en /registro, con dos trámites: Quiero asociarme (solicitud de ingreso) y Ya soy socio (pedir usuario o recuperar la clave).',
      'Quiero asociarme: el interesado deja sus datos y recibe un mail de bienvenida. Cuando secretaría lo da de alta, le llega otro mail con usuario y contraseña. Si el documento, el celular o el nombre ya figuran en el padrón, el formulario lo avisa.',
      'Ya soy socio: busca su ficha por nombre. Si la ficha ya tiene usuario, el trámite que queda es recuperar la clave; si no, pedir el usuario. La clave nunca se da por esa pantalla.',
      'Las solicitudes se ven acá y en Inicio. Secretaría verifica la ficha, contacta al socio y, si el mail no sale, le pasa la contraseña por WhatsApp.',
    ],
    dont: 'No le armes un usuario de panel a un socio. Le corresponde el portal.',
  },
  {
    id: 'configuracion',
    group: 'sys',
    title: 'Configuración',
    tab: 'settings',
    keywords: 'configuracion sistema sede pileta zonda vencimiento cuit reglas tutores boleto mercado pago avisos mora cambiar cambio dia',
    who: 'Superadmin.',
    steps: [
      'Sistema → Configuración. Todo se guarda en el libro.',
      'Sede: nombre, domicilio, CUIT, teléfono, correo. Sale en el pie del portal.',
      'Cuotas: Vence el día (1 al 28; hoy el 10), tolerancia de pago, gracia de la credencial, deuda máxima, cuenta protegida y si los socios ven su cuenta corriente. AMET vence el 18 por regla de la categoría, no por este campo.',
      'Regla de avisos: queda guardada en el libro. Mensaje interno y mail el día 5 (por vencer), el 10 (vence) y el 11 (mora). Recargo del 10 % desde el 11 en familiar e individual.',
      'Pileta: canon socio e invitado, apto médico (días), invitados por socio, nombre de la temporada, si el socio carga el apto, y Mora desde el 10 bloquea el ingreso (en temporada, diciembre a marzo; vale para sede y pileta).',
      'Mercado Pago: Cobros habilitados prende o apaga el checkout, el QR y la adhesión de golpe. El token va en las secretas (MP_ACCESS_TOKEN) de la cuenta del club, no acá. Online = en Mi cuenta. En el lugar = QR dinámico en caja y pileta. Suscripción = débito mensual. Caja QR es el identificador de la caja en Mercado Pago.',
      'Reglas del club: tutores por grupo, recordatorio, portería autoriza pileta, titular en comunicaciones, boleto de pago (mostrar, nombre, recargos), avisos de pago con aprobación, débito familiar, teléfonos útiles, motivos y categorías de gasto. Todo editable.',
      'Zonda se declara al pie de esa misma pantalla.',
    ],
    dont: 'No inventes una clave nueva. Si no está acá, no se usa. No apagues Cobros habilitados con socios pagando: se cae el checkout de todos.',
  },
  {
    id: 'mercado-pago',
    group: 'sys',
    title: 'Mercado Pago',
    tab: 'settings',
    keywords: 'mercado pago mp qr checkout suscripcion debito automatico online token cobro webhook activar prender paga pagar pagos',
    who: 'Superadmin lo prende. Caja y pileta lo usan. El socio paga en Mi cuenta.',
    steps: [
      'Sistema → Configuración → Mercado Pago. Poné Cobros habilitados en Sí. El token va en las secretas de Supabase (MP_ACCESS_TOKEN), no en esta pantalla.',
      'Online: el socio entra a Mi cuenta y toca Pagar ahora. Se genera un código en la misma página para escanear o abrir Mercado Pago (botón Abrir pago). Se acredita cuando Mercado Pago confirma. El enlace de vuelta siempre es www.jockeyclubsj.com.ar/cuenta.',
      'En el lugar: en el cobro de caja y en la caja de pileta aparece Mercado Pago (QR). Cuando Mercado Pago aprueba, el cobro se imputa solo.',
      'Suscripción: Débito cada mes cobra la cuota del mes el día de vencimiento. La deuda anterior se paga aparte, con Pagar ahora. Solo cuenta como adherido el que Mercado Pago confirmó; “débito” escrito en la ficha no alcanza.',
      'Al aprobarse un pago, el socio recibe el boleto por mensaje y mail.',
      'Vitalicio, fundador y comisión no ven Mercado Pago de cuota ni pueden adherirse. Un adherente tampoco paga: lo hace el titular.',
    ],
    dont: 'No cobres dos veces: si el QR ya quedó aprobado, el cobro está imputado; no lo cargues a mano además.',
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
      'Inicio: credencial con QR, estado de la cuota, reservas próximas, invitados del día, mensajes sin leer y accesos rápidos. Reservar Canchas (/reservas), Mi Cuenta (/cuenta), Novedades (/revista), Perfil (/perfil) y Mensajes (/mensajes).',
      'Mi Cuenta (Estado contable) muestra la situación (al día o cuánto debe), el total abonado y el último pago. Si debe, ofrece Pagar ahora (Mercado Pago), Débito cada mes y Transferencia al club con comprobante adjunto (JPG, PNG o PDF). Si está al día, deja adelantar la cuota. Abajo está el historial con cada recibo para descargar.',
      'Si hay recargo, Mi Cuenta lo separa: cuota + recargo.',
      'Un exento (vitalicio, fundador, comisión) ve que no abona cuota y no tiene botones de pago. Un adherente ve su inicio, pero no paga ni reserva: lo hace el titular.',
      'Si la configuración lo apaga, el socio no ve su cuenta corriente y se le dice que consulte en administración.',
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

/** Siglas de dos letras que sí son una duda («el qr no lee», «MD»). */
const SHORT_TERMS = new Set(['qr', 'md', 'mp']);

const MANUAL_STOP = new Set([
  'como', 'para', 'esta', 'este', 'esto', 'aqui', 'alla', 'desde', 'hasta',
  'tiene', 'solo', 'todo', 'toda', 'cada', 'otra', 'otro', 'unas', 'unos',
  'donde', 'abrir', 'usar', 'paso', 'pasa', 'hace', 'hago', 'tengo', 'esa',
  'ese', 'las', 'los', 'del', 'una', 'por', 'con', 'que', 'app', 'uso',
  'cuando', 'cuanto', 'cuantos', 'cuanta', 'cuantas', 'quien', 'quienes', 'cual', 'cuales',
  'puede', 'pueden', 'puedo', 'sirve', 'hacer', 'sobre', 'entre', 'tambien', 'ahora',
  'dice', 'dicen', 'alguien', 'algun', 'alguna', 'sin', 'mas', 'hay', 'muy', 'son',
  'soy', 'fue', 'era', 'les', 'mis', 'tus', 'sus', 'nos', 'uno', 'eso', 'vez', 'sea', 'ser',
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
  // Una palabra corta («por», «del», «con») no puede ser prefijo de la pregunta: «por» no es «portal».
  if (word === token || word.startsWith(token) || (word.length >= 4 && token.startsWith(word))) return true;
  const stem = token.slice(0, 4);
  return stem.length >= 4 && word.startsWith(stem);
}

function wordsHit(token, words) {
  return words.some((word) => tokenMatchesWord(token, word));
}

let lessonIndexCache = null;

function lessonIndex() {
  if (!lessonIndexCache) {
    lessonIndexCache = APP_MANUAL.map((lesson) => ({
      lesson,
      title: wordsOf(lesson.title),
      keywords: wordsOf(lesson.keywords),
      body: wordsOf(`${lesson.who} ${lesson.steps.join(' ')} ${lesson.dont}`),
    }));
  }
  return lessonIndexCache;
}

export function lessonTeach(lesson) {
  if (!lesson) return '';
  const first = lesson.steps?.[0] || '';
  return [first, lesson.dont].filter(Boolean).join(' ');
}

export function matchManualLessons(query = '') {
  const tokens = wordsOf(query).filter((token) => (token.length >= 3 || SHORT_TERMS.has(token)) && !MANUAL_STOP.has(token));
  if (!tokens.length) return [];
  const index = lessonIndex();
  // Una palabra que está en casi todas las lecciones («socio») dice poco; una rara («recargo», «comunicado») dice mucho.
  const weight = new Map(tokens.map((token) => {
    const df = index.filter((row) => wordsHit(token, row.title) || wordsHit(token, row.keywords) || wordsHit(token, row.body)).length;
    return [token, Math.log(1 + index.length / (1 + df))];
  }));
  return index
    .map((row) => {
      // El título pesa más que las palabras clave, y estas más que el cuerpo: «cómo hago un asiento» va a Crear asiento.
      const hits = tokens.reduce((sum, token) => sum + weight.get(token) * (
        (wordsHit(token, row.title) ? 4 : 0)
        + (wordsHit(token, row.keywords) ? 3 : 0)
        + (wordsHit(token, row.body) ? 1 : 0)
      ), 0);
      return { ...row.lesson, hits };
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
    text: `${top.who}\n${top.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    figures: [],
    next: top.dont,
    go: top.tab,
    focus: top.focus || null,
    room: 'manual',
  };
}

function lessonForPrompt(lesson) {
  const where = lesson.focus
    ? `${lesson.title} (${lesson.tab} → ${lesson.focus})`
    : lesson.title;
  return `- ${where} [quién: ${lesson.who}]: ${lesson.steps.join(' ')} ${lesson.dont}`;
}

export function manualForPrompt() {
  return APP_MANUAL.map(lessonForPrompt).join('\n');
}

/** Lecciones que siempre viajan: las reglas de las que cuelga casi cualquier duda. */
const CORE_LESSON_IDS = ['reglas-cuota', 'roles'];

/**
 * El manual que ve Gemini para una pregunta: las lecciones que corresponden, completas,
 * más las reglas fijas, y un índice de títulos del resto para que sepa adónde mandar.
 * Entra en `limit` caracteres, así que nunca se corta a la mitad de una lección.
 */
export function manualPromptFor(query = '', { limit = 9000, top = 4 } = {}) {
  const matches = matchManualLessons(query).slice(0, top);
  const core = CORE_LESSON_IDS.map((id) => APP_MANUAL.find((lesson) => lesson.id === id));
  // Prioridad: las dos que mejor calzan, las reglas fijas (cuota y roles) y recién después el resto.
  const wanted = [];
  const seen = new Set();
  [...matches.slice(0, 2), ...core, ...matches.slice(2)].forEach((lesson) => {
    if (lesson && !seen.has(lesson.id)) {
      seen.add(lesson.id);
      wanted.push(lesson);
    }
  });

  const indexOf = (included) => {
    const rest = APP_MANUAL.filter((lesson) => !included.has(lesson.id)).map((lesson) => lesson.title);
    return rest.length
      ? `\nTAMBIÉN EN EL MANUAL (solo el título; para el detalle, mandá a esa sección): ${rest.join(' · ')}`
      : '';
  };
  // El índice es corto (solo títulos): se reserva su lugar primero y lo que sobra es para las lecciones.
  const budget = Math.max(0, limit - indexOf(new Set()).length);
  const included = new Set();
  const lines = [];
  let used = 0;
  for (const lesson of wanted) {
    const line = lessonForPrompt(lesson);
    if (used + line.length + 1 > budget) continue;
    lines.push(line);
    included.add(lesson.id);
    used += line.length + 1;
  }
  return `${lines.join('\n')}${indexOf(included)}`.slice(0, limit);
}