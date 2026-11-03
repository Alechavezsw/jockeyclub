export default function RouteFallback() {
  return (
    <div style={{ minHeight: '40vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }} aria-live="polite">
      Cargando…
    </div>
  );
}
