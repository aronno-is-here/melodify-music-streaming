import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';
import './styles/tokens.css';
import './styles/app-shell.css';
import './styles/music-ui.css';
import './styles/auth-pages.css';
import './styles/brand.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <NotificationProvider>
            <PlayerProvider>
              <App />
            </PlayerProvider>
          </NotificationProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
