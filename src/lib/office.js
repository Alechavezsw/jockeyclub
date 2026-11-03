/** jspdf y xlsx no entran en el arranque: se piden al exportar o importar un archivo. */

let xlsxPromise;
let jsPdfPromise;
let autoTablePromise;

export function loadXlsx() {
  xlsxPromise ??= import('xlsx');
  return xlsxPromise;
}

export function loadJsPdf() {
  jsPdfPromise ??= import('jspdf');
  return jsPdfPromise;
}

export function loadAutoTable() {
  autoTablePromise ??= import('jspdf-autotable');
  return autoTablePromise;
}
