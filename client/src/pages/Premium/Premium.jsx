import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import AppDialog from '../../components/ui/AppDialog.jsx';
import cssRaw from './Premium.css?raw';

const PLANS = Object.freeze([
  {
    id: 'Individual',
    title: 'Premium Individual',
    trial: 'Try 3 months for BDT 0',
    afterTrial: 'Then BDT 219/month',
    monthlyPrice: 'BDT 219/month',
    accentClass: 'is-individual',
    details: ['1 Premium account', 'Ad-free music', 'Offline playback', 'Unlimited skips'],
  },
  {
    id: 'Student',
    title: 'Premium Student',
    trial: 'Try 1 month for BDT 0',
    afterTrial: 'Then BDT 109/month',
    monthlyPrice: 'BDT 109/month',
    accentClass: 'is-student',
    details: ['1 verified student account', 'All Premium features', 'Lower monthly cost', 'Cancel anytime'],
  },
  {
    id: 'Duo',
    title: 'Premium Duo',
    trial: 'Start Premium Duo',
    afterTrial: 'BDT 299/month',
    monthlyPrice: 'BDT 299/month',
    accentClass: 'is-duo',
    details: ['2 Premium accounts', 'One shared billing plan', 'Ad-free and offline', 'Cancel anytime'],
  },
]);

const PREMIUM_FEATURES = Object.freeze([
  'Ad-free music listening',
  'Download to listen offline',
  'Play songs in any order',
  'High audio quality',
  'Unlimited skips',
  'Queue control',
]);

