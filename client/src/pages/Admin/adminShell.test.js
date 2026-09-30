import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const ADMIN_SOURCE = readSource('./Admin.jsx');
const ADMIN_CSS = readSource('./Admin.css');

const sidebarBlock = ADMIN_SOURCE.slice(
  ADMIN_SOURCE.indexOf('<nav'),
  ADMIN_SOURCE.indexOf('</nav>'),
);

// ============================================================
// GROUPED SIDEBAR
// ============================================================

test('shell: grouped sidebar is rendered from NAV_GROUPS inside the sidebar nav', () => {
  assert.ok(ADMIN_SOURCE.includes('const NAV_GROUPS = ['));
  assert.ok(sidebarBlock.includes('{NAV_GROUPS.map((group) => ('));
  assert.ok(sidebarBlock.includes('className="admin-nav"'));
});

test('group: Overview group exists with Dashboard', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      "{ key: 'overview', label: 'Overview', sections: ['dashboard'] },",
    ),
  );
});

test('group: Content group exists with Music, Lyrics, Chords, Karaoke', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      "{ key: 'content', label: 'Content', sections: ['music', 'missing-lyrics', 'chords', 'karaoke'] },",
    ),
  );
});

test('group: Community group exists with Users and Moderation', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      "{ key: 'community', label: 'Community', sections: ['users', 'moderation'] },",
    ),
  );
});

test('group: Business group exists with Subscriptions', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      "{ key: 'business', label: 'Business', sections: ['subscriptions'] },",
    ),
  );
});

test('group: Intelligence group exists with AI Recommendation', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      "{ key: 'intelligence', label: 'Intelligence', sections: ['ai-recommendation'] },",
    ),
  );
  assert.ok(sidebarBlock.includes('<p className="admin-nav-group-label">{group.label}</p>'));
});

// ============================================================
// NAV ITEMS — every required destination is visible
// ============================================================

test('nav: Dashboard item exists', () => {
  assert.ok(ADMIN_SOURCE.includes("dashboard: { label: 'Dashboard', icon: 'fa-house' },"));
});

test('nav: Music item exists', () => {
  assert.ok(ADMIN_SOURCE.includes("music: { label: 'Music', icon: 'fa-music' },"));
});

test('nav: Lyrics item exists with its own visible destination', () => {
  assert.ok(ADMIN_SOURCE.includes("'missing-lyrics': { label: 'Lyrics', icon: 'fa-file-lines' },"));
});

test('nav: Chords item exists with its own visible destination (not hidden inside Music)', () => {
  assert.ok(ADMIN_SOURCE.includes("chords: { label: 'Chords', icon: 'fa-guitar' },"));
  assert.ok(ADMIN_SOURCE.includes("sections: ['music', 'missing-lyrics', 'chords', 'karaoke']"));
});

test('nav: Karaoke item exists with its own visible destination', () => {
  assert.ok(ADMIN_SOURCE.includes("karaoke: { label: 'Karaoke', icon: 'fa-microphone-lines' },"));
});

test('nav: Users item exists', () => {
  assert.ok(ADMIN_SOURCE.includes("users: { label: 'Users', icon: 'fa-users' },"));
});

test('nav: Moderation item exists', () => {
  assert.ok(ADMIN_SOURCE.includes("moderation: { label: 'Moderation', icon: 'fa-flag' },"));
});

test('nav: Subscriptions item exists', () => {
  assert.ok(ADMIN_SOURCE.includes("subscriptions: { label: 'Subscriptions', icon: 'fa-credit-card' },"));
});

test('nav: AI Recommendation item exists', () => {
  assert.ok(
    ADMIN_SOURCE.includes("'ai-recommendation': { label: 'AI Recommendation', icon: 'fa-brain' },"),
  );
});

test('nav: every NAV_META entry renders with its label and Font Awesome icon', () => {
  assert.ok(sidebarBlock.includes('<i className={`fa-solid ${NAV_META[s].icon}`} aria-hidden="true">'));
  assert.ok(sidebarBlock.includes('{NAV_META[s].label ?? sectionLabel(s)}'));
});

