import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseYouTubeDuration,
  formatDurationSeconds,
  normalizeYouTubeVideoCandidate,
  normalizeYouTubeMusicCandidates,
  YOUTUBE_SOURCE_PROVIDER,
  YOUTUBE_MUSIC_CATEGORY_ID,
  YOUTUBE_MUSIC_CATEGORY,
  TOPIC_CHANNEL_SUFFIX,
  INELIGIBILITY_REASONS,
} from './youtubeMusicNormalizer.js';

const makeVideo = ({ id = 'vidAAAAAAAAAA', snippet = {}, contentDetails = {}, status = {}, ...rest } = {}) => ({
  id,
  snippet: {
    title: 'Test Song',
    channelTitle: `Some Artist${TOPIC_CHANNEL_SUFFIX}`,
    categoryId: '10',
    publishedAt: '2024-03-01T12:00:00Z',
    liveBroadcastContent: 'none',
    thumbnails: {
      default: { url: 'https://i.ytimg.com/vi/vidAAAAAAAAAA/default.jpg' },
    },
    ...snippet,
  },
  contentDetails: { duration: 'PT4M13S', ...contentDetails },
  status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true, ...status },
  ...rest,
});

const searchResponseOf = (videoIds, extraItems = []) => ({
  kind: 'youtube#searchListResponse',
  items: [
    ...videoIds.map((videoId) => ({ id: { videoId }, snippet: { title: 'Search snippet title' } })),
    ...extraItems,
  ],
});

const detailsResponseOf = (videos) => ({ kind: 'youtube#videoListResponse', items: videos });

test('IDENTITY 1: valid video creates source_provider=youtube', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo());
  assert.equal(candidate.source_provider, 'youtube');
  assert.equal(candidate.source_provider, YOUTUBE_SOURCE_PROVIDER);
  assert.equal(candidate.source_provider, 'youtube');
});

test('IDENTITY 2: external_id matches the video ID', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ id: '  vidXYZ123456  ' }));
  assert.equal(candidate.external_id, 'vidXYZ123456');
});

test('IDENTITY 3: youtube_id matches the video ID', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ id: 'vidXYZ123456' }));
  assert.equal(candidate.youtube_id, 'vidXYZ123456');
  assert.equal(candidate.youtube_id, candidate.external_id);
});

test('IDENTITY 4: invalid or missing video ID yields no usable candidate', () => {
  assert.equal(normalizeYouTubeVideoCandidate(makeVideo({ id: '' })), null);
  assert.equal(normalizeYouTubeVideoCandidate(makeVideo({ id: '   ' })), null);
  assert.equal(normalizeYouTubeVideoCandidate(makeVideo({ id: 42 })), null);
  assert.equal(normalizeYouTubeVideoCandidate(makeVideo({ id: null })), null);
  assert.equal(normalizeYouTubeVideoCandidate(makeVideo({ id: 'x'.repeat(65) })), null);
  const withoutId = makeVideo();
  delete withoutId.id;
  assert.equal(normalizeYouTubeVideoCandidate(withoutId), null);
  const explicitUndefined = makeVideo();
  explicitUndefined.id = undefined;
  assert.equal(normalizeYouTubeVideoCandidate(explicitUndefined), null);
  assert.equal(normalizeYouTubeVideoCandidate(null), null);
  assert.equal(normalizeYouTubeVideoCandidate('vidAAAAAAAAAA'), null);
  const searchShaped = { id: { videoId: 'vidAAAAAAAAAA' }, snippet: {} };
  assert.equal(normalizeYouTubeVideoCandidate(searchShaped), null);
});

test('TITLE 5: title is trimmed', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { title: '  Trimmed Song  ' } }));
  assert.equal(candidate.title, 'Trimmed Song');
});

test('TITLE 6: empty title is rejected and the candidate is ineligible', () => {
  for (const title of ['', '   ']) {
    const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { title } }));
    assert.ok(candidate !== null);
    assert.equal(candidate.title, null);
    assert.equal(candidate.catalog_eligible, false);
    assert.equal(candidate.recommendation_eligible, false);
    assert.ok(candidate.ineligibility_reasons.includes('missing-title'));
  }
});

