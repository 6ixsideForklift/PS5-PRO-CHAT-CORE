param(
    [string]$SourceEnv = (Join-Path $PSScriptRoot '..\.env')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targetEnv = Join-Path $repoRoot '.env.ps5-dev'

if (Test-Path -LiteralPath $targetEnv) {
    throw "$targetEnv already exists. Remove it explicitly to recreate the development secrets."
}

$settings = Get-Content -LiteralPath $SourceEnv
$changes = @{
    PORT = '3080'
    DOMAIN_CLIENT = 'http://localhost:3081'
    DOMAIN_SERVER = 'http://localhost:3081'
    ADMIN_PANEL_PORT = '3001'
    JWT_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    JWT_REFRESH_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    CREDS_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    CREDS_IV = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
    MEILI_MASTER_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    ADMIN_PANEL_SESSION_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
}

foreach ($name in @($changes.Keys)) {
    $pattern = "^#?\s*$name=.*$"
    $replacement = "$name=$($changes[$name])"
    $matches = @($settings | Where-Object { $_ -match $pattern })
    if ($matches.Count -gt 0) {
        $settings = @($settings | Where-Object { $_ -notmatch $pattern })
    }
    $settings += $replacement
}

[IO.File]::WriteAllLines($targetEnv, $settings)
Write-Output "Created $targetEnv with development ports and fresh local secrets."
