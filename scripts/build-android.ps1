param([switch]$SkipWebBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

# Use an existing SDK/JDK, or the project-adjacent tools prepared for this build.
$localTools = Join-Path (Split-Path -Parent $projectRoot) 'Notelin-toolchain'
if (!$env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $localTools 'jdk'))) {
    $env:JAVA_HOME = (Get-ChildItem -Directory -LiteralPath (Join-Path $localTools 'jdk') | Select-Object -First 1).FullName
}
if (!$env:ANDROID_HOME) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
    if (Test-Path -LiteralPath $candidate) { $env:ANDROID_HOME = $candidate }
    else { $env:ANDROID_HOME = Join-Path $localTools 'sdk' }
}
if (!(Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/keytool.exe'))) { throw 'JDK 21 is required. Set JAVA_HOME.' }
if (!(Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms/android-36/android.jar'))) { throw 'Android SDK 36 is required. Set ANDROID_HOME.' }
('sdk.dir=' + $env:ANDROID_HOME.Replace('\','/').Replace(':','\:')) | Set-Content -LiteralPath 'android/local.properties' -Encoding ascii

# This key stays outside the repository. Reuse it for every published update.
$signingDirectory = Join-Path $env:USERPROFILE '.notelin'
$signingFile = Join-Path $signingDirectory 'android-signing.properties'
if (!(Test-Path -LiteralPath $signingFile)) {
    New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
    $keystoreFile = Join-Path $signingDirectory 'notelin-release.p12'
    if (Test-Path -LiteralPath $keystoreFile) { throw 'An existing signing key needs its original properties file. Do not replace it.' }
    $randomBytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $generator.GetBytes($randomBytes); $generator.Dispose()
    $env:NOTELIN_KEYSTORE_PASSWORD = [Convert]::ToBase64String($randomBytes)
    try {
        & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keystoreFile -storetype PKCS12 -alias notelin -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Notelin' -storepass:env NOTELIN_KEYSTORE_PASSWORD -keypass:env NOTELIN_KEYSTORE_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Could not create signing key.' }
        @("storeFile=$($keystoreFile.Replace('\','/'))", "storePassword=$env:NOTELIN_KEYSTORE_PASSWORD", 'keyAlias=notelin', "keyPassword=$env:NOTELIN_KEYSTORE_PASSWORD") | Set-Content -LiteralPath $signingFile -Encoding ascii
    } finally { Remove-Item Env:NOTELIN_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue }
}
$env:NOTELIN_SIGNING_PROPERTIES = $signingFile
if (!$SkipWebBuild) {
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Android web build failed.' }
}
& node scripts/prepare-android.mjs
if ($LASTEXITCODE -ne 0) { throw 'Android icons failed.' }
& ./android/gradlew.bat -p android :app:assembleRelease :app:lintRelease --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed.' }
$version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$outputDirectory = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$destination = Join-Path $outputDirectory "Notelin-$version.apk"
Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination $destination -Force
Write-Output "APK: $destination"
