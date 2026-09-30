import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchSrc = readFileSync(join(__dirname, 'SearchView.jsx'), 'utf8');
const searchCss = readFileSync(join(__dirname, 'SearchView.css'), 'utf8');

const sliceBetween = (startMarker, endMarker) => {
  const start = searchSrc.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = searchSrc.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return searchSrc.slice(start, end);
};

const songsEffect = sliceBetween(
  "if (mode !== 'songs') return undefined;",
  '}, [mode, songQuery, regionTag]);',
);
const peopleEffect = sliceBetween(
  "if (mode !== 'people') return undefined;",
  '}, [mode, peopleQuery]);',
);
const peopleSection = searchSrc.slice(searchSrc.indexOf('id={PEOPLE_PANEL_ID}'));

test('7. Songs tab is the default search mode', () => {
  assert.match(searchSrc, /const \[mode, setMode\] = useState\('songs'\);/);
  assert.match(searchSrc, /onClick=\{\(\) => setMode\('songs'\)\}/);
  assert.match(searchSrc, /onClick=\{\(\) => setMode\('people'\)\}/);
  const songsTab = searchSrc.slice(
    searchSrc.indexOf('id={SONGS_TAB_ID}'),
    searchSrc.indexOf('</button>', searchSrc.indexOf('id={SONGS_TAB_ID}')),
  );
  assert.match(songsTab, /aria-selected=\{isSongsMode\}/);
  assert.match(songsTab, /Songs/);
  assert.match(searchSrc, /role="tablist" aria-label="Search modes"/);
  assert.match(searchSrc, /role="tab"/);
});

test('8. Songs mode calls the debounced catalog search', () => {
  assert.match(songsEffect, /\/api\/catalog\/search\?q=/);
  assert.match(songsEffect, /\/api\/songs\?q=/);
  assert.match(songsEffect, /SEARCH_DEBOUNCE_MS/);
});

test('9. Songs mode never calls the user search API', () => {
  assert.equal(songsEffect.includes('/api/users/search'), false);
  assert.equal(searchSrc.includes('Promise.all'), false);
});

test('10. People mode calls the debounced user search API', () => {
  assert.match(peopleEffect, /\/api\/users\/search\?q=/);
  assert.match(peopleEffect, /SEARCH_DEBOUNCE_MS/);
});

test('11. People mode never calls catalog or local song search', () => {
  assert.equal(peopleEffect.includes('/api/catalog'), false);
  assert.equal(peopleEffect.includes('/api/songs'), false);
});

test('12. Regional filter chips render only in Songs mode', () => {
  const chipsBlock = searchSrc.match(
    /\{isSongsMode \? \(\s*<div className="search-region-chips"[\s\S]*?\) : null\}/,
  );
  assert.ok(chipsBlock, 'chips must be gated behind the Songs mode conditional');
  assert.match(chipsBlock[0], /search-region-chip/);
  assert.match(chipsBlock[0], /REGION_OPTIONS\.map/);
  assert.match(searchSrc, /id: 'bn-bd', label: 'Bangla'/);
  assert.match(searchSrc, /id: 'hi-in', label: 'Hindi'/);
  assert.equal(peopleSection.includes('search-region-chip'), false);
  assert.equal(peopleSection.includes('song-source-badge'), false);
});

test('13. People results link to the public profile route', () => {
  assert.match(peopleSection, /to=\{`\/user\/\$\{entry\._id\}`\}/);
  assert.match(peopleSection, /search-user-card/);
  assert.match(peopleSection, /search-user-avatar/);
  assert.match(peopleSection, /search-user-name/);
});

test('14. Song and people query state never overwrite each other', () => {
  assert.match(searchSrc, /const \[songQuery, setSongQuery\] = useState\(''\);/);
  assert.match(searchSrc, /const \[peopleQuery, setPeopleQuery\] = useState\(''\);/);
  assert.equal(/const \[query, setQuery\]/.test(searchSrc), false);
  assert.match(searchSrc, /value=\{isSongsMode \? songQuery : peopleQuery\}/);
  assert.match(
    searchSrc,
    /if \(mode === 'songs'\) setSongQuery\(value\);\s*else setPeopleQuery\(value\);/,
  );
  assert.match(songsEffect, /songQuery\.trim\(\)/);
  assert.match(peopleEffect, /peopleQuery\.trim\(\)/);
});

test('15. Empty states render the specified copy per mode', () => {
  assert.match(searchSrc, /title="Search for songs, artists, or albums\."/);
  assert.match(searchSrc, /title="No songs found\."/);
  assert.match(searchSrc, /title="Search for people\."/);
  assert.match(searchSrc, /title="No people found\."/);
});

test('search input placeholders are mode specific', () => {
  assert.match(searchSrc, /'Search songs, artists, albums\.\.\.'/);
  assert.match(searchSrc, /'Search people\.\.\.'/);
  assert.match(searchSrc, /aria-label=\{isSongsMode \? 'Search songs, artists, albums' : 'Search people'\}/);
});

test('only the active mode issues requests', () => {
  assert.match(searchSrc, /if \(mode !== 'songs'\) return undefined;/);
  assert.match(searchSrc, /if \(mode !== 'people'\) return undefined;/);
  assert.match(searchSrc, /\}, \[mode, songQuery, regionTag\]\);/);
  assert.match(searchSrc, /\}, \[mode, peopleQuery\]\);/);
});

test('tab styles stay responsive without horizontal overflow', () => {
  assert.match(searchCss, /\.search-mode-tabs\s*\{/);
  assert.match(searchCss, /\.search-mode-tab\.active\s*\{/);
  assert.match(
    searchCss,
    /@media \(max-width: 768px\)[\s\S]*?\.search-mode-tabs\s*\{[\s\S]*?width: 100%;[\s\S]*?\}/,
  );
  assert.match(
    searchCss,
    /@media \(max-width: 768px\)[\s\S]*?\.search-mode-tab\s*\{[\s\S]*?flex: 1;[\s\S]*?\}/,
  );
});
