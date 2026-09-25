import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isLeapYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return false;
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

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
  const [loading, setLoading] = useState(false);

  const currentYear = new Date().getFullYear();

  const yearOptions = useMemo(() => {
    const years = [];
    for (let value = currentYear - 13; value >= 1930; value -= 1) {
      years.push(value);
    }
    return years;
  }, [currentYear]);

  const dayOptions = useMemo(() => {
    const monthIndex = month ? Number(month) - 1 : 0;
    const maxDays = month
      ? (isLeapYear(year) && month === '2' ? 29 : DAYS_IN_MONTH[monthIndex])
      : DAYS_IN_MONTH[0];
    return Array.from({ length: maxDays }, (_, index) => index + 1);
  }, [month, year]);

  const goToPasswordStep = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const data = await api.post('/api/auth/signup/step1', { email });
    setLoading(false);

    if (data.success) {
      setStep(2);
    } else {
      setError(data.error || 'Signup failed');
    }
  };

  const goToProfileStep = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const data = await api.post('/api/auth/signup/step2', { password });
    setLoading(false);

    if (data.success) {
      setStep(3);
    } else {
      setError(data.error || 'Signup failed');
    }
  };

  const submitSignup = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const data = await api.post('/api/auth/signup/step3', {
      email,
      password,
      name,
      day,
      month,
      year,
      gender,
      country,
    });

    setLoading(false);

    if (data.success) {
      login(data.token, data.user);
      navigate('/dashboard');
    } else {
      setError(data.error || 'Signup failed');
    }
  };

  return (
    <div className="auth-page signup-page">
      <div className="auth-shell">
        <section className="auth-intro">
          <div>
            <Link to="/" className="auth-brand" aria-label="Go to home">
              <span className="auth-brand-mark">
                <i className="fa-solid fa-wave-square" aria-hidden="true"></i>
              </span>
              <span className="auth-brand-name">Melod<span>ify</span></span>
            </Link>
            <p className="auth-intro-kicker">Create Account</p>
            <h1>Build your <span>music identity</span>.</h1>
            <p>Set up your listener profile and jump directly into your personalized dashboard.</p>
          </div>

          <div className="auth-intro-links">
            <Link to="/" className="music-outline-btn">Home</Link>
            <Link to="/login" className="music-pill-btn">Log In Instead</Link>
          </div>
        </section>

        <section className="auth-card">
          <h2>Sign Up</h2>
          <p>Step {step} of 3</p>
          <div className="auth-stepper" aria-hidden="true">
            <p>Progress</p>
            <div className="auth-step-track">
              <div className="auth-step-fill" style={{ width: `${step * 33.3333}%` }}></div>
            </div>
          </div>

          {error ? <p className="auth-alert error" role="alert">{error}</p> : null}

          {step === 1 ? (
            <form className="auth-form" onSubmit={goToPasswordStep}>
              <div className="auth-form-group">
                <label htmlFor="signup-email">Email address</label>
                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@domain.com"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <button type="submit" className="music-pill-btn" disabled={loading}>
                {loading ? 'Checking...' : 'Next'}
              </button>
            </form>
          ) : null}

          {step === 2 ? (
            <form className="auth-form" onSubmit={goToProfileStep}>
              <div className="auth-form-group">
                <label htmlFor="signup-password">Password</label>
                <div className="auth-password-wrap">
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Create your password"
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

              <ul className="auth-requirements" aria-label="Password requirements">
                <li>At least 10 characters</li>
                <li>At least 1 letter</li>
                <li>At least 1 number or special character</li>
              </ul>

              <div className="auth-inline-links">
                <button type="button" className="music-outline-btn" onClick={() => setStep(1)}>Back</button>
                <button type="submit" className="music-pill-btn" disabled={loading}>{loading ? 'Validating...' : 'Next'}</button>
              </div>
            </form>
          ) : null}

          {step === 3 ? (
            <form className="auth-form" onSubmit={submitSignup}>
              <div className="auth-form-group">
                <label htmlFor="signup-name">Name</label>
                <input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your display name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="auth-form-group">
                <label>Date of birth</label>
                <div className="auth-grid-3">
                  <select aria-label="Birth day" required value={day} onChange={(event) => setDay(event.target.value)}>
                    <option value="">Day</option>
                    {dayOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                  <select aria-label="Birth month" required value={month} onChange={(event) => setMonth(event.target.value)}>
                    <option value="">Month</option>
                    {MONTH_NAMES.map((entry, index) => (
                      <option key={entry} value={index + 1}>{entry}</option>
                    ))}
                  </select>
                  <select aria-label="Birth year" required value={year} onChange={(event) => setYear(event.target.value)}>
                    <option value="">Year</option>
                    {yearOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="auth-form-group">
                <label>Gender</label>
                <div className="auth-radio-group">
                  <label className="auth-radio">
                    <input type="radio" name="gender" value="man" checked={gender === 'man'} onChange={(event) => setGender(event.target.value)} required />
                    Man
                  </label>
                  <label className="auth-radio">
                    <input type="radio" name="gender" value="woman" checked={gender === 'woman'} onChange={(event) => setGender(event.target.value)} />
                    Woman
                  </label>
                  <label className="auth-radio">
                    <input
                      type="radio"
                      name="gender"
                      value="prefer_not_to_say"
                      checked={gender === 'prefer_not_to_say'}
                      onChange={(event) => setGender(event.target.value)}
                    />
                    Prefer not to say
                  </label>
                </div>
              </div>

              <div className="auth-form-group">
                <label htmlFor="signup-country">Country</label>
                <select id="signup-country" required value={country} onChange={(event) => setCountry(event.target.value)}>
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

              <div className="auth-inline-links">
                <button type="button" className="music-outline-btn" onClick={() => setStep(2)}>Back</button>
                <button type="submit" className="music-pill-btn" disabled={loading}>{loading ? 'Creating account...' : 'Create Account'}</button>
              </div>
            </form>
          ) : null}

          <p className="auth-foot-links">
            Already have an account? <Link to="/login">Log in here</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
