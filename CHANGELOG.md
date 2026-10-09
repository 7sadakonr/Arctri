# Changelog

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
