$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "data\server.pid"

if (-not (Test-Path $pidFile)) {
    exit 0
}

$serverPid = (Get-Content $pidFile -Raw).Trim()
if (-not $serverPid) {
    exit 0
}

try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction Stop
    if ($process -and $process.CommandLine -match "server\.mjs") {
        Stop-Process -Id ([int]$serverPid) -Force -ErrorAction Stop
    }
} catch {
    # Already stopped.
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
