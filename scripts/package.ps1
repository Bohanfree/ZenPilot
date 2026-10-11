$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectPath 'dist'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
& node (Join-Path $PSScriptRoot 'build.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Browser build failed' }
$manifestData = Get-Content -LiteralPath (Join-Path $projectPath 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($target in @('chrome', 'firefox')) {
  $archivePath = Join-Path $outputPath ('zenpilot-' + $manifestData.version + '-' + $target + '.zip')
  Compress-Archive -Path (Join-Path $projectPath ('build\' + $target + '\*')) -DestinationPath $archivePath -Force
  Write-Output $archivePath
}
