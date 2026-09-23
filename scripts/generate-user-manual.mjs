/**
 * Manual de uso en PDF — Jockey Club San Juan, Sede Rivadavia.
 * Uso: node scripts/generate-user-manual.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LOGO_JPG = path.join(ROOT, 'public', 'logo-jockey-club-print.jpg');
const LOGO_PNG = path.join(ROOT, 'public', 'logo-jockey-club.png');
const OUT_DOCS = path.join(ROOT, 'docs', 'Manual-del-usuario-Jockey-Club-San-Juan.pdf');
const OUT_PUBLIC = path.join(ROOT, 'public', 'manual-usuario.pdf');

const GREEN = [9, 103, 85];
const GOLD = [202, 57, 12];
const CREAM = [245, 230, 180];
const MUTED = [90, 90, 90];
const INK = [28, 32, 28];
const TIP_BG = [248, 242, 226];
const WARN_BG = [252, 236, 232];
const OK_BG = [232, 242, 234];

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 14;
const CONTENT_BOTTOM = PAGE_H - 20;

function loadLogo() {
  const file = fs.existsSync(LOGO_JPG) ? LOGO_JPG : LOGO_PNG;
  if (!fs.existsSync(file)) return null;
  const mime = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function todayLabel() {
  return new Date().toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

class Manual {
  constructor(logoDataUrl) {
    this.doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    this.logo = logoDataUrl;
    this.y = MARGIN;
    this.toc = [];
  }

  get page() {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  addPage() {
    this.doc.addPage();
    this.drawChrome();
    this.y = 22;
  }

  ensure(h) {
    if (this.y + h > CONTENT_BOTTOM) this.addPage();
  }

  drawChrome() {
    const d = this.doc;
    d.setFillColor(...GREEN);
    d.rect(0, 0, PAGE_W, 12, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(8);
    d.setTextColor(...GOLD);
    d.text('Jockey Club San Juan  ·  Sede Rivadavia', MARGIN, 8);
    d.setFont('helvetica', 'normal');
    d.setTextColor(230, 230, 220);
    d.text('Manual de uso del portal', PAGE_W - MARGIN, 8, { align: 'right' });
  }

  cover() {
    const d = this.doc;
    d.setFillColor(...GREEN);
    d.rect(0, 0, PAGE_W, PAGE_H, 'F');
    d.setFillColor(...GOLD);
    d.rect(0, 118, PAGE_W, 1.2, 'F');

    if (this.logo) {
      try {
        d.addImage(this.logo, this.logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', 78, 28, 54, 54);
      } catch {
        /* logo opcional */
      }
    }

    d.setTextColor(...GOLD);
    d.setFont('helvetica', 'bold');
    d.setFontSize(11);
    d.text('JOCKEY CLUB SAN JUAN', PAGE_W / 2, 96, { align: 'center' });
    d.setFont('helvetica', 'normal');
    d.setFontSize(10);
    d.setTextColor(230, 230, 220);
    d.text('Sede Rivadavia  ·  República del Líbano 1799 Oeste', PAGE_W / 2, 103, { align: 'center' });

    d.setFont('helvetica', 'bold');
    d.setFontSize(26);
    d.setTextColor(255, 255, 255);
    d.text('Manual de uso', PAGE_W / 2, 142, { align: 'center' });
    d.setFontSize(14);
    d.setTextColor(...CREAM);
    d.text('Portal de socios, personal y administración', PAGE_W / 2, 154, { align: 'center' });

    d.setFont('helvetica', 'normal');
    d.setFontSize(11);
    d.setTextColor(220, 220, 210);
    const blurb = d.splitTextToSize(
      'Una guía clara, en español, para que cualquier persona del club pueda entrar al sistema, usar su credencial, reservar, cobrar o atender sin tener que ser experta en computación.',
      150
    );
    d.text(blurb, PAGE_W / 2, 172, { align: 'center' });

    d.setFontSize(9);
    d.setTextColor(...GOLD);
    d.text(`Edición ${todayLabel()}  ·  Versión 1.0`, PAGE_W / 2, 250, { align: 'center' });
    d.setTextColor(200, 200, 190);
    d.text('Uso interno del club  ·  No compartir claves', PAGE_W / 2, 258, { align: 'center' });
  }

  writeToc(entries) {
    this.doc.addPage();
    this.drawChrome();
    this.y = 24;
    this.h1('Índice', { toc: false });
    this.p('Empezá por el capítulo de tu rol. Si no sabés cuál es, leé primero “Antes de empezar” y “Cómo entrar”.');

    autoTable(this.doc, {
      startY: this.y,
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 10,
        cellPadding: { top: 2.2, bottom: 2.2, left: 1, right: 1 },
        textColor: INK,
      },
      columnStyles: {
        0: { cellWidth: 14, fontStyle: 'bold', textColor: GOLD },
        1: { cellWidth: 140 },
        2: { cellWidth: 24, halign: 'right', textColor: MUTED },
      },
      body: entries.map((e) => [e.n, e.title, String(e.page)]),
      margin: { left: MARGIN, right: MARGIN },
      didDrawPage: () => this.drawChrome(),
    });
    this.y = (this.doc.lastAutoTable?.finalY || this.y) + 8;
  }

  mark(n, title) {
    this.toc.push({ n, title, page: this.page });
  }

  h1(text, { toc = true, n } = {}) {
    this.ensure(22);
    if (toc && n) this.mark(n, text.replace(/^\d+\.\s*/, ''));
    this.doc.setFillColor(...GREEN);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, 10, 1.2, 1.2, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(12);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(text, MARGIN + 4, this.y + 6.6);
    this.y += 16;
  }

  h2(text) {
    this.ensure(14);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(11);
    this.doc.setTextColor(...GREEN);
    this.doc.text(text, MARGIN, this.y);
    this.y += 7;
    this.doc.setDrawColor(...GOLD);
    this.doc.setLineWidth(0.35);
    this.doc.line(MARGIN, this.y - 4, MARGIN + 42, this.y - 4);
  }

  p(text) {
    const lines = this.doc.splitTextToSize(text, CONTENT_W);
    this.ensure(lines.length * 5 + 4);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(10);
    this.doc.setTextColor(...INK);
    this.doc.text(lines, MARGIN, this.y);
    this.y += lines.length * 5 + 3.5;
  }

  bullets(items) {
    for (const item of items) {
      const lines = this.doc.splitTextToSize(`•  ${item}`, CONTENT_W);
      this.ensure(lines.length * 5 + 2);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(10);
      this.doc.setTextColor(...INK);
      this.doc.text(lines, MARGIN, this.y);
      this.y += lines.length * 5 + 1.6;
    }
    this.y += 2;
  }

  steps(items) {
    items.forEach((item, i) => {
      const n = `${i + 1}.`;
      const lines = this.doc.splitTextToSize(item, CONTENT_W - 10);
      this.ensure(lines.length * 5 + 4);
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(10);
      this.doc.setTextColor(...GOLD);
      this.doc.text(n, MARGIN, this.y);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setTextColor(...INK);
      this.doc.text(lines, MARGIN + 8, this.y);
      this.y += lines.length * 5 + 2.4;
    });
    this.y += 2;
  }

  box(kind, title, text) {
    const bg = kind === 'warn' ? WARN_BG : kind === 'ok' ? OK_BG : TIP_BG;
    const bar = kind === 'warn' ? [160, 50, 40] : kind === 'ok' ? [30, 100, 55] : GOLD;
    const body = this.doc.splitTextToSize(text, CONTENT_W - 10);
    const h = 8 + body.length * 4.6;
    this.ensure(h + 4);
    this.doc.setFillColor(...bg);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, h, 1.5, 1.5, 'F');
    this.doc.setFillColor(...bar);
    this.doc.rect(MARGIN, this.y, 1.8, h, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9);
    this.doc.setTextColor(...bar);
    this.doc.text(title, MARGIN + 6, this.y + 5);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9);
    this.doc.setTextColor(...INK);
    this.doc.text(body, MARGIN + 6, this.y + 10);
    this.y += h + 5;
  }

  table(head, rows, widths) {
    this.ensure(28);
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 2.1, textColor: INK, valign: 'top' },
      headStyles: { fillColor: GREEN, textColor: CREAM, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 247, 242] },
      columnStyles: (widths || []).reduce((acc, w, i) => {
        acc[i] = { cellWidth: w };
        return acc;
      }, {}),
      margin: { left: MARGIN, right: MARGIN },
      didDrawPage: () => this.drawChrome(),
    });
    this.y = (this.doc.lastAutoTable?.finalY || this.y) + 8;
  }

  footer() {
    const d = this.doc;
    const count = d.getNumberOfPages();
    for (let i = 2; i <= count; i += 1) {
      d.setPage(i);
      d.setDrawColor(...GOLD);
      d.setLineWidth(0.3);
      d.line(MARGIN, FOOTER_Y - 3, PAGE_W - MARGIN, FOOTER_Y - 3);
      d.setFont('helvetica', 'normal');
      d.setFontSize(8);
      d.setTextColor(...MUTED);
      d.text('Jockey Club San Juan · Portal institucional · Uso interno', MARGIN, FOOTER_Y);
      d.text(`${i} / ${count}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
    }
  }

  save(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(this.doc.output('arraybuffer')));
  }
}

function buildBody(m) {
  m.doc.addPage();
  m.drawChrome();
  m.y = 22;

  m.h1('1.  Antes de empezar', { n: '01' });
  m.p('Este portal es el sistema del Jockey Club San Juan, Sede Rivadavia. Reemplaza papeles sueltos, planillas y credenciales viejas por una sola herramienta: la misma para socios, portería, caja, secretaría y tesorería.');
  m.p('No hace falta instalar nada. Se abre en el celular, la tablet o la computadora, con internet. Pedile al club la dirección web (el enlace) y tus datos de ingreso.');
  m.h2('Quién usa qué');
  m.p('Al entrar, el sistema te muestra solo lo que te corresponde. Un socio no ve la contabilidad. Un administrador no ve los asientos contables (eso es de tesorería). Un profesor ve asistencia. Así nadie se pierde ni toca lo que no le toca.');
  m.table(
    ['Si sos…', 'Entras a…', 'Para…'],
    [
      ['Socio o socia', 'Inicio, Reservas, Mi cuenta, Revista', 'Credencial, turnos, saldo, invitados'],
      ['Profesor/a', 'Asistencia', 'Tomar presente de disciplinas'],
      ['Portería / personal', 'Panel + Acceso QR', 'Controlar el ingreso a la sede'],
      ['Caja', 'Panel (Socios, Cuotas, Caja)', 'Cobrar y registrar ingresos'],
      ['Contador/a', 'Panel de Contabilidad', 'Diario, cajas, balances LILA'],
      ['Administración', 'Panel operativo', 'Padrón, reservas, atención (sin contabilidad)'],
      ['Superadministrador', 'Todo el panel', 'Usuarios, permisos y configuración'],
    ],
    [42, 58, 78]
  );
  m.box('tip', 'Consejo', 'Si no ves una pantalla que “deberías” ver, no es un error tuyo: tu usuario no tiene ese permiso. Pedile a Administración o al Superadministrador que revise tu rol.');

  m.h1('2.  Cómo entrar y cómo salir', { n: '02' });
  m.h2('Ingreso');
  m.steps([
    'Abrí el enlace del portal que te dio el club (preferible en Chrome o Safari).',
    'Escribí tu correo electrónico. Tiene que ser el mismo que figura en tu ficha.',
    'Escribí tu contraseña. Nadie del club debería pedirte que se la dictes por WhatsApp.',
    'Tocá el botón para entrar. Si algo falla, el sistema te dice el motivo (clave incorrecta, usuario inexistente, etc.).',
  ]);
  m.h2('Primera vez o clave olvidada');
  m.p('El alta de usuarios la hace el club, no te registrás vos solo. Si olvidaste la clave, contactá a Secretaría o Administración: ellos pueden ayudarte a recuperarla. No uses una cuenta de otra persona.');
  m.h2('Salir');
  m.p('Arriba a la derecha aparece tu nombre (por ejemplo “Hola, Ana”). Ahí está el botón Salir. Usalo siempre si estás en una computadora compartida (caja, portería, sala de profesores).');
  m.box('warn', 'Importante', 'Nunca dejes la sesión abierta en un celular o PC que no es tuyo. Quien esté sentado ahí podría ver tu cuenta, tu saldo o, si sos personal, el padrón.');

  m.h1('3.  Guía del socio', { n: '03' });
  m.p('Cuando entrás como socio ves un menú simple. Esas son tus cuatro puertas:');
  m.bullets([
    'Inicio: tu resumen, credencial digital, estado de cuota, invitados del día y accesos rápidos.',
    'Reservar canchas: turnos de tenis, pádel, pileta, salones y demás espacios.',
    'Mi cuenta: saldo, vencimientos e historial de pagos.',
    'Revista digital: noticias y avisos del club.',
  ]);
  m.h2('Qué significa “al día” o “con deuda”');
  m.p('En Inicio ves el estado de tu cuota. “Al día” quiere decir que no hay saldo pendiente de cobro en el padrón. Si hay deuda, el monto aparece en pesos. Eso no te impide entrar a la sede (el molinete avisa, pero no te deja afuera por deuda), pero sí conviene regularizar en Caja.');
  m.h2('Grupo familiar');
  m.p('Si tu categoría es familiar, en tu ficha aparecen los adherentes (cónyuge, hijos, etc.). Cada uno puede tener su propia situación. El titular es quien suele manejar reservas e invitados, según cómo esté cargado el grupo.');
  m.box('ok', 'Tu ficha es tuya', 'Nadie más, como socio, puede ver el domicilio, el DNI o los pagos de otra persona. En las canchas tampoco ves quién reservó: solo ves si el turno está libre u ocupado.');

  m.h1('4.  Credencial digital y entrada a la sede', { n: '04' });
  m.p('Tu “carnet” ahora vive en el celular. En Inicio está la tarjeta virtual con tu nombre, número de socio y un código QR. Ese QR es la llave del molinete.');
  m.h2('Cómo pasar el QR');
  m.steps([
    'Entrá al portal con tu usuario (no alcanza una captura vieja de hace meses).',
    'Abrí Inicio y dejá la tarjeta a pantalla completa, con el brillo alto.',
    'Acercá el celular al lector de portería, o mostráselo al personal.',
    'Esperá la luz o el mensaje: ACCESO AUTORIZADO, ACCESO CON DEUDA, o ACCESO DENEGADO.',
  ]);
  m.h2('Por qué a veces no anda');
  m.bullets([
    'Foto de un QR viejo o impreso: el sistema ahora exige un QR “firmado” de la app. Una imagen copiada o un carnet anterior puede ser rechazada.',
    'Pantalla sucia, brillo bajo o plástico del protector tapando el código.',
    'Cuenta suspendida: ahí sí el ingreso se deniega hasta que Administración rehabilite.',
    'Sin internet en portería: el personal puede escribir tu número de socio a mano.',
  ]);
  m.box('tip', 'Si tu QR es viejo', 'Abrí la app de nuevo para generar uno nuevo. Si el lector no lo toma, decile a portería tu número de socio: ellos lo cargan a mano y el sistema te reconoce igual.');
  m.h2('Invitados');
  m.p('El pase de invitado también es un QR, pero vale solo el día de hoy y como máximo 3 invitados por socio por día. El anfitrión tiene que estar activo. El invitado muestra su QR en portería; no usa el QR del socio.');

  m.h1('5.  Cómo reservar un turno', { n: '05' });
  m.steps([
    'Andá a Reservar canchas (o al calendario desde Inicio).',
    'Elegí el espacio: cancha, salón, pileta, etc.',
    'Elegí el día. Los días con más verde suelen tener más huecos libres.',
    'Elegí un horario libre y confirmá. El turno queda a tu nombre.',
    'Si te arrepentís, cancelalo desde tus reservas (si el reglamento del espacio lo permite).',
  ]);
  m.h2('Turno ocupado');
  m.p('Si el horario ya está tomado, ves “ocupado” y hasta qué hora, pero no el nombre de la otra persona. Podés anotarte en lista de espera: si se libera, el club te tiene en cuenta.');
  m.h2('Viento Zonda');
  m.p('Cuando el club activa alerta Zonda, las actividades al aire libre se suspenden. Las cubiertas (gimnasio, salones, etc.) siguen. El aviso aparece en la pantalla de reservas.');
  m.h2('Salones y eventos');
  m.p('Los salones de fiestas, parrilla y espacios sociales se reservan igual, a veces con importe. Si tenés dudas de precio o de horario de cierre, preguntá en Secretaría antes de confirmar un evento grande.');
  m.box('warn', 'Respetá el turno', 'Una reserva confirmada ocupa el espacio para todo el club. Si no vas a usarla, cancelala con tiempo para que otro socio pueda tomarla.');

  m.h1('6.  Invitados del día', { n: '06' });
  m.steps([
    'En Inicio, buscá “Invitados del día”.',
    'Escribí el nombre y apellido de la persona.',
    'Tocá Generar QR. Aparece un código para ese invitado.',
    'Mostralo en portería el mismo día (o que el invitado lo muestre en su celular).',
    'Si te equivocaste, podés anular el pase.',
  ]);
  m.bullets([
    'Tope: 3 invitados por día.',
    'Vence a medianoche: al día siguiente hay que generar otro.',
    'Si el socio anfitrión está suspendido, el invitado no entra.',
  ]);

  m.h1('7.  Mi cuenta, cuotas y pagos', { n: '07' });
  m.p('En Mi cuenta ves lo que el club tiene registrado como tu saldo operativo: lo que debés o lo que está al día. Ese número es el que usa Caja cuando cobrás.');
  m.h2('Cómo pagar');
  m.p('El cobro lo registra el personal de caja (efectivo, débito, transferencia, según lo habilitado). Pedí siempre el comprobante. En tu historial debería aparecer el pago con fecha, importe y concepto.');
  m.h2('No mezcles números');
  m.p('A veces Contabilidad muestra reportes llamados “LILA” o “corte”. Son fotos de un Excel de un día puntual (por ejemplo, fin de un mes). No son tu saldo de hoy. Si un número de un reporte no coincide con “Mi cuenta”, prevalece lo que dice tu ficha operativa y lo que te confirme Caja.');
  m.box('tip', 'Regla de oro', 'Tu saldo real es el de tu ficha de socio. Los reportes mensuales, cajas históricas y liquidaciones son copias de un momento, útiles para tesorería, no para discutir un peso de ayer vs. hoy.');

  m.h1('8.  Mensajes, reclamos y revista', { n: '08' });
  m.h2('Mensajes');
  m.p('El club puede enviarte avisos (cierre de pileta, vencimiento, evento). En Inicio ves si hay mensajes sin leer. Abrilos y marcalos como leídos.');
  m.h2('Reclamos');
  m.p('Si hay algo roto, un problema de mantenimiento o una queja, desde Inicio podés abrir un reclamo: tipo, título y descripción. Administración lo asigna y te responde por el mismo canal.');
  m.h2('Revista digital');
  m.p('Es el mural de noticias del club: deportes, fiestas, obras, institucional. Solo se publican las notas que Secretaría o Comunicación cargaron. No es una red social: no hay comentarios públicos.');
  m.h2('Encuestas');
  m.p('Cuando hay una encuesta activa, votás una sola vez. El resultado lo ve el club para decidir (horarios, actividades, etc.).');

  m.h1('9.  Portería y personal de sede', { n: '09' });
  m.p('Si tu rol es Personal, Operador de portería, Cajero, Administrador o Superadministrador, podés abrir Acceso QR (también desde el menú Operación). Esa pantalla es el molinete.');
  m.h2('Rutina recomendada');
  m.steps([
    'Entrá con tu usuario de personal (no el de un socio).',
    'Andá a Acceso QR. Permití la cámara cuando el navegador lo pida. En celulares hace falta HTTPS (el enlace seguro del club).',
    'Pedile al socio que abra su tarjeta en la app, a pantalla completa.',
    'Si la cámara falla: usá “Leer QR desde foto” o escribí el número de socio en “Código manual” y tocá Leer.',
    'Mirá el resultado grande: autorizado, con deuda, denegado, invitado o QR inválido.',
    'Si dice QR no válido o no firmado: pedí que abra la app, o cargá el número a mano.',
  ]);
  m.h2('Qué hacer en cada caso');
  m.table(
    ['Pantalla', 'Significa', 'Qué hacer'],
    [
      ['ACCESO AUTORIZADO', 'Socio activo, sin deuda', 'Dejar pasar'],
      ['ACCESO CON DEUDA', 'Socio activo, debe cuota', 'Dejar pasar e invitar a regularizar en Caja'],
      ['ACCESO DENEGADO', 'Cuenta suspendida u otro bloqueo', 'No dejar pasar; derivar a Administración'],
      ['INVITADO AUTORIZADO', 'Pase del día válido', 'Dejar pasar al invitado'],
      ['PASE INVÁLIDO', 'Vencido, anulado o falso', 'No dejar pasar'],
      ['QR no válido / adulterado', 'Código viejo o inventado', 'Pedir app nueva o número a mano'],
      ['Socio no encontrado', 'El número no está en el padrón', 'No improvisar: avisar a Secretaría'],
    ],
    [48, 52, 78]
  );
  m.box('ok', 'Deuda ≠ rechazo', 'El club decidió que la deuda se informa pero no cierra la puerta. Suspendido sí cierra la puerta. No discutas el monto en el molinete: eso es de Caja.');
  m.h2('Ingresos (historial)');
  m.p('En el panel, Operación → Ingresos muestra las lecturas del día (quién pasó, a qué hora, si fue invitado o denegado). Sirve si hay una duda o un incidente.');

  m.h1('10.  Caja y cobranzas', { n: '10' });
  m.p('Cajeros, portería con caja y tesorería usan el panel. Lo más usado: Socios, Cuotas y Caja.');
  m.h2('Cobrarle a un socio');
  m.steps([
    'Abrí Socios. Buscá por nombre, número, DNI, mail o teléfono.',
    'Entrá al perfil (Ver perfil). Ahí está la ficha completa: domicilio, emergencia, categoría, saldo.',
    'Tocá Cobrar. Cargá importe, medio y concepto. Confirmá.',
    'El saldo de la ficha se actualiza. Entregá o enviá el comprobante.',
  ]);
  m.box('warn', 'No inventes datos', 'El padrón de la lista es liviano a propósito (para que cargue rápido). La ficha completa se pide al abrir el socio. No borres domicilio ni datos médicos: si no los ves en la lista, es normal; están en el perfil.');
  m.h2('Cuotas');
  m.p('La pestaña Cuotas muestra quién está al día, quién debe y quién está por vencer. Sirve para campañas de mora, no para “inventar” deudas. El saldo vivo es siempre el de la ficha del socio.');
  m.h2('Caja del día');
  m.p('En Contabilidad → Cajas (o el atajo Caja si tu rol es cajero) registrás movimientos de efectivo y bancos. Ojo: en reportes LILA, “Ingresos en caja” de un período no es el dinero que hay ahora en el cajón. Es lo que entró en ese recorte de fechas.');

  m.h1('11.  Contabilidad (tesorería)', { n: '11' });
  m.p('Esta parte es para Contador y Superadministrador. El Administrador operativo no entra a contabilidad: así se separa la gestión del club de los números patrimoniales.');
  m.h2('Tres mundos que no se suman entre sí');
  m.bullets([
    'Saldo del socio: ficha viva, lo que se cobra hoy.',
    'Cortes LILA (balance mensual, cuenta corriente, liquidación, créditos): planillas importadas de un día. El sistema las muestra con la leyenda “Corte LILA” y la fecha. No pisan el saldo del socio.',
    'Diario patrimonial: asientos del club (caja, bancos, gastos). Puede estar en cero si todavía no se cargaron asientos nuevos.',
  ]);
  m.h2('Dónde está cada cosa');
  m.table(
    ['Pantalla', 'Para qué sirve'],
    [
      ['Diario / Mayor / Nuevo asiento', 'Contabilidad de partida doble del club'],
      ['Mensual LILA', 'Ingresos y egresos del Excel mensual (foto de un mes)'],
      ['Cta. cte. (liquidación)', 'Corte de cuenta corriente LILA'],
      ['Patrimonial', 'Balance a partir de asientos vivos'],
      ['Cajas', 'Efectivo, bancos, cobranzas y pagos registrados'],
      ['Gastos y proveedores', 'Egresos y cuentas a pagar'],
      ['Créditos socios', 'Compras de crédito entre socios (si el Excel trae filas)'],
    ],
    [58, 120]
  );
  m.box('tip', 'Si los totales no cierran', 'Es esperable que el mensual LILA, la caja de otro corte y la liquidación den números distintos: son fotos de días distintos. No los “ajustes” entre sí a mano. Anotá la fecha de cada reporte.');

  m.h1('12.  Administración del club', { n: '12' });
  m.p('El Administrador opera el club día a día, sin contabilidad. El menú se agrupa así:');
  m.bullets([
    'Operación: Socios, Cuotas, Reservas, Ingresos, Acceso QR.',
    'Club: Disciplinas, Pileta, Fiestas, Revista, Encuestas.',
    'Gestión: Concesiones (si te corresponde), Personal, Reportes.',
    'Atención: Alertas, Reclamos, Mensajería.',
    'Administración: Profesores, Usuarios y altas (según permiso).',
  ]);
  m.h2('Padrón de socios');
  m.p('Buscá, filtrá por categoría, abrí la ficha, editá, cobrá, emití credencial PDF o tarjeta, suspendé. El padrón carga de a poco (miles de socios): esperá a que termine si no aparece alguien.');
  m.h2('Reservas (vista del club)');
  m.p('A diferencia del socio, acá sí ves nombres, importes y podés anular o reactivar. El calendario marca los días con turnos. Los espacios (salones, canchas, pileta) se editan en la misma pantalla.');
  m.h2('Pileta');
  m.p('Control de accesos y reglas de temporada (quién puede entrar, horarios de verano). Coordinar con el guardavidas y con Cuotas si hay restricción por mora, según la política vigente del club.');
  m.h2('Disciplinas y profesores');
  m.p('Las disciplinas (tenis, pádel, rugby, etc.) tienen profesores asignados. El profesor entra a Asistencia y toma presente. Administración da de alta al profesor y le marca qué disciplinas dicta.');
  m.h2('Personal y RR.HH.');
  m.p('Legajos, bitácora, faltas, permisos y documentación del staff. Recursos humanos ve sobre todo esta zona; no necesita el padrón completo.');
  m.h2('Concesiones');
  m.p('Bares y servicios del predio: contrato, canon, comprobantes. Hay un portal aparte para el concesionario, con un código, sin ver el resto del club.');
  m.h2('Reportes y resguardo');
  m.p('Podés bajar un informe ejecutivo en PDF y copias de seguridad. El resguardo automático no guarda domicilios ni historial de pagos completo: es a propósito, para no acumular datos sensibles en la computadora.');

  m.h1('13.  Superadministrador', { n: '13' });
  m.p('Es el único rol que ve todo, incluida la contabilidad y la gestión de usuarios del portal. Con ese poder viene la responsabilidad: no se comparte la clave, no se usa en un café público y no se le asigna el rol a alguien “por las dudas”.');
  m.h2('Usuarios y altas');
  m.steps([
    'Crear el usuario con el correo real de la persona.',
    'Asignar el rol correcto (socio, caja, personal, etc.). Nadie elige su propio rol al registrarse.',
    'Vincular, si corresponde, el número de socio del padrón.',
    'Si es profesor, marcar las disciplinas.',
    'Cuando la persona deja el club o el puesto, revocar el acceso; no alcanza con “esconder” el mail.',
  ]);
  m.box('warn', 'Seguridad', 'El sistema no toma el rol desde un dato que el usuario pueda inventar. Solo un superadministrador (o el proceso interno de alta) puede dar roles de personal o administración.');

  m.h1('14.  Si algo no funciona', { n: '14' });
  m.table(
    ['Qué ves', 'Qué suele ser', 'Qué probar'],
    [
      ['“Verificando credenciales…” eterno', 'Internet o sesión colgada', 'Recargar. Si sigue, Salir e ingresar de nuevo'],
      ['No carga tu ficha de socio', 'El usuario no está vinculado al padrón', 'Administración debe pegar tu número de socio al perfil'],
      ['Padrón en 0 y “actualizando”', 'Está bajando los socios', 'Esperar; son miles de fichas'],
      ['La cámara del QR no inicia', 'El navegador bloqueó el permiso o no hay HTTPS', 'Permitir cámara, usar el enlace seguro, o código manual'],
      ['QR rechazado', 'Credencial vieja o foto', 'Abrir la app de nuevo o tipear el número'],
      ['No ves Contabilidad', 'Tu rol es Administrador u otro operativo', 'Normal. Tesorería entra con usuario de contador'],
      ['Números distintos en reportes', 'Cortes LILA de distintas fechas', 'Mirar la fecha del corte; el saldo vivo está en la ficha'],
      ['No podés reservar exterior', 'Alerta Zonda', 'Elegir un espacio cubierto o esperar el aviso'],
    ],
    [48, 55, 75]
  );

  m.h1('15.  Palabras que vas a ver', { n: '15' });
  m.table(
    ['Palabra', 'En criollo'],
    [
      ['Padrón', 'La lista oficial de socios'],
      ['Ficha', 'La pantalla completa de una persona'],
      ['Adherente', 'Familiar a cargo del titular'],
      ['Categoría / cuota', 'El tipo de socio (familiar, individual, vitalicio…)'],
      ['Saldo operativo', 'Lo que debés o tenés al día, ahora'],
      ['Corte LILA', 'Una foto de un Excel de un día, no el ahora'],
      ['QR firmado', 'Código de la app que no se puede inventar con el número'],
      ['Molinete / Acceso QR', 'La pantalla para entrar a la sede'],
      ['Rol', 'El permiso de tu usuario (socio, caja, admin…)'],
      ['Panel', 'La oficina digital del personal'],
      ['Asiento', 'Una registración contable (debe y haber)'],
      ['Zonda', 'Viento fuerte: se cierran las canchas al aire libre'],
    ],
    [48, 130]
  );

  m.h2('Buenas prácticas para todos');
  m.bullets([
    'Usá tu propio usuario. Nunca prestes la clave.',
    'En portería y caja, cerrá sesión al terminar el turno.',
    'No fotografíes el padrón ni lo mandes por WhatsApp.',
    'Si ves un dato mal (teléfono, categoría, familiar), avisá: se corrige en la ficha, no “en el Excel de alguien”.',
    'Ante la duda, preguntá en Secretaría. El sistema está para ayudar, no para reemplazar el criterio del club.',
  ]);

  m.box('ok', '¿Necesitás ayuda?', 'Socio: Secretaría. Personal de sede: tu responsable de turno. Caja y números: Tesorería. Usuarios que no entran: Superadministrador. Este manual se puede reimprimir desde el archivo PDF del club.');

  m.h1('16.  Mapa rápido del portal', { n: '16' });
  m.p('Direcciones que vas a ver en el navegador (no hace falta memorizarlas: el menú te lleva):');
  m.table(
    ['Ruta', 'Quién la usa', 'Qué hay'],
    [
      ['Inicio (/)', 'Socio', 'Credencial, resumen, invitados'],
      ['/reservas', 'Socio', 'Calendario de espacios'],
      ['/revista', 'Socio', 'Noticias'],
      ['/acceso', 'Portería y personal', 'Lector QR'],
      ['/panel/…', 'Personal y autoridades', 'Oficina del club'],
      ['/concesiones', 'Admin / tesorería', 'Contratos y canon'],
    ],
    [42, 52, 84]
  );
  m.p('Gracias por cuidar los datos de los socios y el predio. El portal funciona bien cuando cada uno usa su rol, cobra en Caja lo que corresponde y muestra en la puerta un QR de verdad, no una foto vieja.');
}

function placeholderToc() {
  return Array.from({ length: 16 }, (_, i) => ({
    n: String(i + 1).padStart(2, '0'),
    title: 'Capítulo',
    page: 0,
  }));
}

function main() {
  const logo = loadLogo();
  const draft = new Manual(logo);
  draft.cover();
  draft.writeToc(placeholderToc());
  buildBody(draft);

  const final = new Manual(logo);
  final.cover();
  final.writeToc(draft.toc);
  buildBody(final);
  final.footer();
  final.save(OUT_DOCS);
  final.save(OUT_PUBLIC);
  const pages = final.doc.getNumberOfPages();
  console.log(`OK ${pages} páginas`);
  console.log(OUT_DOCS);
  console.log(OUT_PUBLIC);
}

main();
