import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Premium.css?raw';

const PLANS = [
  { id: 'Individual', icon: 'fa-user', title: 'Premium Individual', price: 'BDT 219', trialLabel: 'Try 3 months for BDT 0', btnClass: 'btn-individual', details: ['1 Premium account', 'Cancel anytime', 'Subscribe or one-time payment', 'Access to all features'] },
  { id: 'Student', icon: 'fa-graduation-cap', title: 'Premium Student', price: 'BDT 109', trialLabel: 'Try 1 month for BDT 0', btnClass: 'btn-student', details: ['1 verified Premium account', 'Discount for eligible students', 'Cancel anytime', 'All Premium features included'] },
  { id: 'Duo', icon: 'fa-users', title: 'Duo', price: 'BDT 299', trialLabel: 'Get Premium Duo', btnClass: 'btn-duo', details: ['2 Premium accounts', 'Cancel anytime', 'Subscribe or one-time payment', 'For couples living together'] },
];

const FAQS = [
  { q: 'How does the free trial work?', a: "New subscribers get a free trial of Melodify Premium. You'll need to provide payment details to start your trial. After the trial, your subscription will automatically continue at the standard monthly price unless you cancel." },
  { q: 'How do I cancel my subscription?', a: "You can cancel your subscription at any time through your account settings. If you cancel during your free trial, you won't be charged. After the trial, you'll continue to have access to Premium until the end of your billing period." },
  { q: 'What payment methods are accepted?', a: 'We accept all major credit cards, debit cards, and PayPal. In some regions, you can also pay through mobile payment systems and bank transfers.' },
];

