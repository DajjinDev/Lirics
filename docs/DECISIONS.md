# Registro de decisiones técnicas

Decisiones relevantes, su motivo y qué se descartó. Formato breve; las más recientes al final.

## D1 · Sin backend en la Fase 1
**Decisión:** frontend Angular que habla directamente con los proveedores. **Motivo:** todos permiten CORS (verificado) y no hay secretos del servidor: la clave de YouTube es del propio usuario, restringida por referente. **Coste:** MusicBrainz pide identificarse con `User-Agent`, algo que un navegador no puede fijar. **Cuándo cambiar:** al añadir cuentas, caché compartida o proveedores con claves secretas (Musixmatch, MusicKit) → Spring Boot.
**Descartado:** Spring Boot «por si acaso»: sería código sin función y un proxy más que proteger.

## D2 · La búsqueda se apoya en el catálogo (iTunes) y YouTube se usa bajo petición
La especificación presenta YouTube Data API como buscador principal. Como cada `search.list` cuesta mucha cuota, el catálogo (gratis, con portada y duración) busca solo al escribir y **YouTube es una búsqueda explícita** (botón / `Mayús+Enter`) más la resolución del video al abrir una canción. Sin clave todo sigue funcionando pegando enlaces.

## D3 · Reloj del reproductor como fuente de verdad
Un temporizador propio nunca avanza con el reproductor en pausa o cargando. `PlaybackClock` interpola entre lecturas (4 Hz) solo en `PLAYING`; el salto > 350 ms se aplica de golpe y el resto se suaviza; la velocidad de reproducción recalibra el reloj.

## D4 · Umbrales y pesos de coincidencia desde la configuración
Pesos 40/30/20/10 y umbrales 90/75/60 (`app-config.ts`), tal como propone la especificación, con **topes** propios: otro artista/título, duración > 15 s distinta, **sin duración de referencia** (como mucho «probable») y **versión distinta** (como mucho «incierta») no pueden subir. «Alta» exige duración comprobada (±6 s). Se muestra como puntuación 0–100, **no** como probabilidad.
**Consecuencia observada:** la puntuación se satura en 100 para coincidencias exactas.

## D5 · Sin aviso solo si la coincidencia está comprobada
`FOUND_SYNCED` (sin aviso) = alta, o probable con duración verificada, o elección del usuario. Todo lo demás muestra `MATCH_UNCERTAIN` con la razón y la opción de elegir otra versión.

## D6 · Color Thief como cuantizador, tema propio encima
Se adoptó Color Thief 3.5 (lo pide la especificación y es una librería mantenida) pero **la selección de dominante/secundario/acento y la garantía de contraste siguen siendo código propio y probado**, porque Color Thief solo extrae colores. Se carga bajo demanda. Se descartó mantener además un histograma propio (código muerto).

## D7 · Portadas: la grande es mejor esfuerzo, la documentada es el respaldo
Cambiar el tamaño en `artworkUrl100` no está documentado por Apple, pero funciona y da mucha mejor calidad. Se usa y se conserva la URL original como alternativa automática. MusicBrainz + Cover Art Archive solo cuando el catálogo no dio portada.

## D8 · MusicBrainz por lanzamiento, no por grabación
La búsqueda por grabación devolvía resultados sin álbum ni duración. Buscar el lanzamiento que contiene la grabación da los MBID que necesita Cover Art Archive.

## D9 · Reintentos solo donde se observó la necesidad
`503` + `Retry-After` (MusicBrainz «ocupado») se reintenta con tope; los demás errores no. Los proveedores complementarios **nunca** impiden reproducir.

## D10 · `LyricsProvider` devuelve candidatos, no letras
La interfaz sugerida en la especificación (`searchLyrics(track) → SyncedLyrics | null`) mezcla buscar, puntuar y construir. Aquí un proveedor devuelve **candidatos** (`find`) y el servicio los puntúa contra la pista que suena y construye las letras; así varios proveedores se comparan entre sí y el usuario puede elegir otra versión.

## D11 · Letras sin sincronía por palabra inventada
La sincronía por palabra **real** viene de LRCLIB (`hasWordSync`/`lyricsfile`). El reparto aproximado entre palabras es opcional y se rotula como aproximado.

## D12 · Pausas instrumentales solo con evidencia
Se infieren de marcas vacías (≥ 3,5 s), de huecos grandes (≥ 7 s) o de una intro (≥ 4 s); **no** de cualquier espacio entre líneas. El fin de línea estimado se marca `endInferred`.

## D13 · Las pruebas en vivo son opcionales y no sustituyen a las unitarias
`npm test` no usa la red. La prueba en vivo (`LIRIKS_LIVE=1`) existe para comprobar los proveedores reales y generó hallazgos que las pruebas simuladas no habrían encontrado. Se complementó con **pruebas de mutación manuales** (romper una garantía a propósito y comprobar que algún test falla); una de ellas destapó una prueba débil que se corrigió.

## D13b · La clave nunca pasa por el asistente
La prueba con la clave real se hizo con un script que la pide en la terminal del usuario sin mostrarla (`scripts/probar-youtube.ps1`), la borra de la sesión al terminar y escribe un informe que no la contiene. Antes se verificó la forma del error de Google con una clave **falsa**.

## D14 · Servicio de IA aparte y opcional (Fase 3)
Ver [ARCHITECTURE.md](ARCHITECTURE.md) §11b y [ai-service/README.md](../ai-service/README.md).
