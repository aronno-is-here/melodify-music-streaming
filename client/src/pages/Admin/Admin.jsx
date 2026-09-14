import { useEffect, useLayoutEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Admin.css?raw';

const SECTIONS = ['dashboard', 'users', 'music', 'moderation', 'subscriptions'];

export default function Admin() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Admin');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const { user, logout } = useAuth();
  const [section, setSection] = useState('dashboard');
  const [stats, setStats] = useState({ users: 0, plays: 0, revenue: 0 });
  const [users, setUsers] = useState([]);
  const [songs, setSongs] = useState([]);
  const [reports, setReports] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [message, setMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [editingSong, setEditingSong] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [s, u, sg, r, sub] = await Promise.all([
      api.get('/api/admin/stats'),
      api.get('/api/admin/users'),
      api.get('/api/songs?limit=100'),
      api.get('/api/admin/reports'),
      api.get('/api/admin/subscriptions'),
    ]);
    if (s.success) setStats(s.stats);
    if (u.success) setUsers(u.users);
    if (sg.success) setSongs(sg.songs);
    if (r.success) setReports(r.reports);
    if (sub.success) setSubscriptions(sub.subscriptions);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const showMessage = (msg, isError = false) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const deleteUser = async (id) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    const data = await api.del(`/api/admin/users/${id}`);
    if (data.success) {
      showMessage('User deleted');
      setUsers((prev) => prev.filter((u) => u._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete user', true);
    }
  };

  const updateUserRole = async (id, role) => {
    const data = await api.put(`/api/admin/users/${id}`, { role });
    if (data.success) {
      showMessage('User updated');
      setUsers((prev) => prev.map((u) => (u._id === id ? { ...u, role } : u)));
      setEditingUser(null);
    } else {
      showMessage(data.error || 'Failed to update user', true);
    }
  };

  const deleteSong = async (id) => {
    if (!confirm('Are you sure you want to delete this song?')) return;
    const data = await api.del(`/api/songs/${id}`);
    if (data.success) {
      showMessage('Song deleted');
      setSongs((prev) => prev.filter((s) => s._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete song', true);
    }
  };

  const updateSong = async (id, updates) => {
    const data = await api.put(`/api/songs/${id}`, updates);
    if (data.success) {
      showMessage('Song updated');
      setSongs((prev) => prev.map((s) => (s._id === id ? data.song : s)));
      setEditingSong(null);
    } else {
      showMessage(data.error || 'Failed to update song', true);
    }
  };

  const resolveReport = async (id, status) => {
    const data = await api.put(`/api/admin/reports/${id}`, { status });
    if (data.success) {
      showMessage(`Report ${status}`);
      setReports((prev) => prev.map((r) => (r._id === id ? { ...r, status } : r)));
    } else {
      showMessage(data.error || 'Failed to update report', true);
    }
  };

  const deleteReport = async (id) => {
    if (!confirm('Delete this report?')) return;
    const data = await api.del(`/api/admin/reports/${id}`);
    if (data.success) {
      showMessage('Report deleted');
      setReports((prev) => prev.filter((r) => r._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete report', true);
    }
  };

  const updateSubscription = async (id, status) => {
    const data = await api.put(`/api/admin/subscriptions/${id}`, { status });
    if (data.success) {
      showMessage('Subscription updated');
      setSubscriptions((prev) => prev.map((s) => (s._id === id ? { ...s, status } : s)));
    } else {
      showMessage(data.error || 'Failed to update subscription', true);
    }
  };

  const addSong = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = await api.post('/api/songs/upload', formData);
    if (data.success) {
      showMessage('Song added successfully!');
      e.target.reset();
      loadAll();
    } else {
      showMessage(data.error || 'Failed to add song', true);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#fff' }}>
        <p>Loading admin panel...</p>
      </div>
    );
  }

  return (
    <>
      <div className="header">
        <h1>Melodify Admin Panel</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#b3b3b3' }}>{user?.email}</span>
          <button className="logout-btn" onClick={() => logout()}>Logout</button>
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
          {message && <div className={`message ${message.includes('success') || message.includes('updated') || message.includes('deleted') ? 'success' : 'error'}`}>{message}</div>}

          {section === 'dashboard' && (
            <div id="dashboard" className="card">
              <h2>Dashboard</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                <div className="card"><h3>Total Users</h3><p style={{ fontSize: 32, fontWeight: 'bold' }}>{stats.users}</p></div>
                <div className="card"><h3>Total Songs</h3><p style={{ fontSize: 32, fontWeight: 'bold' }}>{songs.length}</p></div>
                <div className="card"><h3>Plays</h3><p style={{ fontSize: 32, fontWeight: 'bold' }}>{stats.plays}</p></div>
                <div className="card"><h3>Revenue</h3><p style={{ fontSize: 32, fontWeight: 'bold' }}>${stats.revenue}</p></div>
              </div>
            </div>
          )}

          {section === 'users' && (
            <div id="users" className="card">
              <h2>User Management</h2>
              <input
                type="text"
                placeholder="Search users..."
                style={{ width: '100%', padding: 10, marginBottom: 10, background: 'var(--accent-black, #000)', border: '1px solid var(--gray, #333)', color: 'var(--white, #fff)', borderRadius: 4 }}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              <table>
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u._id}>
                      <td>{u._id.slice(-6)}</td>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>
                        {editingUser === u._id ? (
                          <select value={u.role} onChange={(e) => updateUserRole(u._id, e.target.value)}>
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : u.role}
                      </td>
                      <td>
                        <button className="btn" onClick={() => setEditingUser(u._id)}>Edit</button>
                        <button className="btn btn-danger" onClick={() => deleteUser(u._id)}>Delete</button>
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
              <form onSubmit={addSong} style={{ marginBottom: 20 }}>
                <div className="form-group"><label>Title</label><input type="text" name="title" required /></div>
                <div className="form-group"><label>Artist</label><input type="text" name="artist" required /></div>
                <div className="form-group">
                  <label>Genre</label>
                  <select name="genre" required>
                    <option value="Pop">Pop</option>
                    <option value="Rock">Rock</option>
                    <option value="Bengali">Bengali</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Romantic">Romantic</option>
                    <option value="Metal">Metal</option>
                    <option value="Melodious">Melodious</option>
                  </select>
                </div>
                <div className="form-group"><label>Duration</label><input type="text" name="duration" placeholder="3:45" /></div>
                <div className="form-group"><label>Song File (MP3/WAV)</label><input type="file" name="song_file" accept=".mp3,.wav" required /></div>
                <div className="form-group"><label>Poster Image (JPG/PNG)</label><input type="file" name="poster_file" accept=".jpg,.jpeg,.png" /></div>
                <div className="form-group"><label>Release Date</label><input type="date" name="release_date" /></div>
                <button type="submit" className="btn">Add Song</button>
              </form>
              {editingSong && (
                <div style={{ marginBottom: 20, padding: 15, border: '1px solid #00b4d8', borderRadius: 8 }}>
                  <h3>Edit Song</h3>
                  <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); updateSong(editingSong._id, Object.fromEntries(fd)); }}>
                    <div className="form-group"><label>Title</label><input type="text" name="title" defaultValue={editingSong.title} required /></div>
                    <div className="form-group"><label>Artist</label><input type="text" name="artist" defaultValue={editingSong.artist} required /></div>
                    <div className="form-group"><label>Genre</label><input type="text" name="genre" defaultValue={editingSong.genre} required /></div>
                    <div className="form-group"><label>Duration</label><input type="text" name="duration" defaultValue={editingSong.duration} /></div>
                    <button type="submit" className="btn">Save</button>
                    <button type="button" className="btn" onClick={() => setEditingSong(null)} style={{ marginLeft: 10 }}>Cancel</button>
                  </form>
                </div>
              )}
              <table style={{ marginTop: 20 }}>
                <thead>
                  <tr><th>ID</th><th>Title</th><th>Artist</th><th>Genre</th><th>Duration</th><th>Actions</th></tr>
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
                        <button className="btn" onClick={() => setEditingSong(song)}>Edit</button>
                        <button className="btn btn-danger" onClick={() => deleteSong(song._id)}>Delete</button>
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
              {reports.length === 0 ? <p>No reports</p> : (
                <table>
                  <thead>
                    <tr><th>ID</th><th>Type</th><th>User</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r._id}>
                        <td>{r._id.slice(-6)}</td>
                        <td>{r.type}</td>
                        <td>{r.user_email}</td>
                        <td>{r.reason}</td>
                        <td>{r.status}</td>
                        <td>
                          {r.status === 'pending' && (
                            <>
                              <button className="btn" onClick={() => resolveReport(r._id, 'resolved')}>Resolve</button>
                              <button className="btn" onClick={() => resolveReport(r._id, 'dismissed')} style={{ marginLeft: 5 }}>Dismiss</button>
                            </>
                          )}
                          <button className="btn btn-danger" onClick={() => deleteReport(r._id)} style={{ marginLeft: 5 }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {section === 'subscriptions' && (
            <div id="subscriptions" className="card">
              <h2>Subscription Management</h2>
              {subscriptions.length === 0 ? <p>No subscriptions</p> : (
                <table>
                  <thead>
                    <tr><th>User Email</th><th>Plan</th><th>Status</th><th>End Date</th><th>Amount</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub) => (
                      <tr key={sub._id}>
                        <td>{sub.user_email}</td>
                        <td>{sub.plan}</td>
                        <td>{sub.status}</td>
                        <td>{sub.end_date ? String(sub.end_date).slice(0, 10) : '-'}</td>
                        <td>${sub.amount}</td>
                        <td>
                          {sub.status === 'active' ? (
                            <button className="btn btn-danger" onClick={() => updateSubscription(sub._id, 'expired')}>Expire</button>
                          ) : (
                            <button className="btn" onClick={() => updateSubscription(sub._id, 'active')}>Activate</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
