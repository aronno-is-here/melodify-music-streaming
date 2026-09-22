import { useLayoutEffect, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import HeroSection from '../../components/home/HeroSection.jsx';
import Waveform from '../../components/home/Waveform.jsx';
import { formatDuration } from '../../components/home/formatDuration.js';
import cssRaw from './Home.css?raw';

const communityAvatarPhotos = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=64&h=64&fit=crop&crop=faces&auto=format&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=64&h=64&fit=crop&crop=faces&auto=format&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=64&h=64&fit=crop&crop=faces&auto=format&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=64&h=64&fit=crop&crop=faces&auto=format&q=80',
];

export default function Home() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Home');
    // Raw imports retain a UTF-8 signature; it is a selector character in CSSOM.
    style.textContent = cssRaw.replace(/^\uFEFF/, '');
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { user } = useAuth();
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSongs = async () => {
      try {
        const data = await api.get('/api/songs?limit=6');
        if (data.success) setSongs(data.songs || []);
      } catch {
        setSongs([]);
      } finally {
        setLoading(false);
      }
    };
    loadSongs();
  }, []);

  const trendingSongs = songs.slice(0, 6);

  const handleImgError = (e, fallback = '/home/poster-fallback.svg') => {
    const image = e.currentTarget;
    if (image.dataset.fallback) return;
    image.dataset.fallback = 'true';
    image.src = fallback;
  };

  return (
    <div className="home-page">
      <div className="home-content">

        {/* NAVBAR */}
        <header className="home-header">
          <div className="home-header-inner">
            <Link to="/" className="home-logo">
              <Waveform />
              <span className="home-logo-text">Melodify</span>
            </Link>
            <nav className="home-nav" aria-label="Main navigation">
              <Link to="/" className="home-nav-link home-nav-link--active" aria-current="page">Home</Link>
              <Link to="/premium" className="home-nav-link">Premium</Link>
              <Link to="/studio" className="home-nav-link">Studio</Link>
              <Link to="/feed" className="home-nav-link">Feed</Link>
            </nav>
            <div className="home-right">
              <div className="home-search">
                <i className="fas fa-search home-search-icon" />
                <input type="search" aria-label="Search songs, artists, or albums" placeholder="Search songs, artists, or albums..." className="home-search-input" />
              </div>
              <button className="home-icon-btn" aria-label="Notifications">
                <svg width="22" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M5 17h14l-2-3V9a5 5 0 0 0-4-5V2h-2v2a5 5 0 0 0-4 5v5z" strokeLinejoin="round" />
                  <path d="M10 20a2 2 0 0 0 4 0" />
                </svg>
              </button>
              <Link to={user ? '/profile' : '/login'} className="home-avatar" aria-label={user ? 'Your profile' : 'Sign in'}>
                {user ? (
                  <span className="home-avatar-text">{user.name?.charAt(0)?.toUpperCase() || 'U'}</span>
                ) : (
                  <i className="fas fa-user" />
                )}
              </Link>
            </div>
          </div>
        </header>

        {/* HERO */}
        <HeroSection />

        {/* TRENDING NOW */}
        <section className="home-section home-section-trending">
          <div className="home-section-inner">
            <div className="home-section-header">
              <div className="home-section-header-left">
                <div className="home-section-accent" />
                <div>
                  <h2 className="home-section-title">Trending Now</h2>
                  <p className="home-section-subtitle">The most loved tracks this week</p>
                </div>
              </div>
              <Link to={user ? '/dashboard' : '/signup'} className="home-view-all">
                View All <i className="fas fa-chevron-right" />
              </Link>
            </div>
            {trendingSongs.length > 0 ? (
              <div className="trending-grid">
                {trendingSongs.map((song) => (
                  <Link
                    key={song._id}
                    to={user ? `/song/${song._id}` : '/signup'}
                    className="trending-card"
                  >
                    <div className="trending-card-artwork">
                      <img
                        src={song.poster_url || '/home/poster-fallback.svg'}
                        alt={song.title}
                        loading="lazy"
                        width="66"
                        height="66"
                        onError={handleImgError}
                      />
                    </div>
                    <div className="trending-card-info">
                      <h4 className="trending-card-title" title={song.title}>{song.title}</h4>
                      <p className="trending-card-artist" title={song.artist}>{song.artist}</p>
                      <span className="trending-card-duration">{formatDuration(song.duration_ms ?? song.duration, song.duration_ms != null ? 'milliseconds' : 'seconds')}</span>
                    </div>
                    <span className="trending-card-play" aria-hidden="true">
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="m2 1 7 5-7 5z" /></svg>
                    </span>
                  </Link>
                ))}
              </div>
            ) : !loading ? (
              <div className="home-empty-state">
                <i className="fas fa-compact-disc" />
                <p>Discover tracks once you sign in</p>
              </div>
            ) : (
              <div className="trending-grid" aria-label="Loading trending songs" aria-busy="true">
                {Array.from({ length: 6 }, (_, index) => <div key={index} className="trending-card trending-card--loading" aria-hidden="true" />)}
              </div>
            )}
          </div>
        </section>

        {/* FEATURE PROMOTION CARDS */}
        <section className="home-section home-section-promotions">
          <div className="home-section-inner">
            <div className="promo-grid">
              {/* Studio Card */}
              <article className="promo-card promo-card-studio" aria-labelledby="home-studio-title">
                <div className="promo-card-studio-artwork" aria-hidden="true">
                  <img
                    src="https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=400&h=600&fit=crop&crop=bottom"
                    alt=""
                    width="126"
                    height="172"
                    loading="lazy"
                    decoding="async"
                    onError={(event) => handleImgError(event, '/home/studio-equipment.svg')}
                  />
                </div>
                <div className="promo-card-content">
                  <h3 id="home-studio-title" className="promo-card-title">Melodify Studio</h3>
                  <p className="promo-card-subtitle">Create. Record. Share.</p>
                  <p className="promo-card-desc">
                    Bring your music to life with our professional studio tools and creative community.
                  </p>
                  <Link to={user ? '/studio' : '/signup'} className="promo-card-btn">
                    Explore Studio
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                      <path d="M2 6h8M6 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              </article>
              {/* Premium Card */}
              <article className="promo-card promo-card-premium" aria-labelledby="home-premium-title">
                <img className="promo-card-premium-artwork" src="/home/premium-crown.svg" alt="" width="128" height="128" loading="lazy" decoding="async" aria-hidden="true" />
                <div className="promo-card-crown" aria-hidden="true">
                  <i className="fas fa-crown" />
                </div>
                <div className="promo-card-content">
                  <h3 id="home-premium-title" className="promo-card-title">Go Premium</h3>
                  <p className="promo-card-subtitle">More music. More freedom.</p>
                  <p className="promo-card-desc">
                    Ad-free listening, higher quality audio, and exclusive content.
                  </p>
                  <Link to="/premium" className="promo-card-btn">
                    Upgrade Now <i className="fas fa-arrow-right" />
                  </Link>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* COMMUNITY */}
        <section className="home-section home-section-community">
          <div className="home-section-inner">
            <div className="community-container">
              <div className="community-header">
                <div className="community-header-left">
                  <h2 className="home-section-title">Join Our Community</h2>
                  <p className="home-section-subtitle" style={{ marginBottom: 0 }}>
                    Real people. Real music. Real connections.
                  </p>
                </div>
                <div className="community-header-right">
                  <div className="community-avatars" aria-hidden="true">
                    {communityAvatarPhotos.map((src) => (
                      <div key={src} className="community-avatar-item">
                        <img
                          src={src}
                          alt=""
                          width="32"
                          height="32"
                          loading="lazy"
                          decoding="async"
                          onError={(event) => handleImgError(event, '/home/avatar-fallback.svg')}
                        />
                      </div>
                    ))}
                  </div>
                  <Link to={user ? '/feed' : '/signup'} className="home-view-all">
                    Explore Feed <i className="fas fa-chevron-right" />
                  </Link>
                </div>
              </div>
              <div className="community-grid">
                <div className="community-image community-image--stage">
                  <img src="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=240&fit=crop&auto=format&q=80" alt="Artist performing live on stage" loading="lazy" decoding="async" onError={handleImgError} />
                </div>
                <div className="community-image">
                  <img src="https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=240&fit=crop&auto=format&q=80" alt="Music creation in a recording studio" loading="lazy" decoding="async" onError={handleImgError} />
                </div>
                <div className="community-image">
                  <img src="https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&h=240&fit=crop&auto=format&q=80" alt="Concert lights above a live music crowd" loading="lazy" decoding="async" onError={handleImgError} />
                </div>
                <div className="community-image community-image--portrait">
                  <img src="https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=320&h=320&fit=crop&crop=faces&auto=format&q=80" alt="Vocalist singing into a microphone" loading="lazy" decoding="async" onError={handleImgError} />
                </div>
                <div className="community-image">
                  <img src="https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=400&h=240&fit=crop&auto=format&q=80" alt="Audience sharing a live concert" loading="lazy" decoding="async" onError={handleImgError} />
                </div>
                <div className="community-image">
                  <img src="https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=400&h=240&fit=crop&auto=format&q=80" alt="DJ mixing setup" loading="lazy" decoding="async" onError={handleImgError} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="home-footer">
          <div className="home-footer-inner">
            <Link to="/" className="home-logo home-logo--footer">
              <Waveform size={26} />
              <span className="home-logo-text">Melodify</span>
            </Link>
            <nav className="home-footer-links" aria-label="Footer navigation">
              <Link to="/about">About</Link>
              <Link to="/help">Help</Link>
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
            </nav>
            <div className="home-footer-social">
              <a href="#" aria-label="YouTube" title="YouTube"><i className="fab fa-youtube" aria-hidden="true" /></a>
              <a href="#" aria-label="Instagram" title="Instagram"><i className="fab fa-instagram" aria-hidden="true" /></a>
              <a href="#" aria-label="X" title="X">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.49h2.039L6.487 3.24H4.3Z" />
                </svg>
              </a>
              <a href="#" aria-label="Discord" title="Discord"><i className="fab fa-discord" aria-hidden="true" /></a>
            </div>
            <p className="home-footer-copy">&copy; 2025 Melodify. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
