# Arctri shell integration for Windows PowerShell 5.1 and PowerShell 7.
# Dot-sourced after the user's profile. Inert unless ARCTRI_NONCE is set.
if (-not $env:ARCTRI_NONCE) { return }
if ($global:__AD_LOADED) { return }
$global:__AD_LOADED = $true

try {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = $utf8
  [Console]::InputEncoding = $utf8
  $global:OutputEncoding = $utf8
} catch {}

$global:__AD_ESC = [char]27
$global:__AD_BEL = [char]7
$global:__AD_RAN = $false
$global:__AD_ID = 0
$global:__AD_BLOCKS = ($env:ARCTRI_BLOCKS -eq '1')

function global:__AD_B64([string]$s) {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))
}

# Multi-line commands arrive as one line: . (__ad_sb 'BASE64'). Dot-sourcing the script block at the prompt runs it in the
# global scope, so variables, functions and Set-Location persist exactly as if the lines had been typed.
function global:__ad_sb([string]$b64) {
  $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  try { [Microsoft.PowerShell.PSConsoleReadLine]::AddToHistory($t) } catch {}
  # The status of the dot-sourcing statement says nothing about the lines inside; the last statement records its own.
  [scriptblock]::Create($t + "`n" + '$global:__AD_LASTOK = $?')
}
$global:__AD_WRAP = "^\. \(__ad_sb '([A-Za-z0-9+/=]+)'\)$"

$global:__AD_ORIG_PROMPT = $function:prompt

function global:prompt {
  $ok = $?
  $lec = $global:LASTEXITCODE
  if ($null -ne $global:__AD_LASTOK) { $ok = $global:__AD_LASTOK; $global:__AD_LASTOK = $null }
  $e = $global:__AD_ESC; $b = $global:__AD_BEL; $n = $env:ARCTRI_NONCE
  $out = ''
  if ($global:__AD_RAN) {
    $code = if ($ok) { 0 } elseif (($lec -is [int]) -and ($lec -ne 0)) { $lec } else { 1 }
    $out += "$e]133;D;$code;aid=$n$b"
    if ($global:__AD_BLOCKS) { $out += "$e[H$e[2J$e[3J" }
    $global:__AD_RAN = $false
  }
  $cwd = (Get-Location).ProviderPath
  $out += "$e]6973;$n;cwd;$(__AD_B64 $cwd)$b"
  $out += "$e]133;A;aid=$n$b$e]133;B;aid=$n$b"
  $global:LASTEXITCODE = $lec
  $p = & $global:__AD_ORIG_PROMPT
  return ($out + $p)
}

if (Get-Module PSReadLine) {
  # PSReadLine 2.2+ (PowerShell 7) takes the last run status; 2.0 (Windows PowerShell 5.1) does not.
  $global:__AD_RL3 = $false
  try {
    $global:__AD_RL3 = [bool]([Microsoft.PowerShell.PSConsoleReadLine].GetMethod('ReadLine',
      [Type[]]@([System.Management.Automation.Runspaces.Runspace], [System.Management.Automation.EngineIntrinsics], [Nullable[bool]])))
  } catch {}
  function global:PSConsoleHostReadLine {
    $lastRunStatus = $?
    Microsoft.PowerShell.Core\Set-StrictMode -Off
    $line = if ($global:__AD_RL3) {
      [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext, $lastRunStatus)
    } else {
      [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext)
    }
    if ($line -and $line.Trim()) {
      $shown = $line
      if ($line -match $global:__AD_WRAP) { $shown = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1])) }
      $global:__AD_ID++
      $e = $global:__AD_ESC; $b = $global:__AD_BEL; $n = $env:ARCTRI_NONCE
      # Block mode: wipe the echoed command so the output always starts at row 0 (see arctri.bash).
      $wipe = if ($global:__AD_BLOCKS) { "$e[H$e[2J$e[3J" } else { '' }
      [Console]::Out.Write("$e]6973;$n;cmd;$($global:__AD_ID);$(__AD_B64 $shown)$b$wipe$e]133;C;aid=$n$b")
      $global:__AD_RAN = $true
    }
    $line
  }
  # Keep the wrapper line out of PSReadLine's history (the script block adds the original text itself),
  # and still honour a history handler the user's profile already set.
  try {
    $global:__AD_PREV_HANDLER = (Get-PSReadLineOption).AddToHistoryHandler
    Set-PSReadLineOption -AddToHistoryHandler {
      param([string]$l)
      if ($l -match $global:__AD_WRAP) { return $false }
      if ($global:__AD_PREV_HANDLER) { return (& $global:__AD_PREV_HANDLER $l) }
      return $true
    }
  } catch {}
  $__ad_hello_blocks = '1'
} else {
  $__ad_hello_blocks = '0'
}
# Without PSReadLine no command boundaries are reported, so the screen must not be cleared either.
if ($__ad_hello_blocks -ne '1') { $global:__AD_BLOCKS = $false }
[Console]::Out.Write("$($global:__AD_ESC)]6973;$($env:ARCTRI_NONCE);hello;$(if ($PSVersionTable.PSEdition -eq 'Core') {'pwsh'} else {'powershell'});$($PSVersionTable.PSVersion);$__ad_hello_blocks$($global:__AD_BEL)")
