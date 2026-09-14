import { useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import cssRaw from '../Login/Login.css?raw';

export default function ForgotPassword() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'ForgotPassword');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    <div className="login-container">
      <div className="logo">
        MELOD<span>IFY</span>
      </div>
      <div className="login-title">Reset your password</div>
      <p style={{ color: '#b3b3b3', textAlign: 'center', marginBottom: '20px', fontSize: '14px' }}>
        Enter your email address and we&apos;ll send you a link to reset your password.
      </p>
      {error && <div className="message" style={{ background: '#dc3545', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{error}</div>}
      {success && <div className="message" style={{ background: '#4caf50', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{success}</div>}
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="Enter your email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" className="continue-btn" disabled={loading}>
          {loading ? 'Sending...' : 'Send Reset Link'}
        </button>
      </form>
      <div className="signup-link" style={{ marginTop: '20px' }}>
        <Link to="/login">Back to Login</Link>
      </div>
    </div>
  );
}
