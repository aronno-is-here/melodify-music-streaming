import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_NON_MUSIC,
  CATALOG_REPAIR_CONFIDENCE,
  UPLOADER_AS_ARTIST_LEVEL,
  buildCatalogSongAssessment,
  classifyNonMusic,
  detectMetadataScript,
  detectUploaderAsArtist,
  extractCatalogArtistCandidate,
  extractTrackTitle,
  inferCatalogLanguage,
  inferCatalogRegionTag,
  isCreditSegment,
  isDecorationSegment,
  isLabelLikeArtist,
  isNoisyTitle,
  isVersionSensitiveTitle,
  normalizeCatalogText,
  resolveCatalogTrack,
  splitCatalogTitleSegments,
  summarizeCatalogAssessments,
} from './catalogMetadata.js';

test('normalizeCatalogText collapses whitespace and bounds length', () => {
  assert.equal(normalizeCatalogText('  A   B  '), 'A B');
  assert.equal(normalizeCatalogText(''), null);
  assert.equal(normalizeCatalogText('x'.repeat(300), 200), null);
  assert.equal(normalizeCatalogText(123), null);
});

test('detectMetadataScript classifies scripts', () => {
  assert.equal(detectMetadataScript('Jabo Hariye'), 'latin');
  assert.equal(detectMetadataScript('\u09af\u09be\u09ac\u09cb \u09b9\u09be\u09b0\u09bf\u09df\u09c7'), 'bengali');
  assert.equal(detectMetadataScript('\u0915\u0948\u0938\u0947 \u092c\u0924\u093e\u090f\u0902'), 'devanagari');
  assert.equal(detectMetadataScript(''), 'unknown');
  assert.equal(detectMetadataScript('???? ????'), 'unknown');
});

test('classifyNonMusic flags strong interview and podcast titles', () => {
  assert.equal(
    classifyNonMusic({ title: 'Ed Sheeran Cousin Exclusive Interview With Piers Morgan' }).classification,
    CATALOG_NON_MUSIC.NON_MUSIC
  );
  assert.equal(
    classifyNonMusic({ title: 'Weekly Podcast Episode 12' }).classification,
    CATALOG_NON_MUSIC.NON_MUSIC
  );
});

test('classifyNonMusic flags combined moderate tokens only on long videos', () => {
  const short = classifyNonMusic({ title: 'News update', durationSeconds: 240 });
  assert.equal(short.classification, CATALOG_NON_MUSIC.LIKELY_MUSIC);
  const long = classifyNonMusic({ title: 'News update', durationSeconds: 1500 });
  assert.equal(long.classification, CATALOG_NON_MUSIC.NON_MUSIC);
});

test('classifyNonMusic treats official music video decoration as music', () => {
  assert.equal(
    classifyNonMusic({ title: 'Opare - Bay of Bengal (Official Video)' }).classification,
    CATALOG_NON_MUSIC.MUSIC
  );
});

test('classifyNonMusic stays uncertain without signals', () => {
  const result = classifyNonMusic({ title: 'Perfect', durationSeconds: 260 });
  assert.equal(result.classification, CATALOG_NON_MUSIC.LIKELY_MUSIC);
  assert.equal(classifyNonMusic({ title: 'Perfect', durationSeconds: 1900 }).classification, CATALOG_NON_MUSIC.UNCERTAIN);
});

test('isLabelLikeArtist detects label style channels', () => {
  assert.equal(isLabelLikeArtist('Sangeeta Music'), true);
  assert.equal(isLabelLikeArtist('T-Series'), true);
  assert.equal(isLabelLikeArtist('Laser Vision'), true);
  assert.equal(isLabelLikeArtist('Piers Morgan Uncensored'), true);
  assert.equal(isLabelLikeArtist('Atif Aslam'), false);
  assert.equal(isLabelLikeArtist(''), false);
});

test('isDecorationSegment and isCreditSegment separate decoration from credits', () => {
  assert.equal(isDecorationSegment('Lyrics Video'), true);
  assert.equal(isDecorationSegment('Studio Version'), true);
  assert.equal(isDecorationSegment('Arfin Rumey'), false);
  assert.equal(isCreditSegment('Arfin Rumey'), true);
  assert.equal(isCreditSegment('Kalyug'), false);
  assert.equal(isCreditSegment('Bay of Bengal'), true);
  assert.equal(isCreditSegment('Exclusive Interview With Piers Morgan'), false);
  assert.equal(extractCatalogArtistCandidate('ViKiNGS featuring RUN OUT'), 'ViKiNGS');
  assert.equal(extractCatalogArtistCandidate('Sangeeta Music'), null);
});

