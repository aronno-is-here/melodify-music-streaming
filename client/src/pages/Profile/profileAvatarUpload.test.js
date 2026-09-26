import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileSrc = readFileSync(join(__dirname, 'Profile.jsx'), 'utf8');
const profileCss = readFileSync(join(__dirname, 'Profile.css'), 'utf8');
const userProfileSrc = readFileSync(join(__dirname, '..', 'UserProfile', 'UserProfile.jsx'), 'utf8');
const shellSrc = readFileSync(join(__dirname, '..', '..', 'components', 'app', 'AuthenticatedAppShell.jsx'), 'utf8');
const shellCss = readFileSync(join(__dirname, '..', '..', 'styles', 'app-shell.css'), 'utf8');
const apiSrc = readFileSync(join(__dirname, '..', '..', 'api', 'client.js'), 'utf8');
const authSrc = readFileSync(join(__dirname, '..', '..', 'context', 'AuthContext.jsx'), 'utf8');

const handlerBlock = profileSrc.match(/const handleAvatarFile = async[\s\S]*?\n {2}\};/)[0];

test('profile renders the current avatar inside the circular avatar area', () => {
  assert.match(profileSrc, /\{user\.avatar \? <img className="profile-avatar-img" src=\{user\.avatar\} alt="" \/> : initials\}/);
  assert.match(profileCss, /\.profile-avatar \{[^}]*border-radius: 50%/);
});

test('profile keeps the initials fallback when no avatar exists', () => {
  assert.match(profileSrc, /: initials\}/);
  assert.match(profileSrc, /const initials = \(user\.name \|\| 'U'\)/);
});

test('upload and change action exists only on the own Profile page', () => {
  assert.match(profileSrc, /aria-label="Change profile picture"/);
  assert.match(profileSrc, /avatarInputRef\.current\?\.click\(\)/);
  assert.equal(userProfileSrc.includes('Change profile picture'), false);
  assert.equal(userProfileSrc.includes('/api/users/me/avatar'), false);
  assert.equal(userProfileSrc.includes('type="file"'), false);
});

test('valid images are submitted through the dedicated avatar endpoint', () => {
  assert.match(handlerBlock, /const form = new FormData\(\)/);
  assert.match(handlerBlock, /form\.append\('avatar', file\)/);
  assert.match(handlerBlock, /await api\.put\('\/api\/users\/me\/avatar', form\)/);
  assert.match(profileSrc, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(apiSrc, /put: \(path, body\) => request\(path, \{ method: 'PUT', body: body instanceof FormData \? body : JSON\.stringify\(body\) \}\)/);
});

test('unsupported image types are rejected before upload', () => {
  assert.match(profileSrc, /const AVATAR_MIME_TYPES = \['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  const guard = handlerBlock.match(/if \(!AVATAR_MIME_TYPES\.includes\(file\.type\)\) \{[\s\S]*?return;\s*\}/)[0];
  assert.ok(guard);
  assert.match(guard, /Choose a JPEG, PNG, or WebP image\./);
  const guardIndex = handlerBlock.indexOf('AVATAR_MIME_TYPES.includes');
  const uploadIndex = handlerBlock.indexOf('api.put');
  assert.ok(guardIndex !== -1 && uploadIndex !== -1 && guardIndex < uploadIndex);
});

test('oversized images are rejected before upload', () => {
  assert.match(profileSrc, /const AVATAR_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(handlerBlock, /if \(file\.size > AVATAR_MAX_BYTES\)/);
  assert.match(handlerBlock, /Image must be 5MB or smaller\./);
  const sizeIndex = handlerBlock.indexOf('file.size > AVATAR_MAX_BYTES');
  const uploadIndex = handlerBlock.indexOf('api.put');
  assert.ok(sizeIndex !== -1 && uploadIndex !== -1 && sizeIndex < uploadIndex);
});

test('a successful upload stores the avatar on the current user', () => {
  assert.match(handlerBlock, /const data = await api\.put\('\/api\/users\/me\/avatar', form\)/);
  assert.match(handlerBlock, /if \(!data\.success\) \{/);
  assert.match(handlerBlock, /Profile picture updated\./);
  assert.equal((handlerBlock.match(/await refreshUser\(\)/g) || []).length, 1);
});

test('auth context current user refreshes after success', () => {
  assert.match(profileSrc, /const \{ user, logout, refreshUser \} = useAuth\(\)/);
  assert.match(authSrc, /const refreshUser = async \(\) =>/);
  assert.match(authSrc, /const data = await api\.get\('\/api\/auth\/me'\)/);
  assert.match(authSrc, /if \(data\.success\) setUser\(data\.user\)/);
});

test('shared nav avatar renders the refreshed user image', () => {
  assert.match(shellSrc, /user\?\.avatar \? \(/);
  assert.match(shellSrc, /<img className="app-avatar" src=\{user\.avatar\} alt="" \/>/);
  assert.match(shellCss, /\.app-avatar \{[^}]*border-radius: 50%/);
  assert.match(shellCss, /\.app-avatar \{[^}]*object-fit: cover/);
});

test('profile avatar styling uses a centered circular cover crop', () => {
  const imgRule = profileCss.match(/\.profile-avatar-img \{[^}]*\}/)[0];
  assert.match(imgRule, /width: 100%/);
  assert.match(imgRule, /height: 100%/);
  assert.match(imgRule, /border-radius: 50%/);
  assert.match(imgRule, /object-fit: cover/);
  assert.match(imgRule, /object-position: center/);
});

test('user profile page displays the persisted avatar', () => {
  assert.match(userProfileSrc, /\{profile\.avatar \? <img src=\{profile\.avatar\} alt="" \/> : initial\}/);
  assert.match(userProfileSrc, /listUser\.avatar \? <img src=\{listUser\.avatar\}/);
});

test('avatar update never touches the auth token or session', () => {
  assert.equal(/localStorage|sessionStorage|melodify_token|token|logout/.test(handlerBlock), false);
  assert.equal(/localStorage\.setItem|removeItem/.test(profileSrc), false);
});
