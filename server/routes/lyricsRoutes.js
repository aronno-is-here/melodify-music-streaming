import express from 'express';
import Song from '../models/Song.js';

const router = express.Router();
const UA = 'Melodify/1.0 (https://github.com/aronno-is-here/melodify-music-streaming)';
const LYRICS_ROUTE_ERROR = 'failed to load lyrics';

function isLatinScript(text) {
  if (!text) return false;
  const latin = text.replace(/[^a-zA-Z]/g, '');
  return latin.length > text.replace(/\s/g, '').length * 0.5;
}

function transliterateDevanagari(text) {
  const VOWELS = {
    '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ee',
    '\u0909': 'u', '\u090A': 'oo', '\u090B': 'ri', '\u0960': 'ri',
    '\u090F': 'e', '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au',
  };
  const VOWEL_SIGNS = {
    '\u093E': 'aa', '\u093F': 'i', '\u0940': 'ee',
    '\u0941': 'u', '\u0942': 'oo', '\u0943': 'ri', '\u0944': 'ri',
    '\u0947': 'e', '\u0948': 'ai', '\u094B': 'o', '\u094C': 'au',
  };
  const CBASE = {
    '\u0915': 'k', '\u0916': 'kh', '\u0917': 'g', '\u0918': 'gh', '\u0919': 'ng',
    '\u091A': 'ch', '\u091B': 'chh', '\u091C': 'j', '\u091D': 'jh', '\u091E': 'ny',
    '\u091F': 'T', '\u0920': 'Th', '\u0921': 'D', '\u0922': 'Dh', '\u0923': 'N',
    '\u0924': 't', '\u0925': 'th', '\u0926': 'd', '\u0927': 'dh', '\u0928': 'n',
    '\u092A': 'p', '\u092B': 'ph', '\u092C': 'b', '\u092D': 'bh', '\u092E': 'm',
    '\u092F': 'y', '\u0930': 'r', '\u0932': 'l', '\u0935': 'v',
    '\u0936': 'sh', '\u0937': 'sh', '\u0938': 's', '\u0939': 'h',
  };
  const SPECIAL = { '\u0902': 'n', '\u0903': 'h', '\u094D': '' };
  const DIGITS = {
    '\u0966': '0', '\u0967': '1', '\u0968': '2', '\u0969': '3', '\u096A': '4',
    '\u096B': '5', '\u096C': '6', '\u096D': '7', '\u096E': '8', '\u096F': '9',
  };

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DIGITS[ch]) { result += DIGITS[ch]; continue; }
    if (VOWELS[ch]) { result += VOWELS[ch]; continue; }
    if (SPECIAL[ch] !== undefined) { result += SPECIAL[ch]; continue; }
    if (VOWEL_SIGNS[ch]) { result += VOWEL_SIGNS[ch]; continue; }
    if (CBASE[ch]) {
      const base = CBASE[ch];
      const next = i + 1 < text.length ? text[i + 1] : null;
      const nc = next ? next.charCodeAt(0) : 0;
      const hasMatra = next && ((nc >= 0x093E && nc <= 0x094C) || nc === 0x094D || nc === 0x0902 || nc === 0x0903 || nc === 0x0962 || nc === 0x0963);
      const nextIsC = next && nc >= 0x0915 && nc <= 0x0939;
      const nextIsVowel = next && nc >= 0x0905 && nc <= 0x0914;
      if (hasMatra || nextIsC || nextIsVowel) {
        result += base;
      } else {
        result += base + 'a';
      }
      continue;
    }
    if (ch >= '\u0900' && ch <= '\u097F') continue;
    result += ch;
  }
  return result;
}

function transliterateBengali(text) {
  const VOWELS = {
    '\u0985': 'a', '\u0986': 'aa', '\u0987': 'i', '\u0988': 'ee',
    '\u0989': 'u', '\u098A': 'oo', '\u098B': 'ri', '\u09E0': 'ri',
    '\u098F': 'e', '\u0990': 'ai', '\u0993': 'o', '\u0994': 'au',
  };
  const VOWEL_SIGNS = {
    '\u09BE': 'aa', '\u09BF': 'i', '\u09C0': 'ee',
    '\u09C1': 'u', '\u09C2': 'oo', '\u09C3': 'ri', '\u09C4': 'ri',
    '\u09C7': 'e', '\u09C8': 'ai', '\u09CB': 'o', '\u09CC': 'au',
  };
  const CBASE = {
    '\u0995': 'k', '\u0996': 'kh', '\u0997': 'g', '\u0998': 'gh', '\u0999': 'ng',
    '\u099A': 'ch', '\u099B': 'chh', '\u099C': 'j', '\u099D': 'jh', '\u099E': 'ny',
    '\u099F': 'T', '\u09A0': 'Th', '\u09A1': 'D', '\u09A2': 'Dh', '\u09A3': 'N',
    '\u09A4': 't', '\u09A5': 'th', '\u09A6': 'd', '\u09A7': 'dh', '\u09A8': 'n',
    '\u09AA': 'p', '\u09AB': 'ph', '\u09AC': 'b', '\u09AD': 'bh', '\u09AE': 'm',
    '\u09AF': 'y', '\u09B0': 'r', '\u09B2': 'l',
    '\u09B6': 'sh', '\u09B7': 'sh', '\u09B8': 's', '\u09B9': 'h',
  };
  const SPECIAL = { '\u0982': 'n', '\u0983': 'h', '\u09CD': '' };
  const DIGITS = {
    '\u09E6': '0', '\u09E7': '1', '\u09E8': '2', '\u09E9': '3', '\u09EA': '4',
    '\u09EB': '5', '\u09EC': '6', '\u09ED': '7', '\u09EE': '8', '\u09EF': '9',
  };

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DIGITS[ch]) { result += DIGITS[ch]; continue; }
    if (VOWELS[ch]) { result += VOWELS[ch]; continue; }
    if (SPECIAL[ch] !== undefined) { result += SPECIAL[ch]; continue; }
    if (VOWEL_SIGNS[ch]) { result += VOWEL_SIGNS[ch]; continue; }
    if (CBASE[ch]) {
      const base = CBASE[ch];
      const next = i + 1 < text.length ? text[i + 1] : null;
      const nc = next ? next.charCodeAt(0) : 0;
      const hasMatra = next && ((nc >= 0x09BE && nc <= 0x09CC) || nc === 0x09CD || nc === 0x0982 || nc === 0x0983 || nc === 0x09E1 || nc === 0x09E2);
      const nextIsC = next && nc >= 0x0995 && nc <= 0x09B9;
      const nextIsVowel = next && nc >= 0x0985 && nc <= 0x0994;
      if (hasMatra || nextIsC || nextIsVowel) {
        result += base;
      } else {
        result += base + 'a';
      }
      continue;
    }
    if (ch >= '\u0980' && ch <= '\u09FF') continue;
    result += ch;
  }
  return result;
}

