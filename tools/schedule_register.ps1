# 작업 스케줄러에 자동 갱신 등록 (관리자 권한 불필요, 현재 사용자로 로그인 중일 때 실행)
#   국내장 마감 후: 평일 16:10 (KST)
#   미국장 마감 후: 화~토 07:10 (KST)
# 해제: tools\schedule_remove.ps1 실행
$script = Join-Path $PSScriptRoot "update.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 90)

$kr = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "16:10"
$us = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Wednesday,Thursday,Friday,Saturday -At "07:10"

Register-ScheduledTask -TaskName "SH STOCK 국내장 갱신" -Action $action -Trigger $kr -Settings $settings -Description "SH STOCK 데이터 자동 갱신 (국내장 마감 후)" -Force | Out-Null
Register-ScheduledTask -TaskName "SH STOCK 미국장 갱신" -Action $action -Trigger $us -Settings $settings -Description "SH STOCK 데이터 자동 갱신 (미국장 마감 후)" -Force | Out-Null
Get-ScheduledTask -TaskName "SH STOCK*" | ForEach-Object { "$($_.TaskName): 다음 실행 $((Get-ScheduledTaskInfo $_).NextRunTime)" }
