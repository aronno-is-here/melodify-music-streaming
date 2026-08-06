import { Link } from 'react-router-dom';
import './Home.css';

export default function Home() {
  return (
    <>
      {/* Header */}
      <header>
        <div className="container">
          <nav>
            <div className="logo">
              MELOD<span>IFY</span>
            </div>
            <ul className="auth-links">
              <li>
                <Link to="/signup" className="btn">
                  Sign Up
                </Link>
              </li>
              <li>
                <Link to="/login" className="btn">
                  Login
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero">
        <div className="container">
          <div className="hero-content">
            <h1>Stream Your Favorite Music Anytime, Anywhere</h1>
            <p>
              Discover millions of songs, download for offline listening, and
              enjoy personalized recommendations powered by AI.
            </p>
            <Link to="/signup" className="btn">
              Get Started
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <div className="container">
          <div className="section-title">
            <h2>Amazing Features</h2>
            <p>
              Melodify offers everything you need for the perfect music streaming
              experience
            </p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🎵</div>
              <h3>Unlimited Streaming</h3>
              <p>
                Access to millions of songs from artists all around the world with
                no interruptions.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📥</div>
              <h3>Offline Listening</h3>
              <p>
                Download your favorite tracks and playlists to listen without an
                internet connection.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🔍</div>
              <h3>Smart Search</h3>
              <p>
                Find songs by lyrics, melody, or just humming. Our AI will
                identify the song for you.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🤖</div>
              <h3>AI Recommendations</h3>
              <p>
                Personalized playlists and recommendations based on your listening
                habits.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🎤</div>
              <h3>Karaoke Mode</h3>
              <p>
                Sing along with real-time lyrics and record your own versions of
                songs.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🎸</div>
              <h3>Guitar Chords</h3>
              <p>
                Learn to play your favorite songs with interactive chord displays.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="how-it-works">
        <div className="container">
          <div className="section-title">
            <h2>How It Works</h2>
            <p>Get started with Melodify in just a few simple steps</p>
          </div>

          <div className="steps">
            <div className="step">
              <div className="step-number">1</div>
              <h3>Create an Account</h3>
              <p>Sign up for free and set up your profile in seconds.</p>
            </div>

            <div className="step">
              <div className="step-number">2</div>
              <h3>Choose Your Plan</h3>
              <p>Select from our free or premium subscription options.</p>
            </div>

            <div className="step">
              <div className="step-number">3</div>
              <h3>Explore Music</h3>
              <p>
                Browse our extensive library or let us recommend music for you.
              </p>
            </div>

            <div className="step">
              <div className="step-number">4</div>
              <h3>Enjoy Anywhere</h3>
              <p>Listen on your phone, computer, or other devices.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="container">
          <h2>Ready to Start Your Musical Journey?</h2>
          <p>
            Join millions of users enjoying unlimited music streaming with
            Melodify. No credit card required to start.
          </p>
          <Link to="/signup" className="btn">
            Sign Up Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="container">
          <div className="footer-content">
            <div className="footer-column">
              <h3>Melodify</h3>
              <p>
                The ultimate music streaming experience with AI-powered features
                and unlimited access to your favorite songs.
              </p>
            </div>

            <div className="footer-column">
              <h3>Company</h3>
              <ul className="footer-links">
                <li>
                  <a href="#">About Us</a>
                </li>
                <li>
                  <a href="#">Careers</a>
                </li>
                <li>
                  <a href="#">Press</a>
                </li>
                <li>
                  <a href="#">Blog</a>
                </li>
              </ul>
            </div>

            <div className="footer-column">
              <h3>Support</h3>
              <ul className="footer-links">
                <li>
                  <a href="#">Help Center</a>
                </li>
                <li>
                  <a href="#">Contact Us</a>
                </li>
                <li>
                  <a href="#">Privacy Policy</a>
                </li>
                <li>
                  <a href="#">Terms of Service</a>
                </li>
              </ul>
            </div>

            <div className="footer-column">
              <h3>Download App</h3>
              <ul className="footer-links">
                <li>
                  <a href="#">iOS</a>
                </li>
                <li>
                  <a href="#">Android</a>
                </li>
                <li>
                  <a href="#">Windows</a>
                </li>
                <li>
                  <a href="#">Mac</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="copyright">
            <p>© 2025 Melodify. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </>
  );
}