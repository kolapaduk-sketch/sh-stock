# 자동 갱신 해제
Get-ScheduledTask -TaskName "SH STOCK*" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
"SH STOCK 자동 갱신 작업을 삭제했습니다."
