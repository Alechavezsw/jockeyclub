/**
 * Contenido del Manual de Administración y Pileta (PDF).
 * Lo dibuja scripts/generate-admin-manual.mjs con la misma clase que el manual general.
 *
 * Para quién: Empleado/a de administración (admin_employee) y Operario/a de pileta
 * (pool_operator). Los dos ven las mismas pestañas del panel (roles.js, FRONT_DESK_TABS).
 *
 * Reglas de redacción:
 * - El PDF usa Helvetica estándar: nada de flechas ni símbolos fuera de Latin-1.
 *   Los caminos de menú se escriben con " > ".
 * - Cada dato sale del código del portal (pantallas, botones y reglas). Si cambia una
 *   pantalla, se cambia acá.
 */

export const CHAPTER_COUNT = 18;

export const ADMIN_MANUAL_TEXTS = {
  chromeRight: 'Manual de Administración y Pileta',
  coverTitle: 'Administración y Pileta',
  coverSubtitle: 'Manual paso a paso del mostrador del club',
  coverBlurb: 'Cómo trabajan el Empleado de administración y el Operario de pileta: buscar y cobrar a un socio, dar altas y bajas, atender solicitudes, reservas, la puerta y la caja de la pileta. Cada tarea, en el orden en que se hace.',
  coverEdition: 'Versión 1.1',
  coverNote: 'Uso interno del club  ·  No compartir claves',
  tocIntro: 'Los dos puestos ven lo mismo en el panel. Si trabajás en la pileta, empezá por el capítulo 13; si trabajás en administración, por el 3. El capítulo 16 dice qué cosas NO se pueden hacer con este perfil y a quién pedirlas.',
};

