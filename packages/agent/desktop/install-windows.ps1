# Install the cf-dam agent for this user and run it at sign-in.
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Url https://dam.example.com [-Name "Studio PC"]
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$Name = $env:COMPUTERNAME
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Install Node.js 24 from https://nodejs.org first.' }
& $node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 24 or newer is needed.' }

$root = Join-Path $env:APPDATA 'cf-dam-agent'
$app = Join-Path $root 'app'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'agent.mjs'), (Join-Path $PSScriptRoot 'package.json') $app -Force
Push-Location $app
npm install --omit=dev --no-audit --no-fund | Out-Null
Pop-Location

# A small launcher sets the address and name, and keeps a log.
$launcher = Join-Path $root 'run-agent.cmd'
@"
@echo off
set "CF_DAM_URL=$Url"
set "AGENT_NAME=$Name"
set NODE_NO_WARNINGS=1
"$node" "$app\agent.mjs" >> "$root\agent.log" 2>&1
"@ | Set-Content -Encoding ASCII $launcher

# Runs as this user at sign-in, so mapped drives and network shares are reachable with their credentials.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'cf-dam agent' -Action $action -Trigger $trigger -Settings $settings -Description 'Indexes photos for cf-dam (read-only).' -Force | Out-Null
Start-ScheduledTask -TaskName 'cf-dam agent'
Write-Host "Installed. The pairing code will appear in $root\agent.log and at http://localhost:8790"
