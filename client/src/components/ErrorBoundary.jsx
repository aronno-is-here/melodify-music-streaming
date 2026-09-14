import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#121212',
          color: '#fff',
          fontFamily: 'Roboto, sans-serif',
          padding: '20px',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px', color: '#00b4d8' }}>Something went wrong</h1>
          <p style={{ color: '#b3b3b3', marginBottom: '24px', maxWidth: '400px' }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#00b4d8',
              color: '#fff',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '999px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
