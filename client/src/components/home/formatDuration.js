// API songs currently use m:ss. Explicit millisecond fields must carry their unit;
// guessing from magnitude would mislabel long recordings as short songs.
export function formatDuration(value, unit = 'seconds') {
  if (value == null || value === '' || typeof value === 'boolean') return '—';
  let seconds;
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.trim().split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return '—';
    const numbers = parts.map(Number);
    if (numbers.slice(1).some(n => n >= 60)) return '—';
    seconds = numbers.reduce((total, n) => total * 60 + n, 0);
  } else if (typeof value === 'number' || typeof value === 'string') {
    const text = String(value).trim();
    if (!/^\d+(?:\.\d+)?(?:ms|s)?$/.test(text)) return '—';
    seconds = parseFloat(text) / (unit === 'milliseconds' || text.endsWith('ms') ? 1000 : 1);
  }
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const tail = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}
