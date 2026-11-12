$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js 18+ is required: https://nodejs.org'
  exit 1
}

node (Join-Path $PSScriptRoot 'server.js')