test('splitCatalogTitleSegments splits on pipes and dashes', () => {
  const segments = splitCatalogTitleSegments('Jabo Hariye | Arfin Rumey | Premer Pothe');
  assert.deepEqual(segments, ['Jabo Hariye', 'Arfin Rumey', 'Premer Pothe']);
  assert.deepEqual(splitCatalogTitleSegments('Aadat - Atif Aslam - Kalyug'), ['Aadat', 'Atif Aslam', 'Kalyug']);
});

test('extractTrackTitle drops decoration but never rewrites karaoke rows', () => {
  assert.deepEqual(
    extractTrackTitle('Aadat - Atif Aslam (Lyrics) - Kalyug'),
    { title: 'Aadat', changed: true }
  );
  assert.deepEqual(
    extractTrackTitle('Opare - KARAOKE - Bay Of Bengal (original instrumental)'),
    { title: 'Opare - KARAOKE - Bay Of Bengal (original instrumental)', changed: false }
  );
  assert.equal(isVersionSensitiveTitle('Opare - KARAOKE - Bay Of Bengal'), true);
  assert.equal(isVersionSensitiveTitle('Perfect'), false);
});

test('isNoisyTitle flags long multi segment titles only', () => {
  assert.equal(isNoisyTitle('Jabo Hariye | Arfin Rumey | Premer Pothe | Music Video'), true);
  assert.equal(isNoisyTitle('Perfect'), false);
  assert.equal(isNoisyTitle(''), false);
});

test('resolveCatalogTrack takes a single credit from the title window', () => {
  const resolved = resolveCatalogTrack({
    title: 'Aadat - Atif Aslam (Lyrics) - Kalyug',
    channelTitle: 'LYRICAL MUSIC STUDIO 0.7',
    artistCandidate: 'LYRICAL MUSIC STUDIO 0.7',
    artistCandidateSource: 'youtube-search',
  });
  assert.equal(resolved.title, 'Aadat');
  assert.equal(resolved.artist, 'Atif Aslam');
  assert.equal(resolved.artistConfidence, 'high');
  assert.deepEqual(resolved.reasons, ['single-credit']);
});

test('resolveCatalogTrack reports ambiguous multi credit titles', () => {
  const resolved = resolveCatalogTrack({
    title: 'Mitwa - Full Video | Shahrukh Khan | Rani Mukherjee | Shafqat Amanat Ali',
    channelTitle: 'Sony Music India',
    artistCandidate: 'Sony Music India',
  });
  assert.equal(resolved.title, 'Mitwa');
  assert.equal(resolved.artist, null);
  assert.equal(resolved.artistConfidence, 'none');
});

test('resolveCatalogTrack keeps a non label channel match as the artist', () => {
  const resolved = resolveCatalogTrack({
    title: 'Opare - Bay of Bengal',
    channelTitle: 'Bay of Bengal',
    artistCandidate: 'Bay of Bengal',
  });
  assert.equal(resolved.title, 'Opare');
  assert.equal(resolved.artist, 'Bay of Bengal');
  assert.deepEqual(resolved.reasons, ['channel-credit-match']);
});

test('resolveCatalogTrack prefers topic channel credits', () => {
  const resolved = resolveCatalogTrack({
    title: 'Perfect',
    channelTitle: 'Ed Sheeran',
    artistCandidate: 'Ed Sheeran',
    artistCandidateSource: 'topic-channel',
  });
  assert.equal(resolved.artist, 'Ed Sheeran');
  assert.deepEqual(resolved.reasons, ['topic-channel']);
});

test('resolveCatalogTrack falls back to an uncertain channel candidate', () => {
  const resolved = resolveCatalogTrack({
    title: 'Perfect',
    channelTitle: 'Weekly Uploads',
    artistCandidate: 'Weekly Uploads',
  });
  assert.equal(resolved.artistConfidence, 'uncertain');
  assert.deepEqual(resolved.reasons, ['channel-fallback']);
});

test('detectUploaderAsArtist is NONE for clean catalog rows', () => {
  const clean = detectUploaderAsArtist({ title: 'Perfect', artist: 'Ed Sheeran' });
  assert.equal(clean.level, UPLOADER_AS_ARTIST_LEVEL.NONE);
  const bayOfBengal = detectUploaderAsArtist({ title: 'Opare - Bay of Bengal', artist: 'Bay of Bengal' });
  assert.equal(bayOfBengal.level, UPLOADER_AS_ARTIST_LEVEL.NONE);
});

