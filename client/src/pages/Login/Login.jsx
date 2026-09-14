import { useLayoutEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Login.css?raw';

export default function Login() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Login');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const data = await api.post('/api/auth/login', { email, password });
    if (data.success) {
      login(data.token, data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/dashboard');
    } else {
      setError(data.error || 'Login failed');
    }
  };

  return (
    <div className="login-container">
      <div className="logo">
        MELOD<span>IFY</span>
      </div>
      <div className="login-title">Log in to Melodify</div>
      {error && <div className="message">{error}</div>}
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
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            placeholder="Enter your password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="continue-btn">
          Continue
        </button>
      </form>
      <div style={{ textAlign: 'right', marginTop: '10px' }}>
        <Link to="/forgot-password" style={{ color: '#00b4d8', fontSize: '14px' }}>Forgot password?</Link>
      </div>

      <div className="signup-link">
        Don&apos;t have an account? <Link to="/signup">Sign up for Melodify</Link>
      </div>
    </div>
  );
}