import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Admin.css?raw';
import KaraokeForm from './KaraokeForm.jsx';
import CatalogSyncPanel from './CatalogSyncPanel.jsx';
import AdminAIRecommendation from './AdminAIRecommendation.jsx';

const SECTIONS = ['dashboard', 'users', 'music', 'karaoke', 'moderation', 'subscriptions', 'ai-recommendation'];

const EXISTING_SECTIONS = new Set(['dashboard', 'users', 'music', 'karaoke', 'moderation', 'subscriptions']);

const sectionLabel = (s) => {
  if (s === 'ai-recommendation') return 'AI Recommendation';
  if (s === 'karaoke') return 'Melodify Studio';
  return s.charAt(0).toUpperCase() + s.slice(1).replace('moderation', ' Content Moderation');
};

export default function Admin() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Admin');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [section, setSection] = useState(() => {
    if (location.pathname === '/admin/ai-recommendation') return 'ai-recommendation';
    if (
      location.state &&
      typeof location.state.section === 'string' &&
      EXISTING_SECTIONS.has(location.state.section)
    ) {
      return location.state.section;
    }
    return 'dashboard';
  });

  const handleSectionClick = (s) => {
    if (s === 'ai-recommendation') {
      navigate('/admin/ai-recommendation');
      return;
    }
    if (location.pathname === '/admin/ai-recommendation') {
      navigate('/admin', { state: { section: s } });
      return;
    }
    setSection(s);
  };
  const [stats, setStats] = useState({ users: 0, songs: 0, plays: 0, revenue: 0, activeSubs: 0, pendingReports: 0, recentPlays: [], monthlyRevenue: 0, lastMonthRevenue: 0, monthlySubs: 0, totalSubs: 0, revenueByPlan: {} });
  const [users, setUsers] = useState([]);
  const [songs, setSongs] = useState([]);
  const [reports, setReports] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [karaokeTracks, setKaraokeTracks] = useState([]);
  const [message, setMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [editingSong, setEditingSong] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const [s, u, sg, r, sub, kar] = await Promise.all([
      api.get('/api/admin/stats'),
      api.get('/api/admin/users'),
      api.get('/api/songs?limit=100'),
      api.get('/api/admin/reports'),
      api.get('/api/admin/subscriptions'),
      api.get('/api/karaoke/all'),
    ]);
    if (s.success) setStats(s.stats);
    if (u.success) setUsers(u.users);
    if (sg.success) setSongs(sg.songs);
    if (r.success) setReports(r.reports);
    if (sub.success) setSubscriptions(sub.subscriptions);
    if (kar.success) setKaraokeTracks(kar.karaoke);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => loadAll(true), 30000);
    return () => clearInterval(interval);
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

  const deleteKaraoke = async (id) => {
    if (!confirm('Are you sure you want to delete this karaoke track?')) return;
    const data = await api.del(`/api/karaoke/${id}`);
    if (data.success) {
      showMessage('Karaoke track deleted');
      setKaraokeTracks((prev) => prev.filter((k) => k._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete karaoke track', true);
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
    const form = e.target;
    const formData = new FormData(form);
    const hasYouTubeId = formData.get('youtube_id')?.trim();
    const hasSongFile = formData.get('song_file')?.size > 0;

    if (!hasYouTubeId && !hasSongFile) {
      showMessage('Please provide either a YouTube ID or upload a song file', true);
      return;
    }

    if (hasYouTubeId) {
      const body = {
        title: formData.get('title'),
        artist: formData.get('artist'),
        genre: formData.get('genre'),
        duration: formData.get('duration') || '3:00',
        youtube_id: hasYouTubeId,
        release_date: formData.get('release_date') || undefined,
        poster_url: formData.get('poster_url')?.trim() || undefined,
      };
      const data = await api.post('/api/songs', body);
      if (data.success) {
        showMessage('Song added successfully!');
        form.reset();
        loadAll();
      } else {
        showMessage(data.error || 'Failed to add song', true);
      }
    } else {
      const data = await api.post('/api/songs/upload', formData);
      if (data.success) {
        showMessage('Song uploaded successfully!');
        form.reset();
        loadAll();
      } else {
        showMessage(data.error || 'Failed to upload song', true);
      }
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
                <a className={section === s ? 'active' : ''} onClick={() => handleSectionClick(s)}>
                  {sectionLabel(s)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="content">
          {message && <div className={`message ${message.includes('success') || message.includes('updated') || message.includes('deleted') ? 'success' : 'error'}`}>{message}</div>}

          {section === 'dashboard' && (
            <div id="dashboard" className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                <h2>Dashboard</h2>
                <button className="btn" onClick={() => loadAll(true)} disabled={refreshing}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 15 }}>
                <div className="card stat-card"><h3>Users</h3><p className="stat-value">{stats.users}</p></div>
                <div className="card stat-card"><h3>Songs</h3><p className="stat-value">{stats.songs || songs.length}</p></div>
                <div className="card stat-card"><h3>Plays</h3><p className="stat-value">{stats.plays}</p></div>
                <div className="card stat-card"><h3>Active Subs</h3><p className="stat-value">{stats.activeSubs}</p></div>
                <div className="card stat-card"><h3>Pending Reports</h3><p className="stat-value">{stats.pendingReports}</p></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 15, marginTop: 20 }}>
                <div className="card stat-card" style={{ borderLeft: '3px solid #4caf50' }}>
                  <h3>Total Revenue</h3>
                  <p className="stat-value" style={{ color: '#4caf50' }}>${stats.revenue}</p>
                  <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{stats.totalSubs || 0} total subscriptions</p>
                </div>
                <div className="card stat-card" style={{ borderLeft: '3px solid #00b4d8' }}>
                  <h3>This Month</h3>
                  <p className="stat-value" style={{ color: '#00b4d8' }}>${stats.monthlyRevenue}</p>
                  <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{stats.monthlySubs || 0} new subs</p>
                </div>
                <div className="card stat-card" style={{ borderLeft: '3px solid #888' }}>
                  <h3>Last Month</h3>
                  <p className="stat-value">${stats.lastMonthRevenue}</p>
                  <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                    {stats.monthlyRevenue > stats.lastMonthRevenue ? (
                      <span style={{ color: '#4caf50' }}>+{stats.lastMonthRevenue > 0 ? Math.round(((stats.monthlyRevenue - stats.lastMonthRevenue) / stats.lastMonthRevenue) * 100) : 100}% vs last month</span>
                    ) : stats.monthlyRevenue < stats.lastMonthRevenue ? (
                      <span style={{ color: '#ff6b6b' }}>-{stats.lastMonthRevenue > 0 ? Math.round(((stats.lastMonthRevenue - stats.monthlyRevenue) / stats.lastMonthRevenue) * 100) : 100}% vs last month</span>
                    ) : (
                      <span>Same as last month</span>
                    )}
                  </p>
                </div>
              </div>

              {Object.keys(stats.revenueByPlan || {}).length > 0 && (
                <div style={{ marginTop: 15 }}>
                  <h3 style={{ color: 'var(--sky-blue)', marginBottom: 10 }}>Revenue by Plan</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {Object.entries(stats.revenueByPlan).map(([plan, data]) => (
                      <div key={plan} className="card" style={{ padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{plan}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#00b4d8' }}>${data.revenue}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{data.subs} active subscriber{data.subs !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {stats.recentPlays && stats.recentPlays.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h3 style={{ color: 'var(--sky-blue)', marginBottom: 10 }}>Recent Plays</h3>
                  <table>
                    <thead>
                      <tr><th>User</th><th>Song</th><th>When</th></tr>
                    </thead>
                    <tbody>
                      {stats.recentPlays.map((play, i) => (
                        <tr key={i}>
                          <td>{play.user?.name || play.user?.email || 'Unknown'}</td>
                          <td>{play.song?.title || 'Unknown'} - {play.song?.artist || ''}</td>
                          <td>{play.playedAt ? new Date(play.playedAt).toLocaleString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
                <div className="form-group"><label>Title *</label><input type="text" name="title" required /></div>
                <div className="form-group"><label>Artist *</label><input type="text" name="artist" required /></div>
                <div className="form-group">
                  <label>Genre *</label>
                  <select name="genre" required>
                    <option value="">Select genre</option>
                    <option value="Pop">Pop</option>
                    <option value="Rock">Rock</option>
                    <option value="Bengali">Bengali</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Romantic">Romantic</option>
                    <option value="Metal">Metal</option>
                    <option value="Melodious">Melodious</option>
                    <option value="Love">Love</option>
                    <option value="Happy">Happy</option>
                  </select>
                </div>
                <div className="form-group"><label>Duration</label><input type="text" name="duration" placeholder="3:45" /></div>
                <div className="form-group"><label>Release Date</label><input type="date" name="release_date" className="date-input" /></div>
                <div className="form-divider"><span>Add via YouTube</span></div>
                <div className="form-group"><label>YouTube ID</label><input type="text" name="youtube_id" placeholder="e.g. dQw4w9WgXcQ" /></div>
                <div className="form-group"><label>Poster URL (optional)</label><input type="url" name="poster_url" placeholder="https://img.youtube.com/vi/ID/hqdefault.jpg" /></div>
                <div className="form-divider"><span>— OR Upload File —</span></div>
                <div className="form-group"><label>Song File (MP3/WAV)</label><input type="file" name="song_file" accept=".mp3,.wav" /></div>
                <div className="form-group"><label>Poster Image (JPG/PNG)</label><input type="file" name="poster_file" accept=".jpg,.jpeg,.png" /></div>
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
              <CatalogSyncPanel />
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

          {section === 'karaoke' && (
            <div id="karaoke" className="card">
              <h2>Karaoke Tracks Management</h2>
              <p style={{ color: '#b3b3b3', marginBottom: 16, fontSize: 13 }}>
                Manage backing tracks available in Melodify Studio for karaoke recording.
              </p>

              <div className="form-divider">Add New Karaoke Track</div>
              <KaraokeForm onSuccess={(k) => { setKaraokeTracks((prev) => [k, ...prev]); showMessage('Karaoke track added'); }} onError={(e) => showMessage(e, true)} />

              <div className="form-divider">Existing Karaoke Tracks ({karaokeTracks.length})</div>
              {karaokeTracks.length === 0 ? (
                <p>No karaoke tracks yet</p>
              ) : (
                <table>
                  <thead>
                    <tr><th>Title</th><th>Artist</th><th>Genre</th><th>Duration</th><th>Available</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {karaokeTracks.map((k) => (
                      <tr key={k._id}>
                        <td>{k.title}</td>
                        <td>{k.artist}</td>
                        <td>{k.genre}</td>
                        <td>{k.duration}</td>
                        <td>{k.available ? 'Yes' : 'No'}</td>
                        <td>
                          <button className="btn" onClick={async () => {
                            const data = await api.put(`/api/karaoke/${k._id}`, { available: !k.available });
                            if (data.success) {
                              setKaraokeTracks((prev) => prev.map((t) => t._id === k._id ? { ...t, available: !t.available } : t));
                              showMessage(`Karaoke track ${k.available ? 'hidden' : 'shown'} in Studio`);
                            }
                          }}>{k.available ? 'Hide' : 'Show'}</button>
                          <button className="btn btn-danger" onClick={() => deleteKaraoke(k._id)} style={{ marginLeft: 5 }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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

          {section === 'ai-recommendation' && <AdminAIRecommendation />}
        </main>
      </div>
    </>
  );
}
