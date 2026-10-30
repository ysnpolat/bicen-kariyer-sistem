<#
    index.html icindeki <meta name="api-taban" content="..."> etiketine
    API yolunu yazar. Yayinlama betigi tarafindan cagrilir.

    Kullanim:
      powershell -NoProfile -ExecutionPolicy Bypass -File api-yolu-yaz.ps1 `
        -Dosya "bicen-kariyer\dist\index.html" -Yol "/apiservis"
#>
param(
    [Parameter(Mandatory = $true)][string]$Dosya,
    [Parameter(Mandatory = $true)][string]$Yol
)

if (-not (Test-Path -LiteralPath $Dosya)) {
    Write-Error "Dosya bulunamadi: $Dosya"
    exit 1
}

$icerik = Get-Content -LiteralPath $Dosya -Raw -Encoding UTF8

$desen = 'name="api-taban"\s+content="[^"]*"'
$yenisi = 'name="api-taban" content="' + $Yol + '"'

if ($icerik -match $desen) {
    $icerik = [regex]::Replace($icerik, $desen, $yenisi)
} else {
    # Etiket yoksa </head> oncesine ekle
    $icerik = $icerik -replace '</head>', ('  <meta ' + $yenisi + ' />' + "`r`n  </head>")
}

Set-Content -LiteralPath $Dosya -Value $icerik -Encoding UTF8 -NoNewline
Write-Output "API yolu yazildi: $Yol"
exit 0
