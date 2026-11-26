/** 83_450 ms → "1:23". Valores inválidos o negativos se muestran como "0:00". */
export function formatClock(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Offset legible con signo: 200 → "+0,2 s"; 0 → "0 s". */
export function formatOffset(ms: number): string {
  if (ms === 0) return '0 s';
  const sign = ms > 0 ? '+' : '−';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(1).replace('.', ',')} s`;
}
