$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = if ($env:TRADE_LICENSE_HOME) { $env:TRADE_LICENSE_HOME } else { Join-Path $env:LOCALAPPDATA 'TradeNotebookIssuer' }
$runtimeFile = Join-Path $dataDirectory 'issuer-runtime.json'
$running = $false
if (Test-Path -LiteralPath $runtimeFile) {
    $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
    try {
        $response = Invoke-WebRequest -Uri $runtime.url -UseBasicParsing -TimeoutSec 3
        $running = $response.StatusCode -eq 200
    } catch { $running = $false }
}
if (-not $running) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $script = Join-Path $PSScriptRoot 'license-admin.cjs'
    $process = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $script) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        Start-Sleep -Milliseconds 200
        if (Test-Path -LiteralPath $runtimeFile) {
            $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
            if ($runtime.pid -eq $process.Id) { $running = $true; break }
        }
        if ($process.HasExited) { throw 'The issuer could not start. Run node scripts/license-admin.cjs to inspect the error.' }
    }
}
if (-not $running) { throw 'Timed out starting the issuer.' }
Start-Process $runtime.url -WindowStyle Hidden