test('ARTIST 7: channel title is preserved (trimmed, without topic stripping)', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { channelTitle: '  Ordinary Channel  ' } }));
  assert.equal(candidate.channel_title, 'Ordinary Channel');
});

test('ARTIST 8: "Artist - Topic" becomes provisional artist "Artist"', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { channelTitle: `Real Energy${TOPIC_CHANNEL_SUFFIX}` } }));
  assert.equal(candidate.channel_title, `Real Energy${TOPIC_CHANNEL_SUFFIX}`);
  assert.equal(candidate.artist_candidate, 'Real Energy');
  assert.equal(candidate.artist_candidate_source, 'topic-channel');
});

test('ARTIST 9: ordinary channel remains a provisional channel-title candidate', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { channelTitle: 'Ordinary Channel' } }));
  assert.equal(candidate.artist_candidate, 'Ordinary Channel');
  assert.equal(candidate.artist_candidate_source, 'channel-title');
});

test('ARTIST 10: video title is never parsed for an arbitrary artist', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: { title: 'Some Famous Artist - Beautiful Song (Official Video)', channelTitle: 'JustChannel' },
  }));
  assert.equal(candidate.artist_candidate, 'JustChannel');
  assert.equal(candidate.artist_candidate_source, 'channel-title');
  assert.equal(candidate.channel_title, 'JustChannel');
});

test('THUMBNAIL 11: highest valid thumbnail quality is selected', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: {
      thumbnails: {
        default: { url: 'https://i.ytimg.com/vi/x/default.jpg' },
        medium: { url: 'https://i.ytimg.com/vi/x/medium.jpg' },
        high: { url: 'https://i.ytimg.com/vi/x/high.jpg' },
        standard: { url: 'https://i.ytimg.com/vi/x/standard.jpg' },
        maxres: { url: 'https://i.ytimg.com/vi/x/maxres.jpg' },
      },
    },
  }));
  assert.equal(candidate.poster_url, 'https://i.ytimg.com/vi/x/maxres.jpg');
});

test('THUMBNAIL 12: selection falls back through available qualities', () => {
  const onlyDefault = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: { thumbnails: { default: { url: 'https://i.ytimg.com/vi/x/default.jpg' } } },
  }));
  assert.equal(onlyDefault.poster_url, 'https://i.ytimg.com/vi/x/default.jpg');

  const invalidMaxres = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: {
      thumbnails: {
        maxres: { url: 'not a url' },
        high: { url: 'https://i.ytimg.com/vi/x/high.jpg' },
      },
    },
  }));
  assert.equal(invalidMaxres.poster_url, 'https://i.ytimg.com/vi/x/high.jpg');
});

test('THUMBNAIL 13: invalid URL schemes are rejected', () => {
  for (const url of [
    'data:image/jpeg;base64,AAAA',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://example.com/x.jpg',
    '',
    '   ',
  ]) {
    const candidate = normalizeYouTubeVideoCandidate(makeVideo({
      snippet: { thumbnails: { maxres: { url }, default: { url } } },
    }));
    assert.equal(candidate.poster_url, null, url);
  }
});

test('THUMBNAIL 14: no usable thumbnail yields null', () => {
  const noThumbnails = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { thumbnails: {} } }));
  assert.equal(noThumbnails.poster_url, null);
  const missingThumbnails = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { thumbnails: undefined } }));
  assert.equal(missingThumbnails.poster_url, null);
  const brokenThumbnails = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { thumbnails: 'nope' } }));
  assert.equal(brokenThumbnails.poster_url, null);
});

test('DURATION 15: PT4M13S parses to 253 seconds', () => {
  assert.equal(parseYouTubeDuration('PT4M13S'), 253);
});

test('DURATION 16: PT1H2M3S parses to 3723 seconds', () => {
  assert.equal(parseYouTubeDuration('PT1H2M3S'), 3723);
});

test('DURATION 17: PT45S parses to 45 seconds', () => {
  assert.equal(parseYouTubeDuration('PT45S'), 45);
  assert.equal(parseYouTubeDuration('PT2H'), 7200);
});

test('DURATION 18: day-containing durations parse correctly', () => {
  assert.equal(parseYouTubeDuration('P1DT2H3M4S'), 86400 + 7200 + 180 + 4);
  assert.equal(parseYouTubeDuration('P2D'), 172800);
});

