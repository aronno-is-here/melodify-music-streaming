import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_DASHBOARD_MESSAGES,
  ADMIN_DASHBOARD_QUICK_ACTIONS,
  ADMIN_DASHBOARD_STAT_META,
  ADMIN_HEALTH_LABELS,
  ADMIN_LYRICS_STATUSES,
  ADMIN_MEDIA_SOURCES,
  ADMIN_MUSIC_MESSAGES,
  collectAdminCatalogGenres,
  computeAdminContentHealth,
  filterAdminCatalogSongs,
  selectAdminBadgeTone,
  selectAdminLyricsStatus,
  selectAdminMediaSource,
  selectAdminMusicView,
  selectAdminMusicViewMessage,
  selectAdminStatValue,
  selectStatCardPresentation,
} from './adminDashboardMusicUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Admin.css'), 'utf8');

const dashboardBlock = src.slice(
  src.indexOf("section === 'dashboard'"),
  src.indexOf("section === 'users'"),
);
const musicBlock = src.slice(
  src.indexOf("section === 'music'"),
  src.indexOf("section === 'missing-lyrics'"),
);
const deleteBody = src.slice(src.indexOf('const deleteSong'), src.indexOf('const deleteKaraoke'));

// ---------- Dashboard ----------

test('dashboard: page wrapper, heading and refresh control', () => {
  assert.match(src, /<div id="dashboard" className="admin-page">/);
  assert.match(dashboardBlock, /<h2>Dashboard<\/h2>/);
  assert.match(dashboardBlock, /admin-page-header/);
  assert.match(dashboardBlock, /onClick=\{\(\) => loadAll\(true\)\} disabled=\{refreshing\}/);
  assert.match(dashboardBlock, /\{refreshing \? 'Refreshing\.\.\.' : 'Refresh'\}/);
});

