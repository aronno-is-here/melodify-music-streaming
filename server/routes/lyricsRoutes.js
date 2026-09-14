import express from 'express';
import Song from '../models/Song.js';

const router = express.Router();

function parseLRC(lrc) {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      if (text) result.push({ time, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

router.get('/:songId', async (req, res) => {
  try {
    const song = await Song.findById(req.params.songId);
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });

    if (song.lyrics) {
      const synced = parseLRC(song.lyrics);
      return res.json({
        success: true,
        source: 'database',
        synced: synced.length > 0,
        lines: synced.length > 0 ? synced : song.lyrics.split('\n').filter(l => l.trim()).map(text => ({ time: null, text })),
        plain: song.lyrics,
      });
    }

    try {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(song.artist)}&track_name=${encodeURIComponent(song.title)}&album_name=${encodeURIComponent(song.artist)}&duration=${encodeURIComponent(song.duration || '')}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Melodify/1.0 (https://github.com/aronno-is-here/melodify-music-streaming)' },
      });

      if (resp.ok) {
        const data = await resp.json();
        const synced = parseLRC(data.syncedLyrics || '');
        const plain = data.plainLyrics || data.syncedLyrics || '';

        const plainLines = plain.split('\n').filter(l => l.trim());
        const lines = synced.length > 0 ? synced : plainLines.map(text => ({ time: null, text }));

        return res.json({
          success: true,
          source: 'lrclib',
          synced: synced.length > 0,
          lines,
          plain,
        });
      }
    } catch {
      // LRCLIB lookup failed, fall through
    }

    return res.json({ success: true, source: 'none', synced: false, lines: [], plain: '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
