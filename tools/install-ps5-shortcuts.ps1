$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $PSScriptRoot 'ps5-pro-chat.ico'
$startupScript = Join-Path $PSScriptRoot 'start-ps5-pro-chat.ps1'
$shell = New-Object -ComObject WScript.Shell

$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'PS5 PRO CHAT Startup.lnk'
$startup = $shell.CreateShortcut($startupLink)
$startup.TargetPath = Join-Path $PSHOME 'powershell.exe'
$startup.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startupScript`""
$startup.WorkingDirectory = $project
$startup.IconLocation = "$icon,0"
$startup.Description = 'Start PS5 PRO CHAT and private laptop tools after Windows sign-in'
$startup.Save()

$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PS5 PRO CHAT.lnk'
$desktop = $shell.CreateShortcut($desktopLink)
$desktop.TargetPath = Join-Path $env:WINDIR 'explorer.exe'
$desktop.Arguments = 'http://localhost:3081/'
$desktop.WorkingDirectory = $project
$desktop.IconLocation = "$icon,0"
$desktop.Description = 'Open PS5 PRO CHAT on this laptop'
$desktop.Save()

Write-Output "Installed startup shortcut: $startupLink"
Write-Output "Installed desktop shortcut: $desktopLink"
