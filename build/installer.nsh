!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "StandReminder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.standreminder.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "StandReminder"
!macroend
