import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import usePlayer from '../../hooks/usePlayer.js';
import { api } from '../../api/client.js';
import cssRaw from './UserProfile.css?raw';

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
  const navigate = useNavigate();
  const player = usePlayer();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [followersList, setFollowersList] = useState([]);
  const [followingList, setFollowingList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('overview');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    const data = await api.get(`/api/users/${id}`);
    if (data.success) {
      setProfile(data.user);
      setIsFollowing(data.isFollowing);
      setFollowersCount(data.followersCount);
      setFollowingCount(data.followingCount);
    } else {
      setError(data.error || 'User not found');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleFollow = async () => {
    if (followLoading) return;
    setFollowLoading(true);
    if (isFollowing) {
      const data = await api.del(`/api/follows/${id}`);
      if (data.success) {
        setIsFollowing(false);
        setFollowersCount(data.followersCount);
      }
    } else {
      const data = await api.post(`/api/follows/${id}`);
      if (data.success) {
        setIsFollowing(true);
        setFollowersCount(data.followersCount);
      }
    }
    setFollowLoading(false);
  };

  const loadFollowers = async () => {
    setShowFollowers(true);
    setListLoading(true);
    const data = await api.get(`/api/follows/${id}/followers`);
    if (data.success) setFollowersList(data.users);
    setListLoading(false);
  };

  const loadFollowing = async () => {
    setShowFollowing(true);
    setListLoading(true);
    const data = await api.get(`/api/follows/${id}/following`);
    if (data.success) setFollowingList(data.users);
    setListLoading(false);
  };

  const playSong = (songs, index) => {
    player.playSong(songs, index);
  };

  if (loading) {
    return (
      <div className="up-page">
        <div className="up-loading">Loading profile...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="up-page">
        <div className="up-error">
          <p>{error}</p>
          <Link to="/dashboard" className="up-back-link">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const initial = profile?.name ? profile.name.charAt(0).toUpperCase() : '?';

  return (
    <div className="up-page">
      <header className="up-header">
        <Link to="/dashboard" className="up-back">
          <i className="fa-solid fa-chevron-left"></i>
          <span>Dashboard</span>
        </Link>
      </header>

      <main className="up-main">
        <div className="up-profile-card">
          <div className="up-avatar">
            {profile.avatar ? <img src={profile.avatar} alt={profile.name} /> : initial}
          </div>
          <div className="up-info">
            <h1 className="up-name">{profile.name}</h1>
            {profile.bio && <p className="up-bio">{profile.bio}</p>}
            <div className="up-stats">
              <button className="up-stat-btn" onClick={loadFollowers}>
                <strong>{followersCount}</strong> Followers
              </button>
              <button className="up-stat-btn" onClick={loadFollowing}>
                <strong>{followingCount}</strong> Following
              </button>
            </div>
            {!profile.isOwnProfile && currentUser && (
              <button
                className={`up-follow-btn ${isFollowing ? 'following' : ''}`}
                onClick={handleFollow}
                disabled={followLoading}
              >
                {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        </div>

        <div className="up-tabs">
          <button
            className={`up-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`up-tab ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            Library
          </button>
          <button
            className={`up-tab ${activeTab === 'posts' ? 'active' : ''}`}
            onClick={() => setActiveTab('posts')}
          >
            Posts
          </button>
        </div>

        {activeTab === 'overview' && (
          <div className="up-section">
            {profile.songs && profile.songs.length > 0 ? (
              <>
                <h2 className="up-section-title">Public Library</h2>
                <div className="up-song-grid">
                  {profile.songs.slice(0, 8).map((song, i) => (
                    <div
                      key={song._id}
                      className="up-song-card"
                      onClick={() => playSong(profile.songs, i)}
                    >
                      <div className="up-song-poster">
                        <img
                          src={song.poster_url || 'https://picsum.photos/150/150?random'}
                          alt={song.title}
                          onError={(e) => { e.target.src = 'https://picsum.photos/150/150?random'; }}
                        />
                        <div className="up-song-play">
                          <i className="fa-solid fa-play"></i>
                        </div>
                      </div>
                      <div className="up-song-info">
                        <span className="up-song-title">{song.title}</span>
                        <span className="up-song-artist">{song.artist}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : profile.libraryVisibility === 'private' && !profile.isOwnProfile ? (
              <div className="up-empty">
                <i className="fa-solid fa-lock"></i>
                <p>This user's song library is private</p>
              </div>
            ) : (
              <div className="up-empty">
                <i className="fa-solid fa-music"></i>
                <p>No songs in library yet</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'library' && (
          <div className="up-section">
            {profile.songs && profile.songs.length > 0 ? (
              <div className="up-song-list">
                {profile.songs.map((song, i) => (
                  <div
                    key={song._id}
                    className="up-song-row"
                    onClick={() => playSong(profile.songs, i)}
                  >
                    <span className="up-song-num">{i + 1}</span>
                    <img
                      className="up-song-row-poster"
                      src={song.poster_url || 'https://picsum.photos/40/40?random'}
                      alt=""
                      onError={(e) => { e.target.src = 'https://picsum.photos/40/40?random'; }}
                    />
                    <div className="up-song-row-info">
                      <span className="up-song-row-title">{song.title}</span>
                      <span className="up-song-row-artist">{song.artist}</span>
                    </div>
                    <span className="up-song-row-genre">{song.genre}</span>
                    <span className="up-song-row-duration">{song.duration}</span>
                  </div>
                ))}
              </div>
            ) : profile.libraryVisibility === 'private' && !profile.isOwnProfile ? (
              <div className="up-empty">
                <i className="fa-solid fa-lock"></i>
                <p>This user's song library is private</p>
              </div>
            ) : (
              <div className="up-empty">
                <i className="fa-solid fa-music"></i>
                <p>No songs in library yet</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'posts' && (
          <div className="up-section">
            {profile.posts && profile.posts.length > 0 ? (
              <div className="up-posts-grid">
                {profile.posts.map((post) => (
                  <div key={post._id} className="up-post-card">
                    <div className="up-post-header">
                      {post.song?.poster_url && (
                        <img className="up-post-song-img" src={post.song.poster_url} alt="" />
                      )}
                      <div>
                        <span className="up-post-title">{post.title}</span>
                        <span className="up-post-song-name">{post.song?.title} - {post.song?.artist}</span>
                      </div>
                    </div>
                    {post.caption && <p className="up-post-caption">{post.caption}</p>}
                    <audio controls src={post.audioUrl} className="up-post-audio"></audio>
                    <div className="up-post-meta">
                      <span>{post.likesCount || 0} likes</span>
                      <span>{post.commentsCount || 0} comments</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="up-empty">
                <i className="fa-solid fa-microphone-lines"></i>
                <p>No posts yet</p>
              </div>
            )}
          </div>
        )}
      </main>

      {showFollowers && (
        <div className="up-modal-overlay" onClick={() => setShowFollowers(false)}>
          <div className="up-modal" onClick={(e) => e.stopPropagation()}>
            <div className="up-modal-header">
              <h3>Followers</h3>
              <button className="up-modal-close" onClick={() => setShowFollowers(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="up-modal-list">
              {listLoading ? (
                <div className="up-modal-status">Loading...</div>
              ) : followersList.length === 0 ? (
                <div className="up-modal-status">No followers yet</div>
              ) : (
                followersList.map((u) => (
                  <Link
                    key={u._id}
                    to={`/user/${u._id}`}
                    className="up-modal-item"
                    onClick={() => setShowFollowers(false)}
                  >
                    <div className="up-modal-avatar">
                      {u.avatar ? <img src={u.avatar} alt={u.name} /> : u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="up-modal-info">
                      <span className="up-modal-name">{u.name}</span>
                      <span className="up-modal-email">{u.email}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showFollowing && (
        <div className="up-modal-overlay" onClick={() => setShowFollowing(false)}>
          <div className="up-modal" onClick={(e) => e.stopPropagation()}>
            <div className="up-modal-header">
              <h3>Following</h3>
              <button className="up-modal-close" onClick={() => setShowFollowing(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="up-modal-list">
              {listLoading ? (
                <div className="up-modal-status">Loading...</div>
              ) : followingList.length === 0 ? (
                <div className="up-modal-status">Not following anyone yet</div>
              ) : (
                followingList.map((u) => (
                  <Link
                    key={u._id}
                    to={`/user/${u._id}`}
                    className="up-modal-item"
                    onClick={() => setShowFollowing(false)}
                  >
                    <div className="up-modal-avatar">
                      {u.avatar ? <img src={u.avatar} alt={u.name} /> : u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="up-modal-info">
                      <span className="up-modal-name">{u.name}</span>
                      <span className="up-modal-email">{u.email}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
