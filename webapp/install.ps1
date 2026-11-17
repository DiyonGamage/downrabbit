# downrabbit installer for Windows 10/11
#   powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://downrabbit.pages.dev/install.ps1 | iex"
# installs into %LOCALAPPDATA%\downrabbit and puts "downr" on your PATH. no admin needed.
param([string]$Base = '', [string]$InstallDir = '', [switch]$SkipPath)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

if (-not $Base) {
  $Base = if ($env:DOWNRABBIT_BASE) { $env:DOWNRABBIT_BASE } else { 'https://github.com/DiyonGamage/downrabbit/releases/latest/download' }
}
$Base = $Base.TrimEnd('/')
if (-not $InstallDir) {
  $InstallDir = if ($env:DOWNRABBIT_DIR) { $env:DOWNRABBIT_DIR } else {
    $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
    Join-Path $local 'downrabbit'
  }
}
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$binDir = Join-Path $InstallDir 'bin'
$shim = Join-Path $binDir 'downr.cmd'
$zipUrl = "$Base/downrabbit-portable.zip"

Write-Host ''
Write-Host 'downrabbit' -ForegroundColor Yellow
Write-Host 'download anything with one command.' -ForegroundColor DarkGray
Write-Host ''
Write-Host "installing to $InstallDir"
Write-Host 'downloading the engine (about 120 MB - a few minutes on slow internet)...'

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('downrabbit-' + [guid]::NewGuid().ToString('n'))
$tmpZip = Join-Path $tmp 'engine.zip'
$tmpDir = Join-Path $tmp 'engine'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing
  $mb = [math]::Round((Get-Item $tmpZip).Length / 1MB)
  Write-Host "downloaded ($mb MB), unpacking..."

  Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
  $src = $tmpDir
  $inner = Get-ChildItem $tmpDir -Directory
  if ($inner.Count -eq 1 -and (Test-Path (Join-Path $inner[0].FullName 'node.exe'))) { $src = $inner[0].FullName }
  if (-not (Test-Path (Join-Path $src 'node.exe'))) { throw 'the download did not contain the engine files' }

  New-Item -ItemType Directory -Force -Path $InstallDir, $binDir | Out-Null
  # files from the retired browser-app install; safe to remove on upgrade
  foreach ($old in @('Downrabbit.cmd', 'Downrabbit-console.cmd', 'Downrabbit-hidden.vbs', 'install-autostart.cmd', 'remove-autostart.cmd', 'allow-firewall.cmd', 'start.cmd', 'start.ps1', 'start.sh', 'termux.sh')) {
    $p = Join-Path $InstallDir $old
    if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue }
  }
  $oldWeb = Join-Path $InstallDir 'webapp'
  if (Test-Path $oldWeb) { Remove-Item $oldWeb -Recurse -Force -ErrorAction SilentlyContinue }
  $copied = $false
  for ($i = 1; $i -le 3 -and -not $copied; $i++) {
    try {
      Get-ChildItem $src -Force | ForEach-Object { Copy-Item $_.FullName -Destination $InstallDir -Recurse -Force }
      $copied = $true
    } catch {
      if ($i -eq 3) { throw }
      Start-Sleep -Seconds 1
    }
  }

  $nodeExe = Join-Path $InstallDir 'node.exe'
  $downrJs = Join-Path $InstallDir 'bridge\downr.js'
  # a literal % in the install path must be %% inside a batch file
  $lines = @(
    '@echo off',
    ('"' + $nodeExe.Replace('%', '%%') + '" "' + $downrJs.Replace('%', '%%') + '" %*')
  )
  Set-Content -Path $shim -Value $lines -Encoding ASCII

  if (-not $SkipPath -and -not $env:DOWNRABBIT_SKIP_PATH) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($userPath) { $parts = @($userPath.Split(';') | Where-Object { $_ }) }
    if ($parts -notcontains $binDir) {
      [Environment]::SetEnvironmentVariable('Path', (($parts + $binDir) -join ';'), 'User')
    }
  }

  $check = & $shim --help 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw ('the installed command did not run: ' + $check.Trim()) }
} catch {
  Write-Host ''
  Write-Host ('install failed: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'check your internet connection and try again. if the downrabbit app is open, close it first.'
  exit 1
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'installed. open a NEW terminal window, then type:' -ForegroundColor Green
Write-Host ''
Write-Host '    downr https://youtu.be/jNQXAC9IVRw'
Write-Host ''
Write-Host 'or just type "downr" and paste a link when it asks.'
Write-Host 'files go to your Downloads folder. -q 1080 / -m / -o "D:\Videos" change that.'
Write-Host ''
Write-Host 'to remove it later, delete this folder and drop it from your PATH:'
Write-Host "    $InstallDir"
