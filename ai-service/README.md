# Liriks AI — servicio de sincronización de letras (Fase 3)

Servicio **opcional e independiente** (Python / FastAPI) que genera marcas de tiempo por palabra para una canción **cuyo audio tienes derecho a procesar**. Si no está en marcha, el resto de Liriks sigue funcionando (el Estudio ofrece entonces la sincronización manual).

## Qué hace

```
audio (tuyo/autorizado)
   │  ffprobe valida el CONTENIDO · ffmpeg → WAV 16 kHz mono
   ▼
[opcional] Demucs: separa la voz
   ▼
 ┌─ con letra aportada ──► alineación forzada (WhisperX/wav2vec2)   ← la opción más precisa
 └─ sin letra ───────────► transcripción (Whisper) + alineación por palabra
   ▼
postproceso: tiempos faltantes interpolados · líneas · confianza · silencios medidos · pausas
   ▼
JSON / LRC / LRC por palabra  (se pueden editar y reimportar en el Estudio de Liriks)
```

Plan B automático si la alineación forzada se queda sin memoria (audios largos): se transcribe y se copian los tiempos a la letra aportada (emparejado de texto). Si el idioma no tiene alineador por palabra, se usan tiempos por segmento y **se avisa**.

## Política y seguridad

- **Solo audio autorizado.** La API exige `rights_confirmed=true` y no existe ningún parámetro de URL: **no descarga nada de internet, ni de YouTube**.
- Escucha en `127.0.0.1` por defecto; CORS limitado a `http://localhost:4200` (`LIRIKS_AI_ORIGINS`).
- El contenido se valida con `ffprobe` (no por extensión); límite de tamaño (100 MB), duración (15 min) y letra (40 000 caracteres).
- El nombre del archivo del cliente **nunca** toca el disco; ffmpeg se invoca sin shell.
- **El audio no se conserva**: el original se borra al convertirlo y todo el directorio de trabajo al terminar. Los resultados viven en memoria 30 min.
- Sin autenticación: está pensado para uso local. Si lo expones en red, ponlo detrás de un proxy con autenticación.

## Instalación

Requiere Python **3.12** y `ffmpeg`/`ffprobe` en el PATH.

```powershell
cd ai-service
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest            # 77 pruebas (no necesitan modelos)
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Con solo eso el servicio arranca en **modo demostración** (`backend: fake`): reparte palabras de forma uniforme, **no usa IA** y todo resultado se rotula `demo` en la API, en el LRC (`[by:DEMO …]`) y en la interfaz. Sirve para probar el flujo.

### IA real (WhisperX + Demucs)

Lee [requirements-ml.txt](requirements-ml.txt): primero PyTorch con CUDA, luego `pip install -r requirements-ml.txt`. Pesa varios GB. Con `LIRIKS_AI_BACKEND=auto` (por defecto) el servicio usa WhisperX en cuanto está instalado.

> **Estado de verificación**: la lógica de IA está escrita contra las firmas reales de whisperx 3.8.6 y demucs 4.1.0 (leídas del código de sus ruedas), pero **sus rutas de inferencia aún no se han ejecutado** en este repositorio; lo que sí está probado es todo lo demás (ver «Pruebas»). Consulta el README principal para el estado actual.

## Configuración (variables de entorno)

| Variable | Defecto | Descripción |
|---|---|---|
| `LIRIKS_AI_BACKEND` | `auto` | `auto` · `fake` (demostración) · `whisperx` |
| `LIRIKS_AI_HOST` / `LIRIKS_AI_PORT` | `127.0.0.1` / `8765` | (para `python -m app`) |
| `LIRIKS_AI_ORIGINS` | `http://localhost:4200,http://127.0.0.1:4200` | Orígenes CORS permitidos |
| `LIRIKS_AI_MODEL` | `small` | `tiny` · `base` · `small` · `medium` · `large-v3` |
| `LIRIKS_AI_DEVICE` | `auto` | `auto` · `cuda` · `cpu` |
| `LIRIKS_AI_BATCH_SIZE` | `4` | Bajo para 6 GB de VRAM |
| `LIRIKS_AI_MAX_UPLOAD_MB` / `_MAX_DURATION_S` | `100` / `900` | Límites |
| `LIRIKS_AI_JOB_TTL_S` | `1800` | Caducidad de resultados |
| `LIRIKS_AI_WORK_DIR` | temp del sistema | Trabajos temporales |

