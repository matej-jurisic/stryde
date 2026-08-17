# Loom release-APK builder (the app is branded "Loom"; the codebase underneath is still Stryde).
# One command: bump version -> build SPA -> cap sync -> sign -> assemble -> stage -> publish to homelab.
# Run from the repo root:
#   .\loom-build.ps1
#
# Machine-specific config — edit these before first use:
$ErrorActionPreference = "Stop"

$jbr      = "D:\Program Files\AndroidStudio\jbr"   # path to Android Studio JBR
$keystore = "D:\Projects\stryde-release.jks"        # kept OUTSIDE the repo; unchanged so existing installs keep updating in place
$alias    = "stryde"
$clientDir = "D:\Projects\stryde\client"
$projDir   = "D:\Projects\stryde\client\android"
$gradle    = "$projDir\app\build.gradle"
$outDir    = "D:\Projects\stryde\release"            # staged APKs

# Homelab publish over SSH. Set $remoteHost to enable; leave "" to only stage locally.
$remoteHost = "homelab"                # SSH host alias (keys already set up)
$remoteUser = "matej"
$sshPort    = 22
$remoteDir  = "/data/loom/releases"    # Obtainium URL -> .../releases/loom.apk

# Fail fast on the password before the long build steps.
$sec  = Read-Host "Keystore password (min 6 chars)" -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
          [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($pass.Length -lt 6) { Write-Host "Password must be at least 6 characters." -ForegroundColor Red; exit 1 }

# Create the keystore once if it does not already exist.
if (-not (Test-Path $keystore)) {
    Write-Host "Creating keystore $keystore ..." -ForegroundColor Cyan
    & "$jbr\bin\keytool.exe" -genkeypair -v -keystore $keystore -alias $alias `
        -keyalg RSA -keysize 2048 -validity 10000 -storepass $pass -keypass $pass -dname "CN=Stryde"
} else {
    Write-Host "Using existing keystore $keystore" -ForegroundColor Cyan
}

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# --- 1. Bump versionCode + versionName ----------
$content = Get-Content $gradle -Raw
if ($content -notmatch 'versionCode\s+(\d+)') {
    Write-Host "Could not find versionCode in $gradle" -ForegroundColor Red; exit 1
}
$oldCode = [int]$Matches[1]
$newCode = $oldCode + 1
$content = $content -replace 'versionCode\s+\d+', "versionCode $newCode"

$newName = $null
if ($content -match 'versionName\s+"([^"]+)"') {
    $parts = $Matches[1] -split '\.'
    $last  = $parts.Length - 1
    if ($parts[$last] -match '^\d+$') { $parts[$last] = [string]([int]$parts[$last] + 1) }
    $newName = ($parts -join '.')
    $content = $content -replace 'versionName\s+"[^"]+"', "versionName `"$newName`""
}
[System.IO.File]::WriteAllText($gradle, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Bumped to versionCode $newCode, versionName $newName" -ForegroundColor Cyan

# --- 2. Build SPA + 3. cap sync ----------
Push-Location $clientDir
npm run build
npx cap sync android
Pop-Location

# --- 4. Build signed release APK ----------
$env:JAVA_HOME                 = $jbr
$env:STRYDE_KEYSTORE           = $keystore
$env:STRYDE_KEYSTORE_PASSWORD  = $pass
$env:STRYDE_KEY_ALIAS          = $alias
$env:STRYDE_KEY_PASSWORD       = $pass
& "$projDir\gradlew.bat" -p $projDir assembleRelease

# --- 5. Stage APK ----------
$apk       = "$projDir\app\build\outputs\apk\release\app-release.apk"
$versioned = "$outDir\loom-v$newName-$newCode.apk"
$stable    = "$outDir\loom.apk"
Copy-Item $apk $versioned -Force
Copy-Item $apk $stable    -Force
Write-Host "Staged: $versioned" -ForegroundColor Green
Write-Host "Stable: $stable"    -ForegroundColor Green

# --- 6. Publish to homelab over SSH ----------
if ($remoteHost) {
    ssh -p $sshPort "${remoteUser}@${remoteHost}" "mkdir -p '$remoteDir'"
    scp -P $sshPort "$stable"    "${remoteUser}@${remoteHost}:$remoteDir/loom.apk"
    scp -P $sshPort "$versioned" "${remoteUser}@${remoteHost}:$remoteDir/"
    Write-Host "Published to ${remoteHost}:${remoteDir}" -ForegroundColor Green
}
