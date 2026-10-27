<p align="center">
  <img src="./build/icon.png" width="88" alt="Arctri logo" />
</p>

<h1 align="center">Arctri</h1>

<p align="center">
  <strong>An agent-first terminal for Windows.</strong><br />
  A real terminal experience for everyday commands, projects, and AI coding agents — without becoming another IDE.
</p>

<p align="center">
  <a href="https://github.com/7sadakonr/Arctri/actions/workflows/ci.yml"><img src="https://github.com/7sadakonr/Arctri/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/version-0.3.4--beta-blue" alt="Version 0.3.4-beta" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4" alt="Windows 10 and 11" />
  <img src="https://img.shields.io/badge/platform-macOS%2012%2B-000000" alt="macOS 12 and later" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
</p>

Arctri is a desktop terminal for Windows and macOS built around the way developers use **Claude Code**, **OpenAI Codex CLI**, and traditional shells. It combines real PTY-backed execution with command blocks, context-aware autocomplete, project navigation, file editing, Git changes, and a contextual toolbar that appears when an AI agent is running.

**Current release:** [`v0.3.4-beta`](https://github.com/7sadakonr/Arctri/releases/latest) · **Windows 10 22H2 / Windows 11 (x64)** with optional WSL2 support · **macOS 12+ (Apple Silicon and Intel)** with your own zsh or bash.

> [!IMPORTANT]
> Arctri does **not** include its own AI model, API keys, or cloud inference service. It runs external AI coding CLIs installed and authenticated by the user. Their subscriptions, accounts, permissions, network requests, and usage limits are managed by their respective providers.

## Contents

- [What you can do](#what-you-can-do)
- [Quick start](#quick-start)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting-and-reporting-problems)
- [How to use Arctri](#how-to-use-arctri)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Development](#development)
- [Privacy and security](#privacy-and-security)
- [Current scope and limitations](#current-scope-and-limitations)
- [License](#license)
- [Author](#author)

## What you can do

| Area | Features |
| --- | --- |
| **Real terminal** | Interactive PTY sessions powered by ConPTY; supports terminal applications, escape sequences, ANSI output, copy/paste, resizing, and scrollback. |
| **Multiple shells** | Windows PowerShell 5.1, PowerShell 7, Command Prompt, plus bash/zsh inside available WSL distributions. |
| **Command blocks** | Group commands and output into individual blocks with exit status, duration, working directory, shell, timestamp, copy, rerun, collapse, and keyboard navigation. |
| **Smart autocomplete** | Context-aware suggestions from command history, installed commands, files/folders, Git subcommands/branches, and npm/pnpm scripts. |
| **AI agent workflow** | Detect and launch Claude Code and Codex CLI on Windows or WSL; recognize agents started by typing `claude` or `codex` in a shell. |
| **Contextual agent toolbar** | Native slash commands, file references/attachments, Git change summary, rich input, and available resume/restart options. Controls depend on the agent and detected CLI capabilities. |
| **Project workspace** | Welcome screen with New Terminal, Open Project, Clone Repository, and five recent projects. |
| **Files and Git** | Browse and filter a project's files (dotfiles shown dimmed), use the right-click menu, multi-select, cut/copy/paste and drag and drop with live updates, open text files beside the terminal, edit/save them, and inspect diffs against Git HEAD. Branches and Changes show a shared sync status (ahead/behind), with automatic fetch and a safe fast-forward Update Branch dialog; external Git changes are detected. |
| **Tabs and sessions** | Multiple independent sessions with tab switching, renaming, reordering, a right-click menu (pin/unpin, duplicate, close others), shell selection, and optional tab restoration. |
| **Personalization** | English/Thai interface, dark/light themes, terminal font size, UI scaling, history/scrollback controls, shell defaults, and agent paths. |
| **Local-first data** | Local command history, preferences, and saved session metadata; no Arctri account required. |

### Command blocks instead of an endless wall of text

In supported shells, Arctri installs shell integration for the session and interprets **OSC 133** command-boundary markers. This allows completed commands to be presented as distinct blocks with their corresponding output and metadata. You can inspect, copy, rerun, or collapse a block without searching through the entire terminal scrollback.

When an interactive full-screen program is active (for example, `vim`, `less`, `ssh`, or an agent TUI), Arctri displays the live terminal. If reliable shell integration is unavailable, it falls back to classic terminal behavior rather than attempting to guess command boundaries. **Command Prompt uses the classic terminal experience.**

### Autocomplete that understands your environment

Suggestions are collected for the *current shell and environment*, so a Windows tab and a WSL tab do not need to share the same PATH, home directory, or command history. Providers include:

- Recent commands and command history, with context from the working directory.
- Executables and shell built-ins.
- Files and directories, with shell-aware quoting.
- Git commands and local branch names.
- `npm` / `pnpm` subcommands and scripts from `package.json`.

Use **Tab** to accept a suggestion or **Esc** to dismiss it. Autocomplete **never runs a suggested command automatically**.

### Designed for existing AI coding agents

Arctri currently integrates with **Claude Code** and **Codex CLI**, but it does not replace their native interfaces.

- Discover each supported CLI in the Windows PATH or inside individual WSL distributions.
- Open an agent in its own tab, or invoke `claude` / `codex` in an ordinary shell.
- Keep the CLI's own terminal UI, sign-in flow, model selection, permission prompts, and session behavior.
- Use Arctri's lower toolbar for file references, slash-command shortcuts, changed files, and rich input.
- Review code changes and edit project files without leaving the terminal workspace.
- Detect available CLI launch flags (such as supported resume, model, and approval options) rather than assuming every installed version supports every option.

Arctri does not silently bypass agent approval or sandbox restrictions. If explicitly supplied launch arguments request unsafe permission bypasses, the application marks that session with a warning.

### File browsing and editing

The file panel displays a navigable tree rooted at the current tab's working folder. It includes filtering, hidden-file visibility, file-type icons, and Git status indicators. Select a text file to open it in a **CodeMirror** editor beside the terminal; **Alt+click** inserts its path into the agent input instead.

The editor supports syntax highlighting, search, and **Ctrl+S** to save. The Git changes view can show an inline comparison against `HEAD`. Arctri detects external modifications and warns about save conflicts instead of blindly overwriting a changed file. Binary and oversized files are not opened in the text editor.

## Quick start

### System requirements

| Requirement | Details |
| --- | --- |
| Operating system | Windows 10 **22H2** or Windows 11 · macOS 12 or later |
| Architecture | **x64** (MVP 1) |
| Shell | Windows PowerShell / Command Prompt; PowerShell 7 optional |
| WSL | **WSL2**, optional; install a Linux distribution to use bash/zsh tabs |
| Git | Recommended; required for cloning repositories and Git-aware features |
| AI agents | Optional; install Claude Code and/or Codex CLI separately to use their integrations |

### Download

Get the installer from the [Releases page](https://github.com/7sadakonr/Arctri/releases): `Arctri-Setup-<version>-x64.exe` for Windows, or the `.dmg` (zip also provided) for macOS, Apple Silicon (`arm64`) or Intel (`x64`).
Builds are betas and **not code-signed** yet: Windows SmartScreen may warn (More info > Run anyway), and macOS needs right-click > Open the first time. Download only from this repository's Releases page.

### Install from source

You can run the app locally or build the Windows installer:

~~~powershell
git clone https://github.com/7sadakonr/Arctri.git
cd Arctri

# Use Windows Node.js 22+ (not a Node installation inside WSL).
npm install

# If Electron's binary was not downloaded by npm:
node node_modules/electron/install.js

# Start the desktop app in development mode
npm run dev
~~~

To build a distributable **Windows x64 installer**:

~~~powershell
npm run dist
~~~

The installer is written to `release/Arctri-Setup-<version>-x64.exe`. A packaged/unpacked build can also be generated using `npm run dist:dir`. The repository's GitHub Actions CI builds and uploads an installer artifact.

> [!NOTE]
> MVP 1 installers are **not code-signed**. Windows SmartScreen may display a warning on first launch. Download or build only from a source you trust.

### Updating

Arctri checks GitHub Releases for a newer version (shortly after start, every six hours, and from **Help > Check for Updates**). This is
the only network request the app makes by itself; switch it off in **Settings > Updates**. You choose the **beta** or **stable** channel there.

- **Windows:** the update is downloaded in the app and installed after **Restart to update**. If tabs are running a command or an agent
  you are asked first, because running processes do not survive the restart. Settings, history and recent projects are kept.
- **macOS:** the app tells you a new version exists and links to the release; install it by hand (the build is not notarized, so it
  cannot replace itself).
- **Versions up to 0.3.3-beta** have no updater: install 0.3.4-beta (the first with one) yourself, from the [Releases page](https://github.com/7sadakonr/Arctri/releases).
- The installers are not code-signed. The updater verifies the downloaded file against the checksum published with the release.

To build the **macOS** app (`.dmg` and `.zip`, Apple Silicon and Intel) run `npm run dist:mac` **on a Mac** (a `.dmg` cannot be built on Windows or Linux; the GitHub Actions `macos` job does it for every push).

> The macOS build is **not notarized** (it is ad-hoc signed, which Apple Silicon requires to run at all), so Gatekeeper blocks it the first time: drag Arctri to Applications, then **right-click > Open** (or run `xattr -cr /Applications/Arctri.app` once). Download or build only from a source you trust.

On a Mac Arctri opens your login shell (zsh by default; bash 4.4 or newer from Homebrew gets command blocks, the bash that macOS ships is 3.2 and does not). Shortcuts use ⌘: ⌘T new tab, ⌘W close tab, ⌘1…9 go to a tab, ⌘, settings, ⌘= / ⌘- zoom, ⌘C / ⌘V copy and paste (Ctrl+C is always the shell's interrupt).

## How to use Arctri

### 1. Start with a project

On the welcome screen:

1. Choose **New Terminal** to create a shell tab.
2. Choose **Open Project** to select a working folder and open a terminal in it.
3. Choose **Clone Repository** to provide a Git URL and choose a parent directory. Clone progress runs visibly in a terminal tab.
4. Reopen one of your **five recent projects**.

Use the **+** / new-tab menu to choose a Windows shell, an installed WSL shell, or an available AI agent. WSL shells are discovered from locally installed distributions.

### 2. Run terminal commands

Type a command in the command editor and press **Enter**. Use **Shift+Enter** for a new line, or **Tab** to complete suggestions. For shells with working command integration, completed commands appear as reusable blocks. Switch between block and classic presentation from Settings or open a classic shell directly.

### 3. Work with an AI agent

First install and sign in to **Claude Code** or **Codex CLI** in the environment where you want to use it. Then either:

- Choose the agent from the **new-tab menu**, or
- Run `claude` or `codex` inside a shell tab.

When detected, Arctri changes the lower toolbar to agent controls. Use **Ctrl+G** for Rich Input, attach or reference files, inspect changed files, and open the file panel. An agent's actual execution, prompts, and approval workflow remain in the native CLI. If an agent is not found, check its installation/PATH or set a custom executable path in Settings.

### 4. Explore and edit project files

Open the file panel with **Ctrl+Shift+E**. Click a file to view/edit it; use **Ctrl+S** to save. Choose a modified file from the Git changes area to inspect its diff against `HEAD`. To add a file path to an agent prompt, use **Alt+click** in the file panel.

### 5. Adjust your workspace

Open **Settings** with **Ctrl+,** to configure language (English/Thai/automatic), theme, interface scale, terminal font size, history limit, scrollback, default shell, block/classic mode, tab restoration, ConPTY implementation, clipboard OSC 52 support, agent notifications, and custom agent executable paths.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+T` / `Ctrl+Shift+W` | New similar tab / close current tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` ... `Ctrl+9` | Select a tab; on the welcome screen, open a listed recent project |
| `F2` | Rename current tab |
| `Ctrl+Up` / `Ctrl+Down` | Navigate command blocks |
| `Enter` / `Shift+Enter` | Execute command / insert newline in the command editor |
| `Tab` / `Esc` | Accept / dismiss an autocomplete suggestion |
| `Ctrl+C` | Copy selected text; otherwise interrupt the current terminal command |
| `Ctrl+V` | Paste into the terminal |
| `Ctrl+Shift+E` | Toggle file panel |
| `Ctrl+G` | Toggle agent Rich Input (when an agent is active) |
| `Ctrl+,` | Open Settings |
| `Ctrl+K` followed by `Ctrl+O` | Open Project from the welcome screen |
| `Ctrl+S` | Save a file in the editor |

Some shortcuts are contextual: they apply only when the command editor, welcome screen, file viewer, or agent session is active.

## How it works

Arctri is an **Electron desktop application**, not a browser-based terminal or a remote shell service. The renderer displays terminal and project UI while the main process owns operating-system access.

~~~text
                        Arctri Desktop Application
┌────────────────────────────────────────────────────────────────────┐
│ React Renderer (TypeScript)                                       │
│ Tabs · xterm.js · Command blocks · Autocomplete UI · Agent toolbar │
│ Welcome screen · File explorer · CodeMirror file/diff viewer       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ typed IPC / events
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Electron Preload                                                  │
│ Context-isolated, validated interface to main-process services    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Electron Main Process                                             │
│ Session manager · Agent adapters · Completion · Git / file I/O     │
│ WSL detection · Preferences / SQLite history · Shell integration  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ PTY worker(s)
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ node-pty / Windows ConPTY                                         │
│ PowerShell · pwsh · cmd · wsl.exe → bash/zsh · Claude/Codex CLI     │
└────────────────────────────────────────────────────────────────────┘
~~~

**Execution flow**

1. A new tab requests a shell or an agent through the preload bridge.
2. The Electron main process selects its shell profile, working directory, and environment (Windows or a specific WSL distribution).
3. The session manager starts a PTY through a worker, keeping process startup and terminal I/O away from the UI thread.
4. The terminal output is streamed to the renderer and drawn by **xterm.js**.
5. When shell integration is active, OSC 133 markers identify command boundaries; the block tracker renders completed commands with their output and metadata.
6. Autocomplete requests consult command history, the shell/environment, filesystem, Git, and package scripts; suggestions return to the editor.
7. Claude/Codex sessions are still ordinary external CLI processes inside real terminals. Arctri adds contextual controls without taking over their execution.

The default ConPTY option uses a **bundled ConPTY implementation** to improve Windows terminal compatibility, including Thai text behavior; Settings also provides a switch to the system's inbox ConPTY implementation.

## Tech stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Desktop runtime | **Electron 44**, **Node.js** | Windows desktop app, process lifecycle, OS integration and IPC |
| Language | **TypeScript 6** | Typed main, preload, renderer and shared modules |
| UI | **React 19**, **Tailwind CSS 4**, **Radix UI**, **Lucide** | Tabs, layouts, menus, dialogs, accessible controls and icons |
| Client state | **Zustand** | UI, session and block state |
| Terminal | **xterm.js 6**, **node-pty**, **ConPTY** | Terminal emulation, interactive shell processes and rendering |
| Text editing | **CodeMirror 6** | Command input, text-file editing, syntax highlighting and Git diff views |
| AI CLI integration | **Claude Code / Codex adapters** | Detect installed executables, read capability flags and launch native sessions |
| Shell integration | **PowerShell, bash, zsh scripts**, **OSC 133** | Prompt/command boundaries and working-directory updates |
| Linux interoperability | **WSL2 / wsl.exe** | Linux shell and agent execution from Windows |
| Local storage | **better-sqlite3**, **electron-store** | Command history, saved sessions, preferences and recent projects |
| Validation | **Zod** | Input and preference validation across the IPC boundary |
| Tooling | **Vite**, **electron-vite**, **electron-builder** | Development, bundling and Windows installer |
| Quality | **Vitest**, **Playwright**, **ESLint**, **GitHub Actions** | Unit/integration/e2e tests, static checks and Windows CI |

Dependencies and exact package versions are maintained in [`package.json`](./package.json).

## Project structure

~~~text
Arctri/
├── .github/workflows/ci.yml     # Windows CI and installer artifact
├── build/                       # Application icon / build resources
├── resources/shell-integration/ # PowerShell, bash, zsh, WSL helper
├── src/
│   ├── main/
│   │   ├── agents/              # Claude/Codex detection and launching
│   │   ├── completion/          # Completion providers and engine
│   │   ├── files/               # Safe file reads/writes and references
│   │   ├── git/                 # Git status and diff support
│   │   ├── ipc/                 # Renderer/main request handlers
│   │   ├── persistence/         # SQLite, preferences, session metadata
│   │   ├── pty/                 # Workers and PTY session management
│   │   ├── shell/               # Shell discovery and launch configuration
│   │   └── wsl/                 # WSL discovery and invocation
│   ├── preload/                 # Restricted, typed renderer API
│   ├── renderer/
│   │   ├── features/            # UI features and interactions
│   │   ├── stores/              # Zustand state
│   │   └── styles/              # Application styles
│   └── shared/                  # Types, OSC parsing, shell state, i18n
├── tests/
│   ├── e2e/                     # Playwright desktop user flows
│   └── integration/             # Real PTY and shell integration tests
├── PLAN.md                      # Technical planning/design decisions
├── CHANGELOG.md                 # Version history
├── electron-builder.yml        # Installer settings
└── package.json                # Scripts and dependencies
~~~

## Development

**Use a Windows installation of Node.js 22 or newer.** Installing dependencies from WSL in this checkout can download Linux native modules instead of the Windows binaries required by Electron.

~~~powershell
npm install
node node_modules/electron/install.js   # only if Electron's binary is missing
npm run dev
~~~

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app with development hot reload |
| `npm run typecheck` | Check main and renderer TypeScript projects |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit tests |
| `npm run test:integration` | Exercise real PTY/shell functionality |
| `npm run build` | Build the Electron application |
| `npm run test:e2e` | Run desktop Playwright tests (build the app first) |
| `npm run dist` | Produce the Windows x64 NSIS installer |
| `npm run dist:mac` | Produce the macOS `.dmg` and `.zip` (run on a Mac) |
| `npm run dist:dir` | Produce an unpacked Windows build |
| `npm run test:smoke` | Smoke-test a built application |

Integration tests that use WSL expect a distribution named **Ubuntu**. Set `ARCTRI_SKIP_WSL=1` to skip those tests. Other test-only environment flags include `ARCTRI_USER_DATA` (isolated user data), `ARCTRI_E2E`, and `ARCTRI_FAKE_WSL`.

CI performs type checking, linting, unit and integration tests, packaging, and an installer smoke test on a Windows runner. See [the workflow](./.github/workflows/ci.yml).

Contributions and bug reports can be submitted through [GitHub Issues](https://github.com/7sadakonr/Arctri/issues). Consult [`PLAN.md`](./PLAN.md) and [`CHANGELOG.md`](./CHANGELOG.md) for architectural context and release history.

## Troubleshooting and reporting problems

**Where things are.** Log: `arctri.log` in the `logs` folder of the user-data folder (Windows `%APPDATA%\Arctri`, macOS `~/Library/Application Support/Arctri`; 5 files of up to 5 MB). It holds lifecycle events and errors, never terminal contents, and home-folder paths and token-shaped strings are masked when written. Preferences: `preferences.json`. History and saved tabs: `arctri.db` (a copy `arctri.db.bak-v<n>` is kept before a newer version changes it).

**Reporting.** **Settings > Copy recent log** copies the last 200 lines, masked again; read it before posting. Open an issue with the [template](https://github.com/7sadakonr/Arctri/issues/new/choose): version, OS, shell, steps, expected and actual result. For Thai text problems name the input method and the program (shell, Claude Code, Codex). Never post terminal output that holds secrets.

| Problem | What to do |
| --- | --- |
| A tab says "The session could not start" | The message names the reason and what to try. A normal shell never needs an AI agent or WSL. |
| An AI agent is "not installed" | Arctri does not install agents. Install Claude Code or Codex CLI from their guides (linked on the welcome page under *Your environment*), or set the executable path in Settings > AI agents. Agents in WSL are looked for in each running distribution. |
| WSL tabs are missing | The welcome page says why (not installed, turned off, no distribution, error). Run `wsl --status` in PowerShell. A stopped distribution is not started just to look for agents; open a tab in it first. |
| Garbled text after switching tabs | Fixed in 0.3.3-beta (repaint once the layout settles). If it still happens, report it with the GPU/driver. |
| An update fails | The dialog says why (offline, files missing, checksum mismatch) and the installed version keeps working. Retry later, turn automatic checks off in Settings > Updates, or install from the Releases page. |
| The app does not start after an update | Install the previous version from its release page; your data is kept. If the database was changed, copy `arctri.db.bak-v<n>` over `arctri.db` while Arctri is closed. |
| The window went blank | A crashed page is reloaded and the terminals keep running; after repeated crashes it stays blank. Restart Arctri and report with the log. |

Signing improves trust but does not by itself remove SmartScreen warnings, which also depend on reputation.

**How well is it tested?** Automated checks run on every change: type checking, linting, unit tests, integration tests with real PowerShell sessions, a silent install of the Windows installer, and an upgrade from one installed version to the next (plus a missing update feed and a damaged installer). Checks on real machines are partial: Thai input with a real IME, sleep/resume, 8-hour sessions, Windows 11 and macOS on Intel have not been run systematically yet, so they are not claimed as supported results.

## Privacy and security

- **Logs:** a local rotating log (`arctri.log`) records lifecycle events and errors, never terminal contents; home-folder paths and token-shaped strings are masked when written, and nothing is sent anywhere. You decide what to paste into a report.
- **Local-first:** Arctri itself does not require an account or include its own telemetry service. The only request it makes on its own is the update check against GitHub Releases (no account, no identifiers sent beyond what an HTTPS request to GitHub carries); turn it off in Settings > Updates.
- **Data on your PC:** Preferences are stored with `electron-store`; command history and saved session information use a local SQLite database in Electron's user-data folder.
- **OS access stays outside the UI:** Terminal processes and filesystem operations are controlled by the main process. Electron uses `contextIsolation`, sandboxing, disabled renderer Node integration, a restricted preload API, and a Content Security Policy.
- **Agent permissions remain native:** Claude Code/Codex authentication and permission decisions belong to those applications. Arctri does not grant them additional permissions automatically.
- **External network activity:** An agent CLI or a command you run may contact external services under its own terms and configuration. Arctri's local-first design does not mean those third-party tools are offline.
- **Executable commands are powerful:** Like any terminal, Arctri can run commands that modify or delete files. Review commands, agent requests, and permissions before approving them.

## Current scope and limitations

- **Windows x64** is the primary target. **macOS** builds are new, unsigned and have had less testing; Linux installers are not part of this release.
- **WSL2 is optional**, but usable WSL distributions must be installed separately.
- **Shell command blocks depend on integration.** If command boundaries are unavailable, the tab remains a functional classic terminal. Interactive/full-screen programs use the live terminal interface.
- **Agent integration currently targets Claude Code and Codex CLI.** Their executables must be installed separately, and available toolbar options vary by CLI version.
- **File editing targets text files**, with a 5 MiB read/edit limit; binary files are not editable in the built-in viewer.
- **Installer signing is not yet provided**, so SmartScreen warnings are possible.

For release-by-release changes, see the [changelog](./CHANGELOG.md).

## License

Arctri's original source code is released under the **MIT License**. See [LICENSE](./LICENSE) for the full license text. Third-party libraries and assets remain subject to their own licenses; bundled file icons include their own [Material Icon Theme attribution](./src/renderer/public/file-icons/LICENSE.material-icon-theme.txt).

## Author

**Jetsadakorn Muangwichit (เจษฎากร ม่วงวิจิตร)**  
GitHub: [@7sadakonr](https://github.com/7sadakonr)

**Kittipop Sanpho (กิตติภพ สารโพธิ์)**  
GitHub: [@kttpx](https://github.com/kktpx)

**Thitipong Songkasin (ฐิติพงษ์ สงกะสิน)** 
GitHub: [@TTthiti01](https://github.com/TTthiti01)


© 2026 Arctri. Licensed under MIT.
