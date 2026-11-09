$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$log = Join-Path $project '.ps5-startup.log'

function Write-StartupLog([string] $message) {
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $message"
}

try {
    Write-StartupLog 'Starting PS5 PRO CHAT'
    & (Join-Path $PSScriptRoot 'start-windows-host-mcp.ps1') |
        ForEach-Object { Write-StartupLog $_ }

    $docker = (Get-Command docker -ErrorAction Stop).Source
    $dockerDesktop = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
    & $docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        if (-not (Test-Path -LiteralPath $dockerDesktop)) {
            throw "Docker Desktop was not found at $dockerDesktop"
        }
        Write-StartupLog 'Launching Docker Desktop'
        Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        & $docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 3
    }
    if (-not $ready) { throw 'Docker Desktop did not become ready within 5 minutes' }

    Push-Location $project
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $docker compose --env-file .env.ps5-dev -f docker-compose.yml `
                -f docker-compose.ps5-dev.yml up -d --no-build --pull never 2>&1 |
                ForEach-Object { Write-StartupLog "Docker: $_" }
            $composeExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        if ($composeExitCode -ne 0) { throw "Docker Compose failed with exit code $composeExitCode" }
    } finally {
        Pop-Location
    }
    Write-StartupLog 'PS5 PRO CHAT is running at http://localhost:3081/'
} catch {
    Write-StartupLog "Startup failed: $($_.Exception.Message)"
    throw
}
