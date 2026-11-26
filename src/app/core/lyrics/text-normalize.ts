/**
 * Normalización de textos musicales para comparar títulos/artistas entre
 * proveedores. Elimina el "ruido" de marketing (Official Video, HD, 4K…) pero
 * conserva lo que distingue versiones (live, acoustic, remix, feat., etc.).
 */

/** Expresiones que NO identifican una versión y se descartan. */
const NOISE =
  /\b(official\s*(music\s*)?(video|audio|lyric\s*video|visuali[sz]er|mv)|video\s*oficial|audio\s*oficial|lyric\s*video|lyrics?|visuali[sz]er|m\/v|mv|hd|hq|4k|8k|1080p|720p|remaster(ed)?(\s*\d{4})?|\d{4}\s*remaster(ed)?|with\s+lyrics?|full\s+(song|version))\b/gi;

export const VERSION_FLAGS = [
  'live',
  'acoustic',
  'remix',
  'instrumental',
  'karaoke',
  'cover',
  'sped',
  'slowed',
  'reverb',
  'nightcore',
  'edit',
  'demo',
  'mashup',
] as const;
export type VersionFlag = (typeof VERSION_FLAGS)[number];

const FLAG_PATTERNS: Record<VersionFlag, RegExp> = {
  live: /\b(live|en vivo|concert|concierto|unplugged|tour)\b/i,
  acoustic: /\b(acoustic|ac[uú]stic[oa]|unplugged)\b/i,
  remix: /\b(remix|rmx|rework|bootleg|flip)\b/i,
  instrumental: /\b(instrumental|backing track|sin voz)\b/i,
  karaoke: /\bkaraoke\b/i,
  cover: /\b(cover|tribute|versi[oó]n de)\b/i,
  sped: /\b(sped\s*up|speed\s*up|spedup|fast(er)?\s*version)\b/i,
  slowed: /\b(slowed|slow\s*version|slowed\s*\+?\s*reverb)\b/i,
  reverb: /\breverb\b/i,
  nightcore: /\bnightcore\b/i,
  edit: /\b(radio\s*edit|edit(ed)?\s*version|clean\s*edit)\b/i,
  demo: /\bdemo\b/i,
  mashup: /\bmash\s*-?\s*up\b/i,
};

/** Detecta marcas de versión alternativa en un texto. */
export function detectVersionFlags(text: string): Set<VersionFlag> {
  const found = new Set<VersionFlag>();
  for (const flag of VERSION_FLAGS) {
    if (FLAG_PATTERNS[flag].test(text)) found.add(flag);
  }
  // "slowed + reverb" implica ambas, "unplugged" ya cubre live+acoustic.
  return found;
}

/** Quita ruido de marketing sin tocar la información de versión. */
export function stripNoise(text: string): string {
  return text
    // Grupos entre paréntesis que son solo marketing: "(Letra/Lyrics)", "[Con letra]".
    .replace(/[\(\[\{][^\)\]\}]*\b(letras?|con letras?|subtitulad[oa]|sub espa[ñn]ol)\b[^\)\]\}]*[\)\]\}]/gi, ' ')
    .replace(NOISE, ' ')
    // Grupos que quedaron vacíos o solo con signos tras quitar el ruido: "( )", "(/ )".
    .replace(/[\(\[\{][^\p{L}\p{N}\)\]\}]*[\)\]\}]/gu, ' ')
    .replace(/\s*[-–—|]\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Forma canónica para comparar: sin acentos, sin símbolos, minúsculas. */
export function normalizeForCompare(text: string): string {
  return stripNoise(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita acompañantes "(feat. X)", "ft. X", "con X" para comparar el título base. */
export function stripFeaturing(text: string): string {
  return text
    .replace(/[\(\[][^\)\]]*\b(feat\.?|ft\.?|featuring|with|con)\b[^\)\]]*[\)\]]/gi, ' ')
    .replace(/\s+\b(feat\.?|ft\.?|featuring)\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice sobre bigramas (0..1). */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigrams(a);
  const bb = bigrams(b);
  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (ba.length + bb.length);
}

/** Similitud de tokens: proporción de palabras del más corto contenidas en el otro. */
export function tokenContainment(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hit = 0;
  for (const t of small) if (big.has(t)) hit++;
  return hit / small.size;
}

