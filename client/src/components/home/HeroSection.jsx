import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

export default function HeroSection() {
  const { user } = useAuth();

  return (
    <section className="hero-section" aria-label="Melodify hero">
      <div className="hero-image-bg" aria-hidden="true">
        <img
          src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?ixlib=rb-1.2.1&auto=format&fit=crop&w=1350&q=80"
          alt=""
          className="hero-image"
          loading="eager"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div className="hero-image-overlay" />
      </div>
      <div className="hero-content-wrapper">
        <div className="hero-eyebrow">YOUR MUSIC. YOUR VIBE.</div>
        <h1 className="hero-headline">
          <span className="hero-line-1">Every <span className="hero-gradient-word">Sound.</span></span>
          <span className="hero-line-2">One <span className="hero-gradient-word">Universe.</span></span>
        </h1>
        <p className="hero-description">
          Discover, stream, and feel the music that moves you.
          Melodify brings together artists, creators and listeners
          in one endless universe.
        </p>
        <div className="hero-cta-group" role="group" aria-label="Get started">
          <Link to={user ? '/dashboard' : '/signup'} className="hero-cta-primary">
            <i className="fas fa-play" aria-hidden="true" />
            <span>{user ? 'Dashboard' : 'Explore Music'}</span>
          </Link>
          <Link to="/premium" className="hero-cta-secondary">
            <i className="fas fa-play" aria-hidden="true" />
            <span>Watch Video</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
