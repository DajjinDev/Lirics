# Integraciones de APIs

Estado real de cada integración: qué endpoints se usan, qué se **verificó con peticiones reales** y qué **no**. La configuración (URLs base, umbrales, límites) vive en [`src/app/core/config/app-config.ts`](../src/app/core/config/app-config.ts).

> Leyenda: ✅ ejecutado contra el servicio real · 🧪 solo con respuestas simuladas (pruebas unitarias) · ⛔ no ejecutado

| Proveedor | Clave | Qué se usa | Verificación |
|---|---|---|---|
| YouTube Data API v3 | **Sí** (tuya) | Búsqueda de videos, información de un video | ✅ búsqueda y `videos.list` con clave real · ✅ forma del error de clave inválida · 🧪 cuota agotada, región, API deshabilitada |
| YouTube IFrame Player API | No | Reproducción y reloj | ✅ en navegador |
| LRCLIB | No | Letras (LRC y por palabra) | ✅ |
| iTunes Search API | No | Catálogo, portadas, duración, género | ✅ |
| MusicBrainz | No | Identificación alternativa (lanzamientos, ISRC) | ✅ (con matices, ver abajo) |
| Cover Art Archive | No | Portadas alternativas | ✅ |
| Color Thief 3.5 | — (librería) | Cuantización de color de la portada | ✅ en navegador |

## 1. YouTube Data API v3

**Base:** `https://www.googleapis.com/youtube/v3`

| Uso | Endpoint | Parámetros |
|---|---|---|
| Buscar videos (**solo bajo petición explícita**) | `GET /search` | `part=snippet` `type=video` `videoEmbeddable=true` `maxResults=10` `q` `key` |
| Detalles de los resultados / de un enlace pegado | `GET /videos` | `part=snippet,contentDetails,status` `id=a,b,c` (hasta 10 ids en **una** llamada) `key` |

- Se devuelven título, canal, miniaturas, **duración** (ISO 8601 → ms con `parseIsoDuration`), `status.embeddable` y `regionRestriction`.
- Los videos **no insertables** y los **bloqueados en tu región** (`CO` u otro país configurado) se excluyen de la búsqueda; un enlace pegado que no se pueda insertar da un mensaje claro *antes* de intentar reproducirlo.
- `videoCategoryId=10` (Música) **no se usa**: puede excluir resultados válidos (la especificación lo deja como opcional).
- Sin clave, un enlace pegado se resuelve con **oEmbed** (sin cuota); con clave, con `videos.list`; si la clave falla (cuota, inválida…) se recurre a oEmbed para no impedir reproducir.

**Cuota.** `search.list` es costoso y `videos.list` barato. Los valores exactos y la cuota diaria **deben confirmarse en tu consola de Google Cloud** (no se verificaron). Medidas aplicadas: búsqueda en YouTube **nunca al escribir** (botón «Buscar también en YouTube» o `Mayús+Enter`), mínimo 3 caracteres, caché de 15 min, deduplicación de peticiones idénticas en curso, una sola llamada agrupada de detalles.

**Errores** (traducidos por el *motivo* que devuelve Google, no solo el código HTTP): cuota agotada (`quotaExceeded`, `dailyLimitExceeded`, `rateLimitExceeded`) · clave inválida · API no habilitada (`accessNotConfigured`) · restricción de referente (`ipRefererBlocked`). Verificado contra la API real: la forma del error de **clave inválida** (`400`, `reason: "badRequest"`, mensaje «API key not valid», `details[].reason: "API_KEY_INVALID"`) y que Google permite CORS desde `localhost:4200` también en los errores. Los demás motivos (cuota agotada, API no habilitada, restricción de referente) se tomaron de la documentación de errores de Google y están cubiertos **solo con respuestas simuladas**: no se provocaron en vivo.

### Obtener y configurar la clave

1. **Crear el proyecto:** https://console.cloud.google.com/projectcreate (nombre libre, p. ej. `Lyrora Music`).
2. **Habilitar la API:** https://console.cloud.google.com/apis/library/youtube.googleapis.com → *Habilitar*.
3. **Crear la clave:** https://console.cloud.google.com/apis/credentials → *Crear credenciales → Clave de API*. No hace falta OAuth para contenido público.
4. **Restringirla** (importante: una clave en el navegador la puede ver cualquiera que abra las herramientas de desarrollo):
   - *Restricciones de aplicación → Sitios web*: `http://localhost:4200/*` (y tu dominio en producción).
   - *Restricciones de API*: solo **YouTube Data API v3**.
5. **Pegarla en Liriks:** icono de ajustes (controles deslizantes) → **Personalizar → YouTube** → campo de la clave → pulsa fuera del campo. Se guarda **solo en tu navegador** (`localStorage`).

