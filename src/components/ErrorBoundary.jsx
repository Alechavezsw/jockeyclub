import { Component } from 'react';
import { APP_NAME } from '../domain/system/appBrand';
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message ? String(error.message).slice(0, 180) : '',
    };
  }

  componentDidCatch(error, info) {
    console.error(`[${APP_NAME}] Error de interfaz:`, error, info?.componentStack);
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__lastUiError = {
        message: String(error?.message || ''),
        stack: String(error?.stack || ''),
        componentStack: String(info?.componentStack || ''),
      };
    }
    const message = String(error?.message || '');
    if (/useAuth|AuthProvider/i.test(message) && import.meta.env.DEV) {
      window.location.reload();
    }
  }

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
          <div className="glass-card" style={{ maxWidth: 420, padding: '2rem', textAlign: 'center' }}>
            <h1 className="serif-font" style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>
              {APP_NAME}
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
              Ocurrió un error inesperado en la interfaz. La sesión se mantiene segura; recargue para continuar.
            </p>
            {this.state.message ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1rem', wordBreak: 'break-word' }}>
                {this.state.message}
              </p>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={this.handleRecover}>
              Recargar portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
