/** PDF del certificado, mismo cuerpo que LILA. */

export async function exportLibreDeudaPdf(certificate) {
  const { jsPDF } = await import('jspdf');
  const letter = certificate.letter;
  const nro = certificate.memberNumberPadded || certificate.memberNumber || 'socio';
  const fileName = certificate.fileName || `Socio ${nro}.pdf`;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 22;
  const width = pageW - 44;
  let y = 22;

  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(letter.headingMember, left, y);

  y += 10;
  doc.setFontSize(14);
  doc.text(letter.headingClub, pageW / 2, y, { align: 'center' });

  y += 8;
  doc.setFontSize(13);
  doc.text(letter.headingTitle, pageW / 2, y, { align: 'center' });

  y += 14;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(25, 25, 25);

  letter.paragraphs.forEach((para) => {
    const isHeading = para === 'CERTIFICO:' || para === 'Firma y sello';
    doc.setFont('times', isHeading ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(para, width);
    if (y + lines.length * 5.4 > pageH - 36) {
      doc.addPage();
      y = 22;
    }
    doc.text(lines, left, y);
    y += lines.length * 5.4 + (isHeading ? 4 : 5);
  });

  y += 6;
  doc.setFont('times', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);
  const noteLines = doc.splitTextToSize(letter.note, width);
  if (y + noteLines.length * 4 > pageH - 18) {
    doc.addPage();
    y = 22;
  }
  doc.text(noteLines, left, y);
  y += noteLines.length * 4 + 8;

  doc.setFont('times', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text(letter.stamp, left, Math.min(y, pageH - 12));

  doc.save(fileName);
  return fileName;
}
