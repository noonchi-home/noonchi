# 바탕화면에 「NOONCHI 허브」 바로가기를 만든다(이 폴더를 apps/desktop의 Electron으로 연다).
# 먼저 저장소 뿌리에서 npm ci --prefix apps/desktop 을 끝낸다(Electron 바이너리까지 받는다).
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File apps\desktop\make-shortcut.ps1
$ErrorActionPreference = "Stop"
$app = $PSScriptRoot
$electron = Join-Path $app "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) { throw "Electron이 없어요: $electron (저장소 뿌리에서 npm ci --prefix apps/desktop 을 먼저 실행하세요)" }

$link = Join-Path ([Environment]::GetFolderPath("Desktop")) "NOONCHI 허브.lnk"
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = $electron
$shortcut.Arguments = "`"$app`""
$shortcut.WorkingDirectory = $app
$shortcut.IconLocation = (Join-Path $app "icon.ico") + ",0"
$shortcut.Description = "NOONCHI 허브"
$shortcut.Save()
"바로가기를 만들었어요: $link"