function romanize(text) {
  if (!text || isLatinScript(text)) return text;
  if (/[\u0900-\u097F]/.test(text)) return transliterateDevanagari(text);
  if (/[\u0980-\u09FF]/.test(text)) return transliterateBengali(text);
  return text;
}

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

function romanizeLRC(lrc) {
  const lines = parseLRC(lrc);
  if (lines.length === 0) return { synced: [], plain: '' };
  const allText = lines.map(l => l.text).join('\n');
  if (isLatinScript(allText)) return { synced: lines, plain: allText };
  const romanized = lines.map(l => ({ time: l.time, text: romanize(l.text) }));
  return { synced: romanized, plain: romanized.map(l => l.text).join('\n') };
}

async function fetchFromLRCLIB(artist, title, duration) {
  const headers = { 'User-Agent': UA };
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    const durSec = durationToSeconds(duration);
    if (durSec > 0) params.set('duration', String(durSec));
    const resp = await fetch(`https://lrclib.net/api/get?${params}`, { headers, signal: AbortSignal.timeout(5000) });
    if (resp.ok) { const data = await resp.json(); if (data.syncedLyrics || data.plainLyrics) return data; }
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
        for (const r of results) { if (r.trackName && r.trackName.toLowerCase() === titleLower) { best = r; break; } }
        if (durSec > 0 && results.length > 1) {
          let closest = best, minDiff = Math.abs((best.duration || 0) - durSec);
          for (const r of results) { const diff = Math.abs((r.duration || 0) - durSec); if (diff < minDiff) { minDiff = diff; closest = r; } }
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
    const songChords = typeof song.chords === 'string' ? song.chords : '';

    if (song.lyrics) {
      if (isLatinScript(song.lyrics)) {
        const synced = parseLRC(song.lyrics);
        return res.json({ success: true, source: 'database', synced: synced.length > 0, lines: synced.length > 0 ? synced : song.lyrics.split('\n').filter(l => l.trim()).map(text => ({ time: null, text })), plain: song.lyrics, chords: songChords });
      }
      const { synced, plain } = romanizeLRC(song.lyrics);
      return res.json({ success: true, source: 'database-romanized', synced: synced.length > 0, lines: synced.length > 0 ? synced : plain.split('\n').filter(l => l.trim()).map(text => ({ time: null, text })), plain, chords: songChords });
    }

    const lrclibData = await fetchFromLRCLIB(song.artist, song.title, song.duration);
    if (lrclibData) {
      const rawPlain = lrclibData.plainLyrics || lrclibData.syncedLyrics || '';
      if (isLatinScript(rawPlain)) {
        const synced = parseLRC(lrclibData.syncedLyrics || '');
        const plainLines = rawPlain.split('\n').filter(l => l.trim());
        return res.json({ success: true, source: 'lrclib', synced: synced.length > 0, lines: synced.length > 0 ? synced : plainLines.map(text => ({ time: null, text })), plain: rawPlain, chords: songChords });
      }
      if (lrclibData.syncedLyrics) {
        const { synced, plain } = romanizeLRC(lrclibData.syncedLyrics);
        return res.json({ success: true, source: 'lrclib-romanized', synced: synced.length > 0, lines: synced, plain, chords: songChords });
      } else {
        const r = romanize(rawPlain);
        const plainLines = r.split('\n').filter(l => l.trim());
        return res.json({ success: true, source: 'lrclib-romanized', synced: false, lines: plainLines.map(text => ({ time: null, text })), plain: r, chords: songChords });
      }
    }

    return res.json({ success: true, source: 'none', synced: false, lines: [], plain: '', chords: songChords });
  } catch (error) {
    res.status(500).json({ success: false, error: LYRICS_ROUTE_ERROR });
  }
});

export default router;
