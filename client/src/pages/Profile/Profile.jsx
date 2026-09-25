import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import AppDialog from '../../components/ui/AppDialog.jsx';
import cssRaw from './Profile.css?raw';

const COUNTRY_OPTIONS = [
  'Bangladesh',
  'India',
  'Pakistan',
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'Japan',
  'Brazil',
];

const GENDER_OPTIONS = [
  { value: 'man', label: 'Man' },
  { value: 'woman', label: 'Woman' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

function buildSuccessTone(message) {
  return message.includes('success') || message.includes('deleted') || message.includes('published')
    ? 'success'
    : 'error';
}

export default function Profile() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Profile');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { user, logout, refreshUser } = useAuth();
  const { playlists, favorites, history } = useOutletContext();
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteRecordingOpen, setDeleteRecordingOpen] = useState(false);
  const [recordingToDelete, setRecordingToDelete] = useState(null);
  const [name, setName] = useState(user?.name || '');
  const [dob, setDob] = useState(user?.dob ? String(user.dob).slice(0, 10) : '');
  const [gender, setGender] = useState(user?.gender || '');
  const [country, setCountry] = useState(user?.country || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [libraryVisibility, setLibraryVisibility] = useState(user?.libraryVisibility || 'private');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (!user) return;

    setName(user.name || '');
    setDob(user.dob ? String(user.dob).slice(0, 10) : '');
    setGender(user.gender || '');
    setCountry(user.country || '');
    setBio(user.bio || '');
    setLibraryVisibility(user.libraryVisibility || 'private');

    const fetchRecordings = async () => {
      setRecordingsLoading(true);
      const data = await api.get('/api/recordings');
      if (data.success) {
        setRecordings(data.recordings || []);
      }
      setRecordingsLoading(false);
    };

    fetchRecordings();
  }, [user]);

  if (!user) return null;

  const initials = (user.name || 'U')
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const setApiMessage = (text) => {
    setMessage(text || 'Something went wrong');
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setMessage('');

    const data = await api.put('/api/auth/me', { name, dob, gender, country });
    if (!data.success) {
      setApiMessage(data.error || 'Update failed');
      return;
    }

    await api.put('/api/users/me/settings', { bio });
    await refreshUser();
    setApiMessage('Profile updated successfully');
    setEditOpen(false);
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setMessage('');

    if (newPassword !== confirmPassword) {
      setApiMessage('New passwords do not match');
      return;
    }

    const data = await api.post('/api/auth/me/password', { currentPassword, newPassword });
    if (!data.success) {
      setApiMessage(data.error || 'Password change failed');
      return;
    }

    setApiMessage('Password changed successfully');
    setPasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setMessage('');

    const data = await api.put('/api/users/me/settings', { bio, libraryVisibility });
    if (!data.success) {
      setApiMessage(data.error || 'Update failed');
      return;
    }

    await refreshUser();
    setApiMessage('Settings updated successfully');
    setSettingsOpen(false);
  };

  const confirmDeleteRecording = async () => {
    if (!recordingToDelete) return;
    const data = await api.del(`/api/recordings/${recordingToDelete}`);
    if (data.success) {
      setRecordings((prev) => prev.filter((recording) => recording._id !== recordingToDelete));
      setApiMessage('Recording deleted');
    } else {
      setApiMessage(data.error || 'Failed to delete recording');
    }
    setDeleteRecordingOpen(false);
    setRecordingToDelete(null);
  };

  const publishRecording = async (recordingId) => {
    const data = await api.post(`/api/recordings/${recordingId}/publish`, {});
    if (data.success) {
      setRecordings((prev) => prev.map((recording) => (
        recording._id === recordingId
          ? { ...recording, publishedAsPost: true }
          : recording
      )));
      setApiMessage('Recording published to feed!');
    } else {
      setApiMessage(data.error || 'Failed to publish');
    }
  };

  return (
    <div className="profile-page">
      <section className="profile-hero app-surface">
        <div className="profile-avatar" aria-hidden="true">{initials}</div>
        <div className="profile-hero-meta">
          <h1>{user.name}</h1>
          <p>{user.email}</p>
          <div className="profile-hero-stats" aria-label="Profile quick stats">
            <span>{favorites.length} liked songs</span>
            <span>{playlists.length} playlists</span>
            <span>{history.length} recent plays</span>
          </div>
          <div className="profile-hero-actions">
            <button type="button" className="music-pill-btn" onClick={() => setEditOpen(true)}>Edit Profile</button>
            <button type="button" className="music-outline-btn" onClick={() => setSettingsOpen(true)}>Privacy & Settings</button>
            <button type="button" className="music-outline-btn" onClick={() => setPasswordOpen(true)}>Change Password</button>
            <button
              type="button"
              className="music-outline-btn"
              onClick={() => {
                logout();
                window.location.href = '/login';
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </section>

      {message ? (
        <p
          className={`profile-message ${buildSuccessTone(message)}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}

      <section className="profile-tabs app-surface" aria-label="Profile sections">
        <button
          type="button"
          className={`profile-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
          aria-pressed={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={`profile-tab ${activeTab === 'recordings' ? 'is-active' : ''}`}
          aria-pressed={activeTab === 'recordings'}
          onClick={() => setActiveTab('recordings')}
        >
          My Recordings ({recordings.length})
        </button>
      </section>

      {activeTab === 'overview' ? (
        <section className="music-section app-surface">
          <SectionHeader title="Personal Information" subtitle="Managed through your Melodify account" />
          <div className="profile-grid">
            <article className="profile-card"><label>Full Name</label><strong>{user.name}</strong></article>
            <article className="profile-card"><label>Email</label><strong>{user.email}</strong></article>
            <article className="profile-card"><label>Date of Birth</label><strong>{user.dob ? String(user.dob).slice(0, 10) : '-'}</strong></article>
            <article className="profile-card"><label>Gender</label><strong>{user.gender || '-'}</strong></article>
            <article className="profile-card"><label>Country</label><strong>{user.country || '-'}</strong></article>
            <article className="profile-card"><label>Bio</label><strong>{user.bio || 'No bio yet'}</strong></article>
            <article className="profile-card"><label>Song Library</label><strong>{user.libraryVisibility || 'private'}</strong></article>
            <article className="profile-card"><label>Premium</label><strong><Link to="/premium" className="profile-link">Manage premium plan</Link></strong></article>
          </div>
        </section>
      ) : null}

      {activeTab === 'recordings' ? (
        <section className="music-section app-surface">
          <SectionHeader title="My Karaoke Recordings" subtitle="Publish to feed or remove old takes" />
          {recordingsLoading ? <p className="profile-status" role="status">Loading recordings...</p> : null}

          {!recordingsLoading && recordings.length === 0 ? (
            <EmptyState
              icon="fa-microphone-lines"
              title="No recordings yet"
              detail="Record your first song in Melodify Studio."
            />
          ) : null}

          {!recordingsLoading && recordings.length > 0 ? (
            <div className="profile-recordings">
              {recordings.map((recording) => (
                <article key={recording._id} className="profile-recording-card">
                  <header>
                    {recording.karaoke?.poster_url ? (
                      <img src={recording.karaoke.poster_url} alt="" className="profile-recording-art" />
                    ) : null}
                    <div>
                      <h3>{recording.title}</h3>
                      <p>{recording.karaoke?.title} - {recording.karaoke?.artist}</p>
                      <small>
                        {recording.effects?.preset ? `Effect: ${recording.effects.preset}` : 'No effect preset'}
                        {recording.duration > 0 ? ` • ${Math.floor(recording.duration / 60)}:${String(recording.duration % 60).padStart(2, '0')}` : ''}
                        {recording.publishedAsPost ? ' • Published' : ''}
                      </small>
                    </div>
                    <span className="profile-recording-badge">{recording.visibility}</span>
                  </header>

                  <audio controls src={recording.audioUrl} className="profile-recording-audio"></audio>

                  <div className="profile-recording-actions">
                    {!recording.publishedAsPost ? (
                      <button type="button" className="music-pill-btn" onClick={() => publishRecording(recording._id)}>
                        Publish to Feed
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="music-outline-btn profile-danger"
                      onClick={() => {
                        setRecordingToDelete(recording._id);
                        setDeleteRecordingOpen(true);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <AppDialog
        open={editOpen}
        title="Edit Profile"
        onClose={() => setEditOpen(false)}
        labelledBy="profile-edit-dialog-title"
      >
        <form className="profile-form" onSubmit={saveProfile}>
          <label htmlFor="profile-name">Full Name</label>
          <input id="profile-name" type="text" value={name} onChange={(event) => setName(event.target.value)} required />

          <label htmlFor="profile-email">Email</label>
          <input id="profile-email" type="email" value={user.email} disabled />

          <label htmlFor="profile-dob">Date of Birth</label>
          <input id="profile-dob" type="date" value={dob} onChange={(event) => setDob(event.target.value)} required />

          <label htmlFor="profile-gender">Gender</label>
          <select id="profile-gender" value={gender} onChange={(event) => setGender(event.target.value)}>
            {GENDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <label htmlFor="profile-country">Country</label>
          <select id="profile-country" value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">Choose a country</option>
            {COUNTRY_OPTIONS.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>

          <label htmlFor="profile-bio">Bio</label>
          <textarea
            id="profile-bio"
            rows="4"
            maxLength="500"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="Tell listeners about yourself"
          />

          <div className="profile-form-actions">
            <button type="button" className="music-outline-btn" onClick={() => setEditOpen(false)}>Cancel</button>
            <button type="submit" className="music-pill-btn">Save Changes</button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={passwordOpen}
        title="Change Password"
        onClose={() => setPasswordOpen(false)}
        labelledBy="profile-password-dialog-title"
      >
        <form className="profile-form" onSubmit={changePassword}>
          <label htmlFor="profile-current-password">Current Password</label>
          <input
            id="profile-current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />

          <label htmlFor="profile-new-password">New Password</label>
          <input
            id="profile-new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />

          <label htmlFor="profile-confirm-password">Confirm New Password</label>
          <input
            id="profile-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />

          <div className="profile-form-actions">
            <button type="button" className="music-outline-btn" onClick={() => setPasswordOpen(false)}>Cancel</button>
            <button type="submit" className="music-pill-btn">Update Password</button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={settingsOpen}
        title="Privacy & Settings"
        onClose={() => setSettingsOpen(false)}
        labelledBy="profile-settings-dialog-title"
      >
        <form className="profile-form" onSubmit={saveSettings}>
          <label htmlFor="profile-settings-bio">Bio</label>
          <textarea
            id="profile-settings-bio"
            rows="4"
            maxLength="500"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />

          <label htmlFor="profile-library-visibility">Song Library Visibility</label>
          <select
            id="profile-library-visibility"
            value={libraryVisibility}
            onChange={(event) => setLibraryVisibility(event.target.value)}
          >
            <option value="private">Private - Only you can see your library</option>
            <option value="public">Public - Anyone can see your library</option>
          </select>

          <div className="profile-form-actions">
            <button type="button" className="music-outline-btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
            <button type="submit" className="music-pill-btn">Save Settings</button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={deleteRecordingOpen}
        title="Delete recording"
        onClose={() => {
          setDeleteRecordingOpen(false);
          setRecordingToDelete(null);
        }}
        labelledBy="profile-delete-recording-title"
        actions={(
          <>
            <button
              type="button"
              className="music-outline-btn"
              onClick={() => {
                setDeleteRecordingOpen(false);
                setRecordingToDelete(null);
              }}
            >
              Cancel
            </button>
            <button type="button" className="music-pill-btn profile-danger-btn" onClick={confirmDeleteRecording}>Delete</button>
          </>
        )}
      >
        <p className="profile-dialog-copy">This removes the recording permanently from your account.</p>
      </AppDialog>
    </div>
  );
}
