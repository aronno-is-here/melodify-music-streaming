import express from 'express';
import Song from '../models/Song.js';

const router = express.Router();
const UA = 'Melodify/1.0 (https://github.com/aronno-is-here/melodify-music-streaming)';

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

function isLikelyEnglish(text) {
  if (!text) return false;
  const sample = text.replace(/[^a-zA-Z]/g, '');
  return sample.length > text.replace(/\s/g, '').length * 0.5;
}

async function translateToEnglish(text) {
  if (!text || isLikelyEnglish(text)) return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return text;
    const data = await resp.json();
    if (data && data[0]) {
      return data[0].map(s => s[0]).join('');
    }
    return text;
  } catch {
    return text;
  }
}

async function translateLRC(lrc) {
  const lines = parseLRC(lrc);
  if (lines.length === 0) return { synced: [], plain: '' };

  const allText = lines.map(l => l.text).join('\n');
  if (isLikelyEnglish(allText)) {
    return { synced: lines, plain: allText };
  }

  const batchSize = 20;
  const translated = [];
  for (let i = 0; i < lines.length; i += batchSize) {
    const batch = lines.slice(i, i + batchSize);
    const batchText = batch.map(l => l.text).join('\n');
    const enText = await translateToEnglish(batchText);
    const enLines = enText.split('\n');
    for (let j = 0; j < batch.length; j++) {
      translated.push({
        time: batch[j].time,
        text: enLines[j] || batch[j].text,
      });
    }
  }

  return {
    synced: translated,
    plain: translated.map(l => l.text).join('\n'),
  };
}

async function fetchFromLRCLIB(artist, title, duration) {
  const headers = { 'User-Agent': UA };

  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    const durSec = durationToSeconds(duration);
    if (durSec > 0) params.set('duration', String(durSec));
    const resp = await fetch(`https://lrclib.net/api/get?${params}`, { headers, signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.syncedLyrics || data.plainLyrics) return data;
    }
  } catch {}

  try {
    const params = new URLSearchParams({ q: `${title} ${artist}` });
    const resp = await fetch(`https://lrclib.net/api/search?${params}`, { headers, signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const results = await resp.json();
      if (Array.isArray(results) && results.length > 0) {
        const durSec = durationToSeconds(duration);
        const titleLower = title.toLowerCase();
        let best = results[0];
        for (const r of results) {
          if (r.trackName && r.trackName.toLowerCase() === titleLower) { best = r; break; }
        }
        if (durSec > 0 && results.length > 1) {
          let closest = best;
          let minDiff = Math.abs((best.duration || 0) - durSec);
          for (const r of results) {
            const diff = Math.abs((r.duration || 0) - durSec);
            if (diff < minDiff) { minDiff = diff; closest = r; }
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

    // 1. Check database first — if lyrics exist and are English, use them
    if (song.lyrics) {
      if (isLikelyEnglish(song.lyrics)) {
        const synced = parseLRC(song.lyrics);
        return res.json({
          success: true,
          source: 'database',
          synced: synced.length > 0,
          lines: synced.length > 0 ? synced : song.lyrics.split('\n').filter(l => l.trim()).map(text => ({ time: null, text })),
          plain: song.lyrics,
        });
      }
      // Database lyrics exist but are not English — translate
      const { synced, plain } = await translateLRC(song.lyrics);
      return res.json({
        success: true,
        source: 'database-translated',
        synced: synced.length > 0,
        lines: synced.length > 0 ? synced : plain.split('\n').filter(l => l.trim()).map(text => ({ time: null, text })),
        plain,
      });
    }

    // 2. Fetch from LRCLIB
    const lrclibData = await fetchFromLRCLIB(song.artist, song.title, song.duration);
    if (lrclibData) {
      const rawLyrics = lrclibData.syncedLyrics || lrclibData.plainLyrics || '';
      const rawPlain = lrclibData.plainLyrics || lrclibData.syncedLyrics || '';

      // If lyrics are already English, use directly
      if (isLikelyEnglish(rawPlain)) {
        const synced = parseLRC(lrclibData.syncedLyrics || '');
        const plainLines = rawPlain.split('\n').filter(l => l.trim());
        const lines = synced.length > 0 ? synced : plainLines.map(text => ({ time: null, text }));
        return res.json({ success: true, source: 'lrclib', synced: synced.length > 0, lines, plain: rawPlain });
      }

      // Non-English — translate while preserving timestamps
      if (lrclibData.syncedLyrics) {
        const { synced, plain } = await translateLRC(lrclibData.syncedLyrics);
        return res.json({ success: true, source: 'lrclib-translated', synced: synced.length > 0, lines: synced, plain });
      } else {
        const enPlain = await translateToEnglish(rawPlain);
        const plainLines = enPlain.split('\n').filter(l => l.trim());
        return res.json({ success: true, source: 'lrclib-translated', synced: false, lines: plainLines.map(text => ({ time: null, text })), plain: enPlain });
      }
    }

    return res.json({ success: true, source: 'none', synced: false, lines: [], plain: '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
