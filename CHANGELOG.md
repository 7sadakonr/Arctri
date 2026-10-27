# Changelog

## 0.3.4-beta

- **Updates.** Arctri checks GitHub Releases for a newer version (Help > Check for Updates, Settings > Updates, and automatically). On Windows the update is
  downloaded in the app and installed on **Restart to update**; if tabs are running work you are asked first and nothing is closed unattended. macOS shows the
  release link (the app is not signed or notarized). Betas and final releases are told apart by the prerelease flag of the GitHub release (the metadata is always `latest.yml`). Versions up to 0.3.3-beta have no updater and need one manual install.
- **Releases.** The workflow now publishes updater metadata and blockmaps, checks that the tag equals the package version and that no release exists for it,
  verifies metadata against the files, and pins its actions. A pass of the Windows integration suite only on retry is flagged on the CI run.
- **Tests.** CI installs the build, offers it the next version from a loopback feed and checks the upgrade, a missing feed and a damaged installer (`scripts/smoke-update.mjs`).
- **Sessions.** A crashed PTY worker now fails the tab with a clear message, finishes its running command, keeps the output already received and ends the
  shell it had started (before, that shell kept running unseen). Closing everything that runs out of time ends what is left before the app exits. Quitting asks
  first, before any session is closed, so Cancel really leaves them running. A crashed page is reloaded and the terminals keep running. Memory held for closed
  tabs and for a window that is gone is bounded. The PTY lifecycle is now in the log.
- **Environment.** The welcome page shows the shells, WSL state and agent CLIs found, whether each is usable, and how to get what is missing; start-up errors say how to
  recover. **Settings > Copy recent log** gives a masked log for bug reports; logs mask home paths and token-shaped strings. Issue template and troubleshooting guide added.
