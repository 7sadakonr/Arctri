# Changelog

## 0.1.3-beta

- Multi-tab file viewer on the left side of the terminal: several files open at once, image preview, word wrap,
  maximize, and a resizable width.
- CI fixes: installer smoke test, cleanup test and publishing behaviour.

## 0.1.2

- New welcome page when no tab is open: New Terminal, Open Project, Clone Repository and the five most recent projects
  (Ctrl+1 to Ctrl+5). Arctri no longer opens a terminal by itself at start; tabs from the last session are still restored.
- Files can be opened beside the terminal: clicking a file in the file panel opens it (editable, Ctrl+S saves), clicking a
  changed file in the changes list shows what changed against HEAD. Alt+click still inserts the path into the message.
- Fixed a closed tab flashing back for a moment as "The process ended (code 1)".

## 0.1.1

- Fixed the WSL file panel so an unreadable folder is reported with a retry action instead of appearing empty.
- Fixed agent terminal content remaining visible over a newly created tab.

## 0.1.0 (MVP 1)

First release. Windows 10 22H2 and Windows 11, x64.

- Real PTY terminal (xterm.js + node-pty on ConPTY): Windows PowerShell 5.1, PowerShell 7, Command Prompt, and
  WSL2 bash/zsh in any installed distribution. Tabs, rename, reorder, resize, scrollback, copy/paste, full-screen programs.
- Command blocks for PowerShell, bash and zsh through OSC 133 shell integration, with exit code, duration,
  working directory, shell, copy/rerun/collapse and keyboard navigation. Falls back to a classic terminal when the
  integration is not available.
- Autocomplete in the block editor: history, commands, files and folders, git subcommands and branches, npm/pnpm
  scripts; per environment (Windows or WSL). Suggestions are never run automatically.
- Codex CLI and Claude Code launchers for Windows and WSL with capability-based toolbar.
- Thai and English interface; Thai input in the editor, in terminals and in agent sessions.
- Local-only storage: preferences (electron-store) and command history (SQLite).

See `docs/RELEASE.md` for known limitations.
