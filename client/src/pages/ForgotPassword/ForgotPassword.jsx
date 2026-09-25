import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const data = await api.post('/api/auth/forgot-password', { email });
    setLoading(false);

    if (data.success) {
      setSuccess('If an account exists with this email, you will receive a password reset link shortly.');
    } else {
      setError(data.error || 'Something went wrong');
    }
  };

  return (
    <div className="auth-page forgot-password-page">
      <div className="auth-shell">
        <section className="auth-intro">
          <div>
            <Link to="/" className="auth-brand" aria-label="Go to home">
              <span className="auth-brand-mark">
                <i className="fa-solid fa-wave-square" aria-hidden="true"></i>
              </span>
              <span className="auth-brand-name">Melod<span>ify</span></span>
            </Link>

            <p className="auth-intro-kicker">Password Recovery</p>
            <h1>Recover your <span>account access</span>.</h1>
            <p>Enter your email and we will send password reset instructions if the account exists.</p>
          </div>

          <div className="auth-intro-links">
            <Link to="/login" className="music-pill-btn">Back to Login</Link>
            <Link to="/" className="music-outline-btn">Home</Link>
          </div>
        </section>

        <section className="auth-card">
          <h2>Forgot Password</h2>
          <p>Enter the email associated with your account.</p>

          {error ? <p className="auth-alert error" role="alert">{error}</p> : null}
          {success ? <p className="auth-alert success" role="status" aria-live="polite">{success}</p> : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-form-group">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                placeholder="name@domain.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <button type="submit" className="music-pill-btn" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <p className="auth-foot-links">
            Remembered your password? <Link to="/login">Return to login</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
