import { useEffect, useLayoutEffect, useState } from 'react';
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
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [dob, setDob] = useState(user?.dob ? String(user.dob).slice(0, 10) : '');
  const [gender, setGender] = useState(user?.gender || '');
  const [country, setCountry] = useState(user?.country || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [libraryVisibility, setLibraryVisibility] = useState(user?.libraryVisibility || 'private');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setDob(user.dob ? String(user.dob).slice(0, 10) : '');
      setGender(user.gender || '');
      setCountry(user.country || '');
      setBio(user.bio || '');
      setLibraryVisibility(user.libraryVisibility || 'private');

      const fetchRecordings = async () => {
        setRecordingsLoading(true);
        const data = await api.get('/api/recordings');
        if (data.success) setRecordings(data.recordings);
        setRecordingsLoading(false);
      };
      fetchRecordings();
    }
  }, [user]);

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
      await api.put('/api/users/me/settings', { bio });
      await refreshUser();
      setMsg('Profile updated successfully');
      setEditOpen(false);
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

  const saveSettings = async (e) => {
    e.preventDefault();
    setMsg('');
    const data = await api.put('/api/users/me/settings', { bio, libraryVisibility });
    if (data.success) {
      await refreshUser();
      setMsg('Settings updated successfully');
      setSettingsOpen(false);
    } else {
      setMsg(data.error || 'Update failed');
    }
  };

  const deleteRecording = async (id) => {
    if (!confirm('Are you sure you want to delete this recording?')) return;
    const data = await api.del(`/api/recordings/${id}`);
    if (data.success) {
      setRecordings((prev) => prev.filter((r) => r._id !== id));
      setMsg('Recording deleted');
    } else {
      setMsg(data.error || 'Failed to delete recording');
    }
  };

  const publishRecording = async (id) => {
    const data = await api.post(`/api/recordings/${id}/publish`, {});
    if (data.success) {
      setRecordings((prev) => prev.map((r) => r._id === id ? { ...r, publishedAsPost: true } : r));
      setMsg('Recording published to feed!');
    } else {
      setMsg(data.error || 'Failed to publish');
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
          <Link to="/premium">Premium</Link>
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
              <a href="#" onClick={(e) => { e.preventDefault(); setSettingsOpen(true); }}>Privacy & Settings</a>
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
            <div style={{ padding: 10, marginBottom: 15, borderRadius: 4, background: msg.includes('success') || msg.includes('deleted') || msg.includes('published') ? '#4caf50' : '#dc3545', color: '#fff' }}>{msg}</div>
          )}

          <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 4 }}>
            <button
              onClick={() => setActiveTab('overview')}
              style={{ flex: 1, padding: '10px 16px', border: 'none', borderRadius: 6, background: activeTab === 'overview' ? 'rgba(0,180,216,0.15)' : 'transparent', color: activeTab === 'overview' ? '#00b4d8' : '#b3b3b3', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('recordings')}
              style={{ flex: 1, padding: '10px 16px', border: 'none', borderRadius: 6, background: activeTab === 'recordings' ? 'rgba(0,180,216,0.15)' : 'transparent', color: activeTab === 'recordings' ? '#00b4d8' : '#b3b3b3', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              My Recordings ({recordings.length})
            </button>
          </div>

          {activeTab === 'overview' && (
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
                <div className="detail-item">
                  <label>Bio</label>
                  <span>{user.bio || 'No bio yet'}</span>
                </div>
                <div className="detail-item">
                  <label>Song Library</label>
                  <span style={{ textTransform: 'capitalize' }}>{user.libraryVisibility || 'private'}</span>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'recordings' && (
            <section className="section">
              <h2>My Karaoke Recordings</h2>
              {recordingsLoading ? (
                <p style={{ color: '#b3b3b3' }}>Loading recordings...</p>
              ) : recordings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#b3b3b3' }}>
                  <i className="fa-solid fa-microphone-lines" style={{ fontSize: 36, display: 'block', marginBottom: 12, color: 'rgba(255,255,255,0.15)' }}></i>
                  <p>No recordings yet</p>
                  <a href="/studio" style={{ color: '#00b4d8', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Go to Melodify Studio</a>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {recordings.map((rec) => (
                    <div key={rec._id} style={{ background: '#1a1a1a', borderRadius: 10, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                        {rec.karaoke?.poster_url && (
                          <img src={rec.karaoke.poster_url} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{rec.title}</div>
                          <div style={{ fontSize: 12, color: '#b3b3b3' }}>
                            {rec.karaoke?.title} - {rec.karaoke?.artist}
                          </div>
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                            {rec.effects?.preset && `Effect: ${rec.effects.preset} · `}
                            {rec.duration > 0 ? `${Math.floor(rec.duration / 60)}:${String(rec.duration % 60).padStart(2, '0')}` : ''}
                            {rec.publishedAsPost ? ' · Published' : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: '#888', textTransform: 'capitalize' }}>{rec.visibility}</span>
                      </div>
                      <audio controls src={rec.audioUrl} style={{ width: '100%', height: 36, borderRadius: 8 }}></audio>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        {!rec.publishedAsPost && (
                          <button
                            onClick={() => publishRecording(rec._id)}
                            style={{ padding: '6px 14px', borderRadius: 16, border: 'none', background: '#00b4d8', color: '#000', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          >
                            Publish to Feed
                          </button>
                        )}
                        <button
                          onClick={() => deleteRecording(rec._id)}
                          style={{ padding: '6px 14px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ff6b6b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
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
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="bio">Bio</label>
              <textarea id="bio" rows="3" maxLength="500" placeholder="Tell us about yourself..." value={bio} onChange={(e) => setBio(e.target.value)} style={{ width: '100%', padding: '10px', background: '#2a2a2a', border: '1px solid #b3b3b3', borderRadius: '20px', color: '#fff', fontSize: '14px', resize: 'vertical', fontFamily: 'inherit' }}></textarea>
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

      {/* Privacy & Settings Modal */}
      <div id="settingsModal" className={`modal${settingsOpen ? ' active' : ''}`}>
        <div className="modal-content">
          <span className="close" onClick={() => setSettingsOpen(false)}>&times;</span>
          <h2>Privacy & Settings</h2>
          <form className="form-grid" onSubmit={saveSettings}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="settingsBio">Bio</label>
              <textarea id="settingsBio" rows="3" maxLength="500" placeholder="Tell others about yourself..." value={bio} onChange={(e) => setBio(e.target.value)} style={{ width: '100%', padding: '10px', background: '#2a2a2a', border: '1px solid #b3b3b3', borderRadius: '20px', color: '#fff', fontSize: '14px', resize: 'vertical', fontFamily: 'inherit' }}></textarea>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="libraryVis">Song Library Visibility</label>
              <select id="libraryVis" value={libraryVisibility} onChange={(e) => setLibraryVisibility(e.target.value)} style={{ width: '100%', padding: '10px', background: '#2a2a2a', border: '1px solid #b3b3b3', borderRadius: '20px', color: '#fff', fontSize: '14px' }}>
                <option value="private">Private - Only you can see your library</option>
                <option value="public">Public - Anyone can see your library</option>
              </select>
            </div>
            <div className="form-buttons">
              <button type="button" className="form-btn cancel-btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button type="submit" className="form-btn save-btn">Save Settings</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}