Angular **no lee** un archivo `.env`: la clave **no** va en el código ni en el repositorio. Si más adelante se añade un backend (Spring Boot), la clave pasará a una variable de entorno del servidor y deberá restringirse por IP.

## 2. YouTube IFrame Player API

Script oficial `https://www.youtube.com/iframe_api`, cargado **una sola vez** (se verifica con pruebas), con callback previo respetado y error claro si lo bloquea un bloqueador de contenido.

Se usa: `playVideo` `pauseVideo` `stopVideo` `seekTo` `setVolume` `getVolume` `mute` `unMute` `isMuted` `getCurrentTime` `getDuration` `getPlaybackRate` `loadVideoById` `cueVideoById` `destroy`, y los eventos `onReady` `onStateChange` `onError` `onPlaybackRateChange`. Estados normalizados: `IDLE LOADING READY PLAYING PAUSED BUFFERING ENDED ERROR`. Errores 2/100/101/150/153 traducidos a mensajes comprensibles.

- **Reloj:** `getCurrentTime()` es la fuente de verdad; un `PlaybackClock` interpola entre lecturas solo mientras `PLAYING`, y un **cambio de velocidad recalibra** el reloj (probado).
- **Política:** el reproductor permanece **visible** (≥ 200 px de alto); no hay descarga, extracción de audio ni bloqueo de anuncios.
- ✅ Verificado en navegador: carga, reproducción, salto, estados, duración. 🧪 El resto de eventos (velocidad, errores) con un `YT` simulado.

## 3. LRCLIB

**Base:** `https://lrclib.net/api` — sin clave, CORS `*`.

| Endpoint | Uso |
|---|---|
| `GET /search?track_name=&artist_name=` | Candidatos. Si no hay resultados: variantes del título (sin paréntesis, antes del guion, prefijos de 2–4 palabras) y, al final, `?q=` |
| `GET /get?track_name=&artist_name=&album_name=&duration=` | Coincidencia exacta por firma (duración en segundos) |
| `GET /get/{id}` | Un registro concreto (`id` solo dígitos) |

Respuesta real: `id trackName artistName albumName duration instrumental plainLyrics syncedLyrics` **y además** `hasWordSync` + `lyricsfile` (YAML con `start_ms` **por palabra**, no documentado en la especificación; se usa para la sincronía real por palabra). `404` con `TrackNotFound` cuando no existe.

✅ Verificado en vivo con 10 canciones (ver §8). ⛔ **Términos de uso no leídos** (su sitio se renderiza con JS): no asumir licencia comercial.

## 4. iTunes Search API

**Base:** `https://itunes.apple.com` — `GET /search?term=&entity=song&media=music&country=&limit=` y `GET /lookup?id=`. Sin clave, CORS `*`.

- **País configurable** (Personalizar → Catálogo; si está vacío: región del navegador → `CO`). Sin resultados → se prueba `US`.
- Campos leídos (todos opcionales, respuestas incompletas se descartan): `trackId artistId collectionId trackName artistName collectionName trackTimeMillis releaseDate artworkUrl100 primaryGenreName trackViewUrl`.
- **Portadas:** solo `artworkUrl100` está documentado. Pedir una portada grande cambiando el tamaño en la URL (`…/1000x1000bb.jpg`) **funciona** (verificado: 200/600/1000) pero **no está documentado**; por eso cada pista conserva la URL original como alternativa y la interfaz recurre a ella si falla.
- **Límite:** ≈ 20 peticiones/min (cifra histórica, no confirmada): limitador de ventana deslizante en el cliente (18/min) que avisa en vez de enviar.
- Las versiones alternativas (remix, live…) que no pediste se ordenan **después** de la normal (hallazgo de la prueba en vivo).
- No se usan las muestras de audio de iTunes.

## 5. MusicBrainz

**Base:** `https://musicbrainz.org/ws/2` — sin clave, CORS `*`.

Hallazgos reales (importantes):

| Observación | Consecuencia |
|---|---|
| Responde **`503` «servidor ocupado»** con `Retry-After` de forma intermitente | Reintentos (hasta 2) respetando `Retry-After` con tope de 5 s |
| Responde **`403` «throttled»** a clientes que no se identifican (comprobado con el *User-Agent* por defecto de Node) y `200` con uno de navegador o identificable | En un **navegador** funciona (verificado desde `localhost:4200`); un **backend** debe enviar un `User-Agent` propio |
| La búsqueda por **grabación** suele no traer álbum ni duración | Se busca por **lanzamiento**: `release/?query=recording:"…" AND artist:"…" AND status:official` |
| Límite de **1 petición/segundo** | Limitador en el cliente (serializa) |

