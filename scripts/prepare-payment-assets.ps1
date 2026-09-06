param([Parameter(Mandatory = $true)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$destination = Join-Path (Split-Path -Parent $PSScriptRoot) 'site/assets/payments'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$assets = @(
    @{ Source = '19.9.jpg'; Name = 'wechat-month'; X = 270; Y = 415; Size = 580 },
    @{ Source = '199.jpg'; Name = 'wechat-forever'; X = 270; Y = 415; Size = 580 },
    @{ Source = '客服.jpg'; Name = 'wechat-support'; X = 90; Y = 330; Size = 640 }
)
foreach ($asset in $assets) {
    $sourcePath = Join-Path $SourceDirectory $asset.Source
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $destination ($asset.Name + '.jpg'))
    $bitmap = [System.Drawing.Bitmap]::new($sourcePath)
    try {
        # Retain every QR module, the center logo and a generous quiet zone.
        $rectangle = [System.Drawing.Rectangle]::new($asset.X, $asset.Y, $asset.Size, $asset.Size)
        $cropped = $bitmap.Clone($rectangle, $bitmap.PixelFormat)
        try {
            $cropped.Save((Join-Path $destination ($asset.Name + '-qr.png')), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $cropped.Dispose() }
    } finally { $bitmap.Dispose() }
}
Write-Output 'Payment originals and QR display crops prepared.'
