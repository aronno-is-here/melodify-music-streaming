import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import GlobalPlayerBar from './GlobalPlayerBar.jsx';
import FullScreenPlayer from '../../pages/Dashboard/FullScreenPlayer.jsx';

const DESKTOP_NAV = Object.freeze([
  { key: 'dashboard', label: 'Home / Dashboard', path: '/dashboard', icon: 'fa-house' },
  { key: 'search', label: 'Search', path: '/search', icon: 'fa-magnifying-glass' },
  { key: 'liked', label: 'Liked Songs', path: '/library?tab=liked', icon: 'fa-heart' },
  { key: 'library', label: 'Playlists / Library', path: '/library', icon: 'fa-book-open' },
  { key: 'feed', label: 'Feed', path: '/feed', icon: 'fa-people-group' },
  { key: 'studio', label: 'Melodify Studio', path: '/studio', icon: 'fa-microphone-lines' },
  { key: 'premium', label: 'Premium', path: '/premium', icon: 'fa-crown' },
  { key: 'profile', label: 'Profile', path: '/profile', icon: 'fa-user' },
]);

const MOBILE_NAV = Object.freeze([
  { key: 'dashboard', label: 'Home', path: '/dashboard', icon: 'fa-house' },
  { key: 'search', label: 'Search', path: '/search', icon: 'fa-magnifying-glass' },
  { key: 'library', label: 'Library', path: '/library', icon: 'fa-book-open' },
  { key: 'profile', label: 'Profile', path: '/profile', icon: 'fa-user' },
]);

const isPathActive = (location, path) => {
  const [pathOnly, query] = path.split('?');
  if (pathOnly === '/library' && query === 'tab=liked') {
    return location.pathname === '/library' && new URLSearchParams(location.search).get('tab') === 'liked';
  }
  if (pathOnly === '/library') {
    return location.pathname === '/library' && new URLSearchParams(location.search).get('tab') !== 'liked';
  }
  return location.pathname === pathOnly;
};