- Se usa solo como complemento y **solo si el catálogo principal no dio portada fiable** (enlace de YouTube sin coincidencia): sin consultas redundantes. Cualquier fallo es silencioso.
- Puntuación mínima de 90; prefiere álbum > sencillo > EP y el lanzamiento más antiguo. Los MBID se validan (UUID) antes de usarlos en rutas; las comillas de la consulta Lucene se escapan.
- **Limitación:** un navegador **no puede fijar** la cabecera `User-Agent` que MusicBrainz pide para identificar clientes → para más escala, un backend. Condiciones de uso comercial **no revisadas**.

## 6. Cover Art Archive

`https://coverartarchive.org/{release|release-group}/{MBID}/front-{250|500|1200}` — sin clave.

- La URL redirige (`307 → 302 → 200`, a archive.org) y **toda la cadena** devuelve `access-control-allow-origin: *`. ✅ Verificado en navegador: la imagen carga a 500×500 **y sus píxeles se pueden leer en un canvas** (requisito para extraer colores).
- Se prueba primero el grupo de lanzamientos y luego el lanzamiento; en cada uno 1200 px y, si no existe, 500 px. Si la imagen no carga (404, CORS) se conservan los metadatos y la portada anterior.
- Las portadas pueden tener derechos de autor aunque el acceso técnico sea gratuito.

## 7. Color Thief 3.5

`getPalette(img, { colorCount: 8 })` → colores con `hsl()` (**s y l de 0 a 100**, no 0–1) y `proportion` (0–1). Se normalizan y alimentan la selección de tema propia (dominante/secundario/acento ponderando saturación), que **garantiza contraste ≥ 4,5:1** con texto blanco. Se carga **bajo demanda** (≈ 6 kB, fuera del bundle inicial). Se prueban varias portadas en orden; si ninguna se puede leer (CORS), paleta de respaldo determinista marcada `fromArtwork: false`.

La escala de `hsl()` se comprobó leyendo los tipos del paquete; una prueba de mutación confirmó que, sin normalizarla, los tests fallan.

## 8. Prueba en vivo (ejecutada)

`LIRIKS_LIVE=1 npx ng test --watch=false` recorre 10 canciones por el flujo real (catálogo → LRCLIB → puntuación → MusicBrainz → Cover Art Archive). Resultado de la última ejecución:

| Canción | Letra | Sincronía | Portada alternativa |
|---|---|---|---|
| A Mí — Rels B | FOUND_SYNCED 100/100 | **palabra** | ✅ |
| Her — BTS | FOUND_SYNCED 100/100 | **palabra** | ✅ |
| Blinding Lights — The Weeknd | FOUND_SYNCED 100/100 | **palabra** | ✅ |
| Despacito — Luis Fonsi | FOUND_SYNCED 100/100 | **palabra** | ✅ |
| Shape of You — Ed Sheeran | FOUND_SYNCED 100/100 | línea | ✅ |
| Lose Yourself — Eminem | FOUND_SYNCED 100/100 | línea | ✅ |
| Calm Down — Rema | FOUND_SYNCED 100/100 | **palabra** | ✅ |
| Let Her Go — Passenger | FOUND_SYNCED 100/100 | **palabra** | ✅ |
| Clair de Lune — Debussy | **INSTRUMENTAL** | — | ✅ |
| Spring Day — BTS | FOUND_SYNCED 100/100 | **palabra** | sin coincidencia en MusicBrainz |

**9/10 con letra sincronizada (7 por palabra), 1 instrumental detectada, 9/10 portadas alternativas.** Esta tabla refleja **estas** canciones en **esta** fecha; no es una cobertura general. Además: `GET /api/get/{id}` ✅.

Lo que esa prueba destapó y se corrigió: títulos de catálogo ruidosos (`Clair de lune (moonlight) Debussy Classic lullaby` → 0 resultados), obras instrumentales con grabaciones de duraciones distintas, la versión *Remix* listada antes que la original, y títulos de YouTube del tipo `A mí (Letra/Lyrics)` que no se reconocían.

> Los «100/100» se saturan: una coincidencia exacta de título, artista, álbum y duración da el máximo, así que la puntuación **no distingue** entre candidatos igual de buenos (el desempate es por tipo de sincronía y duración).

### YouTube Data API v3 con clave real

Ejecutada con `scripts/probar-youtube.ps1` (la clave se pide en la terminal y no se guarda):

| Comprobación | Resultado |
|---|---|
| `search.list` para «Rels B A Mí» | **10 videos** insertables; el primero «A mi», **209 000 ms** (el catálogo da 210 s) |
| `videos.list` de `4NRXx6U8ABQ` | «Blinding Lights», **263 000 ms**, `embeddable: true` |
| Coherencia | 263 s coincide con la duración que el reproductor IFrame reportó para ese video (≈ 4:20–4:23) |

**Sigue sin verificarse en vivo:** cuota agotada, restricciones regionales reales, API deshabilitada, y el **costo exacto de cuota** de cada llamada (confírmalo en tu consola de Google Cloud). La prueba solo mira el primer resultado y no valida la calidad del ranking de los 10.
