$ErrorActionPreference = 'Stop'
$bin = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

function Have($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Path (Join-Path $bin 'yt-dlp.exe')) -and -not (Have 'yt-dlp')) {
  Write-Host 'downloading yt-dlp...'
  Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $bin 'yt-dlp.exe')
}

$haveFfmpeg = $false
$haveMp3 = $false
$ffmpegCmd = Get-Command 'ffmpeg' -ErrorAction SilentlyContinue
if ($ffmpegCmd) {
  $haveFfmpeg = $true
  try {
    $encoders = & $ffmpegCmd.Source -hide_banner -encoders 2>$null
    $haveMp3 = [bool]($encoders | Select-String -Pattern 'libmp3lame')
  } catch {}
}

if (-not (Test-Path (Join-Path $bin 'ffmpeg.exe')) -and (-not $haveFfmpeg -or -not $haveMp3)) {
  Write-Host 'downloading ffmpeg (with MP3 support)...'
  $zip = Join-Path $env:TEMP ('downrabbit-ffmpeg-' + [guid]::NewGuid().ToString('N') + '.zip')
  $tmp = Join-Path $env:TEMP ('downrabbit-ffmpeg-' + [guid]::NewGuid().ToString('N'))
  Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $ffmpeg = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
  $ffprobe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
  if (-not $ffmpeg) { throw 'ffmpeg.exe was not found in the archive' }
  Copy-Item $ffmpeg.FullName (Join-Path $bin 'ffmpeg.exe') -Force
  if ($ffprobe) { Copy-Item $ffprobe.FullName (Join-Path $bin 'ffprobe.exe') -Force }
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zip -Force
}

Write-Host ''
Write-Host 'ready. start the bridge with:'
Write-Host '  .\start.ps1'
