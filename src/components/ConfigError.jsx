export default function ConfigError() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center' }}>
      <div style={{ maxWidth: 440 }}>
        <h1 className="serif-font" style={{ fontSize: '1.6rem', marginBottom: '0.6rem' }}>
          El club no está conectado
        </h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Falta la base de datos (Supabase). En producción no se usa el modo demo
          para no mezclar datos reales del Jockey con usuarios de prueba.
        </p>
      </div>
    </main>
  );
}