export default function Premium() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Premium');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sticky, setSticky] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [subscribing, setSubscribing] = useState(null);
  const [message, setMessage] = useState('');
  const cardsRef = useRef([]);

  useEffect(() => {
    const onScroll = () => setSticky(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.get('/api/subscriptions/me').then((data) => {
      if (data.success) setSubscription(data.subscription);
    });
  }, [user]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.animation = 'fadeInUp 0.8s ease-out forwards';
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    cardsRef.current.forEach((el) => {
      if (el) {
        el.style.opacity = '0';
        observer.observe(el);
      }
    });
    return () => observer.disconnect();
  }, []);

  const trialEnd = new Date();
  trialEnd.setMonth(trialEnd.getMonth() + 3);
  const trialEndLabel = trialEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  const subscribe = async (plan) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setSubscribing(plan);
    setMessage('');
    const data = await api.post('/api/subscriptions', { plan });
    setSubscribing(null);
    if (data.success) {
      setSubscription(data.subscription);
      setMessage(`Subscribed to Premium ${data.subscription.plan}! Active until ${new Date(data.subscription.end_date).toLocaleDateString()}.`);
    } else {
      setMessage(data.error || 'Subscription failed');
    }
  };

  const cancel = async () => {
    const data = await api.put('/api/subscriptions/cancel', {});
    if (data.success) {
      setSubscription(null);
      setMessage('Subscription cancelled.');
    }
  };

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileMenu(false);
  };

  const setCardRef = (el) => {
    if (el && !cardsRef.current.includes(el)) cardsRef.current.push(el);
  };

  return (
    <div>
      <header className={sticky ? 'sticky' : ''}>
        <Link to="/" className="logo">
          Melodify<span>+</span>
        </Link>
        <nav>
          <ul className={mobileMenu ? 'active' : ''}>
            <li><a href="#plans" onClick={(e) => { e.preventDefault(); scrollTo('plans'); }}>Premium</a></li>
            <li><a href="#faq" onClick={(e) => { e.preventDefault(); scrollTo('faq'); }}>Support</a></li>
            <li className="divider"></li>
            {user ? (
              <>
                <li><Link to="/dashboard">Dashboard</Link></li>
                <li><Link to="/profile">{user.name || user.email}</Link></li>
                <li>
                  <a className="nav-btn" onClick={(e) => { e.preventDefault(); logout(); navigate('/'); }}>Log out</a>
                </li>
              </>
            ) : (
              <>
                <li><Link to="/signup">Sign up</Link></li>
                <li><Link to="/login" className="nav-btn">Log in</Link></li>
              </>
            )}
          </ul>
        </nav>
        <button className="mobile-menu-btn" onClick={() => setMobileMenu(!mobileMenu)}>
          <i className={`fas ${mobileMenu ? 'fa-times' : 'fa-bars'}`}></i>
        </button>
      </header>

      <section className="hero">
        <div className="floating-elements">
          <div className="floating-element element-1"></div>
          <div className="floating-element element-2"></div>
          <div className="floating-element element-3"></div>
        </div>
        <div className="hero-content">
          <div className="offer-tag">Limited Time Offer</div>
          <h1 className="offer-title">BDT 0.00 for 3 months of Premium</h1>
          <p className="offer-subtitle">Enjoy ad-free music listening, offline playback, and more. Cancel anytime.</p>
          <div className="buttons">
            <a className="btn btn-primary" onClick={(e) => { e.preventDefault(); subscribe('Individual'); }}>
              <i className="fas fa-crown"></i> Try 3 months for BDT 0
            </a>
            <a className="btn btn-secondary" href="#plans" onClick={(e) => { e.preventDefault(); scrollTo('plans'); }}>View all plans</a>
          </div>
          <p className="terms">
            Premium Individual only. BDT 0 for 3 months, then BDT 219 per month after. Offer available if you haven't tried Premium before. Terms apply. Offer ends {trialEndLabel}.
          </p>
          {subscription && (
            <p className="terms" style={{ color: '#00b4d8' }}>
              <i className="fas fa-crown"></i> Your Premium {subscription.plan} is active until {new Date(subscription.end_date).toLocaleDateString()}.
            </p>
          )}
          {message && <p className="terms">{message}</p>}
        </div>
      </section>

      <section className="experience">
        <span className="section-tag">Why Go Premium</span>
        <h2 className="experience-title">Experience the difference</h2>
        <p className="experience-subtitle">Go Premium and enjoy full control of your listening. Cancel anytime.</p>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>What you'll get</th>
              <th>Free plan</th>
              <th>Premium plans</th>
            </tr>
          </thead>
          <tbody>
            {['Ad-free music listening', 'Download to listen offline', 'Play songs in any order', 'High audio quality', 'Listen with friends in real time', 'Organise listening queue'].map((feature) => (
              <tr key={feature}>
                <td>{feature}</td>
                <td className="dash">-</td>
                <td className="check">✔</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="plans" id="plans">
        <div className="plans-header">
          <div className="payment-options">
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/41/Visa_Logo.png" alt="Visa" />
            <img src="https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" alt="Mastercard" />
            <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/American_Express_logo.svg" alt="American Express" />
          </div>
          <h2 className="plans-title">Pick your Premium</h2>
          <div className="features-grid">
            {[
              { icon: 'fa-music', text: 'Ad-free music' },
              { icon: 'fa-download', text: 'Download songs' },
              { icon: 'fa-headphones', text: 'High quality audio' },
              { icon: 'fa-infinity', text: 'Unlimited skips' },
            ].map((f) => (
              <div className="feature-item" key={f.text} ref={setCardRef}>
                <div className="feature-icon"><i className={`fas ${f.icon}`}></i></div>
                <p className="feature-text">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="plans-cards">
          {PLANS.map((plan, i) => {
            const active = subscription && subscription.plan === plan.id;
            const isPopular = plan.id === 'Individual';
            return (
              <div className={`plan-card${isPopular ? ' popular' : ''}`} key={plan.id} ref={setCardRef}>
                <div className="plan-icon"><i className={`fas ${plan.icon}`}></i></div>
                <h3 className="plan-title">{plan.title}</h3>
                <p className="plan-price">
                  <span className="price-amount">{active ? 'Active' : plan.id === 'Duo' ? plan.price : 'BDT 0'}</span>
                  {active ? <br /> : plan.id === 'Duo' ? '/month' : ` for ${plan.id === 'Individual' ? 3 : 1} months<br>${plan.price}/month after`}
                </p>
                <ul className="plan-details">
                  {plan.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                {active ? (
                  <button className={`plan-btn ${plan.btnClass}`} onClick={cancel}>
                    <i className="fas fa-times"></i> Cancel subscription
                  </button>
                ) : (
                  <button className={`plan-btn ${plan.btnClass}`} onClick={() => subscribe(plan.id)} disabled={subscribing === plan.id}>
                    {subscribing === plan.id ? 'Subscribing...' : plan.trialLabel}
                  </button>
                )}
                {i === 0 && (
                  <p className="plan-terms">
                    BDT 0 for 3 months, then BDT 219 per month after. Offer available only if you haven't tried Premium before. Terms apply. Offer ends {trialEndLabel}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="testimonials">
        <h2 className="testimonials-title">What Our Users Say</h2>
        <div className="testimonials-cards">
          {[
            { text: '"Melodify Premium transformed my music experience! No ads and offline listening are a game-changer for my daily commute. The sound quality is incredible!"', initials: 'AK', name: 'Ayesha Khan', location: 'Dhaka, Bangladesh' },
            { text: '"As a student, the discount makes Premium affordable, and the quality is unbeatable. I can now study with my favorite music without interruptions."', initials: 'RS', name: 'Rahul Sharma', location: 'Chittagong, Bangladesh' },
            { text: '"Duo plan is perfect for me and my partner—great value for two accounts! We both enjoy unlimited access to millions of songs without breaking the bank."', initials: 'PP', name: 'Priya Patel', location: 'Sylhet, Bangladesh' },
          ].map((t) => (
            <div className="testimonial-card" key={t.name} ref={setCardRef}>
              <p className="testimonial-text">{t.text}</p>
              <div className="testimonial-author">
                <div className="author-avatar">{t.initials}</div>
                <div className="author-info">
                  <div className="author-name">{t.name}</div>
                  <div className="author-location">{t.location}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="faq" id="faq">
        <h2 className="faq-title">Frequently Asked Questions</h2>
        <div className="faq-container">
          {FAQS.map((item, i) => (
            <div className={`faq-item${openFaq === i ? ' active' : ''}`} key={item.q}>
              <div className="faq-question" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                {item.q}
                <i className="fas fa-chevron-down"></i>
              </div>
              <div className="faq-answer">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      <footer>
        <div className="footer-content">
          <div className="footer-column">
            <h3>Company</h3>
            <ul>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>About</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Jobs</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Press</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>News</a></li>
            </ul>
          </div>
          <div className="footer-column">
            <h3>Communities</h3>
            <ul>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>For Artists</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Developers</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Advertising</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Investors</a></li>
            </ul>
          </div>
          <div className="footer-column">
            <h3>Useful Links</h3>
            <ul>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Support</a></li>
              <li><Link to="/dashboard">Web Player</Link></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Free Mobile App</a></li>
              <li><a href="#faq" onClick={(e) => e.preventDefault()}>Terms & Conditions</a></li>
            </ul>
          </div>
          <div className="footer-column">
            <h3>Follow Us</h3>
            <div className="social-links">
              <a href="#faq" onClick={(e) => e.preventDefault()}><i className="fab fa-facebook-f"></i></a>
              <a href="#faq" onClick={(e) => e.preventDefault()}><i className="fab fa-twitter"></i></a>
              <a href="#faq" onClick={(e) => e.preventDefault()}><i className="fab fa-instagram"></i></a>
              <a href="#faq" onClick={(e) => e.preventDefault()}><i className="fab fa-youtube"></i></a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Melodify. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}