if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function resetScroll() {
  const root = document.documentElement;
  const main = document.getElementById('contenido-principal');
  window.scrollTo(0, 0);
  root.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;
  if (main) main.scrollTop = 0;
}

/** Tope inmediato. El clic del tab aún puede scrollear el botón a la vista: keepPageAtTop lo pisa. */
export function scrollPageToTop() {
  if (typeof window === 'undefined') return;
  resetScroll();
}

/** Tope en el layout y otra vez después del scroll-into-view del botón. */
export function keepPageAtTop() {
  if (typeof window === 'undefined') return;
  resetScroll();
  requestAnimationFrame(() => {
    resetScroll();
    requestAnimationFrame(resetScroll);
  });
}

/** Evita que el botón de navegación tome foco y mueva el scroll. */
export function preventButtonScroll(event) {
  event.preventDefault();
}