test('detectUploaderAsArtist is HIGH for label style uploaders with title credits', () => {
  const jabo = detectUploaderAsArtist({
    title: 'Jabo Hariye | Arfin Rumey | যাবো হারিয়ে | আরফিন রুমি | Premer Pothe | Music Video',
    artist: 'Sangeeta Music',
  });
  assert.equal(jabo.level, UPLOADER_AS_ARTIST_LEVEL.HIGH);
  assert.ok(jabo.reasons.includes('label-style-artist'));

  const peirs = detectUploaderAsArtist({
    title: 'Ed Sheeran Cousin Exclusive Interview With Piers Morgan',
    artist: 'Piers Morgan Uncensored',
  });
  assert.equal(peirs.level, UPLOADER_AS_ARTIST_LEVEL.HIGH);
});

test('detectUploaderAsArtist is MEDIUM when several credits are ambiguous', () => {
  const result = detectUploaderAsArtist({
    title: 'Mitwa | Shahrukh Khan | Rani Mukherjee | Shafqat Amanat Ali',
    artist: 'Unknown Uploads',
  });
  assert.equal(result.level, UPLOADER_AS_ARTIST_LEVEL.MEDIUM);
  assert.ok(result.reasons.includes('artist-not-in-title'));
  assert.ok(result.reasons.includes('title-credits-different-artist'));
});

test('detectUploaderAsArtist is NONE when the artist already appears in the title', () => {
  const result = detectUploaderAsArtist({
    title: 'Ed Sheeran - Thinking Out Loud (Official Music Video)',
    artist: 'Ed Sheeran',
  });
  assert.equal(result.level, UPLOADER_AS_ARTIST_LEVEL.NONE);
});

test('inferCatalogLanguage keeps existing values and detects scripts', () => {
  assert.equal(inferCatalogLanguage({ language: 'bn' }).language, 'bn');
  assert.equal(inferCatalogLanguage({ title: '\u0995\u09c7\u09a8 \u09b9\u09a0\u09be\u099d' }).language, 'bn');
  assert.equal(inferCatalogLanguage({ title: '\u0915\u0948\u0938\u0947 \u092c\u0924\u093e\u090f\u0902' }).language, 'hi');
  assert.equal(inferCatalogLanguage({ lyrics: '\u0915\u0948\u0938\u0947 \u092c\u0924\u093e\u090f\u0902' }).language, 'hi');
  assert.equal(inferCatalogLanguage({ genre: 'Bengali' }).language, 'bn');
  assert.equal(inferCatalogLanguage({ genre: 'Romantic' }).language, null);
});

test('inferCatalogLanguage only emits approved language codes', () => {
  assert.equal(inferCatalogLanguage({ genre: 'Tamil' }).language, null);
  assert.equal(inferCatalogLanguage({ language: 'tamil' }).language, null);
  assert.equal(inferCatalogLanguage({ language: 'EN-US' }).language, 'en');
});

test('inferCatalogRegionTag uses explicit region text only', () => {
  assert.equal(inferCatalogRegionTag({ regional_tag: 'bn-bd' }).regionalTag, 'bn-bd');
  assert.equal(inferCatalogRegionTag({ title: 'Dhaka Nights' }).regionalTag, 'bn-bd');
  assert.equal(inferCatalogRegionTag({ title: 'Kolkata Live' }).regionalTag, 'bn-in');
  assert.equal(inferCatalogRegionTag({ genre: 'Bollywood' }).regionalTag, 'hi-in');
  assert.equal(inferCatalogRegionTag({ title: 'Perfect' }).regionalTag, null);
  assert.equal(inferCatalogRegionTag({}).regionalTag, null);
});

test('buildCatalogSongAssessment repairs a noisy uploader row', () => {
  const assessment = buildCatalogSongAssessment({
    _id: '6ab8172e551ea0bb04b37d64',
    title: 'Jabo Hariye | Arfin Rumey | যাবো হারিয়ে | আরফিন রুমি | Premer Pothe | Music Video',
    artist: 'Sangeeta Music',
    genre: 'Unknown',
  });
  assert.equal(assessment.repair.confidence, CATALOG_REPAIR_CONFIDENCE.HIGH);
  assert.equal(assessment.uploaderLevel, UPLOADER_AS_ARTIST_LEVEL.HIGH);
  const fields = assessment.repair.changes.map((change) => change.field);
  assert.deepEqual(fields, ['title', 'artist', 'language']);
  assert.equal(assessment.repair.changes.find((c) => c.field === 'artist').to, 'Arfin Rumey');
  assert.equal(assessment.findings.good, false);
  assert.deepEqual(assessment.review, []);
});

