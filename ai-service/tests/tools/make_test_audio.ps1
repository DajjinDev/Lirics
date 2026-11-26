# Genera audio de prueba PROPIO con verdad conocida (tiempos de inicio de cada palabra).
#
# Usa la síntesis de voz de Windows (System.Speech): el evento SpeakProgress informa de la posición
# exacta de audio en la que empieza cada palabra, que sirve como "verdad" para medir la precisión de
# la alineación. Es HABLA sintética, no canto: valida la mecánica y los tiempos, no el rendimiento
# con música real. El texto es original (no es la letra de ninguna canción).
#
# NOTA: PowerShell 5.1 lee los .ps1 sin BOM como ANSI: los acentos se escriben con [char] para que no se corrompan.
#
# Uso:  powershell -File make_test_audio.ps1 -OutDir <carpeta>

param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null

Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Synthesis;
public static class Tts {
  public static List<string> Run(string voice, string text, string path, int rate) {
    var s = new SpeechSynthesizer();
    s.SelectVoice(voice);
    s.Rate = rate;
    s.SetOutputToWaveFile(path);
    var l = new List<string>();
    s.SpeakProgress += (o, e) => l.Add(e.AudioPosition.TotalMilliseconds.ToString("0.0", CultureInfo.InvariantCulture) + "|" + e.Text);
    s.Speak(text);
    s.SetOutputToNull();
    s.Dispose();
    return l;
  }
}
'@

$sets = @(
  @{ name = 'es'; voice = 'Microsoft Helena Desktop'; lang = 'es'
     lines = @("La noche nos acompa$([char]0xF1)a.", 'Y el tiempo deja de pasar.', 'Bajo la luz de la luna.', 'Volvemos a comenzar.') },
  @{ name = 'en'; voice = 'Microsoft Zira Desktop'; lang = 'en'
     lines = @('I walk alone through the quiet city.', 'The lights are falling down on me.', 'I keep on dreaming of the sea.', 'And you are waiting there for me.') }
)

$truth = @{}
foreach ($s in $sets) {
  $wav = Join-Path $OutDir ("voz-" + $s.name + ".wav")
  $text = ($s.lines -join ' ')
  $ev = [Tts]::Run($s.voice, $text, $wav, 0)
  $words = foreach ($e in $ev) { $p = $e.Split('|', 2); @{ start_ms = [double]$p[0]; text = $p[1] } }
  $truth[$s.name] = @{ lang = $s.lang; lines = $s.lines; words = @($words); wav = $wav }
  Write-Host ("{0}: {1} palabras -> {2}" -f $s.name, @($words).Count, $wav)
}
$truth | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $OutDir 'verdad.json')
Write-Host "verdad.json escrito"
