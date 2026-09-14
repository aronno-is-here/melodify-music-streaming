import { useLayoutEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import cssRaw from '../Login/Login.css?raw';

export default function ResetPassword() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'ResetPassword');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="login-container">
        <div className="logo">
          MELOD<span>IFY</span>
        </div>
        <div className="login-title">Invalid Reset Link</div>
        <p style={{ color: '#b3b3b3', textAlign: 'center', marginBottom: '20px' }}>
          This password reset link is invalid or has expired.
        </p>
        <div className="signup-link">
          <Link to="/forgot-password">Request a new reset link</Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    <div className="login-container">
      <div className="logo">
        MELOD<span>IFY</span>
      </div>
      <div className="login-title">Create new password</div>
      {error && <div className="message" style={{ background: '#dc3545', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{error}</div>}
      {success && <div className="message" style={{ background: '#4caf50', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{success}</div>}
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="password">New Password</label>
          <input
            type="password"
            id="password"
            name="password"
            placeholder="Enter new password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm Password</label>
          <input
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            placeholder="Confirm new password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="continue-btn" disabled={loading}>
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
      <div className="signup-link" style={{ marginTop: '20px' }}>
        <Link to="/login">Back to Login</Link>
      </div>
    </div>
  );
}
