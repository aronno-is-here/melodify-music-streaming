import express from 'express';
import Song from '../models/Song.js';
import { protect } from '../middleware/auth.js';
import { createLyricsProviderService, LYRICS_RESOLUTION_STATUS } from '../services/lyricsProviderService.js';
import { createLyricsSourceDiscoveryService } from '../services/lyricsSourceDiscoveryService.js';
import {
  normalizeChordReferenceUrl,
  selectChordPresentation,
} from '../utils/chordProvider.js';
import { stripTransportQueryMetadata } from '../utils/transportQueryMetadata.js';

const router = express.Router();

const lyricsProviderService = createLyricsProviderService();
export const lyricsSourceDiscovery = createLyricsSourceDiscoveryService();

const LYRICS_ROUTE_ERROR = 'failed to load lyrics';
const LYRICS_SOURCES_ROUTE_ERROR = 'failed to load lyrics sources';

const SOURCE_FALLBACK_STATUSES = new Set([
  LYRICS_RESOLUTION_STATUS.UNAVAILABLE,
  LYRICS_RESOLUTION_STATUS.AMBIGUOUS,
]);

const toSourceCandidate = (record) => {
  const candidate = record?.candidates?.[0];
  if (!candidate || typeof candidate.url !== 'string') return null;
  return {
    provider: candidate.provider,
    providerLabel: candidate.providerLabel,
    url: candidate.url,
    title: candidate.title ?? null,
    artist: candidate.artist ?? null,
    confidence: candidate.confidence,
  };
};

// Only `refresh=1` is a supported query key; anything else is rejected.
const parseSourcesQuery = (rawQuery) => {
  const query = stripTransportQueryMetadata(rawQuery);
  if (!query || typeof query !== 'object') return false;
  const keys = Object.keys(query);
  if (keys.length === 0) return false;
  if (keys.length === 1 && keys[0] === 'refresh' && query.refresh === '1') return true;
  return null;
};

router.get('/:songId/sources', protect, async (req, res) => {
  try {
    const refresh = parseSourcesQuery(req.query);
    if (refresh === null) {
      return res.status(400).json({ success: false, error: 'invalid lyrics sources query' });
    }
    if (refresh && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const song = await Song.findById(req.params.songId).select('+language');
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    const record = await lyricsSourceDiscovery.discover(song, { forceRefresh: refresh });
    return res.json({
      success: true,
      category: record.category ?? null,
      candidates: record.candidates,
      discoveredAt: record.discoveredAt ?? null,
    });
  } catch {
    return res.status(500).json({ success: false, error: LYRICS_SOURCES_ROUTE_ERROR });
  }
});

router.get('/:songId', async (req, res) => {
  try {
    const result = await lyricsProviderService.resolveSongLyrics(req.params.songId);
    if (result.notFound) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    const chords = selectChordPresentation(result.song);
    const sourceCandidate = SOURCE_FALLBACK_STATUSES.has(result.lyrics.status)
      ? toSourceCandidate(lyricsSourceDiscovery.peek(result.song))
      : null;

    return res.json({
      success: true,
      source: result.lyrics.source,
      status: result.lyrics.status,
      synced: result.lyrics.synced,
      lines: result.lyrics.lines,
      script: result.lyrics.script || 'other',
      romanizedLines: result.lyrics.romanizedLines || null,
      displayLines: result.lyrics.displayLines || result.lyrics.lines,
      plain: result.lyrics.plain,
      match: result.lyrics.match,
      provider: result.lyrics.provider,
      lyricsVerified: result.song.lyrics_verified === true,
      lyricsLanguage: result.song.lyrics_language || null,
      lyricsLastCheckedAt: result.song.lyrics_last_checked_at || null,
      sourceCandidate,
      chords: chords.chords,
      chordsState: chords.state,
      chordsSource: chords.source,
      chordsVerified: chords.chordsVerified,
      chordifyUrl: chords.chordifyUrl,
      chordifyEmbedUrl: chords.chordifyEmbedUrl,
      chordsReferenceUrl: normalizeChordReferenceUrl(result.song.chords_reference_url),
      chordsLastCheckedAt: result.song.chords_last_checked_at || null,
    });
  } catch {
    return res.status(500).json({ success: false, error: LYRICS_ROUTE_ERROR });
  }
});

export default router;