Con una GPU de 6 GB usa `small` o `medium` (float16). `large-v3` se carga en `int8_float16` automáticamente.

## API

Documentación interactiva en `http://127.0.0.1:8765/docs`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado, backend, ffmpeg, dispositivo, límites |
| POST | `/jobs` | `multipart/form-data`: `audio` (archivo), `rights_confirmed` (**obligatorio `true`**), `lyrics_text`, `language`, `separate_vocals`, `model_size`, `title`, `artist` → `202 {id}` |
| GET | `/jobs/{id}` | `state`, `stage`, `progress` 0–1, `message`, `error`, `result` |
| GET | `/jobs/{id}/export?format=lrc\|lrc-enhanced\|json` | Descarga |
| DELETE | `/jobs/{id}` | Cancela (si corre) o elimina el resultado |

Un solo trabajo se procesa a la vez (la GPU es compartida); el resto espera en cola.

## Confianza y avisos

Todo indicador es **medible**; no se simula entender la canción:

| Señal | Origen |
|---|---|
| Confianza por palabra | Puntuación del alineador (0–1); las palabras con tiempo estimado valen 0,2 |
| Confianza por línea / global | Media; la global ponderada por duración |
| `low_confidence` | Línea < 0,5 |
| `interpolated_words` | Palabras sin tiempo propio (interpoladas entre vecinas) |
| `fast_speech` | > 7 palabras/s (rap, parte rápida) |
| `in_silence` | La línea cae ≥ 60 % sobre silencio **medido** en la pista de voz (requiere separar la voz) |
| `repetition` | 3+ líneas idénticas seguidas (síntoma de alucinación de Whisper en tramos sin voz) |
| `breaks` | Silencios medidos (con voz separada) o huecos grandes entre líneas |

### Dificultades conocidas (lo que NO se puede detectar bien)

Voces superpuestas, coros, auto-tune, reverberación, gritos y cambios de idioma reducen la precisión y **no tienen un detector propio**: se manifiestan indirectamente como baja confianza o tiempos interpolados. Alinear una letra aportada suele ser mucho más fiable que transcribir. Whisper y su VAD están pensados para habla: en música densa pueden **omitir** tramos cantados; separar la voz con Demucs ayuda. Siempre hay que revisar el resultado en el Estudio.

## Estructura

```
app/
  main.py            rutas, validación, CORS, límites
  jobs.py            cola de 1 trabajador, progreso, cancelación, limpieza
  pipeline.py        etapas y avisos
  audio.py           ffprobe / ffmpeg / silencedetect
  postprocess.py     PURO: interpolación, líneas, confianza, silencios
  alignment_text.py  PURO: letra aportada ↔ palabras alineadas
  exporters.py       PURO: LRC / LRC enhanced / JSON
  backends/          base (contratos) · fake · whisperx_backend
tests/               77 pruebas: lógica pura, audio sintético real con ffmpeg, API completa
```

Añadir otro modelo o separador = implementar `Backend` (`backends/base.py`); el pipeline y la API no cambian.

## Pruebas

`python -m pytest` — lógica pura (interpolación, agrupación, confianza, exportadores), audio sintético real generado con ffmpeg (detección de silencios verificada), y la API completa con el backend de demostración (derechos obligatorios, rechazo de archivos que no son audio, límite de tamaño, CORS, borrado del audio, nombres maliciosos, ausencia de parámetros de URL). La compatibilidad del formato con el editor de Liriks se comprueba con fixtures generados por este servicio.
