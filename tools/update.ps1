# SH STOCK 데이터 자동 갱신 (작업 스케줄러가 실행)
# 시세·재무·컨센서스·뉴스·공시를 다시 받아 app/data.js, app/news.js 를 교체하고 결과를 update.log 에 남긴다.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot "update.log"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$py = "C:\Users\하꿈\AppData\Local\Programs\Python\Python312\python.exe"

"==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 갱신 시작 ====" | Out-File $log -Append -Encoding utf8
# 절전 해제 직후에는 인터넷이 아직 안 붙어 있을 수 있어 최대 10분 대기
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    try { [void][System.Net.Dns]::GetHostEntry("m.stock.naver.com"); $ok = $true; break } catch { Start-Sleep -Seconds 30 }
}
if (-not $ok) { "인터넷 연결 없음 — 이번 갱신 건너뜀`n" | Out-File $log -Append -Encoding utf8; exit 1 }
& $py (Join-Path $PSScriptRoot "fetch_data.py") 2>&1 | Where-Object { $_ -notmatch '^\s+\d+/\d+$' } | Out-File $log -Append -Encoding utf8
$fetchCode = $LASTEXITCODE
"---- 수집 종료 코드 $fetchCode ----" | Out-File $log -Append -Encoding utf8
if ($fetchCode -eq 0) {
    & $py (Join-Path $PSScriptRoot "verify_data.py") 2>&1 | Out-File $log -Append -Encoding utf8
} else {
    "수집 실패 — 이전 데이터 유지, 검증 생략" | Out-File $log -Append -Encoding utf8
}
"==== 종료 코드 $LASTEXITCODE ====`n" | Out-File $log -Append -Encoding utf8

# 로그가 너무 커지지 않게 최근 2000줄만 유지
$lines = Get-Content $log -Encoding utf8
if ($lines.Count -gt 2000) { $lines | Select-Object -Last 2000 | Set-Content $log -Encoding utf8 }
