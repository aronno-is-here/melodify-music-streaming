import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import usePlayer from '../../hooks/usePlayer.js';
import { api } from '../../api/client.js';
import SongCard from '../../components/music/SongCard.jsx';
import SongRow from '../../components/music/SongRow.jsx';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import AppDialog from '../../components/ui/AppDialog.jsx';
import cssRaw from './UserProfile.css?raw';

const TABS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'library', label: 'Library' },
  { id: 'posts', label: 'Posts' },
  { id: 'recordings', label: 'Recordings' },
]);

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function UserProfile() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'UserProfile');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const player = usePlayer();
  const outlet = useOutletContext();
  const toggleFavorite = outlet?.toggleFavorite;
  const favoritedIds = outlet?.favoritedIds || new Set();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('overview');
  const [recordings, setRecordings] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);

  const [listDialogType, setListDialogType] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [listUsers, setListUsers] = useState([]);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    const data = await api.get(`/api/users/${id}`);
    if (!data.success) {
      setError(data.error || 'User not found');
      setLoading(false);
      return;
    }

    setProfile(data.user);
    setIsFollowing(Boolean(data.isFollowing));
    setFollowersCount(data.followersCount || 0);
    setFollowingCount(data.followingCount || 0);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!profile) return;

    let cancelled = false;
    (async () => {
      setRecordingsLoading(true);
      const data = await api.get(`/api/recordings/user/${id}`);
      if (cancelled) return;
      if (data.success) {
        setRecordings(data.recordings || []);
      }
      setRecordingsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, profile]);

  const playSongQueue = (songs, index) => {
    player.playSong(songs, index);
  };

  const handleFollow = async () => {
    if (followLoading) return;
    setFollowLoading(true);
    setStatusMessage('');

    const data = isFollowing
      ? await api.del(`/api/follows/${id}`)
      : await api.post(`/api/follows/${id}`);

    setFollowLoading(false);

    if (!data.success) {
      setStatusMessage(data.error || 'Unable to update follow status.');
      return;
    }

    setIsFollowing(!isFollowing);
    setFollowersCount(data.followersCount || 0);
    setStatusMessage(isFollowing ? 'Unfollowed user.' : 'Now following user.');
  };

  const openUserList = async (type) => {
    setListDialogType(type);
    setListLoading(true);
    setListError('');
    setListUsers([]);

    const path = type === 'followers' ? `/api/follows/${id}/followers` : `/api/follows/${id}/following`;
    const data = await api.get(path);

    if (!data.success) {
      setListError(data.error || 'Unable to load user list.');
      setListLoading(false);
      return;
    }

    setListUsers(data.users || []);
    setListLoading(false);
  };

  const profileSongs = profile?.songs || [];
  const profilePosts = profile?.posts || [];

  const listDialogTitle = useMemo(() => {
    if (listDialogType === 'followers') return 'Followers';
    if (listDialogType === 'following') return 'Following';
    return '';
  }, [listDialogType]);

  if (loading) {
    return (
      <div className="user-profile-page">
        <p className="up-status" role="status">Loading profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="user-profile-page">
        <section className="music-section app-surface">
          <p className="up-status up-status-error" role="alert">{error}</p>
          <Link to="/dashboard" className="music-outline-btn up-inline-link">Back to Dashboard</Link>
        </section>
      </div>
    );
  }

  const initial = profile?.name ? profile.name.charAt(0).toUpperCase() : '?';

  return (
    <div className="user-profile-page">
      <section className="music-section app-surface up-hero">
        <div className="up-avatar" aria-hidden="true">
          {profile.avatar ? <img src={profile.avatar} alt="" /> : initial}
        </div>

        <div className="up-meta">
          <h1>{profile.name}</h1>
          {profile.bio ? <p>{profile.bio}</p> : null}

          <div className="up-stat-row" role="group" aria-label="Profile relationship stats">
            <button type="button" className="up-stat-btn" onClick={() => openUserList('followers')}>
              <strong>{followersCount}</strong> Followers
            </button>
            <button type="button" className="up-stat-btn" onClick={() => openUserList('following')}>
              <strong>{followingCount}</strong> Following
            </button>
          </div>

          {!profile.isOwnProfile && currentUser ? (
            <button
              type="button"
              className={`music-pill-btn up-follow-btn ${isFollowing ? 'is-following' : ''}`}
              onClick={handleFollow}
              disabled={followLoading}
            >
              {followLoading ? 'Updating...' : isFollowing ? 'Following' : 'Follow'}
            </button>
          ) : null}

          {statusMessage ? <p className="up-status" role="status" aria-live="polite">{statusMessage}</p> : null}
        </div>
      </section>

      <section className="music-section app-surface up-tab-shell" aria-label="User profile sections">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`up-tab-btn ${activeTab === tab.id ? 'is-active' : ''}`}
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === 'overview' ? (
        <section className="music-section app-surface">
          <SectionHeader title="Highlights" subtitle="Public songs from this profile" />

          {profileSongs.length > 0 ? (
            <div className="up-song-grid">
              {profileSongs.slice(0, 8).map((song, index) => {
                const songId = String(song._id);
                const isActive = player.currentSong ? String(player.currentSong._id) === songId : false;
                return (
                  <SongCard
                    key={song._id}
                    song={song}
                    isPlaying={player.isPlaying}
                    isActive={isActive}
                    isFavorited={favoritedIds.has(songId)}
                    onPlay={() => playSongQueue(profileSongs, index)}
                    onToggleFavorite={() => {
                      if (toggleFavorite) toggleFavorite(song._id);
                    }}
                  />
                );
              })}
            </div>
          ) : profile.libraryVisibility === 'private' && !profile.isOwnProfile ? (
            <EmptyState icon="fa-lock" title="Private library" detail="This user's song library is private." />
          ) : (
            <EmptyState icon="fa-music" title="No public songs yet" detail="Songs shared by this user will appear here." />
          )}
        </section>
      ) : null}

      {activeTab === 'library' ? (
        <section className="music-section app-surface">
          <SectionHeader title="Song library" subtitle="Tap a song to play it in the global player" />

          {profileSongs.length > 0 ? (
            <div className="up-song-list">
              {profileSongs.map((song, index) => {
                const songId = String(song._id);
                const isActive = player.currentSong ? String(player.currentSong._id) === songId : false;
                return (
                  <SongRow
                    key={song._id}
                    song={song}
                    subtitle={song.artist}
                    isPlaying={player.isPlaying}
                    isActive={isActive}
                    isFavorited={favoritedIds.has(songId)}
                    trailing={<span className="up-row-meta">{song.genre || 'Unknown genre'}</span>}
                    onPlay={() => playSongQueue(profileSongs, index)}
                    onToggleFavorite={() => {
                      if (toggleFavorite) toggleFavorite(song._id);
                    }}
                  />
                );
              })}
            </div>
          ) : profile.libraryVisibility === 'private' && !profile.isOwnProfile ? (
            <EmptyState icon="fa-lock" title="Private library" detail="This user's song library is private." />
          ) : (
            <EmptyState icon="fa-music" title="No songs yet" detail="This user has not added songs yet." />
          )}
        </section>
      ) : null}

      {activeTab === 'posts' ? (
        <section className="music-section app-surface">
          <SectionHeader title="Published posts" subtitle="Community posts shared by this user" />

          {profilePosts.length > 0 ? (
            <div className="up-post-list">
              {profilePosts.map((post) => (
                <article key={post._id} className="up-post-card">
                  <header>
                    {(post.song?.poster_url || post.karaoke?.poster_url) ? (
                      <img src={post.song?.poster_url || post.karaoke?.poster_url} alt="" />
                    ) : null}
                    <div>
                      <h3>{post.title}</h3>
                      <p>{post.song?.title || post.karaoke?.title} - {post.song?.artist || post.karaoke?.artist}</p>
                    </div>
                  </header>

                  {post.caption ? <p className="up-post-caption">{post.caption}</p> : null}
                  <audio controls src={post.audioUrl} className="up-post-audio"></audio>

                  <footer>
                    <span>{post.likesCount || 0} likes</span>
                    <span>{post.commentsCount || 0} comments</span>
                    <span>{formatTimeAgo(post.createdAt)}</span>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon="fa-microphone-lines" title="No posts yet" detail="Published karaoke posts will appear here." />
          )}
        </section>
      ) : null}

      {activeTab === 'recordings' ? (
        <section className="music-section app-surface">
          <SectionHeader title="Karaoke recordings" subtitle="Recent takes and effects" />

          {recordingsLoading ? <p className="up-status" role="status">Loading recordings...</p> : null}

          {!recordingsLoading && recordings.length === 0 ? (
            <EmptyState icon="fa-microphone-lines" title="No recordings yet" detail="No saved karaoke recordings are available." />
          ) : null}

          {!recordingsLoading && recordings.length > 0 ? (
            <div className="up-recording-list">
              {recordings.map((recording) => (
                <article key={recording._id} className="up-recording-card">
                  <header>
                    {(recording.karaoke?.poster_url || recording.backingSong?.poster_url) ? (
                      <img src={recording.karaoke?.poster_url || recording.backingSong?.poster_url} alt="" />
                    ) : null}
                    <div>
                      <h3>{recording.title}</h3>
                      <p>
                        {recording.karaoke?.title || recording.backingSong?.title || 'Unknown track'} -{' '}
                        {recording.karaoke?.artist || recording.backingSong?.artist || 'Unknown artist'}
                      </p>
                      {recording.effects?.preset ? <small>Effect: {recording.effects.preset}</small> : null}
                    </div>
                    <span>{recording.visibility}</span>
                  </header>
                  <audio controls src={recording.audioUrl}></audio>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <AppDialog
        open={Boolean(listDialogType)}
        title={listDialogTitle}
        onClose={() => {
          setListDialogType('');
          setListUsers([]);
          setListError('');
        }}
        labelledBy="user-profile-list-dialog-title"
      >
        <div className="up-list-dialog">
          {listLoading ? <p className="up-status" role="status">Loading...</p> : null}
          {listError ? <p className="up-status up-status-error" role="alert">{listError}</p> : null}

          {!listLoading && !listError && listUsers.length === 0 ? (
            <p className="up-status" role="status">No users found.</p>
          ) : null}

          {listUsers.length > 0 ? (
            <ul className="up-list-users">
              {listUsers.map((listUser) => (
                <li key={listUser._id}>
                  <Link to={`/user/${listUser._id}`} onClick={() => setListDialogType('')}>
                    <span className="up-list-avatar" aria-hidden="true">
                      {listUser.avatar ? <img src={listUser.avatar} alt="" /> : listUser.name.charAt(0).toUpperCase()}
                    </span>
                    <span>{listUser.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </AppDialog>
    </div>
  );
}
