import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Feed.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Feed.css'), 'utf8');

test('Feed uses existing post/comment APIs and keeps optimistic safe controls', () => {
  assert.match(src, /api\.get\(`\/api\/posts\?page=\$\{pageNum\}&limit=20`\)/);
  assert.match(src, /api\.post\(`\/api\/comments\/\$\{commentingPostId\}`/);
  assert.match(src, /api\.del\(`\/api\/comments\/\$\{commentId\}`/);
  assert.match(src, /api\.post\(`\/api\/likes\/\$\{postId\}`\)/);
  assert.match(src, /api\.del\(`\/api\/likes\/\$\{postId\}`\)/);
  assert.match(src, /setPosts\(snapshot\)/);
});

test('Feed removes alert/prompt and uses AppDialog for responsive modal surfaces', () => {
  assert.match(src, /<AppDialog/);
  assert.match(src, /title="Comments"/);
  assert.match(src, /title="Share post"/);
  assert.equal(src.includes('alert('), false);
  assert.equal(src.includes('prompt('), false);
  assert.equal(src.includes('confirm('), false);
});

test('Feed keeps recording audio independent from PlayerContext and touch-visible actions', () => {
  assert.equal(src.includes('usePlayer'), false);
  assert.match(src, /<audio controls src=\{post\.audioUrl\} className="feed-recording-audio"/);
  assert.match(src, /className="feed-action"/);
  assert.match(css, /\.feed-action\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.feed-comment-delete\s*\{[\s\S]*min-height:\s*36px/);
});

test('Feed css is scoped and mobile-ready', () => {
  assert.match(css, /\.feed-page/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*main\s*\{/.test(css), false);
});
