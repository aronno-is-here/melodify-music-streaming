import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const data = await api.post('/api/auth/login', { email, password });
    setLoading(false);

    if (data.success) {
      login(data.token, data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/dashboard');
      return;
    }

    setError(data.error || 'Login failed');
  };

  return (
    <div className="auth-page login-page">
      <div className="auth-shell">
        <section className="auth-intro">
          <div>
            <Link to="/" className="auth-brand" aria-label="Go to home">
              <span className="auth-brand-mark">
                <i className="fa-solid fa-wave-square" aria-hidden="true"></i>
              </span>
              <span className="auth-brand-name">Melod<span>ify</span></span>
            </Link>

            <p className="auth-intro-kicker">Welcome Back</p>
            <h1>Pick up your <span>music flow</span>.</h1>
            <p>Log in to continue listening across Dashboard, Search, and your library.</p>
          </div>

          <div className="auth-intro-links">
            <Link to="/" className="auth-secondary-link">Home</Link>
            <Link to="/signup" className="auth-secondary-link auth-secondary-link--primary">Create Account</Link>
          </div>
        </section>

        <section className="auth-card">
          <h2>Log In</h2>
          <p>Use your Melodify account credentials.</p>

          {error ? <p className="auth-alert error" role="alert">{error}</p> : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-form-group">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="name@domain.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="auth-form-group">
              <label htmlFor="login-password">Password</label>
              <div className="auth-password-wrap">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div className="auth-inline-links">
              <span className="auth-muted-note">Need help with access?</span>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <button type="submit" className="music-pill-btn" disabled={loading}>
              {loading ? 'Signing in...' : 'Continue'}
            </button>
          </form>

          <p className="auth-foot-links">
            Don&apos;t have an account? <Link to="/signup">Sign up for Melodify</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