test('DURATION 19: malformed durations yield null, never zero', () => {
  for (const value of ['', '   ', 'garbage', '4:13', 'PT', 'P', 'P1DT', 'pt4m13s', 'PT4M13S extra', 'P1W', ['PT4M13S'], null, undefined, 253, {}]) {
    assert.equal(parseYouTubeDuration(value), null, JSON.stringify(value));
  }
});

test('DURATION 20: negative or impossible values are not accepted', () => {
  for (const value of ['PT-4M13S', 'PT4M-13S', 'P-1DT2H', 'PT-45S', 'PT4M13.5S', 'P10675199DT2H48M5S47.75807S', 'P99999999999999999999D']) {
    assert.equal(parseYouTubeDuration(value), null, JSON.stringify(value));
  }
});

test('DURATION 21: display formatter renders 253 seconds as 4:13', () => {
  assert.equal(formatDurationSeconds(253), '4:13');
  assert.equal(formatDurationSeconds(0), '0:00');
  assert.equal(formatDurationSeconds(59), '0:59');
  assert.equal(formatDurationSeconds(60), '1:00');
});

test('DURATION 22: display formatter renders 3723 seconds as 1:02:03', () => {
  assert.equal(formatDurationSeconds(3723), '1:02:03');
  assert.equal(formatDurationSeconds(7200), '2:00:00');
});

test('DURATION: candidate exposes both duration_seconds and display duration', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ contentDetails: { duration: 'PT4M13S' } }));
  assert.equal(candidate.duration_seconds, 253);
  assert.equal(candidate.duration, '4:13');
});

test('DURATION: candidate duration is null when upstream duration is malformed', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ contentDetails: { duration: 'not-a-duration' } }));
  assert.equal(candidate.duration_seconds, null);
  assert.equal(candidate.duration, null);
});

test('CATEGORY 23: YouTube Music category ID 10 is recognized', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { categoryId: '10' } }));
  assert.equal(candidate.category, YOUTUBE_MUSIC_CATEGORY);
  assert.equal(candidate.category, 'Music');
  assert.equal(candidate.youtube_category_id, YOUTUBE_MUSIC_CATEGORY_ID);
  assert.equal(candidate.youtube_category_id, '10');
});

test('CATEGORY 24: non-music category does not fabricate genre', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { categoryId: '24' } }));
  assert.equal(candidate.category, null);
  assert.equal(candidate.youtube_category_id, '24');
  assert.equal(candidate.genre, null);
});

test('CATEGORY 25: language remains unknown', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo());
  assert.equal(candidate.language, null);
});

test('CATEGORY 26: mood remains unknown and is never invented', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo());
  assert.equal('mood' in candidate, false);
});

test('ELIGIBILITY 27: public + embeddable + valid duration + non-live is eligible', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo());
  assert.equal(candidate.catalog_eligible, true);
  assert.equal(candidate.recommendation_eligible, true);
  assert.deepEqual(candidate.ineligibility_reasons, []);
});

test('ELIGIBILITY 28: private and unlisted are ineligible', () => {
  for (const privacyStatus of ['private', 'unlisted']) {
    const candidate = normalizeYouTubeVideoCandidate(makeVideo({ status: { privacyStatus } }));
    assert.equal(candidate.catalog_eligible, false, privacyStatus);
    assert.deepEqual(candidate.ineligibility_reasons, ['not-public']);
    assert.equal(candidate.privacy_status, privacyStatus);
  }
});

test('ELIGIBILITY 29: non-embeddable videos are ineligible', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ status: { embeddable: false } }));
  assert.equal(candidate.catalog_eligible, false);
  assert.deepEqual(candidate.ineligibility_reasons, ['not-embeddable']);
  assert.equal(candidate.embeddable, false);
});

test('ELIGIBILITY 30: invalid duration is ineligible', () => {
  const malformed = normalizeYouTubeVideoCandidate(makeVideo({ contentDetails: { duration: 'garbage' } }));
  assert.equal(malformed.catalog_eligible, false);
  assert.ok(malformed.ineligibility_reasons.includes('invalid-duration'));
  const zero = normalizeYouTubeVideoCandidate(makeVideo({ contentDetails: { duration: 'PT0S' } }));
  assert.equal(zero.catalog_eligible, false);
  assert.ok(zero.ineligibility_reasons.includes('invalid-duration'));
  assert.equal(zero.duration_seconds, 0);
});