/** Quita grupos entre paréntesis/corchetes: "Tema (moonlight) Clásico" → "Tema Clásico". */
export function stripParentheticals(text: string): string {
  return text
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Variantes de un título para consultar catálogos, de la más fiel a la más simple:
 * completo → sin paréntesis → antes de un guion largo. Sin duplicados ni vacíos.
 */
export function titleVariants(title: string): string[] {
  const noParens = stripParentheticals(title);
  const beforeDash = noParens.split(/\s+[-–—]\s+/)[0].trim();
  return [...new Set([title.trim(), noParens, beforeDash].filter((t) => t.length > 0))];
}

/**
 * Prefijos del título (sin paréntesis) de 4 a 2 palabras, del más largo al más corto:
 * "Clair de lune Debussy Classic lullaby" → ["Clair de lune Debussy", "Clair de lune", "Clair de"].
 * Último recurso para catálogos que añaden texto de marketing detrás del título real.
 */
export function titlePrefixes(title: string): string[] {
  const words = stripParentheticals(title).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = Math.min(words.length - 1, 4); n >= 2; n--) out.push(words.slice(0, n).join(' '));
  return out.slice(0, 3);
}

/**
 * Similitud de títulos 0..1 (ignora ruido y acompañantes). También se compara sin los grupos entre
 * paréntesis, porque los catálogos añaden texto ahí ("(moonlight)", "(Remastered)"); que una VERSIÓN
 * distinta (live, remix…) siga penalizándose lo decide detectVersionFlags sobre el texto completo.
 */
export function titleSimilarity(a: string, b: string): number {
  const direct = titleSimilarityRaw(a, b);
  const sa = stripParentheticals(a);
  const sb = stripParentheticals(b);
  if (sa === a.trim() && sb === b.trim()) return direct;
  return Math.max(direct, titleSimilarityRaw(sa, b), titleSimilarityRaw(a, sb), titleSimilarityRaw(sa, sb));
}

function titleSimilarityRaw(a: string, b: string): number {
  const na = normalizeForCompare(stripFeaturing(a));
  const nb = normalizeForCompare(stripFeaturing(b));
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dice = diceSimilarity(na, nb);
  // Contención solo cuenta si el título más corto tiene ≥2 palabras (evita "love" ⊂ "love story").
  const shortWords = Math.min(na.split(' ').length, nb.split(' ').length);
  const contain = shortWords >= 2 ? tokenContainment(na, nb) * 0.9 : 0;
  return Math.max(dice, contain);
}

/** Separa "A & B feat. C, D x E" en artistas individuales normalizados. */
export function splitArtists(text: string): string[] {
  return text
    .split(/\s*(?:,|&|;|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\by\b|\band\b|\bx\b)\s*/i)
    .map((s) => normalizeForCompare(s))
    .filter(Boolean);
}

/** Similitud de artistas 0..1: coincide si comparten al menos un artista. */
export function artistSimilarity(a: string, b: string): number {
  const whole = diceSimilarity(normalizeForCompare(a), normalizeForCompare(b));
  const la = splitArtists(a);
  const lb = splitArtists(b);
  let best = 0;
  for (const x of la) for (const y of lb) best = Math.max(best, diceSimilarity(x, y));
  return Math.max(whole, best);
}

/* ---------------------------- YouTube helpers ---------------------------- */

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrae el id de video de un enlace de YouTube. Devuelve null para
 * cualquier otra cosa (validación estricta de host e id).
 */
export function parseYouTubeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !YT_HOSTS.has(url.hostname.toLowerCase())) return null;

  let id: string | null = null;
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
    id = m ? m[1] : null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function looksLikeUrl(input: string): boolean {
  return /^(https?:\/\/|www\.|(m\.|music\.)?youtube\.com|youtu\.be)/i.test(input.trim());
}

/** Limpia el nombre del canal de YouTube ("Artist - Topic", "ArtistVEVO"). */
export function cleanChannelName(channel: string): string {
  return channel
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(Official|Oficial)(\s+(Channel|Canal))?$/i, '')
    .trim();
}

/**
 * Deduce artista y título a partir del título de un video de YouTube y su canal.
 * Ej.: "The Weeknd - Blinding Lights (Official Video)" → { The Weeknd, Blinding Lights }.
 */
export function parseYouTubeTitle(
  videoTitle: string,
  channel = '',
): { artist: string; title: string } {
  const cleaned = stripNoise(videoTitle.replace(/["“”]/g, ''));
  const parts = cleaned.split(/\s+[-–—|:]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: cleanChannelName(channel), title: cleaned.trim() };
}
