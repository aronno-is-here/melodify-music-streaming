import express from 'express';
import { createLyricsProviderService } from '../services/lyricsProviderService.js';
import {
  normalizeChordReferenceUrl,
  selectChordPresentation,
} from '../utils/chordProvider.js';

const router = express.Router();

const lyricsProviderService = createLyricsProviderService();
const LYRICS_ROUTE_ERROR = 'failed to load lyrics';

router.get('/:songId', async (req, res) => {
  try {
    const result = await lyricsProviderService.resolveSongLyrics(req.params.songId);
    if (result.notFound) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    const chords = selectChordPresentation(result.song);

    return res.json({
      success: true,
      source: result.lyrics.source,
      status: result.lyrics.status,
      synced: result.lyrics.synced,
      lines: result.lyrics.lines,
      plain: result.lyrics.plain,
      match: result.lyrics.match,
      provider: result.lyrics.provider,
      lyricsVerified: result.song.lyrics_verified === true,
      lyricsLanguage: result.song.lyrics_language || null,
      lyricsLastCheckedAt: result.song.lyrics_last_checked_at || null,
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
