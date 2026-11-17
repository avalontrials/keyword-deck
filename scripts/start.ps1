$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root "data"
$port = 4318
$healthUrl = "http://127.0.0.1:$port/api/health"
$node = (Get-Command node.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

function Test-DeckHealth {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return $response.ok -eq $true -and $response.app -eq "Keyword Deck"
    } catch {
        return $false
    }
}

function Show-ErrorPopup([string]$message) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup($message, 0, "Keyword Deck", 16)
    } catch {
        Write-Error $message
    }
}

if (-not (Test-DeckHealth)) {
    $stdout = Join-Path $dataDir "server.out.log"
    $stderr = Join-Path $dataDir "server.err.log"
    Start-Process -FilePath $node `
        -ArgumentList "server.mjs" `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-DeckHealth) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        $details = ""
        if (Test-Path $stderr) {
            $details = (Get-Content $stderr -Raw -ErrorAction SilentlyContinue)
        }
        Show-ErrorPopup "Keyword Deck could not start its local server.`n`n$details`n`nTry running 'npm start' in:`n$root"
        exit 1
    }
}

$appUrl = "http://127.0.0.1:$port"
$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browser = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
    $profile = Join-Path $dataDir "browser-profile"
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $browserArgs = @(
        "--app=$appUrl",
        "--window-size=1440,960",
        "--window-position=110,60",
        "--user-data-dir=$profile",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
        "--disable-session-crashed-bubble"
    )
    Start-Process -FilePath $browser -ArgumentList $browserArgs | Out-Null
} else {
    Start-Process $appUrl | Out-Null
}