const FAQS = Object.freeze([
  {
    q: 'How does the free trial work?',
    a: 'If you are eligible, your trial starts immediately and converts to a monthly subscription unless you cancel before the renewal date.',
  },
  {
    q: 'How do I cancel my subscription?',
    a: 'Open this Premium page while signed in, choose your active plan, and use the cancel action. Access remains until the current paid period ends.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Yes. Choose a new plan from this page while signed in and we will update your active subscription contract on your account.',
  },
]);

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

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(0);
  const [subscription, setSubscription] = useState(null);
  const [subscribingPlan, setSubscribingPlan] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const data = await api.get('/api/subscriptions/me');
      if (cancelled) return;
      if (data.success) {
        setSubscription(data.subscription || null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const trialEndLabel = useMemo(() => {
    const trialEnd = new Date();
    trialEnd.setMonth(trialEnd.getMonth() + 3);
    return trialEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  }, []);

  const navigateToHash = (id) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const subscribe = async (plan) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setSubscribingPlan(plan);
    setMessage('');
    const data = await api.post('/api/subscriptions', { plan });
    setSubscribingPlan('');

    if (!data.success) {
      setMessage(data.error || 'Subscription failed');
      return;
    }

    setSubscription(data.subscription || null);
    setMessage(`Subscribed to Premium ${data.subscription.plan}.`);
  };

  const cancelSubscription = async () => {
    const data = await api.put('/api/subscriptions/cancel', {});
    if (!data.success) {
      setMessage(data.error || 'Unable to cancel your subscription right now.');
      return;
    }

    setSubscription(null);
    setCancelDialogOpen(false);
    setMessage('Subscription cancelled.');
  };

  return (
    <div className="premium-page">
      <header className="premium-topbar">
        <Link to="/" className="premium-brand" aria-label="Go to Melodify homepage">
          Melod<span>ify</span>
        </Link>

        <button
          type="button"
          className="premium-menu-btn music-icon-control"
          aria-label="Toggle premium navigation"
          aria-expanded={mobileMenuOpen}
          aria-controls="premium-nav"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <i className={`fa-solid ${mobileMenuOpen ? 'fa-xmark' : 'fa-bars'}`} aria-hidden="true"></i>
        </button>

        <nav id="premium-nav" className={`premium-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Premium page sections">
          <button type="button" onClick={() => navigateToHash('premium-plans')}>Plans</button>
          <button type="button" onClick={() => navigateToHash('premium-compare')}>Compare</button>
          <button type="button" onClick={() => navigateToHash('premium-faq')}>FAQ</button>
          {user ? (
            <>
              <Link to="/dashboard">Dashboard</Link>
              <button
                type="button"
                className="premium-ghost-action"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/signup">Sign up</Link>
              <Link to="/login" className="premium-nav-pill">Log in</Link>
            </>
          )}
        </nav>
      </header>

      <main className="premium-main">
        <section className="premium-hero app-surface">
          <p className="premium-tag">Premium Offer</p>
          <h1>BDT 0 for 3 months of Premium Individual</h1>
          <p>Upgrade to ad-free playback, offline listening, and full control over your queue on every device.</p>

          <div className="premium-hero-actions">
            <button
              type="button"
              className="music-pill-btn"
              onClick={() => subscribe('Individual')}
              disabled={subscribingPlan === 'Individual'}
            >
              {subscribingPlan === 'Individual' ? 'Starting...' : 'Try 3 months for BDT 0'}
            </button>
            <button
              type="button"
              className="music-outline-btn"
              onClick={() => navigateToHash('premium-plans')}
            >
              View all plans
            </button>
          </div>

          <p className="premium-disclaimer">
            New subscribers only. Trial ends {trialEndLabel}. Subscription renews monthly unless cancelled.
          </p>

          {subscription ? (
            <p className="premium-status" role="status" aria-live="polite">
              Premium {subscription.plan} is active until {new Date(subscription.end_date).toLocaleDateString()}.
            </p>
          ) : null}

          {message ? (
            <p className="premium-status" role="status" aria-live="polite">{message}</p>
          ) : null}
        </section>

        <section id="premium-compare" className="music-section app-surface premium-section">
          <SectionHeader
            title="Why listeners upgrade"
            subtitle="Compare what you get on Free versus Premium"
          />

          <div className="premium-table-wrap" role="region" aria-label="Feature comparison" tabIndex={0}>
            <table className="premium-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Free</th>
                  <th scope="col">Premium</th>
                </tr>
              </thead>
              <tbody>
                {PREMIUM_FEATURES.map((feature) => (
                  <tr key={feature}>
                    <td>{feature}</td>
                    <td aria-label={`${feature} on Free`}>Not available</td>
                    <td aria-label={`${feature} on Premium`}>Included</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="premium-plans" className="music-section app-surface premium-section">
          <SectionHeader
            title="Choose your plan"
            subtitle="All plans include ad-free listening and cancellation anytime"
          />

          <div className="premium-plan-grid">
            {PLANS.map((plan) => {
              const isActive = subscription?.plan === plan.id;
              return (
                <article key={plan.id} className={`premium-plan-card ${plan.accentClass} ${isActive ? 'is-active' : ''}`}>
                  <p className="premium-plan-name">{plan.title}</p>
                  <p className="premium-plan-price">{isActive ? 'Active' : plan.trial}</p>
                  <p className="premium-plan-sub">{isActive ? plan.monthlyPrice : plan.afterTrial}</p>

                  <ul>
                    {plan.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>

                  {isActive ? (
                    <button
                      type="button"
                      className="music-outline-btn premium-plan-cta"
                      onClick={() => setCancelDialogOpen(true)}
                    >
                      Cancel subscription
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="music-pill-btn premium-plan-cta"
                      disabled={subscribingPlan === plan.id}
                      onClick={() => subscribe(plan.id)}
                    >
                      {subscribingPlan === plan.id ? 'Starting...' : plan.id === 'Duo' ? 'Get Duo' : 'Start trial'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section id="premium-faq" className="music-section app-surface premium-section">
          <SectionHeader
            title="Frequently asked questions"
            subtitle="Everything you need before upgrading"
          />

          <div className="premium-faq-list">
            {FAQS.map((entry, index) => {
              const expanded = openFaqIndex === index;
              return (
                <article key={entry.q} className={`premium-faq-item ${expanded ? 'is-open' : ''}`}>
                  <h3>
                    <button
                      type="button"
                      className="premium-faq-trigger"
                      aria-expanded={expanded}
                      aria-controls={`premium-faq-panel-${index}`}
                      onClick={() => setOpenFaqIndex(expanded ? -1 : index)}
                    >
                      <span>{entry.q}</span>
                      <i className={`fa-solid ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true"></i>
                    </button>
                  </h3>
                  <div id={`premium-faq-panel-${index}`} className="premium-faq-panel" hidden={!expanded}>
                    <p>{entry.a}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="premium-footer app-surface" aria-label="Premium footer links">
        <div className="premium-footer-links">
          <Link to="/dashboard">Web Player</Link>
          <Link to="/feed">Community Feed</Link>
          <Link to="/studio">Melodify Studio</Link>
          <button type="button" onClick={() => navigateToHash('premium-faq')}>Support</button>
        </div>
        <p>© {new Date().getFullYear()} Melodify. Premium plans and pricing are region-specific.</p>
      </footer>

      <AppDialog
        open={cancelDialogOpen}
        title="Cancel Premium subscription"
        onClose={() => setCancelDialogOpen(false)}
        labelledBy="premium-cancel-dialog-title"
        actions={(
          <>
            <button type="button" className="music-outline-btn" onClick={() => setCancelDialogOpen(false)}>Keep plan</button>
            <button type="button" className="music-pill-btn" onClick={cancelSubscription}>Cancel now</button>
          </>
        )}
      >
        <p className="premium-cancel-copy">
          You can resubscribe any time. Premium access remains available until the current billing period ends.
        </p>
      </AppDialog>
    </div>
  );
}