test('ELIGIBILITY 31: live and upcoming content is ineligible', () => {
  for (const liveBroadcastContent of ['live', 'upcoming']) {
    const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { liveBroadcastContent } }));
    assert.equal(candidate.catalog_eligible, false, liveBroadcastContent);
    assert.ok(candidate.ineligibility_reasons.includes('live-content'));
    assert.equal(candidate.live_broadcast_content, liveBroadcastContent);
  }
  const none = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { liveBroadcastContent: 'none' } }));
  assert.equal(none.catalog_eligible, true);
});

test('ELIGIBILITY: missing required status fields fail conservatively', () => {
  const noStatus = makeVideo();
  delete noStatus.status;
  const candidate = normalizeYouTubeVideoCandidate(noStatus);
  assert.equal(candidate.catalog_eligible, false);
  assert.ok(candidate.ineligibility_reasons.includes('not-public'));
  assert.ok(candidate.ineligibility_reasons.includes('not-embeddable'));

  const noLive = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { liveBroadcastContent: undefined } }));
  assert.equal(noLive.catalog_eligible, false);
  assert.ok(noLive.ineligibility_reasons.includes('missing-live-status'));
});

test('ELIGIBILITY: incompatible upload status is ineligible while absence stays compatible', () => {
  const failed = normalizeYouTubeVideoCandidate(makeVideo({ status: { uploadStatus: 'failed' } }));
  assert.equal(failed.catalog_eligible, false);
  assert.deepEqual(failed.ineligibility_reasons, ['incompatible-upload-status']);
  const uploaded = normalizeYouTubeVideoCandidate(makeVideo({ status: { uploadStatus: 'uploaded' } }));
  assert.equal(uploaded.catalog_eligible, true);

  const noUploadStatus = makeVideo();
  delete noUploadStatus.status.uploadStatus;
  const candidate = normalizeYouTubeVideoCandidate(noUploadStatus);
  assert.equal(candidate.upload_status, null);
  assert.equal(candidate.catalog_eligible, true);
});

test('ELIGIBILITY 32: reason codes are from a fixed deterministic vocabulary', () => {
  const reasons = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: { title: '', liveBroadcastContent: 'live', categoryId: '24' },
    contentDetails: { duration: 'bad' },
    status: { privacyStatus: 'private', embeddable: false, uploadStatus: 'rejected' },
  })).ineligibility_reasons;
  assert.ok(reasons.length > 0);
  for (const reason of reasons) {
    assert.ok(INELIGIBILITY_REASONS.includes(reason), reason);
  }
  assert.ok(Object.isFrozen(INELIGIBILITY_REASONS));

  const again = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: { title: '', liveBroadcastContent: 'live', categoryId: '24' },
    contentDetails: { duration: 'bad' },
    status: { privacyStatus: 'private', embeddable: false, uploadStatus: 'rejected' },
  })).ineligibility_reasons;
  assert.deepEqual(reasons, again);
});

test('ELIGIBILITY: reasons follow a fixed evaluation order', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({
    snippet: { title: '', liveBroadcastContent: 'live' },
    contentDetails: { duration: 'bad' },
    status: { privacyStatus: 'private', embeddable: false, uploadStatus: 'rejected' },
  }));
  assert.deepEqual(candidate.ineligibility_reasons, [
    'missing-title',
    'invalid-duration',
    'not-public',
    'not-embeddable',
    'incompatible-upload-status',
    'live-content',
  ]);
});

test('MERGING 33: search result order is preserved', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA', 'vidBBBBBBBBBB', 'vidCCCCCCCCCC']);
  const details = detailsResponseOf([
    makeVideo({ id: 'vidCCCCCCCCCC' }),
    makeVideo({ id: 'vidAAAAAAAAAA' }),
    makeVideo({ id: 'vidBBBBBBBBBB' }),
  ]);
  const candidates = normalizeYouTubeMusicCandidates(search, details);
  assert.deepEqual(
    candidates.map((candidate) => candidate.external_id),
    ['vidAAAAAAAAAA', 'vidBBBBBBBBBB', 'vidCCCCCCCCCC'],
  );
});

