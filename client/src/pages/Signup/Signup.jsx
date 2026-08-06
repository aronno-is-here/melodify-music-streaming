import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import './Signup.css';

const Days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isLeapYear = (year) => {
  year = parseInt(year);
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
};

export default function Signup() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [gender, setGender] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState('');

  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let i = currentYear - 21; i >= 1930; i--) yearOptions.push(i);

  const monthIndex = month ? parseInt(month) - 1 : 0;
  const maxDays = month ? (isLeapYear(year) && month === '2' ? 29 : Days[monthIndex]) : Days[0];
  const dayOptions = [];
  for (let i = 1; i <= maxDays; i++) dayOptions.push(i);

  const handleEmailNext = async (e) => {
    e.preventDefault();
    setError('');
    const data = await api.post('/api/auth/signup/step1', { email });
    if (data.success) setStep(2);
    else setError(data.error || 'Signup failed');
  };

  const handlePasswordNext = async (e) => {
    e.preventDefault();
    setError('');
    const data = await api.post('/api/auth/signup/step2', { password });
    if (data.success) setStep(3);
    else setError(data.error || 'Signup failed');
  };

  const handleProfileNext = async (e) => {
    e.preventDefault();
    setError('');
    const data = await api.post('/api/auth/signup/step3', { email, password, name, day, month, year, gender, country });
    if (data.success) {
      login(data.token, data.user);
      navigate('/dashboard');
    } else {
      setError(data.error || 'Signup failed');
    }
  };

  return (
    <>
      {step === 1 && (
        <div className="signup-container">
          <div className="logo">
            MELOD<span>IFY</span>
          </div>
          <div className="signup-title">Sign up &amp; let the melodies move you!</div>
          {error && <div className="message" style={{ background: '#dc3545', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{error}</div>}
          <form onSubmit={handleEmailNext}>
            <div className="form-group">
              <label htmlFor="email">Email address</label>
              <input type="email" id="email" name="email" placeholder="name@domain.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" className="next-btn">
              Next
            </button>
          </form>
          <div className="or-separator">or</div>
          <div className="social-signup-btn">
            <a href="#" className="social-btn google-btn" onClick={(e) => e.preventDefault()}>
              <img src="https://www.google.com/favicon.ico" alt="Google" /> Sign up with Google
            </a>
          </div>
          <div className="login-link">
            Already have an account? <Link to="/login">Log in here</Link>
          </div>
          <div className="footer-text">
            This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy">Privacy Policy</a> and <a href="https://policies.google.com/terms">Terms of Service</a> apply.
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="password-container">
          <div className="logo">
            MELOD<span>IFY</span>
          </div>
          <div className="progress-indicator">Step 1 of 3</div>
          <div className="progress-bar">
            <div className="progress-bar-fill"></div>
          </div>

          <h2 className="signup-title">Create a password</h2>
          {error && <div className="message" style={{ background: '#dc3545', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{error}</div>}
          <form onSubmit={handlePasswordNext}>
            <input type="hidden" name="email" value={email} />

            <div className="form-group">
              <label htmlFor="password">Password</label>

              <div className="password-input">
                <input type={showPassword ? 'text' : 'password'} id="password" name="password" placeholder="Enter your password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <span className="toggle-password" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? '👁️‍🗨️' : '👁️'}
                </span>
              </div>
            </div>

            <div className="password-requirements">
              <h3>Your password must contain at least</h3>
              <ul>
                <li>
                  <span className="requirement-icon"></span> 1 letter
                </li>
                <li>
                  <span className="requirement-icon"></span> 1 number or special character (example: #?!&amp;)
                </li>
                <li>
                  <span className="requirement-icon"></span> 10 characters
                </li>
              </ul>
            </div>

            <button type="submit" className="next-btn">
              Next
            </button>
          </form>

          <div className="footer-text">
            This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy">Privacy Policy</a> and <a href="https://policies.google.com/terms">Terms of Service</a> apply.
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="profile-container">
          <div className="logo">
            MELOD<span>IFY</span>
          </div>
          <div className="progress-indicator">Step 2 of 3</div>
          <div className="progress-bar">
            <div className="progress-bar-fill step2"></div>
          </div>
          <h2 className="signup-title">Tell us about yourself</h2>
          {error && <div className="message" style={{ background: '#dc3545', padding: 10, borderRadius: 4, marginBottom: 15, color: '#fff' }}>{error}</div>}
          <form onSubmit={handleProfileNext}>
            <input type="hidden" name="email" id="email" value={email} />
            <input type="hidden" name="password" id="password" value={password} />
            <div className="form-group">
              <label htmlFor="name">Name</label>
              <input type="text" id="name" name="name" placeholder="Enter your name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date of birth</label>
              <div className="date-of-birth">
                <select id="day" name="day" required value={day} onChange={(e) => setDay(e.target.value)}>
                  <option value="">Day</option>
                  {dayOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select id="month" name="month" required value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">Month</option>
                  {monthNames.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select id="year" name="year" required value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="">Year</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Gender</label>
              <div className="gender-options">
                <label className="gender-option">
                  <input type="radio" name="gender" value="man" required checked={gender === 'man'} onChange={(e) => setGender(e.target.value)} /> Man
                </label>
                <label className="gender-option">
                  <input type="radio" name="gender" value="woman" checked={gender === 'woman'} onChange={(e) => setGender(e.target.value)} /> Woman
                </label>
                <label className="gender-option">
                  <input type="radio" name="gender" value="prefer_not_to_say" checked={gender === 'prefer_not_to_say'} onChange={(e) => setGender(e.target.value)} /> Prefer not to say
                </label>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="country">Country</label>
              <select id="country" name="country" className="country-select" required value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Choose a country</option>
                <option value="Bangladesh">Bangladesh</option>
                <option value="India">India</option>
                <option value="Pakistan">Pakistan</option>
                <option value="USA">United States</option>
                <option value="UK">United Kingdom</option>
                <option value="Canada">Canada</option>
                <option value="Australia">Australia</option>
                <option value="Germany">Germany</option>
                <option value="Japan">Japan</option>
                <option value="Brazil">Brazil</option>
              </select>
            </div>
            <button type="submit" className="next-btn">
              Next
            </button>
          </form>
          <div className="footer-text">
            This site is protected by reCAPTCHA and the Google <a href="#">Privacy Policy</a> and <a href="#">Terms of Service</a> apply.
          </div>
        </div>
      )}
    </>
  );
}