# Gremlin — One-time setup script
# Run once per machine: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = 'Stop'
$appDir  = $PSScriptRoot
$server  = Join-Path $appDir 'server.ps1'
$appUrl  = 'http://localhost:8090/app/'
$taskName = 'Gremlin Server'

Write-Host ""
Write-Host "  ================================"
Write-Host "    GREMLIN - Setup"
Write-Host "  ================================"
Write-Host ""

# ── 1. Register scheduled task ────────────────────────────────────────────────
Write-Host "  [1/2] Registering scheduled task..."

$action  = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$server`" -NoLaunch"

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit 0 `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action   $action `
    -Trigger  $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "  Done. Task '$taskName' will run at every logon."
Write-Host ""

# ── 2. Desktop shortcut ───────────────────────────────────────────────────────
Write-Host "  [2/2] Creating desktop shortcut..."

$desktop  = [Environment]::GetFolderPath('Desktop')
$lnkPath  = Join-Path $desktop 'Gremlin.lnk'
$wsh      = New-Object -ComObject WScript.Shell
$lnk      = $wsh.CreateShortcut($lnkPath)
$lnk.TargetPath       = $appUrl
$lnk.Description      = 'Gremlin - AMOS Noise Floor Analyzer'
$lnk.WindowStyle      = 1

# Use Chrome if available, otherwise default browser via explorer
$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
    $lnk.TargetPath  = $chrome
    $lnk.Arguments   = "--app=$appUrl"
    $lnk.Description = 'Gremlin - AMOS Noise Floor Analyzer'
}

$lnk.Save()
Write-Host "  Done. Shortcut created on Desktop."
Write-Host ""

# ── 3. Start server now (no reboot needed) ────────────────────────────────────
Write-Host "  Starting server now..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "  ================================"
Write-Host "    Setup complete!"
Write-Host ""
Write-Host "    The server now starts automatically"
Write-Host "    at every Windows logon."
Write-Host ""
Write-Host "    Bookmark: $appUrl"
Write-Host "    Desktop shortcut: Gremlin.lnk"
Write-Host "  ================================"
Write-Host ""

# Open the app
Start-Process $appUrl