- **Busy tabs.** Command Prompt and other tabs without blocks now count as busy while a program runs in them, so closing or updating asks first.
- **Signing.** Windows (Azure Artifact Signing) and macOS (Developer ID, notarization) builds and their verification are wired behind `SIGN_WINDOWS` / `SIGN_MACOS`, off until credentials exist. Installers remain unsigned.
- **CI.** Integration tests run one file per process; a file that passes only on retry is reported as a flake and fails main unless quarantined with a reason.
- **Docs.** Baseline method and bug inventory, compatibility matrix with untested combinations marked, and a go/no-go checklist (kept in the maintainer's notes; the user-facing parts are in the README).
- **Data.** Before a newer version migrates an existing database, a copy is kept as `arctri.db.bak-v<n>` (two newest).

## 0.3.3-beta

- **Terminal.** Fixes garbled text after switching tabs: the terminal is repainted once the layout has settled and after a WebGL context loss.

## 0.3.2-beta

- **Git sync.** Branches and Changes share one sync status (ahead / behind) per repository, fed by an automatic fetch (deduplicated across tabs). An **Update Branch**
  dialog does a safe fast-forward, and Arctri checks the branch before an agent starts work. Changes made to the repository outside Arctri are detected.
- **Live tab names.** A tab is named after the tool the agent is running; the model is read at SessionStart, follows `/model`, and is refreshed after tool calls.
- **Notifications.** The title says what happened (agent and state); the body shows the project folder instead of the session name.
- **Terminal.** Cascadia Mono with no negative letter spacing, and the glyph atlas is rebuilt when WebGL is re-enabled.

## 0.3.1-beta

- **Files panel.** Dotfiles are shown (dimmed), with a right-click menu, multi-select, cut / copy / paste, drag and drop and live updates when files change on disk.
- **Tabs.** Pin and unpin moved into a right-click menu, together with duplicate, close others and more.
- **Fonts.** Roboto for the app, Roboto Mono for code and one Thai face; Thai Backspace fixes.
- **macOS menus.** File, Edit, View, Terminal and Help live in the system menu bar.

## 0.3.0-beta

- **Model in the agent bar.** The bar under an agent's terminal names the model the session is really using, for Claude Code and Codex, and follows `/model`
  switches. The hook script reads only the model's name from the agent's own session files (Claude's transcript at session start and at the end of a turn;
  Codex's rollout of the thread at the end of a turn) and nothing else leaves it; the chip stays hidden until a model is known. Limits: Windows-native agents and
  shells other than bash/zsh have no hooks (no chip); Codex shows it after its first finished turn.
- The green "Enable Codex notifications" button is gone from the Codex bar.
- **Agent status you can trust.** Tab marks, the tooltip, the command palette and the attention bell (bell icon in the tab bar) show one status, from
  hook / notify events and the process only; output text is never read. Looking at a tab only clears its unread marker: a question or an approval
  still reads Waiting / Approval, and stays in the bell until the agent moves on. Ordinary typing no longer dismisses a pending approval; only
  Esc / Ctrl+C (the CLI sends no event then) makes it Unknown, with the reason in the tooltip. Codex reports only the end of a turn, so after you press
  Enter on a finished turn its mark becomes Unknown ("a new turn may have started") until the next turn-complete. A failed or non-zero exit is unread news.
  The bell badge counts each unresolved item once and unread news only until it is seen. OS notifications are decided per event (state + when it began)
  instead of one per tab every 10 s, so an approval right after a finished turn is announced. Hook event files are read in bounded passes
  (at most 25 per pass) and a tab never keeps two watchers.
  Known limits: Windows-native agents and agents in shells other than bash/zsh have no hooks and show "Status tracking unavailable" with the reason;
  Codex has no working / approval events; a "No" answered on a Claude permission prompt stays Approval until Claude's next hook event; macOS is untested here.
- **macOS (Apple Silicon and Intel).** Arctri finds the shells of the Mac (zsh, bash, Homebrew bash), opens the login shell by
  default and gives it the same command blocks, completion, Files/Changes/Branches/History and agent support as on Windows.
  The window uses the traffic lights, a menu in the system menu bar for Cmd+Q / Cmd+H / Edit, and Cmd shortcuts (Cmd+T, Cmd+W,
  Cmd+1…9, Cmd+, and zoom, Cmd+C / Cmd+V). The `.dmg` and `.zip` are ad-hoc signed and not notarized.
- Releases: a `Release` workflow builds the Windows installer and the macOS dmg/zip for a `v*` tag and attaches them to a GitHub Release.
- New environment kind `local` (the machine itself, POSIX paths) next to `windows` and `wsl`; recent projects and saved tabs keep working.

## 0.2.0-beta

- **Menu bar** (File, Edit, View, Terminal, Help) in the title bar, with the current folder in the middle and the git branch
  next to the window buttons. The tab row sits below it. Open Folder, Open Recent, Clone, Settings, zoom (Ctrl+= / Ctrl+- /
  Ctrl+0), theme and a shortcuts list are all reachable from the menus.
- **Sidebar, open by default**, with four views: Files, Changes (click a file for its diff), Branches (click one to run
  `git switch` in the terminal) and History (commits of the branch; a file of a commit opens as a diff of that commit).
- Command blocks only: the Native prompt and Classic modes are gone, and shells that cannot show blocks (Command Prompt,
  Git Bash) are no longer offered. Blocks now look like the terminal: full-width rows headed by the shell's own prompt and
  command, failures in red, newest at the bottom, and a fold button only for long output. The command editor shows the
  shell's real prompt.
- **New tab menu** follows Windows Terminal: its profiles in its order, and a "Terminal" entry that opens its default
  profile. WSL distributions appear once each (zsh when you use it, bash otherwise) with explicit zsh and bash entries below.
- The app opens on the welcome page; tabs from the last session are listed under Recent instead of being reopened. Open
  Project and Recent open in the same shell as "Terminal".
- WSL is remembered between runs and a failed probe no longer makes distributions disappear.
- Git queries for a repository on a Windows drive (`/mnt/d/...`) go through git for Windows, which is much faster than git
  inside WSL for big repositories.
- AI agents are no longer started from the new tab menu; type the agent's command in a terminal.

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
