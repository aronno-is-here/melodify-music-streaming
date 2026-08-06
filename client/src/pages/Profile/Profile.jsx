import { useLayoutEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Profile.css?raw';

export default function Profile() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Profile');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [dob, setDob] = useState(user?.dob ? String(user.dob).slice(0, 10) : '');
  const [gender, setGender] = useState(user?.gender || '');
  const [country, setCountry] = useState(user?.country || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState('');

  if (!user) return null;

  const initials = (user.name || 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const saveProfile = async (e) => {
    e.preventDefault();
    setMsg('');
    const data = await api.put('/api/auth/me', { name, dob, gender, country });
    if (data.success) {
      setMsg('Profile updated successfully');
      setEditOpen(false);
      window.location.reload();
    } else {
      setMsg(data.error || 'Update failed');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setMsg('');
    if (newPassword !== confirmPassword) {
      setMsg('New passwords do not match');
      return;
    }
    const data = await api.post('/api/auth/me/password', { currentPassword, newPassword });
    if (data.success) {
      setMsg('Password changed successfully');
      setPasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setMsg(data.error || 'Password change failed');
    }
  };

  return (
    <>
      <header className="header">
        <div className="logo">
          MELOD<span>IFY</span>
        </div>
        <nav className="nav-links">
          <Link to="/dashboard">Dashboard</Link>
          <a href="/premium/">Premium</a>
        </nav>
      </header>

      <div className="main-container">
        <aside className="sidebar">
          <h3>Profile Menu</h3>
          <ul>
            <li>
              <a href="#" onClick={(e) => e.preventDefault()}>Overview</a>
            </li>
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); setEditOpen(true); }}>Edit Profile</a>
            </li>
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); setPasswordOpen(true); }}>Change Password</a>
            </li>
            <li>
              <a href="#" onClick={(e) => e.preventDefault()}>Privacy Settings</a>
            </li>
            <li>
              <a href="#" onClick={(e) => e.preventDefault()}>Account</a>
            </li>
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); logout(); navigate('/login'); }}>Logout</a>
            </li>
          </ul>
        </aside>

        <main className="content">
          <div className="profile-header">
            <div className="avatar">{initials}</div>
            <div className="profile-info">
              <h1>{user.name}</h1>
              <p>{user.email}</p>
            </div>
          </div>

          <div className="action-buttons">
            <a href="#" className="action-btn" id="editProfileBtn" onClick={(e) => { e.preventDefault(); setEditOpen(true); }}>
              Edit Profile
            </a>
            <a href="#" className="action-btn secondary" onClick={(e) => { e.preventDefault(); logout(); navigate('/login'); }}>
              Logout
            </a>
          </div>

          {msg && (
            <div style={{ padding: 10, marginBottom: 15, borderRadius: 4, background: '#4caf50', color: '#fff' }}>{msg}</div>
          )}

          <section className="section">
            <h2>Personal Information</h2>
            <div className="user-details">
              <div className="detail-item">
                <label>Full Name</label>
                <span>{user.name}</span>
              </div>
              <div className="detail-item">
                <label>Email</label>
                <span>{user.email}</span>
              </div>
              <div className="detail-item">
                <label>Date of Birth</label>
                <span>{user.dob ? String(user.dob).slice(0, 10) : '-'}</span>
              </div>
              <div className="detail-item">
                <label>Gender</label>
                <span>{user.gender}</span>
              </div>
              <div className="detail-item">
                <label>Country</label>
                <span>{user.country || '-'}</span>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Edit Profile Modal */}
      <div id="editProfileModal" className={`modal${editOpen ? ' active' : ''}`}>
        <div className="modal-content">
          <span className="close" onClick={() => setEditOpen(false)}>&times;</span>
          <h2>Edit Profile</h2>
          <form className="form-grid" onSubmit={saveProfile}>
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input type="text" id="fullName" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input type="email" id="email" value={user.email} disabled />
            </div>
            <div className="form-group">
              <label htmlFor="dob">Date of Birth</label>
              <input type="date" id="dob" value={dob} onChange={(e) => setDob(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="gender">Gender</label>
              <select id="gender" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="man">Man</option>
                <option value="woman">Woman</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="country">Country</label>
              <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
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
            <div className="form-buttons">
              <button type="button" className="form-btn cancel-btn" onClick={() => setEditOpen(false)}>Cancel</button>
              <button type="submit" className="form-btn save-btn">Save Changes</button>
            </div>
          </form>
        </div>
      </div>

      {/* Change Password Modal */}
      <div id="changePasswordModal" className={`modal${passwordOpen ? ' active' : ''}`}>
        <div className="modal-content">
          <span className="close" onClick={() => setPasswordOpen(false)}>&times;</span>
          <h2>Change Password</h2>
          <form className="form-grid" onSubmit={changePassword}>
            <div className="form-group">
              <label htmlFor="currentPassword">Current Password</label>
              <input type="password" id="currentPassword" placeholder="Enter current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="newPassword">New Password</label>
              <input type="password" id="newPassword" placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <input type="password" id="confirmPassword" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <div className="form-buttons">
              <button type="button" className="form-btn cancel-btn" onClick={() => setPasswordOpen(false)}>Cancel</button>
              <button type="submit" className="form-btn save-btn">Change Password</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}