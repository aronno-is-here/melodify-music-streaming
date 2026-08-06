import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import './Admin.css';

const SECTIONS = ['dashboard', 'users', 'music', 'moderation', 'analytics', 'subscriptions', 'settings'];

export default function Admin() {
  const { user, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [section, setSection] = useState('dashboard');
  const [stats, setStats] = useState({ users: 0, songs: 0, plays: 0, revenue: 0 });
  const [users, setUsers] = useState([]);
  const [songs, setSongs] = useState([]);
  const [reports, setReports] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [message, setMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');

  const isAdmin = user?.role === 'admin';

  const loadAll = async () => {
    const [s, u, sg, r, sub] = await Promise.all([
      api.get('/api/admin/stats'),
      api.get('/api/admin/users'),
      api.get('/api/songs?limit=20'),
      api.get('/api/admin/reports'),
      api.get('/api/admin/subscriptions'),
    ]);
    if (s.success) setStats(s.stats);
    if (u.success) setUsers(u.users);
    if (sg.success) setSongs(sg.songs);
    if (r.success) setReports(r.reports);
    if (sub.success) setSubscriptions(sub.subscriptions);
  };

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const data = await api.post('/api/auth/login', { email, password });
    if (data.success && data.user.role === 'admin') {
      login(data.token, data.user);
      loadAll();
    } else if (data.success) {
      setError('Admin access required. Use the admin credentials.');
    } else {
      setError(data.error || 'Invalid credentials');
    }
  };

  const addSong = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = await api.post('/api/songs/upload', formData);
    if (data.success) {
      setMessage('Song added successfully!');
      e.target.reset();
      loadAll();
    } else {
      setMessage('Error adding song: ' + data.error);
    }
  };

  if (!isAdmin) {
    return (
      <div className="admin-login-page">
        <form className="login-form" onSubmit={handleLogin}>
          <h2>Admin Login</h2>
          {error && <div className="error">{error}</div>}
          <input type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit">Login</button>
        </form>
      </div>
    );
  }

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="header">
        <h1>Melodify Admin Panel</h1>
        <div>
          <button className="logout-btn" onClick={() => logout()}>
            Logout
          </button>
        </div>
      </div>
      <div className="main">
        <nav className="sidebar">
          <h3>Navigation</h3>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s}>
                <a className={section === s ? 'active' : ''} onClick={() => setSection(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1).replace('moderation', ' Content Moderation')}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="content">
          {message && <div className={`message ${message.includes('successfully') ? 'success' : 'error'}`}>{message}</div>}

          {section === 'dashboard' && (
            <div id="dashboard" className="card">
              <h2>Dashboard</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                <div className="card"><h3>Total Users: {stats.users}</h3></div>
                <div className="card"><h3>Total Songs: {stats.songs}</h3></div>
                <div className="card"><h3>Daily Plays: {stats.plays}</h3></div>
                <div className="card"><h3>Revenue: ${stats.revenue}</h3></div>
              </div>
            </div>
          )}

          {section === 'users' && (
            <div id="users" className="card">
              <h2>User Management</h2>
              <input
                type="text"
                placeholder="Search users..."
                id="userSearch"
                style={{ width: '100%', padding: 10, marginBottom: 10, background: 'var(--accent-black)', border: '1px solid var(--gray)', color: 'var(--white)', borderRadius: 4 }}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="userTable">
                  {filteredUsers.map((u) => (
                    <tr key={u._id}>
                      <td>{u._id.slice(-6)}</td>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>{u.role}</td>
                      <td>
                        <button className="btn" onClick={() => alert('Editing user ' + u._id)}>Edit</button>
                        <button className="btn btn-danger" onClick={() => alert('Banning user ' + u._id)}>Ban</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'music' && (
            <div id="music" className="card">
              <h2>Music Catalog</h2>
              <form onSubmit={addSong}>
                <div className="form-group"><label>Title</label><input type="text" name="title" required /></div>
                <div className="form-group"><label>Artist</label><input type="text" name="artist" required /></div>
                <div className="form-group">
                  <label>Genre</label>
                  <select name="genre" required>
                    <option value="Pop">Pop</option>
                    <option value="Rock">Rock</option>
                    <option value="Bengali">Bengali</option>
                    <option value="Hindi">Hindi</option>
                  </select>
                </div>
                <div className="form-group"><label>Duration</label><input type="text" name="duration" placeholder="3:45" /></div>
                <div className="form-group"><label>Song File (MP3/WAV)</label><input type="file" name="song_file" accept=".mp3,.wav" required /></div>
                <div className="form-group"><label>Poster Image (JPG/PNG)</label><input type="file" name="poster_file" accept=".jpg,.jpeg,.png" /></div>
                <div className="form-group"><label>Release Date</label><input type="date" name="release_date" /></div>
                <button type="submit" className="btn">Add Song</button>
              </form>
              <table style={{ marginTop: 20 }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Artist</th>
                    <th>Genre</th>
                    <th>Duration</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {songs.map((song) => (
                    <tr key={song._id}>
                      <td>{song._id.slice(-6)}</td>
                      <td>{song.title}</td>
                      <td>{song.artist}</td>
                      <td>{song.genre}</td>
                      <td>{song.duration}</td>
                      <td>
                        <button className="btn" onClick={() => alert('Editing song ' + song.title)}>Edit</button>
                        <button className="btn btn-danger" onClick={() => confirm('Delete song?') && alert('Deleted ' + song.title)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'moderation' && (
            <div id="moderation" className="card">
              <h2>Content Moderation</h2>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>User</th>
                    <th>Content ID</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r._id}>
                      <td>{r._id.slice(-6)}</td>
                      <td>{r.type}</td>
                      <td>{r.user_email}</td>
                      <td>{r.content_id}</td>
                      <td>{r.reason}</td>
                      <td>{r.status}</td>
                      <td>
                        <button className="btn" onClick={() => alert('Resolved report ' + r._id)}>Resolve</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'analytics' && (
            <div id="analytics" className="card">
              <h2>Analytics Dashboard</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 20 }}>
                <div className="card"><h3>Total Users: {stats.users}</h3></div>
                <div className="card"><h3>Total Songs: {stats.songs}</h3></div>
                <div className="card"><h3>Daily Plays: {stats.plays}</h3></div>
                <div className="card"><h3>Revenue: ${stats.revenue}</h3></div>
              </div>
              <canvas id="userGrowthChart" width="400" height="200" style={{ background: 'var(--accent-black)', borderRadius: 8 }}></canvas>
            </div>
          )}

          {section === 'subscriptions' && (
            <div id="subscriptions" className="card">
              <h2>Subscription &amp; Payment Management</h2>
              <table>
                <thead>
                  <tr>
                    <th>User Email</th>
                    <th>Status</th>
                    <th>End Date</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub) => (
                    <tr key={sub._id}>
                      <td>{sub.user_email}</td>
                      <td>{sub.status}</td>
                      <td>{sub.end_date ? String(sub.end_date).slice(0, 10) : '-'}</td>
                      <td>${sub.amount}</td>
                      <td>
                        <button className="btn" onClick={() => alert('Extended ' + sub._id)}>Extend</button>
                        <button className="btn btn-danger" onClick={() => alert('Canceled ' + sub._id)}>Cancel</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'settings' && (
            <div id="settings" className="card">
              <h2>System Settings</h2>
              <form onSubmit={(e) => { e.preventDefault(); setMessage('Settings saved'); }}>
                <div className="form-group">
                  <label>Default Theme</label>
                  <select name="theme">
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Max Downloads per User</label>
                  <input type="number" name="max_downloads" value="5" />
                </div>
                <button type="submit" className="btn">Save Settings</button>
              </form>
            </div>
          )}
        </main>
      </div>
    </>
  );
}