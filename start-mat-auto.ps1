$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$siteUrl = "http://127.0.0.1:4010/"
$healthUrl = "http://127.0.0.1:4010/api/health"

function Test-MatAutoServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-MatAutoServer)) {
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null

    $ready = $false
    foreach ($attempt in 1..20) {
        Start-Sleep -Milliseconds 500
        if (Test-MatAutoServer) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        throw "MAT Auto server did not start on $siteUrl"
    }
}

Start-Process $siteUrl | Out-Null
Write-Host "MAT Auto is running at $siteUrl"
