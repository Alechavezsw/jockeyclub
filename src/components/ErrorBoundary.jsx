import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[Jockey Club] Error de interfaz:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ maxWidth: 420, padding: '2rem', textAlign: 'center' }}>
            <h1 className="serif-font" style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>
              Jockey Club San Juan
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
              Ocurrió un error inesperado en la interfaz. La sesión se mantiene segura; recargue para continuar.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.assign('/')}>
              Recargar portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
