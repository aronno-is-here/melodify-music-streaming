import express from 'express';
import Song from '../models/Song.js';

const router = express.Router();
const LRCLIB_UA = 'Melodify/1.0 (https://github.com/aronno-is-here/melodify-music-streaming)';

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

function durationToSeconds(dur) {
  if (!dur) return 0;
  const parts = String(dur).split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

async function fetchFromLRCLIB(artist, title, duration) {
  const headers = { 'User-Agent': LRCLIB_UA };

  // Try /api/get with minimal params first
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    const durSec = durationToSeconds(duration);
    if (durSec > 0) params.set('duration', String(durSec));

    const resp = await fetch(`https://lrclib.net/api/get?${params}`, { headers });
    if (resp.ok) {
      const data = await resp.json();
      if (data.syncedLyrics || data.plainLyrics) return data;
    }
  } catch {}

  // Fallback: /api/search
  try {
    const params = new URLSearchParams({ q: `${title} ${artist}` });
    const resp = await fetch(`https://lrclib.net/api/search?${params}`, { headers });
    if (resp.ok) {
      const results = await resp.json();
      if (Array.isArray(results) && results.length > 0) {
        const durSec = durationToSeconds(duration);
        // Prefer exact title match, then closest duration
        const titleLower = title.toLowerCase();
        let best = results[0];
        for (const r of results) {
          if (r.trackName && r.trackName.toLowerCase() === titleLower) {
            best = r;
            break;
          }
        }
        if (durSec > 0 && results.length > 1) {
          let closest = best;
          let minDiff = Math.abs((best.duration || 0) - durSec);
          for (const r of results) {
            const diff = Math.abs((r.duration || 0) - durSec);
            if (diff < minDiff) {
              minDiff = diff;
              closest = r;
            }
          }
          best = closest;
        }
        if (best.syncedLyrics || best.plainLyrics) return best;
      }
    }
  } catch {}

  return null;
}

router.get('/:songId', async (req, res) => {
  try {
    const song = await Song.findById(req.params.songId);
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });

    // 1. Check database first
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

    // 2. Fetch from LRCLIB
    const lrclibData = await fetchFromLRCLIB(song.artist, song.title, song.duration);
    if (lrclibData) {
      const synced = parseLRC(lrclibData.syncedLyrics || '');
      const plain = lrclibData.plainLyrics || lrclibData.syncedLyrics || '';
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

    return res.json({ success: true, source: 'none', synced: false, lines: [], plain: '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
