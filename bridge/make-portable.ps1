$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $PSScriptRoot 'bin'
$out = Join-Path $root 'dist\downrabbit-portable'
$zip = Join-Path $root 'dist\downrabbit-portable.zip'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path $node)) { throw 'node.exe not found. install Node.js, or drop a node.exe next to this script.' }

foreach ($t in @('yt-dlp.exe', 'ffmpeg.exe')) {
  if (-not (Test-Path (Join-Path $bin $t))) { throw "missing bridge/bin/$t - run bridge/setup.ps1 first" }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $out 'bridge\bin') | Out-Null

Copy-Item $node (Join-Path $out 'node.exe')
Copy-Item (Join-Path $PSScriptRoot 'server.js') (Join-Path $out 'bridge\server.js')
Copy-Item (Join-Path $PSScriptRoot 'package.json') (Join-Path $out 'bridge\package.json')
Copy-Item (Join-Path $PSScriptRoot 'downr.js') (Join-Path $out 'bridge\downr.js')
Copy-Item (Join-Path $PSScriptRoot 'install-cli.cmd') (Join-Path $out 'install-cli.cmd')
Copy-Item (Join-Path $PSScriptRoot 'remove-cli.cmd') (Join-Path $out 'remove-cli.cmd')
Copy-Item (Join-Path $bin 'yt-dlp.exe') (Join-Path $out 'bridge\bin')
Copy-Item (Join-Path $bin 'ffmpeg.exe') (Join-Path $out 'bridge\bin')

$cli = @'
@echo off
"%~dp0node.exe" "%~dp0bridge\downr.js" %*
'@
Set-Content -Path (Join-Path $out 'downr.cmd') -Value $cli -Encoding ASCII

$readme = @'
Downrabbit - download anything, one command
===========================================

This folder is the whole downloader. No install required to use it here:

  downr.cmd "https://youtu.be/..."     saves best quality to Downloads
  downr.cmd                            asks for a link
  downr.cmd "..." -q 1080              pick a quality
  downr.cmd "..." -m                   audio -> mp3
  downr.cmd "..." -o "D:\Videos"       choose the folder
  downr.cmd --help                     all options

Want the short command everywhere? Run install-cli.cmd once (no admin) and
type "downr" from any terminal. remove-cli.cmd undoes it.

Copy this whole folder to any other Windows 10/11 PC and run install-cli.cmd
there - each copy is its own isolated engine.

Licenses: Node.js (MIT), yt-dlp (Unlicense), ffmpeg (GPL build, separate
executable). Source: https://github.com/DiyonGamage/downrabbit
'@
Set-Content -Path (Join-Path $out 'README.txt') -Value $readme -Encoding ASCII

$notices = @'
Bundled components
- node.exe: Node.js, MIT license - https://github.com/nodejs/node/blob/main/LICENSE
- yt-dlp.exe: Unlicense - https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE
- ffmpeg.exe: GPL build - https://ffmpeg.org/legal.html
- downrabbit: Apache-2.0 - https://github.com/DiyonGamage/downrabbit
'@
Set-Content -Path (Join-Path $out 'LICENSES.txt') -Value $notices -Encoding ASCII

if (Test-Path $zip) { Remove-Item $zip -Force }
for ($i = 1; $i -le 3; $i++) {
  try { Compress-Archive -Path $out -DestinationPath $zip -CompressionLevel Optimal; break }
  catch {
    if ($i -eq 3) { throw }
    Start-Sleep -Seconds 3
  }
}

$size = [math]::Round((Get-ChildItem $out -Recurse | Measure-Object Length -Sum).Sum / 1MB)
$zsize = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host ''
Write-Host "portable engine: $out"
Write-Host "zip:             $zip  ($zsize MB)"
Write-Host "folder size:     $size MB"
