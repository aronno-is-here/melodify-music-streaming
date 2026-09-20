import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

export default function HeroSection() {
  const { user } = useAuth();

  return (
    <section className="hero-section" aria-label="Melodify hero">
      <div className="hero-content-wrapper">
        <div className="hero-badge" aria-hidden="true">Music Reimagined</div>
        <h1 className="hero-headline">
          <span className="hero-line-1">Every Sound.</span>
          <span className="hero-line-2">One Universe.</span>
        </h1>
        <p className="hero-description">
          Stream, create, and share music in a premium experience designed
          for true listeners. Discover tracks, record karaoke, and connect
          with a community that speaks music.
        </p>
        <div className="hero-cta-group" role="group" aria-label="Get started">
          <Link to={user ? '/dashboard' : '/signup'} className="hero-cta-primary">
            <i className="fas fa-play" aria-hidden="true" />
            <span>{user ? 'Open Dashboard' : 'Start Listening'}</span>
          </Link>
          <Link to="/premium" className="hero-cta-secondary">
            <span>Explore Premium</span>
          </Link>
        </div>
        <div className="hero-stats" role="list" aria-label="Platform statistics">
          <div className="hero-stat" role="listitem">
            <span className="hero-stat-number">14+</span>
            <span className="hero-stat-label">Curated Tracks</span>
          </div>
          <div className="hero-stat-divider" aria-hidden="true" />
          <div className="hero-stat" role="listitem">
            <span className="hero-stat-number">HD</span>
            <span className="hero-stat-label">Quality Audio</span>
          </div>
          <div className="hero-stat-divider" aria-hidden="true" />
          <div className="hero-stat" role="listitem">
            <span className="hero-stat-number">24/7</span>
            <span className="hero-stat-label">Streaming</span>
          </div>
        </div>
      </div>
      <div className="hero-scroll-indicator" aria-hidden="true">
        <div className="hero-scroll-line" />
        <span>Scroll to explore</span>
      </div>
    </section>
  );
}