export function buildBody(m) {
  m.doc.addPage();
  m.drawChrome();
  m.y = 22;

  /* ------------------------------------------------------------------ 1 */
  m.h1('1.  Antes de empezar', { n: '01' });
  m.p('Este manual es para dos puestos del club que ven exactamente lo mismo en el sistema: el Empleado o Empleada de administración y el Operario u Operaria de pileta. Los dos entran al panel del personal y tienen las mismas 13 secciones. Lo único que cambia es por dónde arrancan el día.');
  m.table(
    ['Puesto', 'Al entrar abre en…', 'Para qué se lo usa sobre todo'],
    [
      ['Empleado/a de administración', 'Inicio (Panel de administración)', 'Padrón, cobro de cuotas, altas y bajas, reservas, atención al socio'],
      ['Operario/a de pileta', 'Entrada pileta (la puerta de la pileta)', 'Controlar el ingreso, cobrar el canon, invitados y apto médico'],
    ],
    [50, 56, 72]
  );
  m.p('Cualquiera de los dos puede ir a cualquier sección de la lista de abajo. El operario de pileta vuelve al resto del panel con el botón Panel, que está arriba a la derecha de la puerta y de la caja de la pileta.');
  m.h2('Qué secciones ves');
  m.table(
    ['Grupo del menú', 'Secciones', 'Capítulo'],
    [
      ['Inicio', 'Tablero del día: vencimiento, accesos rápidos, agenda, alertas', '3'],
      ['IA', 'Jev, el asistente que contesta dudas y lleva a la pantalla', '2'],
      ['Operación', 'Socios, Saldos, Reservas, Entrada pileta, Pileta', '4 al 14'],
      ['Club', 'Fiestas', '15'],
      ['Comunicación', 'Novedades, Encuestas, Alertas, Reclamos, Mensajería', '15'],
      ['Administración', 'Profesores (solo para mirar)', '15'],
    ],
    [40, 110, 28]
  );
  m.box('tip', 'Si una pantalla no aparece', 'No está rota: tu perfil no la abre. Ingresos, Acceso QR, Disciplinas, Personal, Contabilidad, Reportes, Concesiones, Usuarios y altas, Configuración y Migración no son de este perfil. El capítulo 16 los lista con el motivo.');

  /* ------------------------------------------------------------------ 2 */
  m.h1('2.  Entrar y moverse por el panel', { n: '02' });
  m.h2('Ingresar');
  m.steps([
    'Abrí el portal del club (www.jockeyclubsj.com.ar) en Chrome o Safari.',
    'Escribí tu correo y tu contraseña. Es tu usuario personal: no se presta ni se anota en un papel pegado en el escritorio.',
    'Tocá Ingresar al portal.',
    'Si además sos socio o socia del club, el sistema te pide elegir la puerta: Portal de socio o Administración. Para trabajar elegí Administración.',
  ]);
  m.h2('Moverte');
  m.bullets([
    'El menú de la izquierda se agrupa en Operación, Club, Comunicación y Administración. Solo muestra lo que tu perfil abre.',
    'El buscador de arriba (Ctrl + /) lleva directo a una sección o a un socio: escribí “pileta”, “reservas” o el apellido.',
    'Inicio muestra el día. Al tocar el nombre de una sección en un acceso rápido, vas directo.',
    'Las pantallas Entrada pileta y Pileta son páginas propias, sin menú. Para volver al panel usá el botón Panel de arriba.',
  ]);
  m.h2('Jev, el asistente');
  m.p('En el menú IA está Jev. Le podés escribir el número de socio, su DNI o su nombre y apellido y te explica el caso con las mismas reglas que usan la caja y la puerta: categoría, titular o adherente, mora, si entra hoy y si puede pagar pileta. También sirve para saber cómo se hace una tarea. Jev solo lee: no cobra ni cambia nada.');
  m.h2('Salir');
  m.p('Usá siempre el botón Salir al terminar el turno, sobre todo en computadoras compartidas (mostrador, puerta de pileta). Quien se siente después vería el padrón con tu usuario.');
  m.box('warn', 'El padrón es sensible', 'Ves DNI, domicilios, teléfonos y saldos de miles de socios. No los fotografíes, no los mandes por WhatsApp y no los exportes a tu celular. Los PDF y Excel del padrón son para uso interno del club.');

  /* ------------------------------------------------------------------ 3 */
  m.h1('3.  Abrir el día', { n: '03' });
  m.p('Una rutina corta al llegar evita la mayoría de los problemas del resto del turno.');
  m.steps([
    'Entrá a Inicio. Arriba está el título Panel de administración con tu nombre y la fecha.',
    'Mirá la franja del vencimiento. La cuota social vence el 10 de cada mes y la categoría AMET, el 18. La franja dice cuántos días faltan o cuántos pasaron.',
    'Revisá los accesos rápidos. Muestran lo que hoy tiene algo para atender (por ejemplo Reclamos con pendientes, o Puerta pileta).',
    'Leé Agenda del día: las reservas de hoy y de la semana. Un clic te lleva a Reservas.',
    'Mirá el cuadro Alertas. Si hay una alerta viva (por ejemplo viento Zonda), avisá a quien corresponda.',
    'Abrí Socios y mirá la sección Solicitudes: si tiene un número, hay pedidos de alta o de acceso esperando (capítulo 8).',
    'Si trabajás con la pileta, abrí la caja del día antes de cobrar el primer canon (capítulo 14). Es lo primero que se hace en la pileta cada mañana.',
  ]);
  m.box('tip', 'Zonda', 'Con alerta Zonda declarada se suspenden las actividades al aire libre; lo cubierto sigue. Si un socio pregunta por qué no puede reservar una cancha exterior, mirá las alertas antes de buscar otra causa.');

  /* ------------------------------------------------------------------ 4 */
  m.h1('4.  Buscar a un socio y leer su ficha', { n: '04' });
  m.p('Casi todo empieza buscando a la persona. El padrón se abre en Operación > Socios.');
  m.steps([
    'En Socios, escribí en “Buscar en el padrón” un nombre, un Nº de socio, un DNI, un email o un teléfono. Mientras escribís, la lista se filtra y arriba dice cuántos socios y familias encontró.',
    'Si hace falta, filtrá por categoría con el desplegable “Todas las categorías”.',
    'Las tarjetas de arriba son atajos: Titulares, Grupo familiar, Altas y Bajas filtran la lista; Inactivos te lleva a la lista de socios inactivos.',
    'Para abrir la ficha completa tocá el lápiz (Editar ficha) de la fila.',
    'Los tres puntos (más acciones) abren un menú con Credenciales, Tarjeta, Cobrar, Suspender o Activar, y Eliminar (que es dar de baja).',
  ]);
  m.p('El padrón carga de a poco porque son miles de fichas. Mientras carga, podés buscar igual; si alguien no aparece, esperá a que termine.');
  m.h2('La ficha');
  m.p('La cabecera de la ficha dice el estado de la cuenta y si el socio puede pagar pileta. Los estados son:');
  m.table(
    ['Estado', 'Significa'],
    [
      ['Cuenta habilitada', 'Puede ingresar y usar las instalaciones'],
      ['Pendiente de aprobación', 'El alta está en revisión de Secretaría'],
      ['Cuenta suspendida', 'Acceso restringido hasta regularizar'],
      ['Baja del padrón', 'Registro inactivo, con motivo auditado'],
    ],
    [56, 122]
  );
  m.p('Debajo hay secciones para moverse: Ficha, Editar, Tarjeta, Invitados, Documentos, Grupo familiar, Movimientos, Entradas, Asistencia, Reclamos, Mensajes y Trazabilidad. Movimientos muestra cada cobro con su Cuota y su Recargo. Trazabilidad guarda quién cambió qué y con qué motivo.');
  m.box('ok', 'No borres lo que no ves', 'La lista del padrón es liviana a propósito: no muestra domicilio ni datos médicos. Están en la ficha. Si no ves un dato en la lista, no está perdido.');

  /* ------------------------------------------------------------------ 5 */
  m.h1('5.  Cobrar una cuota', { n: '05' });
  m.steps([
    'Buscá al socio (capítulo 4) y abrí su ficha. Si tiene saldo, aparece el botón Cobrar. También se cobra desde el menú de los tres puntos de la fila, opción Cobrar, que solo aparece si el socio debe y no es exento.',
    'Se abre la ventana “Cobrar cuota”. Muestra tres recuadros: Cuota, Recargo y Total. El recargo aparece solo si la cuota venció y la categoría lo lleva.',
    'Elegí el medio de pago: Efectivo, Transferencia o Mercado Pago.',
    'Efectivo: confirmá con “Acreditar efectivo”. Queda registrado en Caja General.',
    'Transferencia: elegí el Banco del club (la ventana muestra titular, CBU y alias), adjuntá el Comprobante (foto o PDF; es obligatorio) y tocá “Registrar con comprobante”.',
    'Mercado Pago: tocá “Cobrar $… con QR”. Aparece el QR de mostrador (y un botón “Abrir pago”). El socio paga desde su teléfono y el cobro se acredita solo cuando Mercado Pago lo aprueba; después dice “Pago acreditado”. No hay botón para confirmar a mano.',
    'Al terminar, el saldo de la ficha se actualiza y el socio recibe el recibo en PDF por mensaje interno.',
  ]);
  m.h2('Casos especiales');
  m.bullets([
    'Adherente: la cuenta es del titular. Si abrís la ficha de un adherente y cobrás, la ventana avisa “El pago de [nombre] entra en la cuenta del titular”. Si el titular no está en el padrón, el sistema no deja cobrar.',
    'Vitalicio, fundador y comisión no abonan cuota. El sistema no deja cobrarles (“Esta categoría no abona cuota social”) y no ofrece Mercado Pago.',
    'AMET vence el 18 y no lleva recargo. Su cuota ya viene con 2,5 % menos: es tarifa, no un descuento que tengas que aplicar.',
    'Recargo: es el 10 % de la cuota desde el día siguiente al vencimiento, solo en socio familiar e individual. Un pago cubre el mes en que se hizo.',
  ]);
  m.box('warn', 'Lo que este perfil no hace al cobrar', 'No ves la casilla “Perdonar recargo” (la usan Tesorería, el contador y el superadministrador) y no ves el botón Anular en Movimientos. Si un cobro salió mal o el socio pide que se le perdone el recargo, anotá número de socio, importe, medio y motivo, y pasalo a Tesorería. No lo arregles cargando otro cobro: queda duplicado.');
  m.box('tip', 'No re-liquides', 'Para cobrarle a un solo socio se cobra desde su ficha. La liquidación del mes es de contador y superadministrador.');

  /* ------------------------------------------------------------------ 6 */
  m.h1('6.  Registrar una transferencia que avisó el socio', { n: '06' });
  m.p('Un socio puede pagar por transferencia desde su cuenta y avisar adjuntando el comprobante. Ese aviso llega a la bandeja de administración. El aviso solo avisa: no cobra ni cambia el saldo.');
  m.steps([
    'Entrá a Comunicación > Mensajería y abrí la sala MD. Ahí están los mensajes internos hacia administración, con el comprobante adjunto.',
    'Abrí el aviso y anotá el número de socio y el importe.',
    'Verificá en el banco que la plata esté acreditada. Si todavía no está, no cobres.',
    'Abrí la ficha del socio y tocá Cobrar. Elegí Transferencia, el banco del club donde entró la plata y adjuntá el comprobante.',
    'Tocá “Registrar con comprobante”. El saldo se actualiza, queda el ingreso en caja y el recibo le llega al socio.',
    'Si el socio no es el titular, el cobro entra en la cuenta del titular.',
  ]);
  m.box('warn', 'Primero el banco', 'No cobres solo porque llegó el aviso. El comprobante puede estar mal, ser de otro día o de otro socio. La plata tiene que estar en la cuenta del club.');

  /* ------------------------------------------------------------------ 7 */
  m.h1('7.  Alta de un socio nuevo y de su grupo familiar', { n: '07' });
  m.p('El alta de un socio titular se hace en Operación > Socios con el botón verde “Registrar Socio”. Antes de empezar, buscá por DNI y por apellido: si la persona ya figura, no la cargues otra vez.');
  m.steps([
    'Tocá “Registrar Socio”. Se abre el formulario “Alta de socio titular”. Los campos con asterisco son obligatorios.',
    '1. Datos personales: Nombre completo (obligatorio), tipo y número de documento, fecha de nacimiento, género, estado civil y nacionalidad. Podés subir la foto de la credencial.',
    '2. Contacto y domicilio: Celular WhatsApp (obligatorio), email, teléfono alternativo, domicilio, localidad, provincia y código postal.',
    '3. Datos de emergencia: grupo sanguíneo, obra social, contacto, número y clínica de emergencia.',
    '4. Membresía y disciplinas: Categoría club (obligatoria), estado, fecha de ingreso, hora y próximo vencimiento de cuota. Marcá al menos una disciplina: es requisito del alta.',
    '5. Facturación y cobranza: razón social, CUIT o CUIL, condición de IVA y medio de pago habitual, si hace falta.',
    '6. Grupo familiar: los adherentes son opcionales y se pueden sumar después. Cada uno lleva nombre completo (obligatorio), vínculo, DNI, nacimiento, categoría y al menos una disciplina.',
    '7. Observaciones: notas internas de secretaría.',
    'Tocá “Registrar socio” (o “Registrar socio + N familiares” si cargaste adherentes). “Cancelar” descarta el formulario.',
  ]);
  m.h2('Sumar un adherente después');
  m.steps([
    'Buscá al titular en Socios y abrí su grupo familiar (la fila se expande).',
    'Tocá “Agregar Adherente”.',
    'Completá Nombre completo, Parentesco, Categoría y Disciplinas (al menos una), y la foto si la tenés. Tocá “Cargar”: el botón se activa recién cuando hay nombre y al menos una disciplina.',
  ]);
  m.box('tip', 'Titular y adherente', 'El titular lleva la cuenta del grupo: paga la cuota y hace las reservas. El adherente tiene credencial pero no paga ni reserva por su cuenta. La mora del titular alcanza a todo el grupo.');

  /* ------------------------------------------------------------------ 8 */
  m.h1('8.  Solicitudes que llegan por internet', { n: '08' });
  m.p('Las personas que usan la pantalla pública de registro dejan pedidos que se atienden desde Socios, en la sección plegable “Solicitudes” (muestra la cantidad pendiente y los pedidos de los últimos 7 días). Arriba a la derecha de esa sección hay un “Link público” y una “Placa” con el QR para pegar en el club.');
  m.p('La sección tiene tres solapas: Acceso al portal, Quiero asociarme y Listos (los trámites ya resueltos).');
  m.h2('Acceso al portal');
  m.p('Es un socio que dijo “Ya soy socio y no tengo usuario / olvidé la contraseña”. La fila muestra la ficha que encontró el sistema (“ficha [nombre]” o “sin ficha automática”).');
  m.steps([
    'Verificá que la persona es quien dice ser: compará nombre, DNI y celular de la solicitud con la ficha. Si algo no coincide, no le des acceso.',
    'Tocá “Entregar acceso”. El sistema crea el acceso y manda el mail al socio.',
    'La ventana muestra el Usuario, el Email de ingreso, la Contraseña y el link del portal, con el aviso “Anotá la contraseña: solo se muestra ahora”. Pasásela al socio antes de cerrar la ventana.',
    'Si el mail no salió, la misma ventana ofrece “Enviar por WhatsApp” (solo si la ficha tiene celular válido) y “Abrir mail”. “Descargar PDF” guarda el comprobante de la entrega.',
    '“Credenciales” (solo si hay ficha vinculada) abre el generador de usuario y contraseña del capítulo 10 para entregarlos a mano.',
    '“Ya contactado” cierra el pedido si ya lo resolviste por otro camino.',
    '“Rechazar” pide una nota (por ejemplo “datos no coinciden”) y se confirma con Confirmar.',
  ]);
  m.h2('Quiero asociarme');
  m.steps([
    'Tocá el nombre para ver el detalle de la solicitud: documento, celular, categoría que pidió y fecha. Si la persona ya figura en el padrón, la fila lo aclara (“Ya es socio: [nombre] Nº …”).',
    '“Dar de alta y enviar usuario” da de alta, genera el acceso y lo manda por mail, igual que en Acceso al portal. Si ya hay ficha, el botón dice “Actualizar ficha y enviar acceso”.',
    '“Dar de alta” abre el formulario del capítulo 7 con los datos ya cargados, para que los revises antes de guardar. En el detalle, “Completar ficha a mano” hace lo mismo.',
    '“Rechazar” pide el “Motivo del rechazo” y se confirma con Confirmar.',
    'En el detalle también podés “Descargar PDF” de la solicitud.',
  ]);
  m.box('warn', 'Nunca por la pantalla pública', 'El sistema jamás entrega una clave por la pantalla pública: el acceso lo entrega el personal. Si el mail no sale (la ventana avisa “Sin email de contacto”), pasá la clave por WhatsApp solo al celular que figura en la ficha, y nunca la dictes en voz alta en el mostrador.');

  /* ------------------------------------------------------------------ 9 */
  m.h1('9.  Suspender, reactivar y dar de baja', { n: '09' });
  m.p('Estas tres acciones piden siempre un motivo y quedan registradas en la ficha (Trazabilidad) y en la auditoría del sistema. Se usan desde el menú de los tres puntos de la fila.');
  m.table(
    ['Acción', 'Botón', 'Motivos que ofrece'],
    [
      ['Suspender', 'Suspender', 'Mora o deuda de cuotas · Conducta o reglamento · Documentación incompleta · Pedido del socio · Otro motivo'],
      ['Reactivar', 'Activar', 'Regularizó situación · Revisión administrativa · Alta o suspensión por error · Otro motivo'],
      ['Dar de baja', 'Eliminar', 'Renuncia o baja voluntaria · Fallecimiento · Mora irrecuperable · Registro duplicado · Corrección o migración de padrón · Otro motivo'],
    ],
    [30, 28, 120]
  );
  m.steps([
    'Buscá al socio y abrí el menú de los tres puntos de su fila.',
    'Elegí Suspender (o Activar si ya está suspendido) o Eliminar.',
    'Elegí el Motivo en el desplegable. El detalle es obligatorio en la baja y cuando el motivo es “Otro motivo”.',
    'Confirmá con “Confirmar suspensión”, “Confirmar reactivación” o “Confirmar baja”.',
  ]);
  m.h2('Qué pasa después');
  m.bullets([
    'Suspendido: no ingresa a la sede y su cuota queda en pausa.',
    'Baja: rige el día 1.º del mes. Si la presentás otro día, queda para el 1.º del mes siguiente. Hasta esa fecha el socio sigue activo y se le cobra el mes: el sistema lo avisa con “Baja el [fecha]… Hasta entonces se cobra el mes”.',
    'Un adherente se suspende o se habilita desde el desglose del grupo familiar, en la fila de su titular.',
  ]);
  m.box('warn', 'Mora no es suspensión', 'Un socio en mora no queda suspendido solo. Suspender es una decisión tuya, con motivo. No des de baja un registro duplicado sin comparar antes cuál es la ficha buena: la baja queda auditada.');

  /* ----------------------------------------------------------------- 10 */
  m.h1('10.  Tarjeta virtual y usuario del portal', { n: '10' });
  m.h2('Ver la tarjeta virtual');
  m.p('En la fila del socio, menú de los tres puntos > Tarjeta. Muestra la credencial digital con nombre, número de socio y el código QR firmado. En la ficha, la solapa Tarjeta muestra lo mismo. Si un socio no puede abrir su celular, podés mostrarla desde acá.');
  m.h2('Generar usuario y contraseña del portal');
  m.steps([
    'Menú de los tres puntos > Credenciales.',
    'Tocá “Generar acceso”. La ventana muestra el Email (que es el usuario) y la Contraseña. Con los botones de al lado podés copiar, mostrar u ocultar la clave y regenerarla.',
    'Entregá el acceso con “Enviar por email” o, si la ficha tiene celular, con el botón de WhatsApp.',
  ]);
  m.box('warn', 'Datos del socio', 'El socio entra con el correo de su ficha. Si ese mail está mal, corregilo antes en Editar. Nunca crees un usuario con el correo de otra persona ni uses tu propio usuario para “probar” una cuenta.');

  /* ----------------------------------------------------------------- 11 */
  m.h1('11.  Saldos (consulta)', { n: '11' });
  m.p('Operación > Saldos es la vista de las cuentas corrientes de los socios. En este perfil es de consulta: se mira y se busca; no se importa ni se liquida. Para cobrar se usa la ficha del socio (capítulo 5).');
  m.h2('Qué podés consultar');
  m.table(
    ['Vista', 'Qué muestra'],
    [
      ['Saldos', 'La cuenta de cada socio'],
      ['CC detalladas', 'Cargos y pagos de la cuenta corriente'],
      ['Créditos comprados', 'Compras a crédito de los socios'],
      ['Deudas mes a mes', 'El saldo por mes'],
      ['Cuentas contables', 'Lo pendiente por categoría de cuota'],
    ],
    [50, 128]
  );
  m.h2('Buscar un saldo');
  m.steps([
    'Entrá a Operación > Saldos. En “Buscar por” completá lo que sepas: Nombre del socio, Apellido, DNI, Número de socio o Identificador de grupo familiar.',
    'Si hace falta, elegí el Estado (Habilitado o Deshabilitado) y la Categoría de cuota.',
    'Tocá Buscar y abrí al socio de la lista para ver el detalle.',
  ]);
  m.box('warn', 'Corte LILA no es el saldo de hoy', 'Muchas cifras de esta pantalla vienen de los cortes de LILA y llevan la leyenda “Corte LILA” con su fecha. Son fotos de un día anterior al 1 de octubre de 2026. El saldo vivo del socio es el que figura en su ficha. Si un número no coincide con lo que dice la ficha, prevalece la ficha.');
  m.p('Importar cobranzas, imputar eventos, el Control de mora y la liquidación del mes no aparecen para este perfil: son de caja, contador y superadministrador.');

  /* ----------------------------------------------------------------- 12 */
  m.h1('12.  Reservas', { n: '12' });
  m.p('Operación > Reservas es el “Libro de Reservas” del club. A diferencia del socio, que solo ve si un turno está libre u ocupado, acá ves quién reservó, cuánto y en qué estado está.');
  m.steps([
    'Elegí el día en el calendario del mes. Con las flechas pasás de mes y con “Hoy” volvés a la fecha actual.',
    'La tabla lista las reservas de ese día con Socio, Instalación, Fecha, Horario, Importe y Estado.',
    'Los estados son Confirmada, Pendiente y Cancelada.',
    'En la columna Gestión: “Aprobar” confirma una reserva pendiente, “Anular” cancela una que no está cancelada y “Reactivar” vuelve a confirmar una cancelada.',
  ]);
  m.h2('Reglas que el socio puede chocar');
  m.bullets([
    '“Las reservas las hace el titular de la cuenta”: es un adherente. Que reserve el titular.',
    '“Ese turno ya está reservado” o “ya empezó”: elegir otro horario.',
    'Cada espacio fija hasta cuántos días antes se reserva, las horas mínimas de anticipación, el máximo de invitados y qué categorías pueden. Si un socio no puede reservar, la causa suele estar en la regla del espacio.',
    'Con Zonda declarado se suspende lo que está al aire libre.',
  ]);
  m.box('tip', 'No fuerces una reserva', 'No cargues una reserva a mano para saltarte una regla. Si la regla del espacio está mal, avisá a quien administra el espacio. Y una fiesta o una cena del club no va acá: es un evento con inscripción (capítulo 15).');

  /* ----------------------------------------------------------------- 13 */
  m.h1('13.  Pileta: la puerta (Entrada pileta)', { n: '13' });
  m.p('Entrada pileta es la pantalla de la puerta. No es el molinete de la sede. Tiene un buscador grande y devuelve un cartel claro: puede entrar o no, y por qué. Se abre desde Operación > Entrada pileta (o directamente en /entrada-pileta). Arriba dice cuántos socios asistieron hoy.');
  m.h2('Cada ingreso, paso a paso');
  m.steps([
    'Escribí en “Buscar socio” el nombre, el DNI o el número. No hace falta esperar a que cargue todo el padrón.',
    'En la lista cada socio trae etiquetas: “Canon pago” o “Canon impago”, “Apto médico” o “Sin apto”, “Cuota al día” o “Debe $…”, y “En mora · no paga pileta” si corresponde. Tocá al socio.',
    'Mirá el cartel grande. Hay tres: PUEDE INGRESAR (canon pago y apto médico vigente), ASISTIÓ (ya quedó anotado hoy) y NO INGRESA, que trae debajo el primer motivo.',
    'Abajo se ve el resumen: Cuenta, Cuota social, Canon pileta, Apto médico, Hoy en pileta e Invitados hoy.',
    'Ojo: un socio que todavía no pagó el canon ve NO INGRESA con el motivo “No pagó el canon de pileta”. No es un rechazo, es que falta cobrar. Si no hay otro obstáculo, debajo aparecen los medios de pago.',
    'Elegí Efectivo o Mercado Pago. En efectivo tocá “Cobrar canon e ingresar” con el importe del día. Con Mercado Pago tocá “Cobrar $… con QR”: el socio paga con el QR y el ingreso se anota cuando se aprueba.',
    'Cuando el cobro entra, el cartel pasa a ASISTIÓ y dice “Anotado en ingresos de hoy”.',
    'Tocá Cerrar (o la tecla Esc) para limpiar la búsqueda y atender al siguiente.',
  ]);
  m.h2('Cuándo NO ingresa');
  m.table(
    ['Cartel o motivo', 'Qué hacer'],
    [
      ['El socio está de baja o suspendido', 'No ingresa. Que lo resuelva Secretaría'],
      ['La cuenta del socio no está habilitada', 'No ingresa. Derivalo a Administración'],
      ['Sin apto médico o vencido', 'Se carga el apto (capítulo 14). Sin apto no se habilita'],
      ['En mora · no abonó la cuota del mes', 'No ingresa ni paga pileta hasta regularizar la cuota. Que pase por Administración o pague en Mi Cuenta'],
      ['Ya ingresó', 'No se cobra dos veces. Aparece “Anotado en ingresos de hoy”'],
    ],
    [78, 100]
  );
  m.p('Importante: estar en mora impide pagar pileta en cualquier época del año. Además, en temporada de pileta (de diciembre a marzo), desde el día 10, quien no pagó la cuota del mes tampoco ingresa al club. En un grupo familiar vale la mora del titular.');
  m.box('warn', 'Antes del primer cobro', 'Para cobrar el canon en efectivo tiene que estar abierta la caja del día. Si está cerrada, la puerta lo avisa arriba (“La caja del día está cerrada”) con un botón “Ir a Pileta”, y “Cobrar canon e ingresar” queda desactivado. Abrí la caja en la pantalla Pileta (capítulo 14).');
  m.box('tip', 'El botón Asistió', 'Anota que el socio estuvo hoy sin cobrar canon: queda como “Asistió” en Ingresos de hoy, con importe cero. No sirve para cobrar. Usalo solo cuando tu responsable lo indique y no lo uses para saltar un NO INGRESA.');

  /* ----------------------------------------------------------------- 14 */
  m.h1('14.  Pileta: la caja del día, el apto y los invitados', { n: '14' });
  m.p('Operación > Pileta (/pileta) es la caja de la pileta: el canon cobrado, los ingresos del día, el apto médico y los invitados. Arriba dice “Sede Rivadavia · Canon, apto médico y socios” y muestra tres números: Socios hoy, Invitados y Canon cobrado.');
  m.h2('1. Abrir la caja del día');
  m.steps([
    'Entrá a Pileta y tocá “Abrir caja del día”, arriba. La caja se abre una sola vez por día.',
    'Al entrar, la pantalla le pregunta a la base si ya hay una caja abierta. Si la abrió otra persona, el botón ya dice “Caja del día abierta” y no hace falta tocar nada. Si dos personas la abren a la vez, el sistema responde “La caja del día ya estaba abierta”: es normal, seguí trabajando.',
    'Sin caja abierta no se puede habilitar a nadie ni cobrar canon. La caja de pileta es distinta de la de Tesorería: no las mezcles.',
  ]);
  m.h2('2. Habilitar a un socio');
  m.steps([
    'En “Apellido, nombre, DNI o Nº de socio…” buscá al socio. Las etiquetas de la lista (“Hoy”, “Mora”) te adelantan el estado. Tocá al socio.',
    'Se abre su ficha con cuatro controles: Estado del socio, Cuota social, Canon pileta de hoy y Revisación médica.',
    'Si el socio está en mora aparece “En mora. No puede pagar pileta hasta regularizar la cuota social” y no se ofrece el cobro.',
    'Si no hay obstáculos, elegí Efectivo o Mercado Pago.',
    'Efectivo: tocá “Habilitar” con el importe del día. Queda el asiento en Caja General y el ingreso a tu nombre. Mercado Pago: tocá “Cobrar $… con QR”; el socio paga con el QR y, cuando Mercado Pago confirma, entra el canon y el ingreso.',
  ]);
  m.h2('3. Apto médico');
  m.steps([
    'En el control “Revisación médica” se ve si está vigente y cuándo vence. La validez la fija la Configuración del club (hoy 365 días).',
    'Si falta o está vencido, tocá “Subir revisación”, elegí la foto o el PDF del certificado y esperá a que se cargue. El control pasa a verde y ya se puede habilitar.',
  ]);
  m.h2('4. Invitados del socio');
  m.p('Después de habilitar al socio aparece “Invitados del socio”, con el tope por día y lo que cuesta cada uno (hoy hasta 3 por día).');
  m.steps([
    'Escribí el “Nombre del invitado” (apellido y nombre).',
    'Elegí Efectivo o Mercado Pago.',
    'Tocá “Sumar invitado” con el importe. Si llegaste al tope, el botón se desactiva.',
  ]);
  m.h2('5. Corregir un error');
  m.p('A la derecha, “Ingresos de hoy” lista a todos los que entraron, con el importe y el medio. Si cargaste a alguien por error, usá el botón Revocar de esa fila. Queda como “revocado” en el historial.');
  m.box('warn', 'No inventes el pase', 'Si falta el apto y tu responsable no te autorizó a pasar sin él, no se habilita. Y si el socio paga con Mercado Pago y el QR ya quedó aprobado, el cobro está registrado: no lo cargues también a mano.');
  m.box('ok', 'Lo mismo en las dos pantallas', 'Entrada pileta y Pileta usan las mismas reglas. La puerta es más rápida para el ingreso; la caja es la que tiene el apto, los invitados y las revocaciones.');

  /* ----------------------------------------------------------------- 15 */
  m.h1('15.  Atención al socio: reclamos, mensajes, novedades, encuestas, alertas y fiestas', { n: '15' });
  m.h2('Reclamos');
  m.p('Comunicación > Reclamos es el buzón de pedidos, solicitudes y reclamos. Cada uno tiene un estado: Pendiente, En Proceso o Resuelto.');
  m.steps([
    'Abrí el reclamo y leé el pedido.',
    'Si corresponde, elegí a quién se lo asignás en “Asignar Tarea a Empleado de Guardia”.',
    'Tocá “Marcar En Proceso” mientras se trabaja en el tema.',
    'Escribí la “Respuesta Oficial del Club” y tocá “Resolver e Informar”: el socio recibe la respuesta por mensaje.',
  ]);
  m.p('Los reclamos de un socio también se ven en la solapa Reclamos de su ficha.');
  m.h2('Mensajería');
  m.bullets([
    'Mail: Recibidos (lo que llega a socios@jockeyclubsj.com.ar) y Enviados (lo que salió desde el sistema).',
    'MD: los mensajes internos hacia administración. Ahí llegan los avisos de transferencia con comprobante (capítulo 6).',
    'WhatsApp: “Cobranza vía WhatsApp”. Elegí la “Plantilla de WhatsApp” y mirá la lista “Socios con cuotas pendientes”; el mensaje sale con el teléfono de la ficha.',
  ]);
  m.p('Para escribirle a un socio o a todo el padrón usá Mensajes > Redactar: elegí el Destinatario (buscá un socio por nombre, credencial o teléfono, o “Todos los socios”), el Asunto, escribí el Mensaje y tocá “Enviar mensaje”.');
  m.box('warn', 'Releé antes de enviar', 'Un mensaje a “Todos los socios” llega a todo el padrón y no se puede retirar. Releé el texto, el asunto y los importes antes de enviar.');
  m.h2('Novedades, Encuestas y Alertas');
  m.bullets([
    'Novedades: “Nueva noticia”. Cargá Título, Categoría, Autor, Bajada, Cuerpo y la portada. Podés guardar un borrador, programar la publicación o usar “Publicar ahora”. El socio la ve en Novedades.',
    'Encuestas: “Nueva encuesta”. Escribí la Pregunta, elegí la Categoría y cargá las Opciones de respuesta (las dos primeras son obligatorias); después tocá “Publicar encuesta”. Con “Cerrar Consulta” o “Abrir Consulta” se cierra o se reabre la votación. Es una consulta al padrón, no un formulario interno.',
    'Alertas: completá Título, Mensaje, Severidad (Informativa, Advertencia o Crítica) y Audiencia (Todos, Socios, Personal o Administración) y tocá “Publicar alerta”. Una alerta viva aparece como ACTIVA y se ve en Inicio. No dejes una alerta de Zonda publicada cuando el viento ya pasó.',
  ]);
  m.h2('Fiestas');
  m.p('Club > Fiestas es para eventos con inscripción (una cena del club, un torneo), no para reservar una cancha. Con “Nuevo evento” cargás Título, Categoría (Fiesta, Deportes, Institucional o Hípica), Inicio, Cupo, Precio de entrada y Descripción, y tocás “Crear evento”. Para inscribir a un socio, buscalo por nombre, número o DNI. Cargar el cobro del evento en la cuenta del socio (“Imputar eventos”) no se hace desde este perfil: lo hacen el contador y el superadministrador.');
  m.h2('Profesores');
  m.p('Administración > Profesores es solo para mirar. Ves quién dicta cada disciplina, pero el alta, la edición y las claves de los profesores las hacen el administrador y el superadministrador. El profesor toma asistencia en su propia pantalla, no en el panel.');

  /* ----------------------------------------------------------------- 16 */
  m.h1('16.  Lo que este perfil no puede hacer', { n: '16' });
  m.p('Estas restricciones son parte del diseño: separan el mostrador de la tesorería y de la seguridad. Si te piden algo de esta lista, no es que el sistema falle: derivalo.');
  m.table(
    ['Tarea', 'Quién la hace', 'Qué hacer vos'],
    [
      ['Liquidar el mes de cuotas', 'Contador, superadministrador', 'Nada: se liquida en el mes en curso'],
      ['Perdonar el recargo del 10 %', 'Tesorería (cargo de Tesorero), contador, superadmin', 'Anotar socio y motivo y pasarlo a Tesorería'],
      ['Anular un cobro mal cargado', 'Tesorería, contador, superadmin', 'No cargar otro cobro. Pasar socio, importe, medio y motivo'],
      ['Importar cobranzas, imputar eventos, Control de mora', 'Contador, superadmin', 'Saldos es solo de consulta'],
      ['Contabilidad, libros, gastos, proveedores', 'Contador, superadmin', 'Ninguna'],
      ['Ingresos y Acceso QR (la puerta de la sede)', 'Portería, caja, personal, administrador', 'La puerta de la pileta sí es tuya (capítulo 13)'],
      ['Crear o editar usuarios y perfiles; dar o quitar roles', 'Superadmin (el administrador solo da el rol Profesor)', 'Pedirlo al superadmin'],
      ['Alta o edición de profesores', 'Administrador, superadmin', 'Pedirlo al administrador'],
      ['Configuración, Mercado Pago, Zonda, tarifas de pileta', 'Administrador, superadmin', 'Pedirlo a quien administra el sistema'],
    ],
    [60, 54, 64]
  );
  m.box('tip', 'Cuando no sepas a quién preguntar', 'Socios y trámites: Secretaría. Caja y números: Tesorería. Usuarios que no entran: el superadministrador. Dudas de “cómo se hace”: Jev, o IA > Manual en el panel.');

  /* ----------------------------------------------------------------- 17 */
  m.h1('17.  Si algo no anda', { n: '17' });
  m.table(
    ['Qué ves', 'Qué suele ser', 'Qué probar'],
    [
      ['“Abrí la caja del día antes de habilitar”', 'La caja de pileta no está abierta', 'En Pileta, “Abrir caja del día”. Después volvé a habilitar'],
      ['El botón Habilitar está gris', 'Caja cerrada, socio en mora, sin apto o ya ingresó hoy', 'Mirá los motivos que aparecen debajo del botón'],
      ['“La caja del día ya estaba abierta”', 'Otra persona ya la abrió', 'Es normal. Seguí trabajando'],
      ['El socio no aparece en la búsqueda', 'El padrón sigue cargando o el dato está mal escrito', 'Esperá a que termine, probá con DNI o número y revisá la ortografía'],
      ['No aparece el botón Cobrar', 'No tiene saldo, es exento o es adherente sin titular', 'Revisá la categoría y la cabecera de la ficha'],
      ['“Esta categoría no abona cuota social”', 'Vitalicio, fundador o comisión', 'Es lo normal: no se les cobra'],
      ['No ves la casilla Perdonar recargo ni el botón Anular', 'Son de Tesorería', 'Capítulo 16'],
      ['“Adjunte el comprobante de la transferencia”', 'Transferencia sin comprobante', 'Adjuntá la foto o el PDF'],
      ['Mercado Pago no acredita', 'Mercado Pago todavía no confirmó', 'Esperá la confirmación. No cobres de nuevo. Avisá a Tesorería si pasan los minutos'],
      ['El número de un saldo no coincide', 'Es un Corte LILA de otra fecha', 'Mirá la fecha del corte. El saldo vivo está en la ficha'],
      ['Entrás al panel y caés en la puerta de la pileta', 'Es el comportamiento del Operario de pileta', 'Tocá Panel o usá el menú para ir a otra sección'],
      ['Una pantalla no aparece en el menú', 'Tu perfil no la abre', 'Capítulo 16. Pedí el permiso a quien corresponda; no uses el usuario de otra persona'],
      ['La pantalla queda “Cargando…”', 'Internet o sesión colgada', 'Recargá. Si sigue, Salir y volver a entrar'],
    ],
    [56, 52, 70]
  );

  /* ----------------------------------------------------------------- 18 */
  m.h1('18.  Jornada tipo y palabras que vas a ver', { n: '18' });
  m.h2('Administración: un día');
  m.bullets([
    'Al llegar: Inicio, franja del vencimiento, alertas, agenda del día y Solicitudes de Socios.',
    'Durante el día: buscar, cobrar desde la ficha, atender solicitudes, aprobar o anular reservas, responder reclamos y mensajes.',
    'Antes de irte: revisá que no queden solicitudes ni reclamos sin atender y salí del sistema.',
  ]);
  m.h2('Pileta: un día');
  m.bullets([
    'Al llegar: Pileta > “Abrir caja del día”.',
    'En la puerta: buscar, mirar el cartel, cobrar canon, cargar apto si falta y sumar invitados.',
    'Errores: Revocar en Ingresos de hoy.',
    'Antes de irte: mirá los tres números de arriba (Socios hoy, Invitados, Canon cobrado) y comparalos con lo que cobraste. Salí del sistema.',
  ]);
  m.h2('Palabras del club');
  m.table(
    ['Palabra', 'En criollo'],
    [
      ['Padrón', 'La lista oficial de socios'],
      ['Ficha', 'La pantalla completa de una persona'],
      ['Titular / adherente', 'El titular lleva la cuenta del grupo; el adherente es el familiar a su cargo y no paga ni reserva por su cuenta'],
      ['Exento', 'Vitalicio, fundador o comisión: no abona cuota social'],
      ['AMET', 'Categoría con vencimiento el 18 y tarifa con 2,5 % menos; no lleva recargo'],
      ['Mora', 'Cuota vencida y sin pagar, desde el día siguiente al vencimiento (el 11; AMET, el 19)'],
      ['Recargo', '10 % sobre la cuota en mora, solo familiar e individual'],
      ['Canon', 'Lo que se paga por usar la pileta ese día'],
      ['Apto', 'La revisación médica para usar la pileta'],
      ['Caja del día', 'La caja general que se abre una vez por día para anotar el canon de pileta'],
      ['Temporada', 'De diciembre a marzo, cuando rige el bloqueo de ingreso por mora'],
      ['Corte LILA', 'Foto de un Excel de un día anterior al 1 de octubre de 2026, no el estado de hoy'],
      ['Trazabilidad', 'El historial de quién cambió qué en la ficha y con qué motivo'],
    ],
    [46, 132]
  );
  m.p('Gracias por cuidar los datos de los socios. El mostrador funciona bien cuando cada uno usa su perfil, cobra con el medio real y deja siempre el motivo de lo que cambia.');
}
