import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(clientSrc, ...parts), 'utf8');

const homeSrc = read('pages', 'Home', 'Home.jsx');
const homeCss = read('pages', 'Home', 'Home.css');
const bellSrc = read('components', 'app', 'NotificationBell.jsx');
const shellSrc = read('components', 'app', 'AuthenticatedAppShell.jsx');
const shellCss = read('styles', 'app-shell.css');
const uiSrc = read('components', 'app', 'notificationUi.js');
const authSrc = read('context', 'AuthContext.jsx');
const profileSrc = read('pages', 'Profile', 'Profile.jsx');

const homeAvatarBlock = (() => {
  const start = homeSrc.indexOf('className="home-avatar"');
  const end = homeSrc.indexOf('</Link>', start);
  assert.ok(start >= 0 && end > start, 'homepage avatar link markup not found');
  return homeSrc.slice(start, end);
})();

test('1. homepage renders the notification bell for an authenticated user', () => {
  assert.match(homeSrc, /import NotificationBell from '\.\.\/\.\.\/components\/app\/NotificationBell\.jsx';/);
  assert.match(homeSrc, /\{user \? \(\s*<NotificationBell variant="home" \/>/);
  assert.match(bellSrc, /className=\{isHomeVariant \? 'home-icon-btn app-bell-btn' : 'app-icon-btn app-bell-btn'\}/);
  assert.match(bellSrc, /aria-label=\{badge\.ariaLabel\}/);
  assert.equal(/disabled=\{[^}]*unread/.test(bellSrc), false);
});

test('2. bell control stays clearly visible and clickable at zero unread', () => {
  const iconBtn = homeCss.match(/\.home-icon-btn\s*\{[^}]*\}/);
  assert.ok(iconBtn, 'homepage icon button style is missing');
  assert.match(iconBtn[0], /width:\s*40px/);
  assert.match(iconBtn[0], /height:\s*40px/);
  assert.match(iconBtn[0], /background:\s*rgba\(/);
  assert.match(iconBtn[0], /border:\s*1px solid/);
  assert.equal(/background:\s*transparent/.test(iconBtn[0]), false);
  assert.match(homeCss, /\.home-icon-btn:hover:not\(:disabled\)\s*\{[^}]*background:\s*rgba\(/);
  assert.match(homeCss, /\.home-icon-btn:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(homeCss, /\.home-icon-btn:disabled\s*\{[^}]*opacity/);

  const buttonStart = bellSrc.indexOf('aria-label={badge.ariaLabel}');
  const buttonEnd = bellSrc.indexOf('</button>', buttonStart);
  assert.ok(buttonStart >= 0 && buttonEnd > buttonStart, 'bell button markup not found');
  const buttonBlock = bellSrc.slice(buttonStart, buttonEnd);
  assert.equal(buttonBlock.includes('disabled'), false);
  assert.match(buttonBlock, /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/);
  assert.match(uiSrc, /NOTIFICATION_UNREAD_ZERO_LABEL = 'No unread notifications'/);
  assert.match(uiSrc, /if \(!Number\.isInteger\(count\) \|\| count <= 0\) \{\s*return \{ show: false,/);
});

test('3. unread badge still renders and stays visible when the count is greater than zero', () => {
  assert.match(bellSrc, /\{badge\.show \? \(\s*<span className="app-bell-badge" aria-hidden="true">\{badge\.text\}<\/span>\s*\) : null\}/);
  assert.match(shellCss, /\.app-bell-badge\s*\{[^}]*position:\s*absolute/);
  assert.match(shellCss, /\.app-bell-badge\s*\{[^}]*background:\s*#ff4d6d/);
  assert.equal(/\.home-icon-btn\s*\{[^}]*overflow:\s*hidden/.test(homeCss), false);
  assert.match(uiSrc, /return \{\s*show: true,\s*text: count > 99 \? '99\+' : String\(count\),/);
});

test('4. empty notification state remains functional on the homepage', () => {
  assert.match(
    bellSrc,
    /\{!loading && !error && items\.length === 0 \? \(\s*<p className="app-notification-state app-notification-empty" role="status">[\s\S]*?\{NOTIFICATION_EMPTY_MESSAGE\}[\s\S]*?<\/p>\s*\) : null\}/,
  );
  assert.match(uiSrc, /NOTIFICATION_EMPTY_MESSAGE = 'No notifications yet\.'/);
  assert.match(shellCss, /\.app-notification-empty\s*\{/);
  assert.match(bellSrc, /className=\{isHomeVariant \? 'home-icon-btn app-bell-btn'/);
});

test('5. homepage avatar uses the authenticated user real avatar when present', () => {
  assert.match(homeAvatarBlock, /user\.avatar \? \(/);
  assert.match(homeAvatarBlock, /className="home-avatar-img"/);
  assert.match(homeAvatarBlock, /src=\{user\.avatar\}/);
  assert.match(homeCss, /\.home-avatar-img\s*\{[^}]*object-fit:\s*cover/);
  assert.match(homeCss, /\.home-avatar-img\s*\{[^}]*border-radius:\s*50%/);
  assert.match(shellSrc, /user\?\.avatar \? \(\s*<img className="app-avatar" src=\{user\.avatar\} alt="" \/>/);
  assert.equal(homeAvatarBlock.includes('http'), false, 'avatar src must not be rewritten with a hardcoded origin');
});

test('6. refreshed AuthContext avatar value is reflected by the homepage', () => {
  assert.match(homeSrc, /const \{ user \} = useAuth\(\);/);
  assert.match(homeSrc, /<Link to=\{user \? '\/profile' : '\/login'\} className="home-avatar"/);

  const avatarBlock = profileSrc.match(/const handleAvatarFile = async[\s\S]*?\n {2}\};/);
  assert.ok(avatarBlock, 'profile avatar upload handler not found');
  assert.match(avatarBlock[0], /await api\.put\('\/api\/users\/me\/avatar', form\)/);
  assert.match(avatarBlock[0], /await refreshUser\(\);/);
  assert.match(authSrc, /const refreshUser = async \(\) => \{[\s\S]*?if \(data\.success\) setUser\(data\.user\);/);
});

test('7. missing avatar keeps the initial-letter fallback', () => {
  assert.match(homeAvatarBlock, /: \(\s*<span className="home-avatar-text">\{user\.name\?\.charAt\(0\)\?\.toUpperCase\(\) \|\| 'U'\}<\/span>\s*\)/);
  assert.ok(
    homeAvatarBlock.indexOf('user.avatar') < homeAvatarBlock.indexOf('home-avatar-text'),
    'avatar image must be preferred over the initial fallback',
  );
  assert.match(homeCss, /\.home-avatar-text\s*\{/);
});

test('8. broken avatar image falls back safely', () => {
  assert.match(homeAvatarBlock, /onError=\{\(event\) => handleImgError\(event, '\/home\/avatar-fallback\.svg'\)\}/);
  assert.match(homeSrc, /const handleImgError = \(e, fallback = '\/home\/poster-fallback\.svg'\)/);
  assert.match(homeSrc, /if \(image\.dataset\.fallback\) return;/);
  assert.equal(existsSync(join(clientSrc, '..', 'public', 'home', 'avatar-fallback.svg')), true);
});
