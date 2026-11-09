$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$pausedFile = Join-Path $project '.ps5-screen-paused'
if (Test-Path -LiteralPath $pausedFile) {
    Remove-Item -LiteralPath $pausedFile
}
Write-Output 'PS5 Pro Operator screen control can be started again.'
