import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DISCOVERED_URL_LENGTH,
  isExpectedSourceHost,
  sanitizeDiscoveredSourceUrl,
} from './lyricsSourceUrl.js';

test('accepts https URLs on expected provider domains', () => {
  const result = sanitizeDiscoveredSourceUrl('https://genius.com/Tahsan-Khamoshiyan-lyrics', {
    allowedHosts: ['genius.com'],
  });
  assert.equal(result, 'https://genius.com/Tahsan-Khamoshiyan-lyrics');
});

test('accepts subdomains of expected provider domains', () => {
  const result = sanitizeDiscoveredSourceUrl('https://search.azlyrics.com/search.php?q=x', {
    allowedHosts: ['azlyrics.com'],
  });
  assert.ok(result);
  assert.ok(result.startsWith('https://search.azlyrics.com/'));
});

test('accepts plain http URLs when explicitly listed', () => {
  const result = sanitizeDiscoveredSourceUrl('http://example.com/lyrics', {
    allowedHosts: ['example.com'],
  });
  assert.equal(result, 'http://example.com/lyrics');
});

test('rejects non http protocols', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://genius.com/x',
  ]) {
    assert.equal(sanitizeDiscoveredSourceUrl(url, { allowedHosts: ['genius.com'] }), null, url);
  }
});

test('rejects URLs outside the allowlist', () => {
  const result = sanitizeDiscoveredSourceUrl('https://evil.com/Tahsan-Khamoshiyan-lyrics', {
    allowedHosts: ['genius.com'],
  });
  assert.equal(result, null);
});

test('rejects credentials, localhost, IP literals, and odd ports', () => {
  assert.equal(sanitizeDiscoveredSourceUrl('https://user:pass@genius.com/x', { allowedHosts: ['genius.com'] }), null);
  assert.equal(sanitizeDiscoveredSourceUrl('https://localhost/x', { allowedHosts: ['genius.com'] }), null);
  assert.equal(sanitizeDiscoveredSourceUrl('https://127.0.0.1/x', { allowedHosts: ['genius.com'] }), null);
  assert.equal(sanitizeDiscoveredSourceUrl('https://genius.com:8443/x', { allowedHosts: ['genius.com'] }), null);
});

test('rejects malformed and oversized URLs', () => {
  assert.equal(sanitizeDiscoveredSourceUrl('not a url', { allowedHosts: ['genius.com'] }), null);
  assert.equal(sanitizeDiscoveredSourceUrl('', { allowedHosts: ['genius.com'] }), null);
  assert.equal(sanitizeDiscoveredSourceUrl(null, { allowedHosts: ['genius.com'] }), null);
  const oversized = `https://genius.com/${'a'.repeat(MAX_DISCOVERED_URL_LENGTH)}`;
  assert.equal(sanitizeDiscoveredSourceUrl(oversized, { allowedHosts: ['genius.com'] }), null);
});

test('strips URL fragments from discovered URLs', () => {
  const result = sanitizeDiscoveredSourceUrl('https://genius.com/Tahsan-Khamoshiyan-lyrics#top', {
    allowedHosts: ['genius.com'],
  });
  assert.equal(result, 'https://genius.com/Tahsan-Khamoshiyan-lyrics');
});

test('without allowlist only protocol and shape are enforced', () => {
  assert.ok(sanitizeDiscoveredSourceUrl('https://anything.example/x'));
  assert.equal(sanitizeDiscoveredSourceUrl('javascript:alert(1)'), null);
});

test('isExpectedSourceHost matches allowed domains only', () => {
  assert.equal(isExpectedSourceHost('https://genius.com/x', ['genius.com']), true);
  assert.equal(isExpectedSourceHost('https://evil.com/x', ['genius.com']), false);
  assert.equal(isExpectedSourceHost('nonsense', ['genius.com']), false);
  assert.equal(isExpectedSourceHost('https://genius.com/x', []), false);
});
