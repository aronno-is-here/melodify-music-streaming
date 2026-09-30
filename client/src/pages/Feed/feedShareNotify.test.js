import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Feed.jsx'), 'utf8');

test('share flow reports the share event to the server', () => {
  assert.match(src, /api\.post\(`\/api\/posts\/\$\{post\._id\}\/share`\)/);
  assert.match(src, /shareInFlightRef/);
  assert.match(src, /shareInFlightRef\.current\.has\(post\._id\)/);
  assert.match(src, /shareInFlightRef\.current\.add\(post\._id\)/);
  assert.match(src, /shareInFlightRef\.current\.delete\(post\._id\)/);
});

test('existing like, comment, and clipboard share behaviour is preserved', () => {
  assert.match(src, /api\.post\(`\/api\/likes\/\$\{postId\}`\)/);
  assert.match(src, /api\.del\(`\/api\/likes\/\$\{postId\}`\)/);
  assert.match(src, /api\.post\(`\/api\/comments\/\$\{commentingPostId\}`/);
  assert.match(src, /navigator\.clipboard\.writeText\(payload\)/);
  assert.match(src, /title="Share post"/);
  assert.equal(src.includes('alert('), false);
  assert.equal(src.includes('confirm('), false);
});
