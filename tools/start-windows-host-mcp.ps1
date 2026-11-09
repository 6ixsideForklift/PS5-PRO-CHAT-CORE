$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$settings = Join-Path $project '.ps5-windows-mcp.json'
if (-not (Test-Path -LiteralPath $settings)) {
    throw 'Private MCP settings are missing. Set them up before starting the helper.'
}

$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*windows-host-mcp.mjs*' }
if ($existing) {
    Write-Output "Windows MCP helper already running (PID $($existing[0].ProcessId))."
    return
}

$node = (Get-Command node -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList 'tools/windows-host-mcp.mjs' `
    -WorkingDirectory $project -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $project '.ps5-windows-mcp.log') `
    -RedirectStandardError (Join-Path $project '.ps5-windows-mcp.err') -PassThru
Write-Output "Windows MCP helper started (PID $($process.Id))."