export default function AuthenticatedAppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const player = usePlayer();

  const [songs, setSongs] = useState([]);
  const [history, setHistory] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [favoritedIds, setFavoritedIds] = useState(new Set());
  const [loadingCore, setLoadingCore] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);

  const menuRef = useRef(null);

  const fetchCoreData = useCallback(async () => {
    setLoadingCore(true);
    const [songsResult, historyResult, playlistResult, favoritesResult, favoriteIdsResult] = await Promise.all([
      api.get('/api/songs?limit=100').catch(() => ({ success: false })),
      api.get('/api/history').catch(() => ({ success: false })),
      api.get('/api/playlists').catch(() => ({ success: false })),
      api.get('/api/favorites').catch(() => ({ success: false })),
      api.get('/api/favorites/ids').catch(() => ({ success: false })),
    ]);

    setSongs(songsResult.success && Array.isArray(songsResult.songs) ? songsResult.songs : []);
    setHistory(historyResult.success && Array.isArray(historyResult.history) ? historyResult.history : []);
    setPlaylists(playlistResult.success && Array.isArray(playlistResult.playlists) ? playlistResult.playlists : []);
    setFavorites(favoritesResult.success && Array.isArray(favoritesResult.favorites) ? favoritesResult.favorites : []);
    setFavoritedIds(
      favoriteIdsResult.success && Array.isArray(favoriteIdsResult.ids)
        ? new Set(favoriteIdsResult.ids.map((id) => String(id)))
        : new Set(),
    );
    setLoadingCore(false);
  }, []);

  const refreshHistory = useCallback(async () => {
    const result = await api.get('/api/history').catch(() => ({ success: false }));
    if (result.success && Array.isArray(result.history)) {
      setHistory(result.history);
    }
  }, []);

  useEffect(() => {
    fetchCoreData();
  }, [fetchCoreData]);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onPointer = (event) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  const toggleFavorite = useCallback(async (songId) => {
    const id = String(songId);
    const alreadyFavorite = favoritedIds.has(id);
    if (alreadyFavorite) {
      await api.del(`/api/favorites/${id}`).catch(() => {});
      setFavoritedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFavorites((prev) => prev.filter((song) => String(song._id) !== id));
      return;
    }

    await api.post(`/api/favorites/${id}`).catch(() => {});
    setFavoritedIds((prev) => new Set([...prev, id]));
    const song = songs.find((row) => String(row._id) === id);
    if (song) {
      setFavorites((prev) => [song, ...prev.filter((row) => String(row._id) !== id)]);
    }
  }, [favoritedIds, songs]);

  const outletData = useMemo(() => ({
    user,
    songs,
    history,
    playlists,
    favorites,
    favoritedIds,
    loadingCore,
    toggleFavorite,
    refreshCoreData: fetchCoreData,
    refreshHistory,
  }), [
    user,
    songs,
    history,
    playlists,
    favorites,
    favoritedIds,
    loadingCore,
    toggleFavorite,
    fetchCoreData,
    refreshHistory,
  ]);

  const currentSongFavorited = player.currentSong
    ? favoritedIds.has(String(player.currentSong._id))
    : false;

  return (
    <div className="melodify-app">
      <div className="app-shell">
        <header className="app-header">
          <Link to="/dashboard" className="app-brand" aria-label="Go to dashboard">
            <span className="app-brand-mark">
              <i className="fa-solid fa-wave-square" aria-hidden="true"></i>
            </span>
            <span className="app-brand-name">
              Melod<span>ify</span>
            </span>
          </Link>

          <div className="app-header-actions" ref={menuRef}>
            <button
              type="button"
              className="app-icon-btn"
              aria-label="Open search"
              onClick={() => navigate('/search')}
            >
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </button>

            <div className="app-profile-menu-wrap">
              <button
                type="button"
                className="app-icon-btn"
                aria-label="Open account menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <i className="fa-solid fa-user" aria-hidden="true"></i>
              </button>

              {profileMenuOpen ? (
                <div className="app-profile-menu" role="menu" aria-label="Account actions">
                  <NavLink to="/profile" role="menuitem">
                    <i className="fa-regular fa-id-badge" aria-hidden="true"></i>
                    Profile
                  </NavLink>
                  <NavLink to="/library" role="menuitem">
                    <i className="fa-solid fa-book-open" aria-hidden="true"></i>
                    Library
                  </NavLink>
                  {user?.role === 'admin' ? (
                    <NavLink to="/admin" role="menuitem">
                      <i className="fa-solid fa-shield-halved" aria-hidden="true"></i>
                      Admin Panel
                    </NavLink>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="app-main">
          <aside className="app-sidebar" aria-label="Primary navigation">
            <nav className="app-nav">
              {DESKTOP_NAV.map((item) => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  className={() => `app-nav-link ${isPathActive(location, item.path) ? 'is-active' : ''}`}
                >
                  <i className={`fa-solid ${item.icon}`} aria-hidden="true"></i>
                  <span className="app-nav-label">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="app-content">
            <Outlet context={outletData} />
          </main>
        </div>

        <GlobalPlayerBar
          isFavorited={currentSongFavorited}
          onToggleFavorite={toggleFavorite}
          onExpand={() => setFullPlayerOpen(true)}
        />

        <nav className="app-mobile-nav" aria-label="Mobile navigation">
          {MOBILE_NAV.map((item) => {
            const active = isPathActive(location, item.path);
            return (
              <NavLink
                key={item.key}
                to={item.path}
                className={`app-mobile-link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <i className={`fa-solid ${item.icon}`} aria-hidden="true"></i>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {fullPlayerOpen ? (
        <FullScreenPlayer
          onClose={() => setFullPlayerOpen(false)}
          isFavorited={currentSongFavorited}
          onToggleFavorite={() => {
            if (!player.currentSong) return;
            toggleFavorite(player.currentSong._id);
          }}
        />
      ) : null}
    </div>
  );
}
