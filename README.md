# Liriks

> La música, a través de sus letras.

Aplicación web que reproduce una canción mientras muestra su **letra sincronizada** sobre una atmósfera visual generada a partir de los colores de la portada. Busca por canción/artista/álbum o pega un enlace de YouTube.

Estado: **Fases 1 (MVP), 2 (experiencia visual) y 3 (IA, parcial)**. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para la arquitectura, decisiones, lo verificado y lo pendiente.

## Requisitos

- Node.js 22.22.3+ o 24.15+ (requisito de Angular 22; probado con 24.16) y npm
- Un navegador moderno (usa `@property`, `color-mix`, `<dialog>`)

## Instalación y ejecución

```powershell
npm install
npm start          # http://localhost:4200
```

```powershell
npm test           # 291 pruebas (Vitest) · 1 prueba en vivo opcional
npm run build      # build de producción en dist/liriks
```

Prueba **en vivo** contra los proveedores reales (necesita red; no corre en `npm test`):

```powershell
$env:LIRIKS_LIVE = "1"; $env:LIRIKS_LIVE_REPORT = "informe.json"; npx ng test --watch=false
# opcional, para probar también YouTube Data API:  $env:LIRIKS_YT_KEY = "<tu clave>"
```

## Cómo funciona sin configurar nada

No necesitas claves ni backend:

1. **Busca** una canción (catálogo y portadas oficiales vía iTunes Search) **o pega un enlace de YouTube**.
2. Con un enlace de YouTube la canción **suena de verdad** (IFrame Player API, reproductor visible) y las letras siguen el reloj del video.
3. Si eliges un resultado del catálogo **sin** video vinculado, entra en **modo demostración**: se ve cómo se mueven las letras con un reloj virtual, **sin audio**. Está rotulado en pantalla. Pega el enlace de YouTube de esa canción en el aviso para escucharla.

### Clave de YouTube Data API v3 (opcional)

Con una clave propia, la app puede **buscar videos en YouTube** (botón «Buscar también en YouTube» o `Mayús+Enter`) y **encontrar sola** el video de una canción del catálogo. Sin clave, todo lo demás funciona pegando enlaces.

1. Crea un proyecto en https://console.cloud.google.com/projectcreate
2. Habilita **YouTube Data API v3**: https://console.cloud.google.com/apis/library/youtube.googleapis.com
3. Crea una **clave de API**: https://console.cloud.google.com/apis/credentials (no hace falta OAuth)
4. **Restríngela**: sitios web `http://localhost:4200/*` (y tu dominio) y solo a *YouTube Data API v3*. Cualquier clave usada en el navegador puede ser inspeccionada.
5. Pégala en la app: **Personalizar → YouTube**. Se guarda solo en tu navegador.

Angular **no lee un `.env`**: la clave nunca va en el código ni en el repositorio (ver [`.env.example`](.env.example)). `search.list` consume bastante cuota; confirma tus límites en Google Cloud. Los mensajes de cuota agotada o clave inválida se explican en pantalla. Detalle y límites de todas las APIs: **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)**.

### País del catálogo

**Personalizar → Catálogo** (2 letras, p. ej. `CO`). Vacío = el de tu navegador. Si no hay resultados se prueba el catálogo de EE. UU.

### Estudio de sincronización (Fase 3)

Ruta `/studio` (enlace al pie del inicio). Sincroniza **tu propio audio** (o uno que estés autorizado a usar):

1. Elige un archivo de audio: se reproduce **solo en tu navegador**, no se sube a ningún sitio.
2. Pega la letra (opcional) o importa un `.lrc` / `.json`.
3. **Sincronizar con IA** (servicio local opcional, ver [ai-service/README.md](ai-service/README.md)) o **a mano**: reproduce y pulsa `T` cuando empiece cada línea.
4. Revisa en el editor (tiempo por línea, texto, ±0,1 s, marcar en este instante, insertar/eliminar/unir, deshacer, vista previa con el mismo motor del reproductor) y exporta **LRC**, **LRC por palabra** o **JSON**.

La IA necesita instalar un servicio aparte (Python 3.12, y PyTorch/WhisperX/Demucs para el modo real). Sin instalarlo, el Estudio funciona con sincronización manual; con solo el servicio ligero entra en **modo demostración** (sin IA, rotulado en toda la interfaz y en los archivos exportados).

### Modos de visualización

| Modo | Qué hace |
|---|---|
| Clásico | Portada a la izquierda, letras a la derecha |
| Cinematográfico | Letras centradas y más grandes, controles que se atenúan al estar inactivo |
| Karaoke | Como el anterior, con énfasis en la palabra que se canta. Sin datos de palabra reales usa un reparto **aproximado** y lo rotula así |
| Minimalista | Fondo plano, sin desenfoque, textura ni sombras |
| Portada | La portada como protagonista, letras secundarias |

## Estructura

```
src/app/core/lyrics      Núcleo puro y probado: parsers LRC/lyricsfile, motor de sync, matching
src/app/core/providers   LRCLIB, iTunes, YouTube
src/app/core/services    Reloj, reproducción, sesión, tema dinámico, ajustes
src/app/features         home · search · player · lyrics · visualizer · settings
docs/ARCHITECTURE.md     Arquitectura y decisiones
```

## Limitaciones conocidas

- **Sin audio sin video vinculado** (modo demostración). Reproducción completa solo vía YouTube; no todos los videos permiten incrustarse (se muestra un mensaje claro).
- La **cobertura de letras depende de LRCLIB** (colaborativo). No toda canción tiene letra sincronizada ni sincronía por palabra.
- Las letras de LRCLIB corresponden a una grabación concreta: en videos con intros distintas hay desfase → se avisa («coincidencia no comprobada») y se puede ajustar o elegir otra versión.
- **Experimental, no apto para distribución comercial**: LRCLIB y portadas no implican licencia comercial. Revisa sus términos antes de publicar (no pude leer los de LRCLIB de forma automática).
- **YouTube Data API v3**: la búsqueda y `videos.list` se verificaron con una clave real, y también la forma del error de clave inválida. **No** se provocó en vivo la cuota agotada ni las restricciones regionales (solo respuestas simuladas), ni se confirmó el costo exacto de cuota. LRCLIB, iTunes, MusicBrainz y Cover Art Archive también se verificaron en vivo; ver [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- **MusicBrainz** limita (403) a clientes que no se identifican y responde 503 «ocupado» de forma intermitente; desde un navegador funciona, a más escala conviene un backend. Términos de uso de LRCLIB y MusicBrainz **no revisados**.
- **La IA real (WhisperX/Demucs) no está probada de extremo a extremo**: está escrita contra las firmas reales de sus paquetes, pero requiere instalar varios GB y no se ha ejecutado aquí. Lo demás del servicio (pipeline, confianza, exportadores, API, seguridad) sí está probado.
- Sin cola de reproducción (por eso no hay «anterior/siguiente»); sin cuentas ni favoritos. Hoja de ruta en la documentación.
- Las verificaciones de navegador (escritorio, móvil, modos, errores) fueron manuales; aún no hay pruebas E2E ni de rendimiento automatizadas. **No se ha medido la fluidez (FPS) real**: el panel de pruebas limita `requestAnimationFrame` en segundo plano.
- Al cambiar de canción hay animación de entrada, pero no de salida de la anterior.
- En pantallas de ~768 px de alto, los modos Portada y Clásico con video de YouTube reducen la portada para que el reproductor (obligatorio) quede entero a la vista.