// ============================================================
// ACTIVE ITEM STATE
// ============================================================

test('active: nav items map section state to the active class', () => {
  assert.ok(
    ADMIN_SOURCE.includes("className={`admin-nav-item ${section === s ? 'active' : ''}`}"),
  );
});

test('active: current destination exposes aria-current', () => {
  assert.ok(ADMIN_SOURCE.includes("aria-current={section === s ? 'page' : undefined}"));
});

test('active: Admin.css styles .sidebar a.active', () => {
  assert.match(ADMIN_CSS, /\.sidebar a\.active\s*\{/);
});

test('active: header context shows the active group and page title', () => {
  assert.ok(ADMIN_SOURCE.includes('const activeNavGroup = NAV_GROUPS.find('));
  assert.ok(ADMIN_SOURCE.includes('<h1 className="admin-header-title">{activeLabel}</h1>'));
  assert.ok(ADMIN_SOURCE.includes('<span className="admin-header-group">{activeGroupLabel}</span>'));
});

// ============================================================
// MOBILE NAVIGATION TRIGGER
// ============================================================

test('mobile: menu button exists with aria-expanded and aria-controls', () => {
  assert.ok(ADMIN_SOURCE.includes('className="admin-menu-btn"'));
  assert.ok(ADMIN_SOURCE.includes('aria-expanded={navOpen}'));
  assert.ok(ADMIN_SOURCE.includes('aria-controls="admin-sidebar"'));
  assert.ok(ADMIN_SOURCE.includes('<nav id="admin-sidebar"'));
});

test('mobile: drawer state toggles the is-open class and closes after navigation', () => {
  assert.ok(ADMIN_SOURCE.includes("className={`sidebar ${navOpen ? 'is-open' : ''}`}"));
  assert.ok(ADMIN_SOURCE.includes('const handleNavClick = (s) => {'));
  assert.ok(sidebarBlock.includes('onClick={() => handleNavClick(s)}'));
});

test('mobile: backdrop and Escape close the drawer', () => {
  assert.ok(ADMIN_SOURCE.includes('className="admin-nav-backdrop"'));
  assert.ok(ADMIN_SOURCE.includes("if (event.key === 'Escape') setNavOpen(false);"));
});

test('mobile: Admin.css ships the off-canvas drawer at <=768px', () => {
  assert.match(ADMIN_CSS, /@media \(max-width: 768px\)/);
  assert.match(ADMIN_CSS, /\.sidebar\.is-open\s*\{/);
  assert.match(ADMIN_CSS, /transform: translateX\(-103%\)/);
  assert.match(ADMIN_CSS, /\.admin-menu-btn\s*\{[^}]*display: inline-flex/);
});

// ============================================================
// LOGOUT + ADMIN IDENTITY REMAIN ACCESSIBLE
// ============================================================

test('logout: header keeps the existing logout action', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      '<button type="button" className="admin-logout-btn" onClick={() => logout()}>',
    ),
  );
  assert.equal(ADMIN_SOURCE.includes('onClick={() => logout()}'), true);
});

test('logout: admin identity stays visible (header on desktop, drawer on mobile)', () => {
  assert.ok(ADMIN_SOURCE.includes('<span className="admin-header-email">{user?.email}</span>'));
  assert.ok(ADMIN_SOURCE.includes('<span className="admin-sidebar-email">{user?.email}</span>'));
});

// ============================================================
// BRANDING
// ============================================================

test('brand: Melodify Admin Console branding replaces the old cyan strip', () => {
  assert.ok(ADMIN_SOURCE.includes('<span className="admin-brand-name">Melodify</span>'));
  assert.ok(ADMIN_SOURCE.includes('<span className="admin-brand-tag">Admin Console</span>'));
  assert.equal(ADMIN_SOURCE.includes('Melodify Admin Panel'), false);
});

// ============================================================
// SECTION SWITCHING PRESERVED
// ============================================================