test('MERGING 34: duplicate search IDs are deduplicated', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA', '  vidAAAAAAAAAA  ', 'vidAAAAAAAAAA', 'vidBBBBBBBBBB']);
  const details = detailsResponseOf([
    makeVideo({ id: 'vidAAAAAAAAAA' }),
    makeVideo({ id: 'vidBBBBBBBBBB' }),
  ]);
  const candidates = normalizeYouTubeMusicCandidates(search, details);
  assert.deepEqual(
    candidates.map((candidate) => candidate.external_id),
    ['vidAAAAAAAAAA', 'vidBBBBBBBBBB'],
  );
});

test('MERGING 35: details not present in search results are ignored', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA']);
  const details = detailsResponseOf([
    makeVideo({ id: 'vidAAAAAAAAAA' }),
    makeVideo({ id: 'vidZZZZZZZZZZ' }),
    makeVideo({ id: 'vidYYYYYYYYYY' }),
  ]);
  const candidates = normalizeYouTubeMusicCandidates(search, details);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].external_id, 'vidAAAAAAAAAA');
});

test('MERGING 36: searched videos without details are omitted (chosen policy)', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA', 'vidBBBBBBBBBB']);
  const details = detailsResponseOf([makeVideo({ id: 'vidAAAAAAAAAA' })]);
  const candidates = normalizeYouTubeMusicCandidates(search, details);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].external_id, 'vidAAAAAAAAAA');
});

test('MERGING 37: malformed search responses fail safely', () => {
  const details = detailsResponseOf([makeVideo()]);
  for (const search of [null, undefined, 'search', 42, [], {}, { items: null }, { items: 'x' }, { items: {} }]) {
    assert.throws(
      () => normalizeYouTubeMusicCandidates(search, details),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Invalid YouTube search response');
        return true;
      },
      JSON.stringify(search),
    );
  }
});

test('MERGING 38: malformed details responses fail safely', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA']);
  for (const details of [null, undefined, 'details', 42, [], {}, { items: null }, { items: 'x' }, { items: {} }]) {
    assert.throws(
      () => normalizeYouTubeMusicCandidates(search, details),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Invalid YouTube video details response');
        return true;
      },
      JSON.stringify(details),
    );
  }
});

test('MERGING 39: inputs are never mutated', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA', 'vidAAAAAAAAAA', 'vidBBBBBBBBBB']);
  const details = detailsResponseOf([makeVideo({ id: 'vidAAAAAAAAAA' }), makeVideo({ id: 'vidBBBBBBBBBB' })]);
  const searchBefore = structuredClone(search);
  const detailsBefore = structuredClone(details);
  normalizeYouTubeMusicCandidates(search, details);
  assert.deepEqual(search, searchBefore);
  assert.deepEqual(details, detailsBefore);

  const single = makeVideo();
  const singleBefore = structuredClone(single);
  normalizeYouTubeVideoCandidate(single);
  assert.deepEqual(single, singleBefore);
});

test('MERGING 40: output contains no raw response data', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA']);
  const details = detailsResponseOf([makeVideo({
    etag: 'ETAG_MARKER_VALUE',
    snippet: {
      description: 'RAW_DESCRIPTION_MARKER_VALUE',
      tags: ['secret-tag'],
      localized: { title: 'Localized', description: 'Localized description' },
    },
  })]);
  const [candidate] = normalizeYouTubeMusicCandidates(search, details);
  const serialized = JSON.stringify(candidate);
  assert.equal(serialized.includes('RAW_DESCRIPTION_MARKER_VALUE'), false);
  assert.equal(serialized.includes('ETAG_MARKER_VALUE'), false);
  assert.equal(serialized.includes('secret-tag'), false);
  assert.equal('etag' in candidate, false);
  assert.equal('description' in candidate, false);
  assert.equal('snippet' in candidate, false);
  assert.equal('contentDetails' in candidate, false);
  assert.equal('status' in candidate, false);
  assert.equal('thumbnails' in candidate, false);
  assert.equal('items' in candidate, false);
  assert.equal('kind' in candidate, false);
});

