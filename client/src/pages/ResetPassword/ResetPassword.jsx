import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9#?!&]/.test(password)) {
      setError('Password must contain at least 10 characters, 1 letter, and 1 number or special character.');
      return;
    }

    setLoading(true);
    const data = await api.post('/api/auth/reset-password', { token, password });
    setLoading(false);

    if (data.success) {
      setSuccess('Password reset successful! Redirecting to login...');
      setTimeout(() => navigate('/login'), 2000);
    } else {
      setError(data.error || 'Something went wrong');
    }
  };

  return (
    <div className="auth-page reset-password-page">
      <div className="auth-shell">
        <section className="auth-intro">
          <div>
            <Link to="/" className="auth-brand" aria-label="Go to home">
              <span className="auth-brand-mark">
                <i className="fa-solid fa-wave-square" aria-hidden="true"></i>
              </span>
              <span className="auth-brand-name">Melod<span>ify</span></span>
            </Link>

            <p className="auth-intro-kicker">Secure Reset</p>
            <h1>Set a new <span>password</span>.</h1>
            <p>Create a strong password to protect your listening history and account settings.</p>
          </div>

          <div className="auth-intro-links">
            <Link to="/login" className="music-pill-btn">Back to Login</Link>
            <Link to="/" className="music-outline-btn">Home</Link>
          </div>
        </section>

        <section className="auth-card">
          {!token ? (
            <>
              <h2>Invalid Reset Link</h2>
              <p>This password reset link is invalid or has expired.</p>
              <div className="auth-form">
                <Link to="/forgot-password" className="music-pill-btn">Request New Reset Link</Link>
              </div>
            </>
          ) : (
            <>
              <h2>Create New Password</h2>
              <p>Use a secure password with letters and numbers/symbols.</p>

              {error ? <p className="auth-alert error" role="alert">{error}</p> : null}
              {success ? <p className="auth-alert success" role="status" aria-live="polite">{success}</p> : null}

              <form className="auth-form" onSubmit={handleSubmit}>
                <div className="auth-form-group">
                  <label htmlFor="reset-password">New Password</label>
                  <div className="auth-password-wrap">
                    <input
                      id="reset-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Enter new password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      aria-label={showPassword ? 'Hide new password' : 'Show new password'}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
                    </button>
                  </div>
                </div>

                <div className="auth-form-group">
                  <label htmlFor="reset-confirm-password">Confirm Password</label>
                  <div className="auth-password-wrap">
                    <input
                      id="reset-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Confirm new password"
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
                      onClick={() => setShowConfirmPassword((value) => !value)}
                    >
                      <i className={`fa-regular ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
                    </button>
                  </div>
                </div>

                <button type="submit" className="music-pill-btn" disabled={loading}>
                  {loading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          <p className="auth-foot-links">
            <Link to="/login">Back to Login</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
