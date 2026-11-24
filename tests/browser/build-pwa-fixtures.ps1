param([string]$Baseline = 'c475c43')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$target = Join-Path $root ('pwa-fixture-' + [guid]::NewGuid() + '.local')
$utf8 = [Text.UTF8Encoding]::new($false)

Push-Location -LiteralPath $root
try {
  $configOld = (git show "${Baseline}:vite.config.js") -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'Configuração da versão anterior indisponível.' }
  $mainOld = (git show "${Baseline}:src/main.jsx") -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'Entrada da versão anterior indisponível.' }
  $manifest = (git show HEAD:package.json) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'Manifesto rastreado indisponível.' }
  $configNew = [IO.File]::ReadAllText((Join-Path $root 'vite.config.js'))
  $mainNew = [IO.File]::ReadAllText((Join-Path $root 'src/main.jsx'))
  New-Item -ItemType Directory -Path $target | Out-Null
  Copy-Item -LiteralPath @('src', 'public', 'admin', 'scripts') -Destination $target -Recurse
  $checks = Join-Path $target 'checks'
  New-Item -ItemType Directory -Path $checks | Out-Null
  $unitTests = Get-ChildItem -LiteralPath 'tests' -File -Filter '*.test.js' | ForEach-Object {
    $copy = Join-Path $checks ($_.Name -replace '\.test\.js$', '.mjs')
    Copy-Item -LiteralPath $_.FullName -Destination $copy
    $copy
  }
  Copy-Item -LiteralPath @('index.html', 'package-lock.json', '.oxlintrc.json') -Destination $target
  [IO.File]::WriteAllText((Join-Path $target 'package.json'), $manifest, $utf8)
} finally { Pop-Location }

$oldUrl = $env:VITE_SUPABASE_URL
$oldKey = $env:VITE_SUPABASE_PUBLISHABLE_KEY
Push-Location -LiteralPath $target
try {
  $env:VITE_SUPABASE_URL = 'http://127.0.0.1:59887'
  $env:VITE_SUPABASE_PUBLISHABLE_KEY = 'local-test-placeholder'
  npm.cmd ci --offline --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Instalação limpa falhou.' }
  node --test @unitTests
  if ($LASTEXITCODE -ne 0) { throw 'Testes Node falharam.' }

  foreach ($version in @('antigo', 'B', 'C')) {
    $config = if ($version -eq 'antigo') { $configOld } else { $configNew }
    $main = if ($version -eq 'antigo') { $mainOld } else { $mainNew }
    [IO.File]::WriteAllText((Join-Path $target 'vite.config.js'), $config, $utf8)
    $marker = "globalThis.__SAL_TEST_BUILD = '$version'"
    [IO.File]::WriteAllText((Join-Path $target 'src/main.jsx'), ($main + "`n" + $marker + "`n"), $utf8)
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Build $version falhou." }
    Copy-Item -LiteralPath (Join-Path $target 'dist') -Destination (Join-Path $target $version) -Recurse
  }
  Write-Output "Fixtures prontas em $target"
} finally {
  $env:VITE_SUPABASE_URL = $oldUrl
  $env:VITE_SUPABASE_PUBLISHABLE_KEY = $oldKey
  Pop-Location
}
