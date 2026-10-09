export const GIT_SUBCOMMANDS: Array<[string, string]> = [
  ['add', 'Add file contents to the index'], ['branch', 'List, create or delete branches'],
  ['checkout', 'Switch branches or restore files'], ['cherry-pick', 'Apply commits from other branches'],
  ['clone', 'Clone a repository'], ['commit', 'Record changes'], ['diff', 'Show changes'],
  ['fetch', 'Download objects and refs'], ['init', 'Create a repository'], ['log', 'Show commit history'],
  ['merge', 'Join histories'], ['mv', 'Move or rename a file'], ['pull', 'Fetch and integrate'],
  ['push', 'Update remote refs'], ['rebase', 'Reapply commits on another base'], ['remote', 'Manage remotes'],
  ['reset', 'Reset HEAD'], ['restore', 'Restore working tree files'], ['revert', 'Revert commits'],
  ['rm', 'Remove files'], ['show', 'Show objects'], ['stash', 'Stash changes'], ['status', 'Show status'],
  ['switch', 'Switch branches'], ['tag', 'Manage tags'], ['worktree', 'Manage worktrees']
];

/** Subcommands whose next word is a branch name. */
export const GIT_BRANCH_COMMANDS = new Set([
  'checkout', 'switch', 'merge', 'rebase', 'branch', 'cherry-pick', 'diff', 'log', 'show', 'reset', 'push', 'pull', 'fetch'
]);

export const NPM_SUBCOMMANDS = [
  'install', 'run', 'test', 'start', 'build', 'ci', 'update', 'uninstall', 'init', 'publish', 'exec', 'outdated', 'audit'
];
export const PNPM_SUBCOMMANDS = [
  'install', 'add', 'remove', 'run', 'test', 'start', 'build', 'update', 'dlx', 'exec', 'init', 'outdated', 'audit'
];
export const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

export const BASH_BUILTINS = [
  'alias', 'bg', 'cd', 'command', 'declare', 'echo', 'eval', 'exec', 'exit', 'export', 'fg', 'history', 'jobs', 'kill',
  'let', 'local', 'popd', 'printf', 'pushd', 'pwd', 'read', 'return', 'set', 'shift', 'source', 'test', 'trap', 'type',
  'ulimit', 'umask', 'unalias', 'unset', 'wait'
];

export const CMD_BUILTINS = [
  'assoc', 'break', 'call', 'cd', 'chdir', 'cls', 'color', 'copy', 'date', 'del', 'dir', 'echo', 'endlocal', 'erase',
  'exit', 'for', 'ftype', 'goto', 'if', 'md', 'mkdir', 'mklink', 'move', 'path', 'pause', 'popd', 'prompt', 'pushd',
  'rd', 'rem', 'ren', 'rename', 'rmdir', 'set', 'setlocal', 'shift', 'start', 'time', 'title', 'type', 'ver', 'verify', 'vol'
];

export const POWERSHELL_COMMANDS = [
  'Add-Content', 'Clear-Host', 'Compare-Object', 'Copy-Item', 'ForEach-Object', 'Format-List', 'Format-Table',
  'Get-ChildItem', 'Get-Command', 'Get-Content', 'Get-Date', 'Get-Help', 'Get-History', 'Get-Item', 'Get-ItemProperty',
  'Get-Location', 'Get-Member', 'Get-Process', 'Get-Service', 'Group-Object', 'Import-Module', 'Invoke-Command',
  'Invoke-RestMethod', 'Invoke-WebRequest', 'Join-Path', 'Measure-Object', 'Move-Item', 'New-Item', 'Out-File',
  'Out-Null', 'Out-String', 'Pop-Location', 'Push-Location', 'Read-Host', 'Remove-Item', 'Rename-Item', 'Resolve-Path',
  'Select-Object', 'Select-String', 'Set-Content', 'Set-Item', 'Set-Location', 'Sort-Object', 'Split-Path',
  'Start-Process', 'Start-Service', 'Start-Sleep', 'Stop-Process', 'Stop-Service', 'Tee-Object', 'Test-Connection',
  'Test-Path', 'Where-Object', 'Write-Error', 'Write-Host', 'Write-Output', 'Write-Warning',
  'cd', 'cls', 'copy', 'del', 'dir', 'echo', 'foreach', 'gc', 'gci', 'gcm', 'gl', 'gm', 'gps', 'ls', 'mkdir', 'mv',
  'pwd', 'rm', 'select', 'sleep', 'sort', 'type', 'where'
];
