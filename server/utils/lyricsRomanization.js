import { transliterate } from 'transliteration';

export const LYRICS_SCRIPT = Object.freeze({
  DEVANAGARI: 'devanagari',
  BENGALI: 'bengali',
  LATIN: 'latin',
  OTHER: 'other',
});

const DEV_CONS = /[\u0915-\u0939\u0958-\u095F]/;
const BEN_CONS = /[\u0995-\u09B9]/;

const DEV_MATRAS = Object.freeze({
  '\u093E': 'a', '\u093F': 'i', '\u0940': 'i', '\u0941': 'u', '\u0942': 'u',
  '\u0943': 'ri', '\u0945': 'e', '\u0946': 'e', '\u0947': 'e', '\u0948': 'ai',
  '\u0949': 'o', '\u094A': 'o', '\u094B': 'o', '\u094C': 'au', '\u094E': 'a', '\u094F': 'o',
});

const BEN_MATRAS = Object.freeze({
  '\u09BE': 'a', '\u09BF': 'i', '\u09C0': 'i', '\u09C1': 'u', '\u09C2': 'u',
  '\u09C3': 'ri', '\u09C7': 'e', '\u09C8': 'ai', '\u09CB': 'o', '\u09CC': 'au',
  '\u09D7': 'au',
});

const isDevanagari = (ch) => ch >= '\u0900' && ch <= '\u097F';
const isBengali = (ch) => ch >= '\u0980' && ch <= '\u09FF';

function insertInherentVowels(text, consonants, vowel) {
  const chars = [...text];
  const out = [];
  for (let i = 0; i < chars.length; i += 1) {
    out.push(chars[i]);
    const next = chars[i + 1];
    if (next && consonants.test(chars[i]) && consonants.test(next)) out.push(vowel);
  }
  return out.join('');
}

function substituteMatras(text, map) {
  return [...text].map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('');
}

function romanizeDevanagariRun(text) {
  let value = insertInherentVowels(text, DEV_CONS, '\u0905');
  value = substituteMatras(value, DEV_MATRAS);
  value = transliterate(value);
  return value.replace(/N/g, 'n').replace(/M/g, 'm').replace(/'/g, '');
}

function romanizeBengaliRun(text) {
  let value = insertInherentVowels(text, BEN_CONS, '\u0985');
  value = substituteMatras(value, BEN_MATRAS);
  value = transliterate(value);
  return value
    .replace(/N/g, 'ng')
    .replace(/M/g, 'ng')
    .replace(/aa/g, 'a')
    .replace(/ii/g, 'i')
    .replace(/'/g, '');
}

export function romanizeText(text) {
  if (typeof text !== 'string' || !text) return null;
  let hasTargetScript = false;
  let out = '';
  let run = '';
  let runScript = null;
  const flush = () => {
    if (!run) return;
    if (runScript === 'dev') out += romanizeDevanagariRun(run);
    else if (runScript === 'ben') out += romanizeBengaliRun(run);
    else out += run;
    run = '';
  };
  for (const ch of text) {
    const nextScript = isDevanagari(ch) ? 'dev' : isBengali(ch) ? 'ben' : 'other';
    if (nextScript !== runScript) {
      flush();
      runScript = nextScript;
    }
    if (nextScript !== 'other') hasTargetScript = true;
    run += ch;
  }
  flush();
  if (!hasTargetScript) return null;
  return out;
}

export function romanizeLines(lines, script) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  if (script !== LYRICS_SCRIPT.DEVANAGARI && script !== LYRICS_SCRIPT.BENGALI) return null;
  let changed = 0;
  const result = lines.map((line) => {
    const text = typeof line?.text === 'string' ? line.text : '';
    const romanized = romanizeText(text);
    if (romanized === null || romanized === text) return { ...line };
    changed += 1;
    return { ...line, text: romanized };
  });
  if (changed === 0) return null;
  return result;
}

export function detectLyricsScript(value) {
  const text = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map((line) => (typeof line?.text === 'string' ? line.text : '')).join('\n')
      : '';
  let devanagari = 0;
  let bengali = 0;
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    if (isDevanagari(ch)) devanagari += 1;
    else if (isBengali(ch)) bengali += 1;
    else if (/\p{Script=Latin}/u.test(ch) && /\p{L}/u.test(ch)) latin += 1;
    else if (/\p{L}/u.test(ch)) other += 1;
  }
  if (devanagari === 0 && bengali === 0) {
    return latin > 0 ? LYRICS_SCRIPT.LATIN : LYRICS_SCRIPT.OTHER;
  }
  const ranked = [
    [LYRICS_SCRIPT.DEVANAGARI, devanagari],
    [LYRICS_SCRIPT.BENGALI, bengali],
    [LYRICS_SCRIPT.LATIN, latin],
    [LYRICS_SCRIPT.OTHER, other],
  ].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[1][1] === ranked[0][1]) return LYRICS_SCRIPT.OTHER;
  return ranked[0][0];
}

export function withScriptPresentation(payload) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const script = detectLyricsScript(payload.plain || lines);
  const isSupported = script === LYRICS_SCRIPT.DEVANAGARI || script === LYRICS_SCRIPT.BENGALI;
  const romanizedLines = isSupported ? romanizeLines(lines, script) : null;
  const displayLines = script === LYRICS_SCRIPT.DEVANAGARI && romanizedLines
    ? romanizedLines
    : lines;
  return {
    ...payload,
    script,
    romanizedLines,
    displayLines,
  };
}
