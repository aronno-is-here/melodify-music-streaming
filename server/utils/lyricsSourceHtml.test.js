import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_SOURCE_MAX_ANCHORS,
  LYRICS_SOURCE_MAX_ANCHOR_TEXT_LENGTH,
  LYRICS_SOURCE_MAX_HTML_CHARS,
  extractSourceAnchors,
} from './lyricsSourceHtml.js';

test('extraction bounds are fixed', () => {
  assert.equal(LYRICS_SOURCE_MAX_ANCHORS, 200);
  assert.equal(LYRICS_SOURCE_MAX_HTML_CHARS, 400000);
  assert.equal(LYRICS_SOURCE_MAX_ANCHOR_TEXT_LENGTH, 300);
});

test('collects only anchor hrefs and anchor text', () => {
  const html = [
    '<html><body>',
    '<div class="lyric-body">SECRET LYRICS BODY THAT MUST NOT LEAK</div>',
    '<a href="https://genius.com/Artist-Track-lyrics">Artist &amp; Track Lyrics</a>',
    "<a href='/lyrics/artist/track.html'>Track <b>Lyrics</b></a>",
    '</body></html>',
  ].join('');

  const anchors = extractSourceAnchors(html);
  assert.equal(anchors.length, 2);
  assert.deepEqual(anchors[0], { href: 'https://genius.com/Artist-Track-lyrics', text: 'Artist & Track Lyrics' });
  assert.deepEqual(anchors[1], { href: '/lyrics/artist/track.html', text: 'Track Lyrics' });
  assert.equal(JSON.stringify(anchors).includes('SECRET LYRICS BODY'), false);
  assert.equal(JSON.stringify(anchors).includes('lyric-body'), false);
});

test('returns an empty list for non-string or empty input', () => {
  assert.deepEqual(extractSourceAnchors(undefined), []);
  assert.deepEqual(extractSourceAnchors(null), []);
  assert.deepEqual(extractSourceAnchors(''), []);
  assert.deepEqual(extractSourceAnchors(123), []);
});

test('caps the number of collected anchors', () => {
  const many = Array.from({ length: 20 }, (_, index) => `<a href="https://x.test/${index}">Track ${index}</a>`).join('');
  assert.equal(extractSourceAnchors(many, { maxAnchors: 5 }).length, 5);
  assert.equal(extractSourceAnchors(many, { maxAnchors: 0 }).length, 0);
});

test('ignores markup beyond the html scan cap', () => {
  const html = [
    '<a href="https://x.test/early">Early</a>',
    'x'.repeat(200),
    '<a href="https://x.test/late">Late</a>',
  ].join('');
  const anchors = extractSourceAnchors(html, { maxHtmlChars: 60 });
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].href, 'https://x.test/early');
});

test('truncates very long anchor text', () => {
  const text = 'a'.repeat(1000);
  const anchors = extractSourceAnchors(`<a href="https://x.test/track">${text}</a>`);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].text.length, LYRICS_SOURCE_MAX_ANCHOR_TEXT_LENGTH);
});

test('skips anchors without a usable href', () => {
  const html = '<a>no href</a><a href="">empty</a><a href="https://x.test/ok">Ok</a>';
  const anchors = extractSourceAnchors(html);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].href, 'https://x.test/ok');
});
