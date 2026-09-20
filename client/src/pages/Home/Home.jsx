import { useLayoutEffect, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import MusicBackground3D from '../../components/home/MusicBackground3D.jsx';
import AmbientOverlay from '../../components/home/AmbientOverlay.jsx';
import HeroSection from '../../components/home/HeroSection.jsx';
import SectionReveal from '../../components/home/SectionReveal.jsx';
import { useScrollProgress } from '../../hooks/useScrollProgress.js';
import cssRaw from './Home.css?raw';

export default function Home() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Home');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { user } = useAuth();
  const scrollProgress = useScrollProgress();
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

  const handleImgError = (e) => {
    e.target.src = '/default-poster.jpg';
  };

  return (
    <div className="home-page">
      <MusicBackground3D scrollProgress={scrollProgress} />
      <AmbientOverlay scrollProgress={scrollProgress} />

      <div className="home-content">
        {/* NAVBAR */}
        <header className="home-header">
          <div className="home-header-inner">
            <Link to="/" className="home-logo">
              MELOD<span>IFY</span>
            </Link>
            <nav className="home-nav">
              <Link to="/premium" className="home-nav-link">Premium</Link>
              <Link to="/studio" className="home-nav-link">Studio</Link>
              <Link to="/feed" className="home-nav-link">Community</Link>
            </nav>
            <div className="home-auth">
              {user ? (
                <Link to="/dashboard" className="home-btn home-btn-primary">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className="home-btn home-btn-ghost">Log In</Link>
                  <Link to="/signup" className="home-btn home-btn-primary">Sign Up</Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* HERO */}
        <HeroSection />

        {/* TRENDING */}
        <SectionReveal className="home-section" delay={100}>
          <div className="home-section-inner">
            <div className="home-section-label">Discover</div>
            <h2 className="home-section-title">Trending Now</h2>
            {trendingSongs.length > 0 ? (
              <div className="trending-grid">
                {trendingSongs.map((song, i) => (
                  <Link
                    key={song._id}
                    to={user ? `/song/${song._id}` : '/signup'}
                    className="trending-card"
                  >
                    <div className="trending-card-artwork">
                      <img
                        src={song.poster_url || '/default-poster.jpg'}
                        alt={song.title}
                        loading="lazy"
                        onError={handleImgError}
                      />
                      <div className="trending-card-overlay">
                        <div className="trending-card-play">
                          <i className="fas fa-play" />
                        </div>
                      </div>
                    </div>
                    <div className="trending-card-info">
                      <h4 className="trending-card-title">{song.title}</h4>
                      <p className="trending-card-artist">{song.artist}</p>
                    </div>
                    <div className="trending-card-index">{String(i + 1).padStart(2, '0')}</div>
                  </Link>
                ))}
              </div>
            ) : !loading ? (
              <div className="home-empty-state">
                <i className="fas fa-compact-disc" />
                <p>Discover tracks once you sign in</p>
              </div>
            ) : null}
          </div>
        </SectionReveal>

        {/* STUDIO / KARAOKE */}
        <SectionReveal className="home-section" delay={150}>
          <div className="home-section-inner">
            <div className="studio-promo">
              <div className="studio-promo-visual">
                <div className="studio-wave-ring studio-wave-ring-1" />
                <div className="studio-wave-ring studio-wave-ring-2" />
                <div className="studio-wave-ring studio-wave-ring-3" />
                <div className="studio-mic-icon">
                  <i className="fas fa-microphone-alt" />
                </div>
              </div>
              <div className="studio-promo-content">
                <div className="home-section-label">Create</div>
                <h2 className="home-section-title">Melodify Studio</h2>
                <p className="studio-promo-desc">
                  Sing along with real-time synced lyrics, apply professional
                  vocal effects, and publish your recordings to the Melodify
                  community. Your stage, your voice.
                </p>
                <ul className="studio-promo-features">
                  <li><i className="fas fa-microphone" /> Professional vocal recording</li>
                  <li><i className="fas fa-sliders-h" /> Studio effects & presets</li>
                  <li><i className="fas fa-share-alt" /> Publish & share recordings</li>
                </ul>
                <Link to={user ? '/studio' : '/signup'} className="home-btn home-btn-primary">
                  <i className="fas fa-headphones" /> Open Studio
                </Link>
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* COMMUNITY */}
        <SectionReveal className="home-section" delay={100}>
          <div className="home-section-inner">
            <div className="home-section-label">Community</div>
            <h2 className="home-section-title">From the Community</h2>
            <p className="home-section-subtitle">
              Real recordings from Melodify artists around the world
            </p>
            <div className="community-promo">
              <div className="community-card">
                <div className="community-card-icon">
                  <i className="fas fa-users" />
                </div>
                <h3>Discover Artists</h3>
                <p>Browse public profiles and find new talent in the Melodify community.</p>
                <Link to={user ? '/feed' : '/signup'} className="home-btn home-btn-ghost">
                  Explore Feed
                </Link>
              </div>
              <div className="community-card">
                <div className="community-card-icon">
                  <i className="fas fa-record-vinyl" />
                </div>
                <h3>Public Recordings</h3>
                <p>Listen to community karaoke recordings and find your next favorite cover.</p>
                <Link to={user ? '/feed' : '/signup'} className="home-btn home-btn-ghost">
                  Listen Now
                </Link>
              </div>
              <div className="community-card">
                <div className="community-card-icon">
                  <i className="fas fa-heart" />
                </div>
                <h3>Connect & Follow</h3>
                <p>Follow creators, like posts, and build your music network.</p>
                <Link to={user ? '/feed' : '/signup'} className="home-btn home-btn-ghost">
                  Join In
                </Link>
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* PREMIUM */}
        <SectionReveal className="home-section" delay={100}>
          <div className="home-section-inner">
            <div className="premium-promo">
              <div className="premium-promo-bg" />
              <div className="premium-promo-content">
                <div className="home-section-label home-section-label--premium">Premium</div>
                <h2 className="home-section-title">Elevate Your Experience</h2>
                <p className="premium-promo-desc">
                  Unlock priority features, ad-free listening, and exclusive
                  content with Melodify Premium. Choose the plan that fits you.
                </p>
                <div className="premium-promo-plans">
                  <div className="premium-mini-plan">
                    <span className="premium-mini-name">Individual</span>
                    <span className="premium-mini-price">Best for one</span>
                  </div>
                  <div className="premium-mini-plan">
                    <span className="premium-mini-name">Student</span>
                    <span className="premium-mini-price">Discounted</span>
                  </div>
                  <div className="premium-mini-plan">
                    <span className="premium-mini-name">Duo</span>
                    <span className="premium-mini-price">For two</span>
                  </div>
                </div>
                <Link to="/premium" className="home-btn home-btn-premium">
                  View Plans
                </Link>
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* FINAL CTA */}
        <SectionReveal className="home-section" delay={100}>
          <div className="home-section-inner">
            <div className="final-cta">
              <h2 className="final-cta-title">Ready to Feel the Music?</h2>
              <p className="final-cta-desc">
                Join Melodify and enter a world of premium music streaming,
                creative tools, and a vibrant community.
              </p>
              <Link to={user ? '/dashboard' : '/signup'} className="home-btn home-btn-primary home-btn-lg">
                {user ? 'Go to Dashboard' : 'Get Started Free'}
              </Link>
            </div>
          </div>
        </SectionReveal>

        {/* FOOTER */}
        <footer className="home-footer">
          <div className="home-footer-inner">
            <div className="home-footer-brand">
              <div className="home-logo home-logo--footer">
                MELOD<span>IFY</span>
              </div>
              <p className="home-footer-tagline">
                The premium music streaming experience. Stream, create, and
                connect with music lovers worldwide.
              </p>
            </div>
            <div className="home-footer-links">
              <div className="home-footer-col">
                <h4>Product</h4>
                <Link to="/premium">Premium</Link>
                <Link to="/studio">Studio</Link>
                <Link to="/feed">Community</Link>
              </div>
              <div className="home-footer-col">
                <h4>Account</h4>
                <Link to="/login">Log In</Link>
                <Link to="/signup">Sign Up</Link>
                <Link to="/profile">Profile</Link>
              </div>
              <div className="home-footer-col">
                <h4>Legal</h4>
                <a href="#">Privacy Policy</a>
                <a href="#">Terms of Service</a>
              </div>
            </div>
          </div>
          <div className="home-footer-bottom">
            <p>&copy; 2026 Melodify. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
