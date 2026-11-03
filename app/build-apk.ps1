param(
  [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$moduleRoot = Join-Path $projectRoot 'app'
$buildTools = Join-Path $SdkRoot 'build-tools\36.1.0'
$androidJar = Join-Path $SdkRoot 'platforms\android-36\android.jar'
$javaHomePath = 'C:\Program Files\Android\Android Studio\jbr'
if (-not (Test-Path $javaHomePath)) { throw 'No encuentro el JDK incluido con Android Studio.' }
if (-not (Test-Path $androidJar)) { throw "No encuentro Android SDK Platform 36 en $SdkRoot. Instálalo desde Android Studio > Tools > SDK Manager." }
$env:JAVA_HOME = $javaHomePath
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:TEMP = Join-Path $projectRoot '.tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$javaBin = Join-Path $javaHomePath 'bin'
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$javac = Join-Path $javaBin 'javac.exe'
$jar = Join-Path $javaBin 'jar.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$intermediate = Join-Path $moduleRoot 'build\manual'
$apkOut = Join-Path $moduleRoot 'build\outputs\apk\debug'
New-Item -ItemType Directory -Force $intermediate,$apkOut | Out-Null

& $aapt2 compile -o $intermediate (Join-Path $moduleRoot 'src\main\res\drawable\ic_launcher.xml')
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación del icono Android.' }
$flat = Join-Path $intermediate 'drawable_ic_launcher.xml.flat'
& $aapt2 link -o (Join-Path $intermediate 'unsigned.apk') -I $androidJar `
  --manifest (Join-Path $moduleRoot 'src\main\AndroidManifest.xml') `
  --java (Join-Path $intermediate 'generated') --min-sdk-version 33 --target-sdk-version 35 `
  --version-code 1 --version-name 1.0 -R $flat `
  -A (Join-Path $moduleRoot 'src\main\assets')
if ($LASTEXITCODE -ne 0) { throw 'Falló el empaquetado de recursos Android.' }

$classDir = Join-Path $intermediate 'classes'
New-Item -ItemType Directory -Force $classDir | Out-Null
& $javac -source 8 -target 8 -classpath $androidJar -d $classDir (Join-Path $moduleRoot 'src\main\java\com\saltoestelar\app\MainActivity.java')
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de MainActivity.' }
$classesJar = Join-Path $intermediate 'classes.jar'
& $jar cf $classesJar -C $classDir .
if ($LASTEXITCODE -ne 0) { throw 'Falló la creación del archivo de clases.' }
$dexDir = Join-Path $intermediate 'dex'
New-Item -ItemType Directory -Force $dexDir | Out-Null
& $d8 --min-api 23 --lib $androidJar --output $dexDir $classesJar
if ($LASTEXITCODE -ne 0) { throw 'Falló la conversión de clases a DEX.' }
$unsignedDexApk = Join-Path $intermediate 'unsigned-dex.apk'
Copy-Item (Join-Path $intermediate 'unsigned.apk') $unsignedDexApk -Force
& $jar uf $unsignedDexApk -C $dexDir classes.dex
if ($LASTEXITCODE -ne 0) { throw 'Falló la incorporación de código DEX al APK.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$normalizedApk = Join-Path $intermediate 'normalized.apk'
if (Test-Path $normalizedApk) { Remove-Item -LiteralPath $normalizedApk -Force }
$sourceZip = [System.IO.Compression.ZipFile]::OpenRead($unsignedDexApk)
$targetZip = [System.IO.Compression.ZipFile]::Open($normalizedApk, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($entry in $sourceZip.Entries) {
    $entryName = $entry.FullName.Replace('\', '/')
    $targetEntry = $targetZip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $sourceStream = $entry.Open()
    $targetStream = $targetEntry.Open()
    try { $sourceStream.CopyTo($targetStream) } finally { $targetStream.Dispose(); $sourceStream.Dispose() }
  }
} finally { $targetZip.Dispose(); $sourceZip.Dispose() }
$alignedApk = Join-Path $intermediate 'aligned.apk'
& $zipalign -f -p 4 $normalizedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw 'Falló la alineación del APK.' }
$keystore = Join-Path $env:USERPROFILE '.android\debug.keystore'
if (-not (Test-Path $keystore)) { throw 'Android Studio aún no creó la llave debug.keystore. Abre Android Studio una vez y vuelve a ejecutar este script.' }
$outputApk = Join-Path $apkOut 'app-debug.apk'
& $apksigner sign --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --ks $keystore --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out $outputApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw 'Falló la firma del APK.' }
& $apksigner sign --min-sdk-version 23 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --ks $keystore --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out $outputApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw 'Falló la firma del APK.' }
& $apksigner verify --verbose $outputApk
if ($LASTEXITCODE -ne 0) { throw 'La verificación de firma del APK falló.' }
$shareApk = Join-Path $projectRoot 'SaltoEstelar-Android13+.apk'
Copy-Item $outputApk $shareApk -Force
Write-Host "APK listo: $shareApk"
