import { Injectable } from '@angular/core';
import { API_BASES } from '../config/app-config';
import { isMbid } from './musicbrainz.provider';

export type CoverArtSize = 250 | 500 | 1200;

/**
 * Cover Art Archive: portadas alternativas a partir de identificadores de MusicBrainz.
 * No hay llamada a una API JSON: la URL `…/front-{tamaño}` redirige (307 → archive.org) a la
 * imagen; se verificó que TODA la cadena de redirecciones responde con
 * `access-control-allow-origin: *`, por lo que sus píxeles se pueden leer en Canvas.
 * Que la URL exista no garantiza que haya portada (404 si no): quien la use debe comprobar la carga.
 * Las portadas pueden estar protegidas por derechos de autor aunque el acceso sea gratuito.
 */
@Injectable({ providedIn: 'root' })
export class CoverArtProvider {
  /** URL de la portada frontal, o null si el identificador no es un MBID válido (evita rutas arbitrarias). */
  frontUrl(kind: 'release' | 'release-group', mbid: string, size: CoverArtSize = 500): string | null {
    if (!isMbid(mbid)) return null;
    return `${API_BASES.coverArt}/${kind}/${mbid}/front-${size}`;
  }
}