test('buildCatalogSongAssessment leaves ambiguous artist credits as review only', () => {
  const assessment = buildCatalogSongAssessment({
    _id: '6ab93ed37b45defcdfb6b688',
    title: 'Mitwa - Full Video | Shahrukh Khan | Rani Mukherjee | Shafqat Amanat Ali',
    artist: 'Sony Music India',
    genre: 'Unknown',
  });
  assert.equal(assessment.repair.confidence, CATALOG_REPAIR_CONFIDENCE.NONE);
  assert.equal(assessment.repair.changes.length, 0);
  assert.equal(assessment.review.length, 1);
  assert.equal(assessment.findings.ambiguous, true);
});

test('buildCatalogSongAssessment never rewrites karaoke rows', () => {
  const assessment = buildCatalogSongAssessment({
    _id: '6ab74678704b74f5b51ebf82',
    title: 'Opare - KARAOKE - Bay Of Bengal (original instrumental)',
    artist: 'Another Metal Head- Bangladesh',
    genre: 'Unknown',
  });
  assert.equal(assessment.versionSensitive, true);
  assert.equal(assessment.repair.changes.length, 0);
  assert.equal(assessment.repair.confidence, CATALOG_REPAIR_CONFIDENCE.NONE);
});

test('buildCatalogSongAssessment marks non music rows ineligible', () => {
  const assessment = buildCatalogSongAssessment({
    _id: '6ab722702fe37579bd0f4bcf',
    title: "Ed Sheeran's Cousin Brands Him a 'Snake' & 'Coward' | Exclusive Interview With Piers Morgan",
    artist: 'Piers Morgan Uncensored',
    genre: 'Unknown',
    recommendation_eligible: true,
  });
  assert.equal(assessment.nonMusic, CATALOG_NON_MUSIC.NON_MUSIC);
  const change = assessment.repair.changes.find((entry) => entry.field === 'recommendation_eligible');
  assert.ok(change);
  assert.equal(change.to, false);
  assert.equal(assessment.findings.ambiguous, false);
});

test('buildCatalogSongAssessment does not treat a channel name in the title as uploader noise', () => {
  const assessment = buildCatalogSongAssessment({
    _id: '6ab722849d632e1354286103',
    title: 'Ed Sheeran - Thinking Out Loud (Official Music Video)',
    artist: 'Ed Sheeran',
    genre: 'Unknown',
  });
  assert.equal(assessment.uploaderLevel, UPLOADER_AS_ARTIST_LEVEL.NONE);
  assert.equal(assessment.repair.changes.length, 0);
  assert.equal(assessment.findings.good, true);
});

test('buildCatalogSongAssessment ignores uploader text when inferring regions', () => {
  const assessment = buildCatalogSongAssessment({
    _id: '6ab74678704b74f5b51ebf82',
    title: 'Opare - KARAOKE - Bay Of Bengal',
    artist: 'Another Metal Head- Bangladesh',
    genre: 'Unknown',
  });
  assert.equal(assessment.regionalTag, null);
});

test('summarizeCatalogAssessments buckets the production catalog shape', () => {
  const assessments = [
    buildCatalogSongAssessment({ _id: 'a', title: 'Perfect', artist: 'Ed Sheeran', genre: 'Romantic' }),
    buildCatalogSongAssessment({
      _id: 'b',
      title: 'Jabo Hariye | Arfin Rumey | যাবো হারিয়ে | আরফিন রুমি | Premer Pothe | Music Video',
      artist: 'Sangeeta Music',
      genre: 'Unknown',
    }),
    buildCatalogSongAssessment({
      _id: 'c',
      title: 'Mitwa | Shahrukh Khan | Rani Mukherjee',
      artist: 'Sony Music India',
      genre: 'Unknown',
    }),
  ];
  const summary = summarizeCatalogAssessments(assessments);
  assert.equal(summary.audited, 3);
  assert.equal(summary.good, 1);
  assert.equal(summary.probableUploaderAsArtist, 2);
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.highConfidenceRepairs, 3);
  assert.equal(summary.modifiedRows, 1);
  assert.equal(summary.skippedRepairs, 1);
  assert.equal(summarizeCatalogAssessments(null).audited, 0);
});
