/**
 * Duración ISO 8601 de YouTube → milisegundos. Ej.: "PT3M45S" → 225000.
 * Admite días, horas, minutos y segundos (con decimales). Devuelve undefined para valores
 * inválidos o de duración cero (p. ej. "P0D", que YouTube usa en directos).
 */
export function parseIsoDuration(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m || iso === 'P' || iso.endsWith('T')) return undefined;
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => (x ? Number(x) : 0));
  const ms = Math.round((((d * 24 + h) * 60 + min) * 60 + s) * 1000);
  return ms > 0 ? ms : undefined;
}