test('sections: existing SECTIONS order is preserved', () => {
  const sectionsLine = ADMIN_SOURCE.match(/const SECTIONS = \[([^\]]+)\]/);
  assert.ok(sectionsLine);
  const ids = sectionsLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(ids, [
    'dashboard',
    'users',
    'music',
    'missing-lyrics',
    'karaoke',
    'moderation',
    'subscriptions',
    'ai-recommendation',
  ]);
});

test('sections: handleSectionClick stays the single section switcher', () => {
  assert.equal(
    (ADMIN_SOURCE.match(/const handleSectionClick = \(s\) =>/g) || []).length,
    1,
  );
  assert.ok(ADMIN_SOURCE.includes("navigate('/admin/ai-recommendation')"));
  assert.ok(ADMIN_SOURCE.includes("navigate('/admin', { state: { section: s } });"));
  assert.ok(
    ADMIN_SOURCE.includes(
      `if (location.pathname === '/admin/ai-recommendation') return 'ai-recommendation';`,
    ),
  );
  assert.ok(ADMIN_SOURCE.includes('EXISTING_SECTIONS.has(location.state.section)'));
});

test('sections: every existing section still renders its content unchanged', () => {
  for (const [needle, expected] of [
    ["section === 'dashboard' && (", '<div id="dashboard" className="admin-page">'],
    ["section === 'users' && (", '<div id="users" className="card">'],
    ["section === 'music' && (", '<div id="music" className="admin-page">'],
    ["section === 'missing-lyrics' && <MissingLyricsQueue />", null],
    ["section === 'chords' && (", '<div id="chords" className="admin-page">'],
    ["section === 'karaoke' && (", '<div id="karaoke" className="admin-page">'],
    ["section === 'moderation' && (", '<div id="moderation" className="card">'],
    ["section === 'subscriptions' && (", '<div id="subscriptions" className="card">'],
    ["section === 'ai-recommendation' && <AdminAIRecommendation />", null],
  ]) {
    assert.ok(ADMIN_SOURCE.includes(needle), needle);
    if (expected) assert.ok(ADMIN_SOURCE.includes(expected), expected);
  }
});

test('sections: chords destination is accepted by the location.state initializer', () => {
  const match = ADMIN_SOURCE.match(/const EXISTING_SECTIONS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(match);
  const ids = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.equal(ids.includes('chords'), true);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate section ids');
});

test('sections: Music keeps the existing Manage Chords workflow untouched', () => {
  assert.ok(ADMIN_SOURCE.includes('Manage Chords'));
  assert.ok(ADMIN_SOURCE.includes('className="btn admin-manage-chords"'));
});

// ============================================================
// SHELL LAYOUT / THEME
// ============================================================

test('shell: admin-shell wraps header, sidebar, and content', () => {
  assert.ok(ADMIN_SOURCE.includes('<div className="admin-shell">'));
  assert.ok(ADMIN_SOURCE.includes('<header className="admin-header">'));
  assert.ok(ADMIN_SOURCE.includes('<main className="content admin-content">'));
  assert.ok(ADMIN_SOURCE.includes('<div className="admin-content-inner">'));
});

test('shell: Admin.css uses Melodify theme tokens for the console chrome', () => {
  assert.match(ADMIN_CSS, /\.admin-shell\s*\{/);
  assert.match(ADMIN_CSS, /--mel-bg-glass/);
  assert.match(ADMIN_CSS, /--mel-border/);
  assert.match(ADMIN_CSS, /\.admin-content-inner\s*\{[^}]*max-width/);
  assert.match(ADMIN_CSS, /:focus-visible/);
  assert.equal(/font-family:\s*'Roboto'/.test(ADMIN_CSS), false);
});

test('shell: no new icon package is imported for the admin shell', () => {
  assert.equal(/lucide|react-icons|@heroicons/.test(ADMIN_SOURCE), false);
  assert.equal(ADMIN_SOURCE.includes('MelodifyBrand'), false);
});
