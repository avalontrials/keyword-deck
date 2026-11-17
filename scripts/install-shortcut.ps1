$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root "assets\keyword-deck.ico"
$launcher = Join-Path $root "Keyword Deck.vbs"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Keyword Deck.lnk"

if (-not (Test-Path $launcher)) {
    throw "Launcher not found: $launcher"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$shortcut.Arguments = "`"$launcher`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Keyword Deck - a local keyword search desk"
if (Test-Path $icon) {
    $shortcut.IconLocation = "$icon,0"
}
$shortcut.WindowStyle = 1
$shortcut.Save()

$null = $shell.Popup("Keyword Deck shortcut created on the desktop.", 4, "Keyword Deck", 64)