test('dashboard: renders the stats grid from shared metadata', () => {
  assert.match(dashboardBlock, /className="admin-stats-grid"/);
  assert.match(dashboardBlock, /ADMIN_DASHBOARD_STAT_META\.map\(\(meta\) =>/);
  assert.match(dashboardBlock, /selectAdminStatValue\(meta\.key, \{ dataStatus, stats, songs, karaokeTracks \}\)/);
  assert.match(dashboardBlock, /selectStatCardPresentation\(selection\)/);
  assert.match(dashboardBlock, /data-state=\{card\.state\}/);
  assert.match(dashboardBlock, /\{card\.display\}/);
});

test('dashboard stat cards: every metric key has a label, icon and context', () => {
  assert.deepEqual(
    ADMIN_DASHBOARD_STAT_META.map((meta) => meta.key),
    ['users', 'songs', 'karaoke', 'pendingReports', 'activeSubs', 'plays'],
  );
  for (const meta of ADMIN_DASHBOARD_STAT_META) {
    assert.equal(typeof meta.label, 'string');
    assert.ok(meta.label.length > 0, meta.key);
    assert.ok(meta.icon.startsWith('fa-'), meta.key);
    assert.equal(typeof meta.context, 'string');
    assert.ok(meta.context.length > 0, meta.key);
  }
});

test('dashboard stat cards: loading, failure and value presentation', () => {
  assert.equal(
    selectStatCardPresentation({ status: 'loading', value: null }).display,
    ADMIN_DASHBOARD_MESSAGES.STAT_LOADING,
  );
  assert.equal(
    selectStatCardPresentation({ status: 'error', value: null }).display,
    ADMIN_DASHBOARD_MESSAGES.STAT_UNAVAILABLE,
  );
  assert.equal(
    selectStatCardPresentation({ status: 'ready', value: '12' }).display,
    ADMIN_DASHBOARD_MESSAGES.STAT_UNAVAILABLE,
  );
  assert.equal(
    selectStatCardPresentation({ status: 'ready', value: Number.NaN }).display,
    ADMIN_DASHBOARD_MESSAGES.STAT_UNAVAILABLE,
  );
  assert.deepEqual(selectStatCardPresentation({ status: 'ready', value: 7 }), {
    state: 'ready',
    display: '7',
  });
});

test('dashboard stat cards: values resolve per source status', () => {
  const ready = { stats: 'ready', songs: 'ready', karaoke: 'ready' };
  assert.deepEqual(
    selectAdminStatValue('users', { dataStatus: ready, stats: { users: 12 } }),
    { status: 'ready', value: 12 },
  );
  assert.deepEqual(
    selectAdminStatValue('songs', { dataStatus: ready, stats: { songs: 14 } }),
    { status: 'ready', value: 14 },
  );
  assert.deepEqual(
    selectAdminStatValue('songs', { dataStatus: ready, stats: {}, songs: [{}, {}] }),
    { status: 'ready', value: 2 },
  );
  assert.deepEqual(
    selectAdminStatValue('karaoke', { dataStatus: ready, karaokeTracks: [{}] }),
    { status: 'ready', value: 1 },
  );
  assert.equal(
    selectAdminStatValue('plays', { dataStatus: { stats: 'error' }, stats: {} }).status,
    'error',
  );
  assert.equal(
    selectAdminStatValue('users', { dataStatus: { stats: 'loading' }, stats: {} }).status,
    'loading',
  );
});

test('dashboard: quick actions panel renders shared actions', () => {
  assert.match(dashboardBlock, /aria-labelledby="admin-quick-actions-title"/);
  assert.match(dashboardBlock, /ADMIN_DASHBOARD_QUICK_ACTIONS\.map\(\(action\) =>/);
  assert.match(dashboardBlock, /runQuickAction\(action\)/);
  assert.match(dashboardBlock, /data-action=\{action\.id\}/);
  assert.match(dashboardBlock, /\{action\.description\}/);
});

test('dashboard quick actions: complete action set with target sections', () => {
  assert.deepEqual(
    ADMIN_DASHBOARD_QUICK_ACTIONS.map((action) => action.id),
    ['add-song', 'manage-lyrics', 'manage-chords', 'add-karaoke', 'review-reports'],
  );
  for (const action of ADMIN_DASHBOARD_QUICK_ACTIONS) {
    assert.ok(action.section.length > 0, action.id);
    assert.ok(action.label.length > 0, action.id);
    assert.ok(action.description.length > 0, action.id);
  }
  const addSongAction = ADMIN_DASHBOARD_QUICK_ACTIONS.find((action) => action.id === 'add-song');
  assert.equal(addSongAction.opensAddSong, true);
  assert.equal(
    ADMIN_DASHBOARD_QUICK_ACTIONS.filter((action) => action.opensAddSong === true).length,
    1,
  );
});

test('dashboard: quick action handler opens add-song or navigates', () => {
  assert.match(src, /const runQuickAction = \(action\) => \{/);
  assert.match(src, /if \(action\.opensAddSong\) \{/);
  assert.match(src, /setAddingSong\(true\);\s*\n\s*handleNavClick\(action\.section\);/);
  assert.match(src, /handleNavClick\(action\.section\);\s*\n\s*\};/);
});

test('dashboard: content health panel counts only loaded songs', () => {
  assert.match(dashboardBlock, /aria-labelledby="admin-content-health-title"/);
  assert.match(src, /computeAdminContentHealth\(songs\)/);
  assert.match(dashboardBlock, /Object\.keys\(ADMIN_HEALTH_LABELS\)\.map/);
  assert.match(dashboardBlock, /contentHealth\[key\]/);
  assert.match(dashboardBlock, /dataStatus\.songs === 'ready'/);
  assert.match(dashboardBlock, /ADMIN_DASHBOARD_MESSAGES\.HEALTH_UNAVAILABLE/);
  assert.match(dashboardBlock, /Across \{contentHealth\.total\} loaded song/);
  assert.equal(musicBlock.includes('computeAdminContentHealth'), false);
  assert.equal(
    src.includes('/api/admin/missing-lyrics') && dashboardBlock.includes('missing-lyrics'),
    false,
    'dashboard health must not call the missing-lyrics endpoint',
  );
});

test('content health: lyrics require verified non-empty text', () => {
  assert.deepEqual(computeAdminContentHealth([]), {
    total: 0,
    lyricsAvailable: 0,
    lyricsMissing: 0,
    chordsAvailable: 0,
    chordsMissing: 0,
  });
  const health = computeAdminContentHealth([
    { lyrics: 'hello world', lyrics_verified: true, chords: '' },
    { lyrics: 'hello world', lyrics_verified: false },
    { lyrics: '   ', lyrics_verified: true },
    { lyrics: 'unverified text' },
    { lyrics_verified: true },
    { chords: 'C G Am', chords_verified: true },
  ]);
  assert.equal(health.total, 6);
  assert.equal(health.lyricsAvailable, 1);
  assert.equal(health.lyricsMissing, 5);
  assert.equal(health.chordsAvailable, 1);
  assert.equal(health.chordsMissing, 5);
  assert.equal(health.lyricsAvailable + health.lyricsMissing, health.total);
  assert.equal(health.chordsAvailable + health.chordsMissing, health.total);
});

test('content health: label map is exactly four coverage labels', () => {
  assert.deepEqual(Object.keys(ADMIN_HEALTH_LABELS), [
    'lyricsAvailable',
    'lyricsMissing',
    'chordsAvailable',
    'chordsMissing',
  ]);
  assert.equal(ADMIN_HEALTH_LABELS.lyricsAvailable, 'Lyrics Available');
  assert.equal(ADMIN_HEALTH_LABELS.lyricsMissing, 'Lyrics Missing');
  assert.equal(ADMIN_HEALTH_LABELS.chordsAvailable, 'Chords Available');
  assert.equal(ADMIN_HEALTH_LABELS.chordsMissing, 'Chords Missing');
});

test('dashboard: revenue and recent plays read only persisted stats fields', () => {
  const used = Array.from(dashboardBlock.matchAll(/stats\.([a-zA-Z_]+)/g)).map((m) => m[1]);
  const allowed = new Set([
    'revenue',
    'totalSubs',
    'monthlyRevenue',
    'monthlySubs',
    'lastMonthRevenue',
    'revenueByPlan',
    'recentPlays',
  ]);
  for (const key of used) {
    assert.ok(allowed.has(key), `unexpected stats field: ${key}`);
  }
  assert.match(dashboardBlock, /dataStatus\.stats === 'ready'/);
  assert.match(dashboardBlock, /admin-revenue-grid/);
  assert.match(dashboardBlock, /admin-revenue-plans/);
  assert.match(dashboardBlock, /aria-labelledby="admin-recent-plays-title"/);
  assert.match(dashboardBlock, /ADMIN_DASHBOARD_MESSAGES\.NO_RECENT_PLAYS/);
  assert.match(dashboardBlock, /stats\.recentPlays\.map\(\(play, i\) =>/);
});

test('dashboard: no legacy inline bright-color card styling remains', () => {
  assert.equal(/style=\{\{ display: 'grid'/.test(dashboardBlock), false);
  assert.equal(/#4caf50|#ff6b6b/.test(dashboardBlock), false);
  assert.equal(/<div id="dashboard" className="card">/.test(src), false);
});

// ---------- Music catalog ----------

test('music: page wrapper, heading, subtitle and header actions', () => {
  assert.match(src, /<div id="music" className="admin-page">/);
  assert.match(musicBlock, /<h2>Music Catalog<\/h2>/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.PAGE_SUBTITLE/);
  assert.match(musicBlock, /onClick=\{\(\) => loadAll\(true\)\} disabled=\{refreshing\}/);
  assert.match(musicBlock, /onClick=\{openAddSong\}>Add Song<\/button>/);
});

test('music: catalog toolbar searches and filters client side', () => {
  assert.match(musicBlock, /className="admin-toolbar"/);
  assert.match(musicBlock, /placeholder=\{ADMIN_MUSIC_MESSAGES\.SEARCH_PLACEHOLDER\}/);
  assert.equal(ADMIN_MUSIC_MESSAGES.SEARCH_PLACEHOLDER, 'Search songs...');
  assert.match(musicBlock, /value=\{songSearch\}/);
  assert.match(musicBlock, /setSongSearch\(event\.target\.value\)/);
  assert.match(musicBlock, /value=\{songGenreFilter\}/);
  assert.match(musicBlock, /setSongGenreFilter\(event\.target\.value\)/);
  assert.match(musicBlock, /<option value="all">\{ADMIN_MUSIC_MESSAGES\.ALL_GENRES\}<\/option>/);
  assert.equal(ADMIN_MUSIC_MESSAGES.ALL_GENRES, 'All genres');
  assert.match(musicBlock, /catalogGenres\.map\(\(genre\) =>/);
  assert.match(src, /collectAdminCatalogGenres\(songs\)/);
  assert.match(
    src,
    /filterAdminCatalogSongs\(songs, \{ query: songSearch, genre: songGenreFilter \}\)/,
  );
});

test('music search: query matches title, artist and album case-insensitively', () => {
  const songs = [
    { title: 'Bohemian', artist: 'Queen', genre: 'Rock' },
    { title: 'Anaconda', artist: 'Nicki', album: 'Pink Friday', genre: 'Pop' },
    { title: 'Hindi Song', artist: 'Arijit', genre: 'Hindi' },
    { title: 'No Genre', artist: 'X', genre: 42 },
  ];
  assert.equal(filterAdminCatalogSongs(songs, { query: 'bohe' }).length, 1);
  assert.equal(filterAdminCatalogSongs(songs, { query: 'QUEEN' }).length, 1);
  assert.equal(filterAdminCatalogSongs(songs, { query: 'pink friday' }).length, 1);
  assert.equal(filterAdminCatalogSongs(songs, { query: '' }).length, 4);
  assert.equal(filterAdminCatalogSongs(songs, { genre: 'Hindi' }).length, 1);
  assert.equal(filterAdminCatalogSongs(songs, { genre: 'all' }).length, 4);
  assert.equal(filterAdminCatalogSongs(songs, { query: 'queen', genre: 'Pop' }).length, 0);
  assert.equal(filterAdminCatalogSongs(null, { query: 'x' }).length, 0);
});

test('music search: genre options are unique and sorted', () => {
  assert.deepEqual(
    collectAdminCatalogGenres([
      { genre: 'Rock' },
      { genre: ' pop ' },
      { genre: 'Rock' },
      { genre: '' },
      { genre: null },
      {},
    ]),
    ['pop', 'Rock'],
  );
  assert.deepEqual(collectAdminCatalogGenres(undefined), []);
});

test('music: view states resolve from load status and match counts', () => {
  assert.equal(selectAdminMusicView({ status: 'loading', totalSongs: 3, matchCount: 3 }), 'loading');
  assert.equal(selectAdminMusicView({ status: 'error', totalSongs: 0, matchCount: 0 }), 'error');
  assert.equal(selectAdminMusicView({ status: 'ready', totalSongs: 0, matchCount: 0 }), 'empty');
  assert.equal(selectAdminMusicView({ status: 'ready', totalSongs: 3, matchCount: 0 }), 'no-matches');
  assert.equal(selectAdminMusicView({ status: 'ready', totalSongs: 3, matchCount: 2 }), 'ready');
  assert.equal(selectAdminMusicView({ status: 'error', totalSongs: 3, matchCount: 2 }), 'ready');
});

test('music: view messages are exact fixed strings', () => {
  assert.equal(selectAdminMusicViewMessage('loading'), 'Loading music...');
  assert.equal(selectAdminMusicViewMessage('error'), 'Unable to load music.');
  assert.equal(selectAdminMusicViewMessage('empty'), 'No songs found.');
  assert.equal(selectAdminMusicViewMessage('no-matches'), 'No songs match your search.');
  assert.equal(selectAdminMusicViewMessage('ready'), '');
  assert.equal(ADMIN_MUSIC_MESSAGES.REFRESH_FAILED, 'Unable to refresh music.');
  assert.equal(ADMIN_MUSIC_MESSAGES.RETRY, 'Retry');
});

test('music: catalog body renders loading, error, empty and no-match states', () => {
  assert.match(src, /selectAdminMusicView\(\{/);
  assert.match(src, /status: dataStatus\.songs/);
  assert.match(musicBlock, /musicView === 'loading'/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.LOADING/);
  assert.match(musicBlock, /musicView === 'error'/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.ERROR/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.RETRY/);
  assert.match(musicBlock, /musicView === 'empty'/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.EMPTY/);
  assert.match(musicBlock, /musicView === 'no-matches'/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.NO_MATCHES/);
});

test('music: failed refresh keeps the table visible with an inline notice', () => {
  assert.match(musicBlock, /dataStatus\.songs === 'error' &&/);
  assert.match(musicBlock, /ADMIN_MUSIC_MESSAGES\.REFRESH_FAILED/);
  assert.match(musicBlock, /className="admin-inline-notice"/);
  assert.match(musicBlock, /filteredSongs\.map\(\(song\) =>/);
  assert.equal(musicBlock.includes('{songs.map((song) =>'), false, 'table must render filtered songs');
});

test('music: catalog table columns and horizontal scroll shell', () => {
  assert.match(musicBlock, /className="admin-table-shell"/);
  assert.match(musicBlock, /className="admin-table-scroll"/);
  for (const column of ['Artwork', 'Song', 'Genre', 'Lyrics', 'Chords', 'Source', 'Actions']) {
    assert.ok(musicBlock.includes(`<th>${column}</th>`), `missing column ${column}`);
  }
  assert.ok(musicBlock.indexOf('<th>Chords</th>') < musicBlock.indexOf('<th>Actions</th>'));
});

test('music: row renders artwork, title and artist metadata', () => {
  assert.match(musicBlock, /song\.poster_url \? \(/);
  assert.match(musicBlock, /className="admin-table-art" src=\{song\.poster_url\}/);
  assert.match(musicBlock, /admin-table-art--empty/);
  assert.match(musicBlock, /admin-table-song-title">\{song\.title\}/);
  assert.match(musicBlock, /admin-table-song-meta">\{song\.artist\}/);
});

test('music status badges: lyrics, chords and source columns', () => {
  assert.match(musicBlock, /selectAdminLyricsStatus\(song\)/);
  assert.match(musicBlock, /selectChordListStatus\(song\)/);
  assert.match(musicBlock, /selectAdminMediaSource\(song\)/);
  assert.match(musicBlock, /selectAdminBadgeTone\(selectAdminLyricsStatus\(song\)\)/);
  assert.match(musicBlock, /selectAdminBadgeTone\(selectChordListStatus\(song\)\)/);
  assert.match(musicBlock, /selectAdminBadgeTone\(selectAdminMediaSource\(song\)\)/);
  assert.match(css, /\.admin-badge\.ok \{/);
  assert.match(css, /\.admin-badge\.info \{/);
  assert.match(css, /\.admin-badge\.warn \{/);
  assert.match(css, /\.admin-badge\.muted \{/);
});

test('music status badges: helper vocabularies and tones', () => {
  assert.deepEqual(ADMIN_LYRICS_STATUSES, ['Verified', 'Available', 'Missing']);
  assert.deepEqual(ADMIN_MEDIA_SOURCES, ['YouTube', 'Local', 'None']);
  assert.equal(selectAdminLyricsStatus({ lyrics: 'text', lyrics_verified: true }), 'Verified');
  assert.equal(selectAdminLyricsStatus({ lyrics: 'text', lyrics_verified: false }), 'Available');
  assert.equal(selectAdminLyricsStatus({ lyrics: '   ', lyrics_verified: true }), 'Missing');
  assert.equal(selectAdminLyricsStatus(null), 'Missing');
  assert.equal(selectAdminMediaSource({ youtube_id: 'abc' }), 'YouTube');
  assert.equal(selectAdminMediaSource({ youtube_id: '  ', file_path: '/x.mp3' }), 'Local');
  assert.equal(selectAdminMediaSource({ youtube_id: '', file_path: '' }), 'None');
  assert.equal(selectAdminBadgeTone('Verified'), 'ok');
  assert.equal(selectAdminBadgeTone('Available'), 'info');
  assert.equal(selectAdminBadgeTone('Unverified'), 'warn');
  assert.equal(selectAdminBadgeTone('Missing'), 'warn');
  assert.equal(selectAdminBadgeTone('YouTube'), 'ok');
  assert.equal(selectAdminBadgeTone('Local'), 'ok');
  assert.equal(selectAdminBadgeTone('None'), 'muted');
  assert.equal(selectAdminBadgeTone('anything-else'), 'muted');
});

test('add song ux: shared dialog with grouped form sections', () => {
  assert.match(musicBlock, /<AppDialog/);
  assert.match(musicBlock, /open=\{addingSong\}/);
  assert.match(musicBlock, /title="Add Song"/);
  assert.match(musicBlock, /labelledBy="admin-add-song-title"/);
  assert.match(musicBlock, /id="admin-add-song-form"/);
  assert.match(musicBlock, /onSubmit=\{addSong\}/);
  assert.match(musicBlock, /form="admin-add-song-form"/);
  assert.match(musicBlock, /<legend>Basic Information<\/legend>/);
  assert.match(musicBlock, /<legend>YouTube<\/legend>/);
  assert.match(musicBlock, /<legend>Upload File<\/legend>/);
  assert.match(musicBlock, /btn btn-ghost/);
  assert.match(musicBlock, /onClick=\{\(\) => setAddingSong\(false\)\}/);
});

test('add song ux: dialog opens from header and quick actions, closes on success', () => {
  assert.match(src, /const openAddSong = \(\) => \{/);
  assert.match(src, /setAddingSong\(true\);\s*\n\s*handleNavClick\('music'\);/);
  const addBody = src.slice(src.indexOf('const addSong'), src.indexOf('const openAddSong'));
  assert.ok(addBody.length > 0);
  assert.equal((addBody.match(/setAddingSong\(false\)/g) || []).length, 2);
  assert.equal(
    src.includes('<form onSubmit={addSong} style='),
    false,
    'legacy inline add form must be replaced by the dialog',
  );
});

test('edit song ux: panel identity header with token-styled shell', () => {
  assert.match(musicBlock, /className="admin-panel admin-song-editor"/);
  assert.match(musicBlock, /admin-song-editor-head/);
  assert.match(musicBlock, /<h3>Edit Song<\/h3>/);
  assert.match(musicBlock, /\{editingSong\.title\} — \{editingSong\.artist\}/);
  assert.match(musicBlock, /<form onSubmit=\{saveSongEdits\}>/);
  assert.match(css, /\.admin-song-editor \{/);
  assert.match(css, /\.admin-song-editor-head \{/);
  assert.equal(
    musicBlock.includes("border: '1px solid #00b4d8'"),
    false,
    'editor must not use the legacy bright inline border',
  );
});

test('edit song ux: verification sections remain intact', () => {
  assert.match(musicBlock, /Lyrics Verification/);
  assert.match(musicBlock, /Chords Verification/);
  assert.match(musicBlock, /Suggested Sources/);
  assert.match(musicBlock, /name="lyrics_verified"/);
  assert.match(musicBlock, /name="chords_verified"/);
});

test('manage chords preserved: editor anchors and actions are unchanged', () => {
  assert.match(src, /id="song-chords-editor"/);
  assert.match(src, /<h4 className="admin-chord-heading">Manage Chords<\/h4>/);
  assert.match(src, /Current chord status: \{selectChordListStatus\(editingSong\)\}/);
  assert.match(
    musicBlock,
    /onClick=\{\(\) => manageSongChords\(song\)\}>Manage Chords<\/button>/,
  );
  assert.match(musicBlock, /onClick=\{\(\) => openSongEditor\(song\)\}>Edit<\/button>/);
  assert.match(musicBlock, /className="btn admin-manage-chords"/);
  assert.equal(src.split('const saveChordsOnly').length - 1, 1, 'single chord save implementation');
  assert.equal(src.split('const manageSongChords').length - 1, 1, 'single manage chords implementation');
});

test('delete flow preserved: confirmation gate before the delete request', () => {
  assert.ok(deleteBody.length > 0, 'deleteSong must exist');
  assert.match(deleteBody, /if \(!confirm\('Are you sure you want to delete this song\?'\)\) return;/);
  const confirmIndex = deleteBody.indexOf('confirm(');
  const requestIndex = deleteBody.indexOf('api.del(');
  assert.ok(confirmIndex >= 0 && requestIndex > confirmIndex, 'confirm must run before api.del');
  assert.match(musicBlock, /onClick=\{\(\) => deleteSong\(song\._id\)\}>Delete<\/button>/);
  assert.equal(deleteBody.includes('setTimeout'), false, 'no instant/deferred delete bypass');
});

// ---------- Responsive ----------

test('responsive music: toolbar stacks and table scrolls inside its shell', () => {
  assert.match(css, /\.admin-table-scroll \{\r?\n\s*overflow-x: auto;/);
  assert.match(css, /\.admin-table \{\r?\n\s*width: 100%;\r?\n\s*min-width: 780px;/);
  const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
  assert.match(mobile, /\.admin-page-header \{\r?\n\s*flex-direction: column;/);
  assert.match(mobile, /\.admin-toolbar-search \{\r?\n\s*max-width: none;/);
  assert.match(css, /\.admin-toolbar-search \{[^}]*max-width: 420px;/);
});

test('responsive dashboard: columns collapse and stat grids reflow', () => {
  const tablet = css.slice(css.indexOf('@media (max-width: 1024px)'));
  assert.match(tablet, /\.admin-dash-columns \{\r?\n\s*grid-template-columns: minmax\(0, 1fr\);/);
  const phone = css.slice(css.indexOf('@media (max-width: 430px)'));
  assert.match(phone, /\.admin-stats-grid \{\r?\n\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  const small = css.slice(css.indexOf('@media (max-width: 360px)'));
  assert.match(small, /\.admin-stats-grid \{\r?\n\s*grid-template-columns: minmax\(0, 1fr\);/);
  const pageRule = css.slice(css.indexOf('.admin-page {'), css.indexOf('.admin-page-header {'));
  assert.equal(/overflow:\s*hidden/.test(pageRule), false, 'page wrapper must not trap scroll');
});

test('shared tokens power the new surfaces without bright slabs', () => {
  const start = css.indexOf('/* ---------- Checkpoint B');
  assert.ok(start > 0, 'checkpoint styles must exist');
  const block = css.slice(start);
  assert.match(block, /var\(--mel-bg-elev-1\)/);
  assert.match(block, /var\(--mel-border\)/);
  assert.match(block, /var\(--mel-radius-12\)/);
  assert.match(block, /var\(--mel-text-muted\)/);
  assert.equal(/background: var\(--sky-blue\)/.test(block), false, 'no bright sky-blue panel fills');
  assert.equal(/box-shadow: 0 20px 60px/.test(block), false, 'no heavy shadows');
});