test('MERGING: normalization uses authoritative details, not search snippets', () => {
  const search = {
    items: [{
      id: { videoId: 'vidAAAAAAAAAA' },
      snippet: { title: 'Search title that must be ignored' },
    }],
  };
  const details = detailsResponseOf([makeVideo({ id: 'vidAAAAAAAAAA', snippet: { title: 'Authoritative Title' } })]);
  const [candidate] = normalizeYouTubeMusicCandidates(search, details);
  assert.equal(candidate.title, 'Authoritative Title');
});

test('DETERMINISM: identical inputs produce deep-equal outputs', () => {
  const search = searchResponseOf(['vidAAAAAAAAAA', 'vidBBBBBBBBBB', 'vidAAAAAAAAAA']);
  const details = detailsResponseOf([
    makeVideo({ id: 'vidAAAAAAAAAA' }),
    makeVideo({ id: 'vidBBBBBBBBBB', snippet: { title: 'Second Song', categoryId: '24' } }),
    makeVideo({ id: 'vidIGNOREDDDDD' }),
  ]);
  const first = normalizeYouTubeMusicCandidates(search, details);
  const second = normalizeYouTubeMusicCandidates(search, details);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const singleFirst = normalizeYouTubeVideoCandidate(makeVideo());
  const singleSecond = normalizeYouTubeVideoCandidate(makeVideo());
  assert.deepEqual(singleFirst, singleSecond);
});

test('PUBLISHED DATE: valid dates normalize to ISO strings and invalid dates to null', () => {
  const valid = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { publishedAt: '2024-03-01T12:00:00Z' } }));
  assert.equal(valid.published_at, '2024-03-01T12:00:00.000Z');
  const invalid = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { publishedAt: 'not-a-date' } }));
  assert.equal(invalid.published_at, null);
  const missing = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { publishedAt: undefined } }));
  assert.equal(missing.published_at, null);
  const empty = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { publishedAt: '  ' } }));
  assert.equal(empty.published_at, null);
});

test('ARTIST: missing or invalid channel title yields null artist candidate', () => {
  for (const channelTitle of [undefined, null, 42, '', '   ']) {
    const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { channelTitle } }));
    assert.equal(candidate.artist_candidate, null, JSON.stringify(channelTitle));
    assert.equal(candidate.artist_candidate_source, null, JSON.stringify(channelTitle));
  }
  const bareTopic = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { channelTitle: TOPIC_CHANNEL_SUFFIX } }));
  assert.equal(bareTopic.artist_candidate, null);
  assert.equal(bareTopic.artist_candidate_source, null);
});

test('ARTIST: artist parsing never mutates or claims canonical Song.artist', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo({ snippet: { channelTitle: `Borbaad${TOPIC_CHANNEL_SUFFIX}` } }));
  assert.equal('artist' in candidate, false);
  assert.equal(candidate.artist_candidate, 'Borbaad');
});

test('CANDIDATE SHAPE: bounded machine-readable fields only', () => {
  const candidate = normalizeYouTubeVideoCandidate(makeVideo());
  const allowedKeys = [
    'source_provider', 'external_id', 'youtube_id', 'title', 'channel_title',
    'artist_candidate', 'artist_candidate_source', 'poster_url',
    'duration_seconds', 'duration', 'category', 'youtube_category_id',
    'genre', 'language', 'privacy_status', 'upload_status', 'embeddable',
    'live_broadcast_content', 'published_at', 'catalog_eligible',
    'recommendation_eligible', 'ineligibility_reasons',
  ];
  assert.deepEqual(Object.keys(candidate).sort(), [...allowedKeys].sort());
  assert.equal(candidate.recommendation_eligible, candidate.catalog_eligible);
  assert.ok(Array.isArray(candidate.ineligibility_reasons));
  assert.equal(Number.isNaN(new Date(candidate.published_at ?? 'invalid').getTime()), false);
});

test('DETERMINISM: no wall-clock or random values leak into candidates', () => {
  const source = normalizeYouTubeVideoCandidate(makeVideo());
  assert.equal(source.published_at, '2024-03-01T12:00:00.000Z');
  assert.equal('imported_at' in source, false);
  assert.equal('metadata_refreshed_at' in source, false);
  assert.equal('created_at' in source, false);
  assert.equal('updated_at' in source, false);
  const secondRun = normalizeYouTubeVideoCandidate(makeVideo());
  assert.deepEqual(source, secondRun);
});
