import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'D:/Aronno/Works/Melodify - Music Streaming Website/client/src';
const loginSrc = readFileSync(join(root, 'pages', 'Login', 'Login.jsx'), 'utf8');
const signupSrc = readFileSync(join(root, 'pages', 'Signup', 'Signup.jsx'), 'utf8');
const forgotSrc = readFileSync(join(root, 'pages', 'ForgotPassword', 'ForgotPassword.jsx'), 'utf8');
const resetSrc = readFileSync(join(root, 'pages', 'ResetPassword', 'ResetPassword.jsx'), 'utf8');
const authCss = readFileSync(join(root, 'styles', 'auth-pages.css'), 'utf8');

test('Login uses labeled fields, real password toggle button, and async states', () => {
  assert.match(loginSrc, /label htmlFor="login-email"/);
  assert.match(loginSrc, /label htmlFor="login-password"/);
  assert.match(loginSrc, /className="auth-password-toggle"/);
  assert.equal(loginSrc.includes('className="toggle-password"'), false);
  assert.match(loginSrc, /disabled=\{loading\}/);
  assert.match(loginSrc, /role="alert"/);
});

test('Signup preserves 3-step flow and API contracts without recaptcha copy', () => {
  assert.match(signupSrc, /setStep\(2\)/);
  assert.match(signupSrc, /setStep\(3\)/);
  assert.match(signupSrc, /api\.post\('\/api\/auth\/signup\/step1'/);
  assert.match(signupSrc, /api\.post\('\/api\/auth\/signup\/step2'/);
  assert.match(signupSrc, /api\.post\('\/api\/auth\/signup\/step3'/);
  assert.equal(signupSrc.includes('reCAPTCHA'), false);
});

test('Forgot and reset password preserve security route contracts and token behavior', () => {
  assert.match(forgotSrc, /api\.post\('\/api\/auth\/forgot-password'/);
  assert.match(resetSrc, /const token = searchParams\.get\('token'\)/);
  assert.match(resetSrc, /\{!token \? \(/);
  assert.match(resetSrc, /api\.post\('\/api\/auth\/reset-password'/);
  assert.match(resetSrc, /password\.length < 10/);
});

test('Auth pages keep accessible state announcements and navigation links', () => {
  assert.match(forgotSrc, /role="alert"/);
  assert.match(forgotSrc, /role="status" aria-live="polite"/);
  assert.match(resetSrc, /role="alert"/);
  assert.match(resetSrc, /role="status" aria-live="polite"/);
  assert.match(loginSrc, /Link to="\/"/);
  assert.match(signupSrc, /Link to="\/"/);
  assert.match(forgotSrc, /Link to="\/"/);
  assert.match(resetSrc, /Link to="\/"/);
});

test('Shared auth css avoids global body/100vh traps and supports mobile grids', () => {
  assert.match(authCss, /\.auth-page/);
  assert.match(authCss, /min-height: 100dvh/);
  assert.match(authCss, /@media \(max-width: 640px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(authCss), false);
  assert.equal(authCss.includes('height: 100vh'), false);
});
