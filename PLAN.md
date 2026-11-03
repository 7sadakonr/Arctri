# Arctri — MVP 1 (v0.1.0) Development Plan

> สถานะ: **อนุมัติแล้ว (2026-10-09)** ขั้นถัดไปคือ Phase 0 (bootstrap และ PoCs)
> ภาษา: ใช้ภาษาไทยเป็นหลัก ส่วนศัพท์เทคนิค ชื่อไฟล์ และโค้ดคงเป็นภาษาอังกฤษ

---

## 0. Context และผลการตรวจสภาพแวดล้อม

Arctri คือ terminal สำหรับ Windows ที่ออกแบบรอบการใช้ AI coding agent (Codex CLI, Claude Code) โดยมี command blocks แบบ Warp, autocomplete, รองรับ WSL2 และภาษาไทยเต็มรูปแบบ terminal ต้องเป็นพื้นที่ทำงานหลัก ไม่ใช่ IDE

ผลการตรวจ repo และเครื่องพัฒนา (2026-10-09):

| รายการ | ผล | ผลต่อแผน |
|---|---|---|
| Repo `D:\Desktop\Arctri` | ว่างเปล่า ไม่มี git | วางโครงสร้างใหม่ทั้งหมด |
| OS | Windows 10 Pro 22H2 build 19045 | เป็นเครื่องทดสอบ Win10 ได้ทันที ยังไม่มีเครื่อง Win11 |
| Node (Windows) | v24.16.0, npm 12.2.0, ไม่มี pnpm | ใช้ **npm** |
| Node (WSL) | v22.23.3 | **ห้าม** รัน `npm install` จาก WSL ใน repo นี้ เพราะจะได้ native binary ของ Linux ต้องสั่งผ่าน Node ฝั่ง Windows เสมอ (`powershell.exe -Command "cd D:\Desktop\Arctri; npm ..."`) |
| Shells | Windows PowerShell 5.1.19041, PowerShell 7 (`C:\Program Files\PowerShell\7\pwsh.exe`), cmd | ทดสอบได้ครบทั้งสาม |
| WSL | WSL2, distro `Ubuntu` (Running) มี bash และ zsh | ทดสอบ WSL bash/zsh ได้ |
| Agents | Claude Code: มีเฉพาะใน WSL (`~/.local/bin/claude`) · Codex: WSL (`/usr/bin/codex`) และ Windows (`codex.exe` แบบ native และ npm shim `codex.cmd`) | ทดสอบได้ทั้งกรณี "ติดตั้งแล้ว" และ "ไม่ได้ติดตั้ง" (Claude บน Windows) |
| VS Build Tools | **ไม่มี** (ไม่พบ vswhere) และ `python.exe` เป็นแค่ stub ของ WindowsApps | native module ต้องใช้ prebuilt binary เท่านั้น ถ้า prebuild ไม่มีต้องติดตั้ง VS 2022 Build Tools (C++ workload) กับ Python 3 จริง ดู PoC-6 |

---

## 1. ขอบเขต MVP 1 แยกตามระดับการรองรับ

### 1.1 Fully supported (ต้องผ่าน acceptance)
- PTY จริงผ่าน node-pty + ConPTY สำหรับ PowerShell 5.1, PowerShell 7, cmd, WSL bash, WSL zsh
- Tabs หลาย session, rename, สลับ tab โดย process ยังทำงานอยู่, ปิด tab แล้วไม่มี process ค้าง
- Resize, scrollback, ANSI/256/truecolor, copy/paste, bracketed paste, alternate screen (vim, htop, less), ssh
- Command blocks สำหรับ **WSL bash** และ **PowerShell 5.1/7** (command, output, status, exit code, duration, cwd, shell, timestamp, copy/rerun/collapse/navigate)
- Command blocks สำหรับ **WSL zsh** (priority 3 แต่ยังอยู่ใน fully supported ถ้า PoC ผ่าน)
- Classic (raw) mode อัตโนมัติเมื่อ shell integration ใช้งานไม่ได้
- Autocomplete ใน command editor ของ Arctri: history, คำสั่งจาก PATH, cmdlets/builtins, file/dir, git subcommand/branch, npm/pnpm scripts แยกตาม environment
- WSL detection, รายชื่อ distro, เปิด shell ใน distro ที่เลือก, จัดการกรณีไม่มี WSL/distro หาย/distro หยุด
- Agent adapters สำหรับ Codex CLI และ Claude Code: detect แยก Windows/WSL, launch แบบ native TUI, หลาย session, แสดงตัวตน agent, จัดการ process จบ, error ที่เข้าใจง่าย
- Bottom toolbar ที่เปลี่ยนตามประเภท session โดยแสดงเฉพาะ control ที่ทำงานได้จริง
- พิมพ์ภาษาไทย (Thai keyboard layout และ IME composition) ใน command editor, ใน terminal และใน agent session; UI แปลไทย/อังกฤษ
- ตัวติดตั้ง NSIS สำหรับ Windows 10/11 x64

### 1.2 Best-effort (ทำงานได้ในกรณีปกติ แต่ไม่รับประกันทุกกรณี)
- cmd.exe: ติดตาม cwd ผ่าน `PROMPT` แต่ **ไม่มี command blocks** (cmd ไม่มี hook ก่อนรันคำสั่งและไม่รายงาน exit code ใน prompt)
- shell อื่นใน WSL (fish, sh) และ distro อื่นที่ไม่ใช่ Ubuntu/Debian: เปิดได้ใน classic mode
- การแสดงตัวตน agent เมื่อผู้ใช้พิมพ์ `claude`/`codex` เองใน shell tab (อ้างอิง command line ที่ shell integration รายงาน)
- สถานะ agent แบบ structured ผ่านกลไกที่ CLI รองรับอย่างเป็นทางการ (Claude Code hooks, Codex `notify`) เปิดใช้แบบ opt-in เท่านั้น
- การ render อักษรไทยที่มีสระบน/ล่างและวรรณยุกต์ซ้อนกันให้ตรง cell ทุกกรณี ขึ้นกับว่าโปรแกรม ConPTY และ xterm.js คำนวณความกว้างตรงกันหรือไม่ (ดู §11)
- Import history จากไฟล์ของ shell (`~/.bash_history`, PSReadLine history) แบบ opt-in

### 1.3 Technical limitations (บอกผู้ใช้ตรงๆ)
- process ที่รันอยู่ไม่รอดเมื่อปิดแอป ตอนเปิดใหม่จะคืนได้แค่ tab layout, cwd และ metadata
- ใน block mode ผู้ใช้จะไม่เห็น prompt ที่ shell วาดเอง (เช่น oh-my-posh/starship) เพราะ Arctri แสดง cwd/branch ใน toolbar แทน ถ้าต้องการ prompt เดิมให้ใช้ classic mode
- Autocomplete ทำงานใน command editor ของ Arctri เท่านั้น ใน classic mode และขณะที่โปรแกรม interactive ทำงานอยู่ ปุ่ม Tab จะส่งให้ shell/โปรแกรมตามปกติ
- ยังไม่รองรับ programmable completion ของ shell (bash-completion specs, PowerShell argument completers) ใน MVP 1
- Output ของ block เก็บได้ไม่เกิน scrollback limit ถ้าเกินจะแสดงป้าย "truncated"
- Output ของ block ไม่บันทึกลงดิสก์ บันทึกเฉพาะ metadata และ command
- ไม่สามารถเปลี่ยน model/permission ของ agent ระหว่าง session ผ่าน API ใดๆ ได้ toolbar จะแสดงค่าที่ "launch ด้วย" และมีทางลัดส่ง slash command ที่ CLI รองรับเองเท่านั้น
- Windows x64 เท่านั้น ARM64 เลื่อนไป MVP 2
- ตัวติดตั้งยังไม่ได้ code sign จึงจะเจอคำเตือน SmartScreen

### 1.4 Deferred to MVP 2
ดู §17

---

## 2. ความเสี่ยงทางเทคนิคหลักและ Proof-of-Concept (Phase 0)

| # | ความเสี่ยง | ทำไมเสี่ยง | PoC | เกณฑ์ตัดสิน / Fallback |
|---|---|---|---|---|
| R1 | **ConPTY บน Win10 กับ OSC passthrough** | ConPTY ของ Windows 10 (inbox) render buffer ของตัวเองใหม่ อาจกลืน OSC ที่ไม่รู้จัก หรือส่งออกมา**ผิดลำดับ**เทียบกับข้อความ ทำให้ block boundary คลาดเคลื่อน | **PoC-1** | ทดสอบ inbox conpty กับ `conpty.dll` ที่ node-pty bundle มา (`useConptyDll`) บน pwsh 5.1/7 และ wsl bash ถ้า bundled ผ่านให้ใช้เป็นค่า default ถ้าไม่ผ่านทั้งคู่ให้ใช้ fallback แบบ side channel (named pipe พร้อมเลขลำดับ) และลดเกณฑ์ block เป็น best-effort บน Win10 |
| R2 | **PTY rendering กับ block rendering** | ถ้าล้าง xterm ฝั่งเราเอง ConPTY จะไม่รู้ และเมื่อ repaint (เช่นตอน resize) จะวาดข้อมูลเก่ากลับมา | **PoC-2** | ใช้ "clear ผ่าน shell" (ดู §6) ทดสอบ resize ระหว่าง/หลังคำสั่ง 50 ครั้งแล้วต้องไม่มีข้อความผี |
| R3 | **ภาษาไทยกับความกว้าง cell** | มีสามฝ่ายคำนวณความกว้างไม่ตรงกัน คือโปรแกรม (glibc wcwidth / PSReadLine / Ink), ConPTY และ xterm.js ผลคือ cursor เพี้ยน | **PoC-3** | เทียบ inbox กับ bundled conpty, xterm `unicode11` กับ `unicode-graphemes` addon, และ font fallback แล้วบันทึกผลเป็น matrix แยกต่อ shell |
| R4 | **Agent TUI ผ่าน ConPTY** | Claude Code (Ink) วาดใน normal buffer และ redraw หนัก Codex ใช้ alt screen ปุ่ม Shift+Enter, Esc, Ctrl+C และ paste ต้องผ่าน ConPTY ได้ถูก | **PoC-4** | ใช้งานจริงใน Windows/WSL ครบ 15 นาที ทุกปุ่มต้องทำงาน resize ต้องไม่พัง |
| R5 | **ส่งคำสั่งจาก editor เข้า shell** | multiline บน PSReadLine (newline = Enter), ต้องล้างบรรทัดที่ค้างใน line editor ก่อน | **PoC-5** | bash/zsh ใช้ bracketed paste ส่วน pwsh ลอง win32-input-mode Shift+Enter ผ่าน bundled conpty ถ้าไม่ได้ใช้ฟังก์ชันใน integration script ที่รับ base64 แล้ว `Invoke`|
| R6 | **Native modules และ packaging** | node-pty / better-sqlite3 ต้องตรง ABI ของ Electron เครื่องนี้ไม่มี build tools | **PoC-6** | build NSIS แล้วติดตั้งบน Win10 ที่สะอาด ถ้า better-sqlite3 ไม่มี prebuild สำหรับ Electron เวอร์ชันที่เลือก ให้ใช้ `node:sqlite` ที่มากับ Electron/Node แทนผ่าน interface เดียวกัน |
| R7 | **Throughput** | output ปริมาณมากผ่าน IPC ทำให้ UI ค้าง | **PoC-7** | `cat` ไฟล์ 100 MB แล้ว UI ต้องตอบสนอง และ Ctrl+C ต้องหยุดได้ภายใน 1 วินาที |
| R8 | **WSL process lifecycle** | ปิด `wsl.exe` แล้ว process ใน Linux อาจค้าง distro ที่หยุดอยู่ใช้เวลา boot หลายวินาที | รวมใน PoC-1/2 | ตรวจ `ps` ใน distro หลังปิด tab ต้องไม่มี process ของ session เหลือ |

ผล PoC ทุกตัวบันทึกเป็น `docs/decisions/ADR-00x-*.md` (บริบท ผลทดสอบ การตัดสินใจ) ก่อนเริ่มงานที่เกี่ยวข้อง

---

## 3. สถาปัตยกรรม

### 3.1 ภาพรวม process

```
┌──────────────────────────── Electron Main (Node) ─────────────────────────────┐
│ WindowManager   SessionManager ── PtyBackend(node-pty/ConPTY) ── shell/wsl.exe │
│                    │  └─ DataPump (batch + flow control) ──MessagePort──┐      │
│                    └─ ShellIntegrationManager (OSC tokenizer + state machine)  │
│ WslManager ─ WslHelper (long-lived sh per distro)   EnvironmentQueryService     │
│ CompletionEngine (providers)   AgentManager (adapters)   PersistenceService     │
│ IPC router (zod-validated)                                                       │
└──────────────────────────────────────┬─────────────────────────────┬────────────┘
                        ipcRenderer.invoke/on (control)      MessagePort (PTY bytes)
┌──────────────────────── Preload (contextBridge) ───────────────────────────────┐
│ window.arctri = { sessions, wsl, agents, completion, history, prefs, … }     │
└──────────────────────────────────────┬─────────────────────────────────────────┘
┌──────────────────────── Renderer (React) ──────────────────────────────────────┐
│ TitleBar+Tabs │ SessionView = BlockList (finished) + LiveTerminal (xterm.js)    │
│ CommandEditor + AutocompleteOverlay │ BottomToolbar (shell/agent variants)      │
│ Zustand stores: sessions, blocks, prefs, ui                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 หลักการแบ่งหน้าที่
- **Main** เป็นเจ้าของทุกอย่างที่แตะ OS ได้แก่ PTY, filesystem, การ spawn process, WSL, SQLite และ prefs
- **Preload** เปิด API แคบๆ ที่มี type ชัดเจน ไม่มีฟังก์ชันรันคำสั่งทั่วไป และไม่ส่ง `ipcRenderer` ออกไปทั้งก้อน
- **Renderer** เป็นเจ้าของ "geometry" ของ terminal ได้แก่ xterm buffer, markers, snapshots และ UI state
- **`src/shared`** เป็นโค้ด TypeScript ล้วนที่ไม่ import electron/node (OSC tokenizer, state machine, ranking, types) ใช้ได้ทั้ง main, renderer และ test
- **Semantic state** (shell phase, cwd, command text, exit code) คำนวณใน main จาก stream เดียวกับที่ส่งไป renderer ส่วน **ตำแหน่งใน buffer** คำนวณใน renderer ด้วย xterm parser hooks ทั้งสองฝั่ง key ด้วย `commandId` ที่ integration script สร้าง ทำให้จับคู่กันได้แน่นอนโดยไม่ต้องพึ่ง timing
- ทุก tab มี xterm instance ที่มีชีวิตตลอด แม้ tab จะไม่ได้แสดงอยู่ (ซ่อนด้วย CSS ไม่ unmount) เพื่อไม่ให้ buffer หลุดจาก PTY

### 3.3 Data path ของ PTY
1. node-pty `onData` (string UTF-8) เข้า `DataPump` ของ session
2. `ShellIntegrationManager.feed(chunk)` อ่าน OSC แบบ streaming (รองรับ sequence ที่ถูกตัดข้าม chunk) **โดยไม่แก้ไข stream**
3. DataPump รวม chunk ทุก ~8 ms หรือ 64 KB แล้วส่งผ่าน `MessagePort` ของ session (`MessageChannelMain`) ไม่ผ่าน `ipcMain` ทั่วไป
4. Flow control: renderer ack จำนวนไบต์เมื่อ `term.write(data, cb)` เสร็จ ถ้าค้างเกิน 2 MB main จะ `pty.pause()` และ `resume()` เมื่อต่ำกว่า 512 KB
5. Input: renderer → `sessions.write(id, data)` (invoke แบบไม่รอผล) → `pty.write`

---

## 4. โครงสร้างโฟลเดอร์

```
D:\Desktop\Arctri\                 (repo root)
├─ PLAN.md
├─ package.json  .npmrc  tsconfig.json  tsconfig.node.json  tsconfig.web.json
├─ electron.vite.config.ts         # build main/preload/renderer
├─ electron-builder.yml            # NSIS, asarUnpack, extraResources
├─ vitest.config.ts  playwright.config.ts  components.json (shadcn)
├─ resources/
│  ├─ icons/                       # ไอคอนของ Arctri เอง
│  └─ shell-integration/
│     ├─ arctri.ps1             # PowerShell 5.1 + 7
│     ├─ arctri.bash            # bash ≥ 4.4 (ใช้ PS0)
│     ├─ zsh/.zshenv .zshrc .zprofile .zlogin   # ZDOTDIR shim
│     ├─ cmd-prompt.txt            # template PROMPT สำหรับ cwd
│     └─ wsl-helper.sh             # helper POSIX sh สำหรับ query ใน WSL
├─ src/
│  ├─ shared/                      # pure TS
│  │  ├─ types/ env.ts session.ts block.ts completion.ts agent.ts
│  │  ├─ ipc/contract.ts           # channel names + zod schemas
│  │  ├─ osc/tokenizer.ts  osc/protocol.ts
│  │  ├─ shell/state-machine.ts
│  │  ├─ completion/tokenize.ts  completion/rank.ts
│  │  └─ i18n/en.ts  i18n/th.ts  i18n/index.ts
│  ├─ main/
│  │  ├─ index.ts  window.ts  logger.ts  single-instance.ts
│  │  ├─ ipc/router.ts  ipc/handlers/*.ts
│  │  ├─ pty/pty-backend.ts  pty/session-manager.ts  pty/data-pump.ts  pty/process-cleanup.ts
│  │  ├─ shell/profiles.ts  shell/discovery.ts  shell/integration-manager.ts
│  │  │   shell/adapters/{pwsh,bash,zsh,cmd}.ts
│  │  ├─ wsl/wsl-manager.ts  wsl/list-parser.ts  wsl/path-mapper.ts  wsl/helper-client.ts
│  │  ├─ env-query/windows.ts  env-query/wsl.ts  env-query/service.ts
│  │  ├─ completion/engine.ts  completion/providers/{history,commands,paths,git,scripts}.ts
│  │  ├─ agents/agent-manager.ts  agents/adapters/{claude-code,codex}.ts  agents/detect.ts
│  │  └─ persistence/prefs.ts  persistence/db.ts  persistence/migrations/*.sql
│  │      persistence/history-repo.ts  persistence/session-repo.ts
│  ├─ preload/index.ts
│  └─ renderer/
│     ├─ index.html  main.tsx  App.tsx  styles/globals.css  assets/fonts/
│     ├─ components/ui/            # shadcn (ใช้เฉพาะที่จำเป็น)
│     ├─ features/
│     │  ├─ titlebar/  tabs/  launcher/ (เมนู new tab: shells, distros, agents)
│     │  ├─ terminal/ LiveTerminal.tsx  xterm-host.ts  block-tracker.ts  snapshot.ts  keymap.ts
│     │  ├─ blocks/ BlockList.tsx  BlockCard.tsx  styled-lines.tsx  block-nav.ts
│     │  ├─ editor/ CommandEditor.tsx  AutocompleteOverlay.tsx  ghost-text.ts
│     │  ├─ toolbar/ BottomToolbar.tsx  ShellToolbar.tsx  AgentToolbar.tsx
│     │  └─ settings/ SettingsDialog.tsx
│     ├─ stores/ sessions.ts  blocks.ts  prefs.ts  ui.ts
│     └─ lib/ api.ts  i18n.ts  format.ts
├─ tests/
│  ├─ integration/                 # Windows เท่านั้น: node-pty จริง + @xterm/headless
│  ├─ e2e/                         # Playwright _electron
│  └─ fixtures/                    # ไฟล์ทดสอบ ANSI, ไทย, output ขนาดใหญ่
└─ docs/
   ├─ decisions/ADR-*.md
   ├─ testing/manual-checklist.md  testing/thai-matrix.md
   └─ RELEASE.md
```

Unit test วางไว้ข้างไฟล์ (`*.test.ts`)

---

## 5. Interfaces ของ core services

```ts
// ── shared/types/env.ts ─────────────────────────────────────────────
export type EnvironmentRef = { kind: 'windows' } | { kind: 'wsl'; distro: string };
export type WinPath = string & { readonly __brand: 'WinPath' };
export type PosixPath = string & { readonly __brand: 'PosixPath' };
export type EnvPath =
  | { env: 'windows'; path: WinPath }
  | { env: 'wsl'; distro: string; path: PosixPath };
export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'other';

export interface ShellProfile {
  id: string;                    // 'pwsh', 'powershell', 'cmd', 'wsl:Ubuntu:bash'
  label: string;
  env: EnvironmentRef;
  shell: ShellKind;
  executable: string;            // Windows path ของ exe ที่ spawn จริง (pwsh.exe / wsl.exe)
  integration: 'blocks' | 'cwd-only' | 'none';
}

// ── shared/types/session.ts ─────────────────────────────────────────
export type SessionId = string & { readonly __brand: 'SessionId' };
export type Presentation = 'blocks' | 'classic';          // กำหนดตอน spawn
export type ShellPhase = 'unknown' | 'prompt' | 'editing' | 'executing';
export type IntegrationStatus = 'pending' | 'active' | 'unavailable' | 'degraded';

export interface SessionSpec {
  profileId: string;
  cwd?: EnvPath;
  kind: 'shell' | 'agent';
  agent?: { adapterId: AgentId; installationId: string; options: AgentLaunchOptions };
  presentation?: Presentation;   // default มาจาก prefs และ capability ของ profile
  title?: string;
  cols: number; rows: number;
}

export interface SessionInfo {
  id: SessionId; title: string; titleSource: 'user' | 'auto';
  profileId: string; env: EnvironmentRef; shell: ShellKind;
  kind: 'shell' | 'agent'; agentId?: AgentId;
  presentation: Presentation; integration: IntegrationStatus;
  phase: ShellPhase; cwd?: EnvPath; gitBranch?: string;
  pid: number; state: 'starting' | 'running' | 'exited' | 'failed';
  exit?: { code: number | null; reason?: string };
  createdAt: number;
}

export interface TerminalSessionManager {
  create(spec: SessionSpec): Promise<SessionInfo>;
  write(id: SessionId, data: string): void;
  submitCommand(id: SessionId, command: string): Result<void, 'not-at-prompt' | 'no-integration'>;
  resize(id: SessionId, cols: number, rows: number): void;
  rename(id: SessionId, title: string): void;
  close(id: SessionId, opts?: { force?: boolean }): Promise<void>;
  list(): SessionInfo[];
  onChange(cb: (info: SessionInfo) => void): Unsubscribe;
}

export interface PtyBackend {            // แยกไว้เพื่อ fake ใน unit test
  spawn(o: { file: string; args: string[]; cwd: string; env: Record<string, string>;
             cols: number; rows: number; useConptyDll: boolean }): PtyProcess;
}

// ── shared/osc/protocol.ts ──────────────────────────────────────────
// OSC 133;A|B|C|D[;exit]  (มาตรฐาน FinalTerm)
// OSC 6973;<key>=<value>;n=<nonce>    (ของ Arctri ค่า value เข้ารหัส base64url)
//   keys: hello (shell,version,blocks), cmd (id,text), cwd (path), env (distro)
export type ShellEvent =
  | { t: 'hello'; shell: ShellKind; version: string; blocks: boolean }
  | { t: 'promptStart' } | { t: 'inputStart' }
  | { t: 'commandLine'; commandId: number; text: string }
  | { t: 'executed'; commandId?: number }
  | { t: 'finished'; exitCode?: number }
  | { t: 'cwd'; path: string };

export interface OscTokenizer {          // streaming ไม่แก้ไขข้อมูล
  push(chunk: string): Array<{ kind: 'osc'; id: number; payload: string }>;
}

export interface ShellStateMachine {
  apply(ev: ShellEvent, now: number): StateTransition;   // คืน transition หรือ 'rejected'
  readonly phase: ShellPhase;
  readonly current?: PendingCommand;
}

export interface ShellIntegrationAdapter {
  shell: ShellKind;
  buildLaunch(p: ShellProfile, ctx: LaunchContext): { file: string; args: string[]; env: Record<string, string> };
  clearLineInput: string;                 // bash/zsh: '\x15' (Ctrl+U) · PSReadLine: '\x1b' (RevertLine)
  encodeSubmit(command: string): string;  // bytes ที่เขียนลง PTY
  supportsBlocks: boolean;
}

// ── shared/types/block.ts ───────────────────────────────────────────
export interface CommandBlock {
  id: string; sessionId: SessionId; commandId: number;
  command: string; cwd?: EnvPath; env: EnvironmentRef; shell: ShellKind;
  status: 'running' | 'success' | 'failed' | 'interrupted' | 'unknown';
  exitCode?: number; startedAt: number; endedAt?: number; durationMs?: number;
  usedAltScreen: boolean;
  output?: BlockSnapshot;                 // อยู่ใน renderer เท่านั้น
  collapsed: boolean;
}
export interface BlockSnapshot {
  lines: StyledLine[];                    // logical lines (รวมบรรทัดที่ wrap แล้ว)
  styles: CellStyle[];                    // ตาราง style ที่ใช้ร่วมกัน
  truncated: boolean; byteSize: number;
}
export interface StyledLine { runs: Array<{ text: string; style: number }> }

// ── shared/types/completion.ts ──────────────────────────────────────
export interface CompletionContext {
  sessionId: SessionId; env: EnvironmentRef; shell: ShellKind; cwd: EnvPath;
  line: string; cursor: number;           // UTF-16 index ใน editor
}
export interface CompletionItem {
  label: string; insertText: string; replace: [start: number, end: number];
  kind: 'command' | 'path' | 'dir' | 'history' | 'git-subcommand' | 'git-branch' | 'script' | 'flag';
  detail?: string; source: string; score: number;
}
export interface CompletionProvider {
  id: string;
  appliesTo(ctx: CompletionContext, tok: TokenizedLine): boolean;
  provide(ctx: CompletionContext, tok: TokenizedLine, signal: AbortSignal): Promise<CompletionItem[]>;
}
// operation ตายตัวเท่านั้น ไม่มี "รันคำสั่งใดๆ"
export interface EnvironmentQueryService {
  listDir(p: EnvPath, o: { prefix: string; limit: number }): Promise<DirEntry[]>;
  readSmallText(p: EnvPath, maxBytes: number): Promise<string | null>;
  gitBranches(cwd: EnvPath): Promise<string[]>;
  listExecutables(env: EnvironmentRef): Promise<string[]>;   // cache ตาม PATH
}

// ── main/wsl ────────────────────────────────────────────────────────
export type WslStatus =
  | { available: false; reason: 'not-installed' | 'disabled' | 'no-distros' | 'error'; detail?: string }
  | { available: true; defaultDistro?: string };
export interface WslDistro { name: string; state: 'Running' | 'Stopped' | 'Installing' | 'Converting' | 'Uninstalling' | 'Unknown';
                             version: 1 | 2; isDefault: boolean; hiddenByDefault: boolean }
export interface WslManager {
  status(): Promise<WslStatus>;
  listDistros(opts?: { refresh?: boolean }): Promise<WslDistro[]>;
  toPosix(distro: string, p: WinPath): Promise<PosixPath>;
  toWindows(distro: string, p: PosixPath): Promise<WinPath | null>;
  helper(distro: string): WslHelperClient;           // lazy, ปิดเมื่อไม่มี session ของ distro นั้น
}

// ── shared/types/agent.ts ───────────────────────────────────────────
export type AgentId = 'claude-code' | 'codex';
export interface AgentInstallation {
  id: string; adapterId: AgentId; env: EnvironmentRef;
  command: string; resolvedPath?: string; version?: string;
  source: 'path' | 'login-shell' | 'user-configured';
}
export interface AgentCapabilities {
  resumeLast: boolean; resumePicker: boolean;
  launchFlags: { model: boolean; permissionMode: boolean; extraArgs: boolean };
  structuredStatus: 'none' | 'hooks-opt-in';
  nativeCommands: Array<{ label: string; text: string }>;   // ส่งเป็น text เข้า TUI
}
export interface AgentLaunchOptions { cwd?: EnvPath; resume?: 'last' | 'picker'; model?: string;
                                      permissionMode?: string; extraArgs?: string[] }
export interface AgentAdapter {
  id: AgentId; displayName: string;
  detect(env: EnvironmentRef, q: EnvironmentQueryService): Promise<AgentInstallation | null>;
  capabilities(inst: AgentInstallation): AgentCapabilities;
  buildLaunch(inst: AgentInstallation, o: AgentLaunchOptions): LaunchSpec;  // argv array เท่านั้น
}

// ── persistence ─────────────────────────────────────────────────────
export interface HistoryRepo {
  record(e: { envKey: string; command: string; cwd?: string; exitCode?: number; at: number }): void;
  search(envKey: string, prefix: string, limit: number): HistoryEntry[];
}
export interface PersistenceService { prefs: PrefsStore; history: HistoryRepo; sessions: SessionRepo }
```

`envKey` = `windows:pwsh`, `windows:powershell`, `wsl:Ubuntu:bash` เป็นต้น history จะไม่ปนกันข้าม environment

### 5.1 IPC contract (ย่อ)
ทุก channel ประกาศใน `shared/ipc/contract.ts` พร้อม zod schema ทั้งขาเข้าและขาออก main ตรวจทุก argument และตรวจ `event.senderFrame.url` ว่ามาจากหน้าแอปเอง

| Channel | ทิศทาง | หมายเหตุ |
|---|---|---|
| `session:create/close/rename/resize/list` | invoke | |
| `session:write` | send | จำกัด 1 MB ต่อข้อความ |
| `session:submit` | invoke | สำเร็จเฉพาะตอน phase = `prompt`/`editing` |
| `session:changed` | event | SessionInfo |
| `session:port` | event | ส่ง MessagePort ของ PTY data |
| `shell:event` | event | ShellEvent ที่ผ่าน state machine แล้ว |
| `profiles:list`, `wsl:status`, `wsl:distros` | invoke | |
| `completion:query` | invoke | มี requestId เพื่อยกเลิก |
| `agents:detect`, `agents:launch` | invoke | launch = สร้าง session ชนิด agent |
| `history:search`, `prefs:get/set` | invoke | prefs:set ตรวจ key กับ schema |
| `clipboard:*` | ไม่มี | ใช้ `navigator.clipboard` ใน renderer |

---

## 6. Command Blocks ทำงานร่วมกับ PTY จริงอย่างไร

### 6.1 แนวคิดหลัก
- **xterm.js หนึ่งตัวต่อ session คือ terminal emulator ตัวจริงตัวเดียว** ทุกไบต์จาก PTY เขียนลงตัวนี้ตามลำดับ ไม่มีการแยก stream และไม่มี emulator ตัวที่สอง
- Session ใน **block mode** แบ่งหน้าจอเป็นสองชั้นในคอลัมน์เดียวกัน
  1. **BlockList** บล็อกที่จบแล้ว เป็น snapshot แบบอ่านอย่างเดียว render เป็น DOM (virtualized)
  2. **LiveTerminal** xterm ที่ใช้งานอยู่ แสดงเฉพาะตอนคำสั่งกำลังรัน (หรือเมื่อผู้ใช้สลับไปพิมพ์ใน native prompt)
- เมื่อคำสั่งจบ output จะ "ย้าย" จาก xterm ไปเป็น snapshot **ไม่ได้คัดลอก** ข้อมูลจึงมีที่เดียวเสมอ ไม่ซ้ำ

### 6.2 วงจรชีวิตของ block (block mode)
1. **Prompt (A→B)** shell integration ส่ง `OSC 133;A` แล้ววาด prompt แล้วส่ง `OSC 133;B` state = `prompt` ตอนนี้ LiveTerminal ถูกซ่อน (prompt ของ shell อยู่ใน xterm แต่ไม่แสดง) ส่วน CommandEditor ที่ด้านล่างรับ focus
2. **Submit** ผู้ใช้กด Enter ใน editor main เขียน `clearLineInput` ตามด้วย `encodeSubmit(cmd)` ลง PTY ทำให้ shell echo คำสั่งตามปกติ
3. **Executed (E→C)** hook ก่อนรันของ shell (bash `PS0`, zsh `preexec`, PSReadLine Enter handler) ส่ง `OSC 6973;cmd=<id,text>;n=<nonce>` แล้วตามด้วย `OSC 133;C` renderer จะ `registerMarker()` ที่บรรทัด cursor ณ ตอนที่ parser เจอ C (handler ทำงาน synchronous ระหว่าง parse จึงได้ตำแหน่งตรงไบต์) จากนั้นแสดง LiveTerminal แบบเต็มพื้นที่และส่ง focus ให้ xterm เพื่อให้โปรแกรมที่รับ stdin หรือ TUI ใช้งานได้ทันที
4. **Running** output ทั้งหมดไหลเข้า xterm ตามปกติ ทั้ง alt screen, cursor movement และ resize ทุกอย่างเป็นพฤติกรรม terminal จริง ถ้ามี alt-screen (`?1049h`) จะตั้ง `usedAltScreen = true`
5. **Finished (D)** hook หลังคำสั่ง (`PROMPT_COMMAND`/`precmd`/`prompt` function) ส่ง `OSC 133;D;<exit>` ใน handler ของ D renderer ทำ snapshot ช่วง marker C ถึงบรรทัด cursor ของ normal buffer โดยอ่าน `buffer.getLine()` รวมบรรทัดที่ `isWrapped` เป็น logical line แล้วเก็บ style จาก cell attributes
6. **Clear ผ่าน shell** ต่อจาก D hook ของ shell ใน block mode จะส่ง `ESC[H ESC[2J ESC[3J` **ผ่าน PTY** ทำให้ ConPTY และ xterm ล้างหน้าจอตรงกัน (ConPTY รู้เรื่องการล้างเพราะผ่านตัวมันเอง) หลังจากนั้นค่อยวาด prompt ถัดไป ถ้า PoC-1 พบว่า ConPTY ไม่ส่ง `ESC[3J` ออกมา renderer จะเรียก `term.clear()` ใน write-callback ของ chunk นั้นได้อย่างปลอดภัย เพราะ scrollback ของ xterm เป็นข้อมูลฝั่งเราอย่างเดียว ConPTY จะ repaint เฉพาะ viewport
7. Snapshot กลายเป็น `BlockCard` ใน BlockList ส่วน metadata (command, cwd, exit, duration) ส่งไปบันทึกใน SQLite ผ่าน main

ลำดับ 5→6 สำคัญ เพราะ xterm parse ตามลำดับ handler ของ D จึงอ่าน buffer ก่อนเจอ clear เสมอ

### 6.3 ทำไมเลือกแบบนี้ (และไม่เลือกแบบอื่น)
- **ตกแต่ง block บน xterm ตัวเดียวด้วย decorations** ทำได้ง่ายแต่ **ยุบ (collapse) ไม่ได้** เพราะ xterm ซ่อนแถวไม่ได้ จึงใช้แบบนี้เป็น classic mode เท่านั้น
- **สร้าง xterm ใหม่ต่อคำสั่งแล้วล้างฝั่งเรา** จะทำให้ ConPTY และ xterm เห็นหน้าจอไม่ตรงกัน และ repaint ตอน resize จะทำให้หน้าจอเสีย
- แบบที่เลือกทำให้ **selection เป็น DOM selection ปกติ** ข้าม block ได้ ภาษาไทยใน snapshot ใช้ text shaping ของ browser จึงแสดงสระ/วรรณยุกต์ได้ถูกต้อง และ snapshot เป็น logical lines ที่ใช้ `white-space: pre-wrap` จึง **reflow ตามความกว้างหน้าต่างได้เอง** โดยไม่ต้องคุยกับ PTY

### 6.4 กรณีพิเศษ
| กรณี | พฤติกรรม |
|---|---|
| vim/htop/less (alt screen) | รันใน LiveTerminal แบบเต็ม เมื่อจบ block แสดง "Interactive program · 3m 12s" กับ output ใน normal buffer (ถ้ามี) |
| ssh, `python` REPL, `bash` ซ้อน | ไม่มี D จนกว่าจะออก block จึงเป็น "running" และ LiveTerminal เป็น terminal ดิบตลอด ไม่สร้าง block ปลอมจาก shell ปลายทาง (state machine ปฏิเสธ A/C/D ที่ nonce ไม่ตรงหรือลำดับผิด) |
| Ctrl+C | ส่ง `\x03` เข้า PTY เมื่อ D มาพร้อม exit 130 (bash) หรือ PowerShell รายงาน `$?=false` โดยไม่มี exit code จะตั้งสถานะเป็น `interrupted`/`failed` |
| output เกิน scrollback (default 10,000 บรรทัดสำหรับ live, ตั้งค่าได้) | marker C ถูก dispose snapshot เริ่มจากบรรทัดแรกที่ยังเหลือและตั้ง `truncated = true` |
| Resize ระหว่างรัน | resize PTY และ xterm พร้อมกัน (debounce 50 ms) snapshot เก่าจะ reflow ด้วย CSS |
| Resize ขณะซ่อน LiveTerminal | ยัง resize ตามพื้นที่จริงที่ LiveTerminal จะได้ PTY จึงมีขนาดคงที่เสมอ ไม่ resize ตอนสลับแสดง/ซ่อน |
| `clear`/`cls` ภายในคำสั่ง | ล้างเฉพาะ LiveTerminal ของ block นั้น |
| integration ไม่ส่ง `hello` ภายใน prompt แรก | ตั้ง integration = `unavailable` และสลับ session นั้นเป็น classic presentation ได้ทันที เพราะยังไม่มีการ clear ใดๆ เกิดขึ้น (clear จะเกิดหลังจาก hello ยืนยันแล้วเท่านั้น) |
| ลำดับ event ผิด (เช่น D โดยไม่มี C) | state machine บันทึก `degraded` และไม่สร้าง block ถ้าเกิดซ้ำ 3 ครั้งใน session จะแสดง banner แนะนำให้เปิด tab ใหม่แบบ classic |
| ผู้ใช้อยากพิมพ์ใน prompt ของ shell เอง (เช่น Ctrl+R) | shortcut `Ctrl+Shift+Enter`/ปุ่ม "Native prompt" แสดง LiveTerminal และส่ง focus ให้ xterm คำสั่งที่รันจากที่นั่นก็ยังได้ block ปกติ เพราะ hook อยู่ใน shell |

### 6.5 Classic mode
- xterm เต็มพื้นที่ input ไปตรงที่ PTY เหมือน terminal ทั่วไป
- ถ้า integration ยังทำงาน จะวาด decoration บางๆ ที่ gutter ตาม marker (สีตาม exit code) และรองรับ navigate/copy command/copy output/rerun ได้ **แต่ไม่รองรับ collapse** (บอกใน tooltip)
- Presentation เลือกตอนสร้าง tab (ค่าเริ่มต้นตาม profile) การสลับต้องเปิด tab ใหม่ เพราะ hook ที่ clear หน้าจอถูกตั้งตั้งแต่ตอน spawn ผ่าน env `ARCTRI_BLOCKS=1`

### 6.6 Shell integration แต่ละ shell
- **ฉีดสคริปต์โดยไม่แก้ไฟล์ของผู้ใช้** และโหลด rc เดิมของผู้ใช้ก่อนเสมอ
  - pwsh/powershell: `-NoLogo -NoExit -Command ". '<resources>\arctri.ps1'"` สคริปต์ห่อฟังก์ชัน `prompt` เดิม ส่ง D (exit จาก `$?` + `$LASTEXITCODE`) แล้ว A … B ใช้ `Set-PSReadLineKeyHandler -Chord Enter` เพื่อส่ง E/C ก่อน `AcceptLine` ถ้าไม่มี PSReadLine ให้ทำงานแค่ cwd-only
  - bash ใน WSL: `wsl.exe -d <distro> --cd <path> -- bash --rcfile <posix path ของ arctri.bash> -i` สคริปต์ source `~/.bashrc` ก่อน แล้วใช้ `PS0` สำหรับ C, `PROMPT_COMMAND` (ต่อท้ายของเดิม รองรับแบบ array ของ bash 5.1) สำหรับ D/A และต่อท้าย `PS1` ด้วย B ใช้ร่วมกับ bash-preexec ได้
  - zsh ใน WSL: ตั้ง `ZDOTDIR` ไปที่ shim ของเรา (ส่งผ่าน `env ZDOTDIR=… USER_ZDOTDIR=…` ใน argv ของ wsl.exe) shim source ไฟล์เดิมของผู้ใช้ทั้ง 4 ไฟล์ แล้วเพิ่ม `precmd`/`preexec` ผ่าน `add-zsh-hook`
  - cmd: ตั้ง `PROMPT` ให้ส่ง cwd ด้วย `$e]6973;cwd=$P…$e\` ก่อน prompt เดิม (cwd-only)
- Path ของสคริปต์ใน WSL แปลงด้วย `wslpath -u` (รองรับกรณีผู้ใช้เปลี่ยน automount root) ถ้า distro ปิด automount ไว้ จะส่งเนื้อหาสคริปต์ผ่าน env (`WSLENV`) แล้วใช้ `bash --rcfile <(printf %s "$ARCTRI_RC")`
- **Nonce**: main สร้าง nonce สุ่มต่อ session ส่งผ่าน env `ARCTRI_NONCE` property ใน `OSC 6973` ที่ nonce ไม่ตรงจะถูกทิ้ง ป้องกันไฟล์ที่ถูก `cat` ปลอม command text (ซึ่งจะส่งผลต่อปุ่ม Rerun) หรือปลอม cwd
- สคริปต์ integration ต้อง idempotent (ถ้าโหลดซ้ำต้องไม่ซ้อน hook) และไม่ส่ง sequence ใดๆ เมื่อ `ARCTRI_NONCE` ไม่มีค่า (กรณีผู้ใช้ copy สคริปต์ไปใช้ที่อื่น)

### 6.7 State machine (ใน `shared/shell/state-machine.ts`)
```
unknown --hello--> prompt
prompt  --A-->  prompt(promptStart)  --B--> editing
editing --cmd(id,text)--> editing(pending id)  --C--> executing(id)
executing --D(exit?)--> prompt  [emit BlockFinished]
executing --A without D--> prompt [emit BlockFinished(status=unknown)]   # shell crash/exec
any     --exit of PTY--> closed  [running block -> interrupted]
ข้อมูลที่ผิดลำดับ: บันทึก anomaly และไม่ emit block
```
ไม่มีการใช้ timeout ตัดสินว่าคำสั่งจบ timeout มีแค่สำหรับ "ยังไม่ได้รับ hello" (10 วินาที เพื่อเลือก classic) เท่านั้น

---

## 7. Autocomplete ทำงานอย่างปลอดภัยได้อย่างไร

### 7.1 หลักความปลอดภัย
1. **ไม่รันข้อความที่ผู้ใช้พิมพ์หรือ suggestion ใดๆ** การเลือก suggestion จะแค่แทรกข้อความใน editor ต้องกด Enter เองเสมอ
2. Provider เรียกได้เฉพาะ `EnvironmentQueryService` ซึ่งมี operation ตายตัว (list directory, อ่านไฟล์เล็ก, git branches, รายการ executable) ส่งค่าเป็น argv array ไม่ต่อ string เป็นคำสั่ง shell
3. Process ภายนอกที่ใช้มีแค่ `git for-each-ref --format=%(refname:short) refs/heads refs/remotes` (ตั้ง `GIT_OPTIONAL_LOCKS=0`, timeout 1.5 วินาที) และ WSL helper
4. ไม่ query shell ที่ผู้ใช้กำลังใช้อยู่ (ไม่ฉีด input เข้า PTY เพื่อขอ completion)
5. ทุก request มี `AbortSignal` เมื่อพิมพ์ต่อจะยกเลิก request เก่า และใช้ debounce 30 ms
6. ตอนรอผลจะไม่บล็อกการพิมพ์ ถ้า provider ตัวไหนช้าก็แสดงเท่าที่มี

### 7.2 Providers
| Provider | Windows | WSL | Cache |
|---|---|---|---|
| history | SQLite ตาม envKey (prefix + frecency) | เหมือนกัน | ไม่ต้อง |
| commands | สแกน PATH × PATHEXT (`fs.readdir`) + รายการ cmdlet/alias แบบ static ของ PS 5.1/7 + builtins ของ cmd | `wsl-helper.sh` list ไฟล์ executable ตาม `$PATH` ที่ integration รายงาน + builtins ของ bash/zsh แบบ static | 5 นาที หรือเมื่อ PATH เปลี่ยน |
| paths | `fs.readdir` เทียบกับ cwd รองรับ `~`, `.\`, `..`, ช่องว่าง, quote | helper `ls` ภายใน distro (เร็วกว่า 9P ผ่าน `\\wsl.localhost`) | ต่อ directory 2 วินาที |
| git | subcommands แบบ static + branches เมื่อ token ก่อนหน้าเป็น `checkout/switch/merge/rebase/branch -d` | ผ่าน helper | ต่อ repo 10 วินาที |
| scripts | อ่าน `package.json` ใกล้ cwd ที่สุด (ไม่เกิน 512 KB) ใช้หลัง `npm run`, `pnpm`, `pnpm run`, `yarn` | อ่านผ่าน helper | ตาม mtime |

### 7.3 Tokenizer และการแทรกข้อความ
- `shared/completion/tokenize.ts` แยก token ตามกฎ quoting ของแต่ละ shell (PowerShell: `'…'`, `"…"`, backtick · POSIX: `'…'`, `"…"`, `\`) เพื่อรู้ว่า cursor อยู่ token ไหน และ token นั้นเป็นตำแหน่งคำสั่งหรืออาร์กิวเมนต์
- path ที่มีช่องว่างจะถูก quote ตามกฎของ shell นั้น (PowerShell ใช้ `'C:\My Dir\'` และเติม `& ` ถ้าเป็นตำแหน่งคำสั่ง ส่วน POSIX escape ด้วย `\ `)
- ตำแหน่ง cursor ใช้ UTF-16 index ใน editor (ไม่ใช่ cell ของ terminal) ข้อความไทยจึงไม่กระทบ

### 7.4 Ranking (`shared/completion/rank.ts`)
`score = matchQuality (exact prefix > word-boundary > fuzzy) × sourceWeight + frecency(history) + cwdBonus(ใช้ใน cwd นี้) − lengthPenalty` รวม label ซ้ำจากหลาย source ให้เหลือตัวเดียว

### 7.5 UI ของ editor
- Dropdown ใต้/เหนือ editor สูงสุด 8 รายการ เลื่อนด้วย ↑/↓ Tab หรือ Enter เพื่อรับ (Enter รับเฉพาะตอน dropdown เปิดและมีรายการที่เลือกอยู่) Esc ปิด
- Ghost text แสดงเฉพาะเมื่อ "ปลอดภัย" คือ cursor อยู่ท้ายบรรทัด มีผลจาก history ที่ prefix ตรงพอดี และไม่ได้อยู่ระหว่าง IME composition กด → หรือ End เพื่อรับ
- ↑/↓ เมื่อ dropdown ปิด = เลื่อน history ของ environment นั้น
- Editor ปิดการทำงานขณะที่ phase = `executing` (คีย์ไปที่ LiveTerminal) จึงไม่รบกวน TUI และ agent

---

## 8. การแยก Windows กับ WSL

- **ชนิดข้อมูลแยกกันตั้งแต่ระดับ type**: `EnvironmentRef`, `WinPath`/`PosixPath` (branded) และ `EnvPath` ทุก service ที่ทำงานกับไฟล์หรือคำสั่งรับ `EnvironmentRef` เสมอ แปลง path ได้ทางเดียวคือผ่าน `PathMapper`
- **PathMapper**: แปลง Windows→WSL ด้วย `wslpath` ผ่าน helper (รองรับ automount root ที่ไม่ใช่ `/mnt`) และ cache ตาม drive ส่วน WSL→Windows คืน `\\wsl.localhost\<distro>\…` หรือ path ไดรฟ์ ใช้ตอนเปิดใน Explorer และตอนที่ agent ฝั่ง Windows ต้องเปิด cwd ของ WSL (ซึ่งจะเตือนว่าช้า)
- **WSL discovery** (ไม่ start distro ใดๆ):
  1. ตรวจว่ามี `wsl.exe` ใน System32 หรือไม่
  2. อ่าน registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` ด้วย `reg.exe query` เพื่อดูชื่อ distro, version และ default (ไม่ต้องพึ่ง output ของ wsl.exe)
  3. `wsl.exe --list --verbose` เพื่อดู state (Running/Stopped) โดยตั้ง `WSL_UTF8=1` และ decode รองรับทั้ง UTF-8 และ UTF-16LE (WSL รุ่นเก่า)
  4. ซ่อน `docker-desktop*` และ distro ที่เป็น WSL1 (แสดงใน "Other" พร้อมคำอธิบาย)
  5. ถ้าไม่มี WSL เลยหรือคำสั่งล้มเหลว ให้คืน `available:false` UI จะซ่อนกลุ่ม WSL และแสดงข้อความสั้นๆ ใน launcher ไม่มี error dialog
- **เปิด session**: `wsl.exe -d <name> --cd <posix cwd> -- <shell> …` ถ้า distro เป็น Stopped จะแสดงสถานะ "Starting Ubuntu…" ใน tab ถ้า wsl.exe exit code ≠ 0 ภายใน 10 วินาทีแรกและไม่เคยได้ hello จะแสดง error card ที่อ่าน stderr/ข้อความจาก wsl.exe (เช่น distro ไม่พบ) พร้อมปุ่ม "เลือก distro อื่น"
- **Lifecycle**: ปิด tab → `pty.kill()` → ConPTY ปิด console → `wsl.exe` จบ → shell ใน Linux ได้ SIGHUP ตรวจด้วย helper ว่าไม่มี process ที่มี `ARCTRI_SESSION=<id>` ใน environ เหลืออยู่ ถ้ามีให้ส่ง `kill -TERM` แล้ว `-KILL` ตาม process group (ข้อนี้เป็น best-effort ทำผ่าน helper ที่ฝั่ง distro เท่านั้น)
- **WSL helper** (`wsl-helper.sh`): process `sh` ที่อยู่ยาวหนึ่งตัวต่อ distro (สร้างเมื่อมี session ของ distro นั้น) protocol แบบบรรทัด `<id>\t<op>\t<base64 args…>` ตอบเป็นบล็อกที่มีตัวคั่น op ที่มีคือ `ls`, `cat-small`, `git-branches`, `path-exec`, `wslpath`, `which`, `reap` สคริปต์ decode args ด้วย `base64 -d` แล้วใช้เป็นอาร์กิวเมนต์เท่านั้น ไม่ `eval`
- **Environment**: env ของ Windows ไม่ไหลเข้า WSL ยกเว้นตัวที่ระบุใน `WSLENV` (`ARCTRI_NONCE`, `ARCTRI_SESSION`, `ARCTRI_BLOCKS`, `TERM_PROGRAM=Arctri`) ฝั่ง Windows จะตั้ง `TERM_PROGRAM`, `COLORTERM=truecolor` และคง PATH ของผู้ใช้
- **Agent detection แยก environment** ดู §9

---

## 9. Agent Adapters

### 9.1 Detection
| | Windows | WSL |
|---|---|---|
| วิธี | ค้น PATH × PATHEXT เอง (ไม่ spawn) ลำดับความสำคัญ `.exe` > `.cmd` แล้วรัน `<exe> --version` (timeout 5 วินาที) เมื่อผู้ใช้เปิดเมนู agent | helper `which claude codex` ใน PATH ที่ integration รายงาน ถ้าไม่พบให้ลอง `bash -lic 'command -v …'` (timeout 8 วินาที เพราะต้อง source rc ของผู้ใช้ เช่น nvm) |
| เครื่องนี้ | codex: พบ (`codex.exe`) · claude: ไม่พบ | claude: พบ · codex: พบ |
| Override | ผู้ใช้ระบุ path เองได้ใน Settings แยกต่อ environment | เหมือนกัน |

ผล detection cache ไว้และมีปุ่ม "Re-scan" ไม่มีการติดตั้ง agent ให้อัตโนมัติ (แสดงลิงก์เอกสารการติดตั้งของผู้ผลิตแทน)

### 9.2 Launch
- Agent session คือ PTY ที่รัน agent ตรงๆ ใน classic presentation (ไม่มี shell integration) Windows: spawn `codex.exe` โดยตรง ถ้าเป็น `.cmd` shim ใช้ `cmd.exe /d /s /c` พร้อม argv ที่ escape แล้ว WSL: `wsl.exe -d <d> --cd <cwd> -- bash -lic 'exec "$0" "$@"' <agent> <args…>` เพื่อให้ได้ PATH/env เดียวกับที่ผู้ใช้ใช้ปกติ โดยค่าทุกตัวเป็นอาร์กิวเมนต์ ไม่ต่อ string
- การยืนยันตัวตนเป็นหน้าที่ของ CLI เอง Arctri ไม่อ่านไม่เก็บ token หรือ API key ใดๆ
- เมื่อ agent จบ tab จะแสดงแถบ "Claude Code exited (code 0)" พร้อมปุ่ม Restart / Resume / Open shell here / Close
- ไม่ส่ง flag ที่ข้ามการขออนุญาต (เช่น `--dangerously-skip-permissions`, `--yolo`) จาก UI ใดๆ ถ้าผู้ใช้ใส่เองใน `extraArgs` จะแสดงคำเตือนสีแดงใน toolbar ตลอด session

### 9.3 Capabilities (ค่าตั้งต้น ยืนยันกับ `--help` ของเวอร์ชันที่ติดตั้งใน PoC-4)
| Capability | Claude Code | Codex CLI |
|---|---|---|
| Launch ใน cwd | ✅ | ✅ |
| Resume ล่าสุด | `claude --continue` | `codex resume --last` |
| Resume picker | `claude --resume` | `codex resume` |
| Model ตอน launch | `--model` | `--model` / `-m` |
| Permission/approval ตอน launch | `--permission-mode` | `--ask-for-approval`, `--sandbox` |
| เปลี่ยน model ระหว่าง session | ทำได้ผ่าน `/model` ใน TUI เท่านั้น | ผ่าน `/model` ใน TUI เท่านั้น |
| Structured status | opt-in: hooks ผ่าน `--settings <ไฟล์ชั่วคราว>` ที่มี hook แบบสังเกตการณ์อย่างเดียว เขียน event ลง named pipe | opt-in: `notify` config ผ่าน `-c` override แจ้งเมื่อจบ turn |
| Native commands ที่ให้ปุ่มลัด | `/model`, `/clear`, `/compact`, `/help` (ส่งเป็นข้อความเข้า TUI) | `/model`, `/approvals`, `/new`, `/status` |

Capability matrix ถูก gate ตามเวอร์ชันที่ detect ได้ ถ้า flag ไม่มีใน `--help` ของเวอร์ชันนั้น control จะถูกซ่อน

### 9.4 ข้อจำกัดที่ประกาศชัด
- Arctri **ไม่ parse ข้อความบนหน้าจอ** ของ agent เพื่อเดาสถานะ ถ้าไม่ได้เปิด hooks สถานะจะมีแค่ Running / Exited
- ปุ่ม native command ระบุชัดว่า "ส่ง `/model` ไปยัง Claude Code" การเปลี่ยนเกิดใน UI ของ CLI เอง
- ปุ่มลัดทั้งหมดใช้ได้เฉพาะตอน TUI รอ input ถ้าผู้ใช้กดตอน agent กำลังทำงาน ข้อความจะถูกส่งเหมือนผู้ใช้พิมพ์เอง (เขียนไว้ใน tooltip)
- **Prompt composer** (กล่องพิมพ์หลายบรรทัดใน toolbar ของ agent) ส่งข้อความด้วย bracketed paste เข้า TUI ทำให้พิมพ์ไทยยาวๆ ได้ใน textarea ปกติ ไม่ส่ง Enter ให้อัตโนมัติ ผู้ใช้ต้องยืนยันใน TUI เอง

---

## 10. UI/UX

### 10.1 Layout
```
┌ [◆] [pwsh ~\proj ×] [Ubuntu · bash ×] [✦ Claude · WSL ×] [+▾]        ─ □ × ┐  ← titleBarOverlay (ปุ่มระบบของ Windows)
│                                                                            │
│  ▸ git status                         ~/proj · bash · 12:04 · 0.3s  ✓     │  ← BlockCard (ยุบได้)
│    On branch main …                                                         │
│  ▸ npm test                           ~/proj · bash · 12:05 · 14.2s ✗ 1   │
│    …                                                                        │
│  ┌ LiveTerminal (แสดงเมื่อคำสั่งรันอยู่) ───────────────────────────────┐  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ ❯ git che|ckout   (ghost)                ┌ checkout  git-subcommand ┐   │ │  ← CommandEditor + overlay
│ └────────────────────────────────────────────────────────────────────────┘ │
│ bash · Ubuntu │ ~/proj │  main │ ●blocks                     ⚙            │  ← BottomToolbar
└────────────────────────────────────────────────────────────────────────────┘
```
- Agent tab: พื้นที่หลักเป็น xterm เต็ม toolbar แสดง `✦ Claude Code · WSL Ubuntu · ~/proj · launched: model=…, mode=… · Running` และปุ่ม `Composer`, `/model ▸`, `Restart`, `Resume`, `Open shell here`, `Stop`
- Tab ใช้ไอคอนบอกชนิด (shell/agent) และจุดสีบอกสถานะ (running, exit≠0, bell)

### 10.2 Design direction
- Dark-first ใช้ CSS variables ผ่าน Tailwind v4 `@theme` มี light theme แบบพื้นฐาน
- Accent ของ Arctri เอง (ไม่ใช้สี/ไอคอน/โลโก้ของ Warp) ใช้ไอคอน Lucide
- Animation สั้น (≤120 ms) เฉพาะตอน expand/collapse, เปิด overlay และสลับ tab เคารพ `prefers-reduced-motion`
- shadcn/ui ใช้เฉพาะ Dialog, DropdownMenu, Tooltip, Tabs (settings), Input, Switch, ScrollArea, Command (palette ภายหลัง)
- รองรับ display scaling 100–200% (ทดสอบ 100/125/150/175) ความละเอียดขั้นต่ำ 1280×720
- Keyboard: `Ctrl+Shift+T` tab ใหม่, `Ctrl+Shift+W` ปิด, `Ctrl+Tab`/`Ctrl+Shift+Tab` สลับ, `Ctrl+↑/↓` เลือก block ก่อนหน้า/ถัดไป, `Space` ยุบ/ขยาย block ที่เลือก, `Ctrl+Shift+C` copy (ใน xterm: `Ctrl+C` copy เมื่อมี selection, ไม่มี selection ส่ง `^C`), `Ctrl+V`/`Ctrl+Shift+V` paste, `F2` rename tab

### 10.3 Fonts (ยืนยันใน PoC-3)
- UI: Inter + **IBM Plex Sans Thai** (OFL, bundle มากับแอป ไม่พึ่ง font ของระบบเพื่อให้ Win10/11 เหมือนกัน)
- Terminal: **JetBrains Mono** (bundle) แล้ว fallback เป็น `Noto Sans Thai` (bundle) และ `Leelawadee UI`, `Tahoma` cell width วัดจาก JetBrains Mono อักษรไทยใช้ 1 cell สระบน/ล่างและวรรณยุกต์ใช้ 0 cell ตาม Unicode (สระอำ U+0E33 ใช้ 1 cell)

### 10.4 Localization
- i18n แบบเบาเขียนเอง (`shared/i18n`) dictionary แบบ typed ของ `en` และ `th` ฟังก์ชัน `t(key, params)` และ `Intl` สำหรับวัน/เวลา/ระยะเวลา ไม่ใช้ i18next เพราะข้อความมีไม่มาก
- เลือกภาษาตาม `app.getLocale()` ครั้งแรก เปลี่ยนได้ใน Settings

---

## 11. Thai input/rendering

| ชั้น | วิธี | ความเสี่ยง |
|---|---|---|
| CommandEditor / Composer | `<textarea>` ปกติ (ไม่ใช้ contenteditable) รองรับ composition event ของ Chromium เต็มรูปแบบ autocomplete จะหยุดระหว่าง `compositionstart`…`compositionend` | ต่ำ |
| xterm input | `textarea` ที่ซ่อนอยู่ของ xterm รองรับ composition ส่วน Thai keyboard layout ส่งอักขระตรงทีละตัว (สระ/วรรณยุกต์เป็น keystroke แยก) ผ่าน `onData` | กลาง |
| xterm rendering | WebGL renderer + `@xterm/addon-unicode11` (หรือ `addon-unicode-graphemes` ถ้า PoC-3 ดีกว่า) | กลาง |
| ConPTY | inbox conpty ของ Win10 คำนวณความกว้างแบบเก่า bundled conpty รองรับ grapheme ดีกว่า | **สูง** ตัดสินใน PoC-3 |
| โปรแกรมปลายทาง | bash readline + glibc UTF-8 locale ใช้ได้ดี · PSReadLine มีปัญหาเรื่อง zero-width char (ข้อจำกัดของ PSReadLine เอง) · Ink (Claude Code) ใช้ string-width | กลาง–สูง บันทึกเป็นตาราง |
| Snapshot (block ที่จบแล้ว) | DOM text shaping จึงถูกต้องเสมอ | ต่ำ |
| UTF-8 | node-pty ใช้ UTF-8 · PowerShell 5.1 ตั้ง `[Console]::OutputEncoding/InputEncoding = UTF8` และ `$OutputEncoding` ใน integration script · cmd ใช้ `chcp 65001` แบบ opt-in (ค่าเริ่มต้นไม่บังคับ เพราะโปรแกรมเก่าบางตัวพัง) · WSL ตรวจ `locale` ถ้าไม่ใช่ UTF-8 จะแสดงคำแนะนำ ไม่แก้ให้เอง | |

ชุดทดสอบภาษาไทยอยู่ที่ `docs/testing/thai-matrix.md` ประกอบด้วย `สวัสดีครับ`, `น้ำ`, `ที่นี่`, `กำลัง`, `ผู้ใหญ่`, `ฤๅษี`, `เป็นไปได้` ผสมอังกฤษ `git commit -m "แก้บั๊ก login"`, path `C:\งาน\โปรเจกต์ ใหม่` และ backspace หลังวรรณยุกต์ ทดสอบใน editor, pwsh 5.1, pwsh 7, bash, zsh, Claude Code และ Codex บน inbox/bundled conpty

---

## 12. Security

- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload ใช้แค่ `contextBridge`/`ipcRenderer`), `webSecurity: true`
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'` (ใน dev อนุญาต Vite HMR เท่านั้น)
- บล็อก navigation และ `window.open` ทั้งหมด ลิงก์จาก terminal (web-links addon) เปิดด้วย `shell.openExternal` เฉพาะ `http(s):` หลังผู้ใช้ Ctrl+Click
- IPC: ตรวจ schema ทุก channel (zod) ตรวจ sender และไม่มี API ที่รัน string เป็นคำสั่ง `session:create` รับเฉพาะ `profileId`/`adapterId` ที่ main รู้จัก ไม่รับ executable path จาก renderer (path ที่ผู้ใช้กำหนดเองเก็บใน prefs และ main ตรวจว่าเป็นไฟล์จริง)
- OSC 52 (clipboard write จากโปรแกรม) ปิดเป็นค่าเริ่มต้น OSC ของ Arctri ต้องมี nonce
- Electron Fuses ตอน package: ปิด `RunAsNode`, `EnableNodeCliInspectArguments`, `EnableNodeOptionsEnvironmentVariable` เปิด `EnableEmbeddedAsarIntegrityValidation` และ `OnlyLoadAppFromAsar`
- ข้อมูลทั้งหมดอยู่ที่ `%APPDATA%\Arctri` ไม่มี telemetry และไม่มี network call ยกเว้นลิงก์ที่ผู้ใช้เปิดเอง
- ไม่ bypass การขออนุญาตของ agent ไม่ส่งปุ่มกดตอบ approval prompt แทนผู้ใช้

---

## 13. Dependencies และข้อจำกัดในการ build

### 13.1 รายการ (pin เวอร์ชัน exact ใน Phase 0 หลังตรวจความเข้ากันได้จริง)
| Package | ช่วงเวอร์ชันเป้าหมาย | เหตุผล/ข้อจำกัด |
|---|---|---|
| electron | stable line ล่าสุดที่ ≥ 2 สัปดาห์ ณ วันเริ่ม และรองรับ Win10 | ต้องตรวจกับ prebuild ของ better-sqlite3 |
| electron-vite | ล่าสุด | เป็นตัวเชื่อม Vite กับ main/preload/renderer ลด config |
| electron-builder | 26.x | NSIS, `asarUnpack`, `extraResources` |
| @electron/fuses | ล่าสุด | hardening |
| node-pty | ≥ 1.1.0 | N-API มี prebuilt win32-x64 ไม่ต้อง rebuild ตาม Electron ABI และมี `useConptyDll` (ยืนยันใน PoC-1/6) |
| better-sqlite3 | 12.x | ต้องมี prebuilt ของ Electron ABI ที่เลือก fallback คือ `node:sqlite` |
| electron-store | ล่าสุด (ESM) | main process build เป็น ESM หรือ bundle ด้วย electron-vite |
| react, react-dom | 19.x | |
| vite | ตามที่ electron-vite รองรับ | |
| tailwindcss + @tailwindcss/vite | 4.x | |
| shadcn (CLI) + radix | ล่าสุด | copy component เข้า repo |
| lucide-react, zustand 5, zod 4 | | zod ใช้ตรวจ IPC และ prefs |
| @xterm/xterm | 5.5+ (ประเมิน 6.x) | |
| @xterm/addon-fit, -web-links, -webgl, -unicode11, -serialize, -search(ภายหลัง) | ตามเวอร์ชัน xterm | webgl เพื่อ throughput, unicode11 สำหรับความกว้าง |
| @xterm/headless | ตาม xterm | ใช้ใน integration test |
| vitest 3+, @playwright/test | | Playwright ใช้ `_electron.launch` |

ไม่ใช้: i18next, redux, electron-log, framework สำหรับ plugin, ORM

### 13.2 ข้อจำกัดในการ build
- พัฒนาและ build บน **Windows Node เท่านั้น** (repo อยู่ที่ไดรฟ์ D:) เมื่อ Claude Code ทำงานจาก WSL จะสั่งผ่าน `powershell.exe -NoProfile -Command "Set-Location D:\Desktop\Arctri; npm …"`
- `postinstall`: `electron-builder install-app-deps` เพื่อดึง prebuild ของ better-sqlite3 สำหรับ Electron
- `asarUnpack`: `node_modules/node-pty/**` (มี `conpty.dll`, `OpenConsole.exe`, agent exe), `node_modules/better-sqlite3/**/*.node`
- `extraResources`: `resources/shell-integration/**` ต้องเป็นไฟล์จริงบนดิสก์ เพราะ pwsh dot-source และ WSL ต้องเข้าถึงผ่าน `/mnt/c/...`
- NSIS แบบ per-user (`perMachine: false`, ไม่ต้องสิทธิ์ admin) ติดตั้งที่ `%LOCALAPPDATA%\Programs\Arctri`
- ทางสำรองถ้าไม่มี prebuild: ติดตั้ง VS 2022 Build Tools (Desktop development with C++) และ Python 3.12 จริง (ไม่ใช่ stub ของ WindowsApps)
- รองรับเฉพาะ x64 ใน MVP 1

---

## 14. Implementation Phases และ Tasks

รูปแบบของแต่ละ task: **Obj** วัตถุประสงค์ · **Files** · **Deps** · **Approach** · **Expect** พฤติกรรมที่คาดหวัง · **Err** การจัดการ error · **Verify** · **DoD**

### Phase 0 — Bootstrap และ PoCs (ใหม่ เพื่อลดความเสี่ยงก่อน Phase 1)

**P0-T1 Repo bootstrap**
- Obj: โครงโปรเจกต์ที่ build/run/test ได้ · Files: `package.json`, `.npmrc`, `tsconfig*.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`, `.editorconfig`, `PLAN.md` · Deps: ไม่มี
- Approach: `git init`, scaffold ด้วย electron-vite (react-ts) แล้วลบ demo ออก ตั้ง TypeScript strict, ESLint (flat config) + Prettier, Tailwind v4, shadcn init
- Expect: `npm run dev` เปิดหน้าต่างว่างที่มี title bar · Err: ถ้า install ล้มเพราะ native module ให้บันทึกและไป PoC-6 ก่อน
- Verify: `npm run typecheck && npm run lint && npm test` ผ่าน · DoD: commit แรก, CI workflow `windows-latest` รัน typecheck/lint/unit

**P0-T2 PoC-1 ConPTY + OSC passthrough** (สคริปต์ Node ล้วนใน `poc/`, ไม่ใช่โค้ดของแอป)
- Obj: รู้ว่า OSC 133/6973 ผ่าน ConPTY ได้ครบและตรงลำดับหรือไม่ · Files: `poc/conpty-osc.mjs`, `docs/decisions/ADR-001-conpty.md` · Deps: P0-T1
- Approach: spawn pwsh 5.1/7 และ `wsl.exe bash` ผ่าน node-pty ด้วย `useConptyDll` true/false ส่ง marker ที่มีเลขลำดับแทรกกับ output 1,000 บรรทัด แล้วตรวจว่า sequence ครบ ลำดับถูก และตำแหน่งตรงเมื่อป้อนเข้า `@xterm/headless`
- Expect/Verify: ตาราง pass/fail ต่อ shell × conpty · DoD: ADR เลือก conpty mode ค่าเริ่มต้นและ fallback

**P0-T3 PoC-2 Block lifecycle** · Obj: ยืนยันกลไก snapshot-at-D + clear ผ่าน shell · Files: `poc/block-lifecycle/` (หน้า HTML เล็กใน Electron) · Approach: ตาม §6.2 พร้อม resize อัตโนมัติ 50 ครั้งระหว่าง/หลังคำสั่ง · Verify: ไม่มีข้อความผีหรือบรรทัดหายเมื่อเทียบกับ output ที่คาดไว้ · DoD: ADR-002

**P0-T4 PoC-3 Thai** · Files: `poc/thai/`, `docs/testing/thai-matrix.md` · Approach: render ชุดคำทดสอบใน xterm (unicode11 vs graphemes, font fallback) บน pwsh/bash/Claude Code/Codex กับ conpty สองแบบ แล้วจับภาพหน้าจอ · DoD: ADR-003 เลือก addon/font/conpty และบันทึกข้อจำกัดที่เหลือ

**P0-T5 PoC-4 Agent TUI** · ใช้งาน `claude` (WSL) และ `codex` (Windows/WSL) ใน harness ของ PoC-2 ตรวจ Shift+Enter, Esc, Ctrl+C, paste ยาว, resize, mouse และอ่าน `--help` เพื่อยืนยัน capability matrix · DoD: ADR-004

**P0-T6 PoC-5 Command submission** · ทดสอบ `clearLineInput` + `encodeSubmit` กับคำสั่งหลายบรรทัด, quote, ไทย บน bash/zsh/pwsh · DoD: ADR-005 วิธีส่งต่อ shell

**P0-T7 PoC-6 Packaging** · electron-builder NSIS ของแอปว่างที่ import node-pty + better-sqlite3 แล้วติดตั้งบน Win10 VM ที่ไม่มี Node/Build Tools · DoD: ADR-006 ยืนยัน pin เวอร์ชัน Electron/node-pty/better-sqlite3

**P0-T8 PoC-7 Throughput** · MessagePort + batching + flow control กับ output 100 MB · DoD: ตัวเลขพื้นฐานบันทึกใน ADR-007

**Phase 0 acceptance**: ADR ครบ 7 ฉบับ ทุกความเสี่ยงสูงมีคำตอบหรือ fallback ที่ตกลงแล้ว (ถ้า PoC-1 ล้มทั้งสองแบบ จะกลับมาขอตัดสินใจกับผู้ใช้ก่อนเริ่ม Phase 2)

---

### Phase 1 — Desktop and Terminal Foundation

**P1-T1 Main window และ app shell**
- Obj: หน้าต่างที่ปลอดภัยพร้อม title bar ที่มี tab · Files: `main/index.ts`, `main/window.ts`, `main/single-instance.ts`, `renderer/App.tsx`, `features/titlebar/*` · Deps: P0-T1
- Approach: `titleBarStyle: 'hidden'` + `titleBarOverlay` (ทำงานทั้ง Win10/11) จำขนาด/ตำแหน่งหน้าต่างใน prefs single instance lock ตั้งค่า security ตาม §12
- Expect: ลาก/snap/maximize ได้ตาม Windows · Err: ถ้าตำแหน่งที่จำไว้อยู่นอกจอ ให้คืนค่ากลางจอ
- Verify: e2e ตรวจ `contextIsolation`/`nodeIntegration` จาก `webContents` และ manual snap layouts Win11 · DoD: เปิด/ปิดได้ไม่มี error ใน console

**P1-T2 Logger และ diagnostics** · Files: `main/logger.ts` · Approach: เขียนไฟล์ JSONL ใน `%APPDATA%\Arctri\logs` หมุนไฟล์ 5×5 MB ไม่ log ข้อมูล PTY · DoD: มีเมนู "Copy diagnostics" (เวอร์ชัน OS, Electron, conpty mode, profiles)

**P1-T3 IPC contract + preload**
- Files: `shared/ipc/contract.ts`, `main/ipc/router.ts`, `preload/index.ts`, `renderer/lib/api.ts` · Deps: P1-T1
- Approach: นิยาม channel และ zod schema ที่เดียว สร้าง router ที่ validate ขาเข้าและ sender ส่วน preload expose ฟังก์ชันที่มี type พร้อม `subscribe` ที่คืน unsubscribe
- Err: argument ผิด schema จะ reject ด้วย error code `E_INVALID_ARGS` และ log
- Verify: unit test ของ router (args ถูก/ผิด, sender แปลกปลอม) · DoD: renderer ไม่มีการเข้าถึง `ipcRenderer` ตรงๆ

**P1-T4 PtyBackend + SessionManager + DataPump**
- Files: `main/pty/*`, `shared/types/session.ts` · Deps: P1-T3, ADR-001/007
- Approach: wrap node-pty (`useConptyDll` ตาม ADR) SessionManager ดูแล map ของ session, title อัตโนมัติจากชื่อ shell/โปรแกรม, ส่ง `SessionInfo` เมื่อมีการเปลี่ยนแปลง DataPump ทำ batching/flow control ผ่าน MessagePort
- Expect: หลาย session ทำงานพร้อมกัน สลับ tab แล้ว process ยังรันต่อ
- Err: spawn ล้มเหลว (exe ไม่พบ, cwd ไม่มีอยู่) จะคืน `failed` พร้อมเหตุผล ถ้า cwd ไม่มีให้ fallback ไปที่ home และแจ้งเตือน PTY exit ส่ง exit code
- Verify: integration test (Windows) spawn/write/resize/kill พร้อม fake backend ใน unit test · DoD: ไม่มี process ค้างหลังปิด 20 tab (`tasklist` ไม่มี OpenConsole/pwsh/wsl ที่เป็นลูกของแอป)

**P1-T5 Process cleanup** · Files: `main/pty/process-cleanup.ts` · Approach: ปิด tab เรียก `kill()` ถ้ายังไม่จบใน 3 วินาทีใช้ `taskkill /T /F /PID` ตอนปิดแอป (`before-quit`) ปิดทุก session แบบขนานและรอไม่เกิน 5 วินาที ถาม confirm ถ้ามี process ที่ไม่ใช่ shell idle กำลังรัน (รู้จาก phase เมื่อมี integration) · Verify: test ปิดแอประหว่าง `ping -t`, `sleep 1000` ใน WSL และ agent ที่ยังรันอยู่ · DoD: ไม่มี orphan

**P1-T6 Shell discovery + profiles** · Files: `main/shell/discovery.ts`, `main/shell/profiles.ts` · Approach: หา `powershell.exe` (System32), `pwsh.exe` (PATH, `%ProgramFiles%\PowerShell\*`, MS Store alias), `cmd.exe` (`%ComSpec%`) แล้วรวมกับ profile ของ WSL · Err: shell ที่หาไม่พบไม่แสดงในเมนู · DoD: เมนู new tab แสดงเฉพาะ shell ที่มีจริง พร้อมตั้ง default ได้

**P1-T7 WslManager (discovery + launch)** · Files: `main/wsl/wsl-manager.ts`, `main/wsl/list-parser.ts`, `main/wsl/path-mapper.ts` · Approach: ตาม §8 (ยังไม่มี helper ซึ่งจะมาใน Phase 3) · Err: ไม่มี WSL, ไม่มี distro, distro ถูกลบระหว่างใช้งาน, wsl.exe ค้าง (timeout 15 วินาทีสำหรับ discovery) · Verify: unit test parser ด้วย fixture UTF-16LE/UTF-8/ภาษาไทยในชื่อ distro + manual กับ distro ที่ Stopped · DoD: เปิด Ubuntu bash ได้จากเมนู ผู้ใช้ที่ไม่มี WSL ไม่เห็น error

**P1-T8 Terminal view (xterm)** · Files: `features/terminal/LiveTerminal.tsx`, `xterm-host.ts`, `keymap.ts`, `stores/sessions.ts` · Approach: หนึ่ง xterm ต่อ session ซ่อนแบบไม่ unmount, WebGL renderer (fallback DOM เมื่อ context loss), fit addon + ResizeObserver (debounce 50 ms), web-links, unicode addon ตาม ADR-003, scrollback ตั้งค่าได้ (default 10,000) · Expect: vim/htop/less/ssh ใช้ได้, สีครบ, copy/paste ตาม §10.2, bracketed paste, เตือนก่อน paste หลายบรรทัดใน classic mode · Verify: e2e พิมพ์ `echo hello` แล้วอ่าน buffer + manual TUI · DoD: ผ่าน checklist M1 ใน §15

**P1-T9 Tabs** · Files: `features/tabs/*`, `features/launcher/*` · Approach: tab กะทัดรัด, rename (double-click/F2), ลากเรียงลำดับ, ปุ่ม `+` กับ dropdown แบ่งกลุ่ม Windows / WSL / Agents (Agents จะว่างจนถึง Phase 4), middle-click ปิด · DoD: shortcut ตาม §10.2 ทำงาน

**P1-T10 Persistence ขั้นต้น** · Files: `main/persistence/prefs.ts`, `db.ts`, `migrations/001_init.sql`, `session-repo.ts` · Approach: electron-store + zod schema สำหรับ prefs, SQLite (WAL) ตาราง `sessions`, `history`, `schema_version` · Err: DB เสียให้ย้ายไฟล์เป็น `.corrupt-<ts>` แล้วสร้างใหม่และแจ้งผู้ใช้ · DoD: restore tab layout + cwd ได้เมื่อเปิดแอปใหม่ (เป็นตัวเลือก)

**P1-T11 Thai พื้นฐาน + i18n infrastructure** · Files: `shared/i18n/*`, `renderer/assets/fonts/*`, `styles/globals.css` · Approach: bundle fonts ตาม §10.3 ตั้ง UTF-8 ให้ PS 5.1 (ผ่าน `-Command` ตอน spawn ก่อนมี integration script เต็ม) แปล UI ทั้งหมดเป็น en/th · Verify: thai-matrix หมวด "พิมพ์และแสดงผลพื้นฐาน" · DoD: พิมพ์ไทยใน pwsh 7 และ bash แล้วแสดงผลถูก ส่วนข้อจำกัดที่ทราบบันทึกไว้แล้ว

**Phase 1 acceptance**: เปิด Arctri แล้วรันคำสั่งจริงได้ใน PowerShell 5.1, PowerShell 7, cmd และ WSL bash/zsh, หลาย tab, resize/copy/paste/scrollback, vim/htop ใช้ได้, ไม่มี WSL ก็ใช้งานได้ปกติ, ไม่มี process ค้าง

---

### Phase 2 — Command Block Engine

**P2-T1 OSC tokenizer + protocol** · Files: `shared/osc/*` · Approach: state machine ระดับอักขระที่รองรับ terminator ทั้ง BEL และ ST, sequence ที่ถูกตัดข้าม chunk, จำกัดความยาว payload 64 KB · Verify: unit + property-based test (สุ่มตัด chunk 10,000 แบบ) · DoD: coverage ≥ 95%

**P2-T2 Shell state machine** · Files: `shared/shell/state-machine.ts` · Approach: ตาม §6.7 · Verify: unit test ทุก transition และลำดับผิดๆ · DoD: ไม่มี transition ที่ไม่ได้ทดสอบ

**P2-T3 ShellIntegrationManager (main)** · Files: `main/shell/integration-manager.ts`, `main/shell/adapters/*.ts` · Approach: adapter ต่อ shell สร้าง launch args/env (nonce, `ARCTRI_BLOCKS`), feed stream เข้า tokenizer + state machine, อัปเดต `SessionInfo.phase/cwd/integration`, บันทึก history เมื่อ block จบ, แก้ git branch ของ cwd (Windows: อ่าน `.git/HEAD` โดยตรง, WSL: ผ่าน helper) · Err: ไม่ได้ hello ภายใน prompt แรก/10 วินาทีจะตั้ง `unavailable` · DoD: integration test ได้ event ที่ถูกต้องสำหรับ 20 สถานการณ์ใน §15

**P2-T4 Integration scripts** · Files: `resources/shell-integration/*` · Approach: ตาม §6.6 ทดสอบกับ rc ของผู้ใช้ที่ซับซ้อน (oh-my-zsh, starship, bash-preexec, PSReadLine custom handlers, `Set-StrictMode`) · Err: สคริปต์ทั้งหมดห่อด้วย try/trap ไม่ทำให้ shell ของผู้ใช้เสีย · Verify: integration test พร้อม fixture rc · DoD: shell ทำงานเหมือนเดิมเมื่อไม่ได้อยู่ใน Arctri (ไม่มี nonce = ไม่ทำอะไร)

**P2-T5 Block tracker (renderer)** · Files: `features/terminal/block-tracker.ts`, `snapshot.ts`, `stores/blocks.ts` · Approach: `term.parser.registerOscHandler(133|6973)` วาง marker, จับ alt-screen ด้วย `buffer.onBufferChange`, สร้าง snapshot เป็น logical lines + style table ตาม §6.2 · Verify: integration test บน `@xterm/headless` เทียบ snapshot กับข้อความที่คาดไว้ (ANSI, wrap, ไทย, 10,000 บรรทัด) · DoD: สร้าง snapshot 10k บรรทัดใช้เวลา < 50 ms

**P2-T6 Block UI** · Files: `features/blocks/*` · Approach: BlockList แบบ virtualized (เขียนเองแบบง่ายด้วย ResizeObserver หรือใช้ `@tanstack/react-virtual` ถ้าจำเป็น), BlockCard แสดงหัว (command, cwd, shell, เวลา, duration, ไอคอนสถานะ, exit code) และ output ที่ render จาก StyledLine, actions: copy command, copy output (plain text), rerun (ใช้งานได้เฉพาะ phase = prompt), collapse/expand, เลือกด้วยคีย์บอร์ด · Expect: selection ข้าม block ได้, reflow เมื่อ resize · DoD: block ยาว 100,000 บรรทัดยังเลื่อนลื่น (render เฉพาะส่วนที่มองเห็นภายใน block)

**P2-T7 Session view (block presentation)** · Files: `features/terminal/SessionView.tsx` · Approach: สลับแสดง/ซ่อน LiveTerminal ตาม phase, auto-scroll ไปท้ายเมื่อมี output ใหม่ (หยุด auto-scroll เมื่อผู้ใช้เลื่อนขึ้นเอง), ปุ่ม "Native prompt" · Verify: e2e รัน 3 คำสั่งแล้วได้ 3 BlockCard พร้อม exit code ที่ถูก · DoD: ผ่าน PoC-2 scenario ในแอปจริง

**P2-T8 CommandEditor (ส่วนพื้นฐาน)** · Files: `features/editor/CommandEditor.tsx` · Approach: textarea หลายบรรทัด (Shift+Enter ขึ้นบรรทัดใหม่), Enter ส่งผ่าน `session:submit`, history ↑/↓, ปิดใช้งานขณะ `executing` · Err: `not-at-prompt` แสดง toast "Shell ยังไม่พร้อม" · DoD: พิมพ์ไทยด้วย IME/keyboard ได้ถูกต้อง

**P2-T9 Classic mode markers** · Files: `features/terminal/classic-decorations.ts` · Approach: xterm `registerDecoration` ที่ gutter + navigate/copy/rerun · DoD: ใช้งานใน tab classic ที่มี integration ได้

**P2-T10 Fallback และ degraded** · Approach: banner เมื่อ integration `unavailable/degraded`, ปุ่มเปิด tab classic ใหม่ใน cwd เดิม · Verify: ทดสอบด้วย shell ที่ถูกตั้งให้ไม่โหลดสคริปต์ และ `bash --norc` ซ้อน · DoD: ไม่มี block ผิดในทุกกรณีทดสอบ

**Phase 2 acceptance**: บน WSL bash, PowerShell 5.1/7 และ WSL zsh คำสั่งถูกแยกเป็น block ถูกต้อง 100% ใน test suite (exit code, duration, cwd) vim/htop/ssh/agent ใช้งานได้ไม่พัง ใน shell ที่ไม่มี integration จะทำงานแบบ terminal ปกติโดยไม่มี block ผิด

---

### Phase 3 — Autocomplete Engine

**P3-T1 Tokenizer + ranking** · Files: `shared/completion/*` · Verify: unit test quoting ของ PowerShell/POSIX, path ที่มีช่องว่าง, ไทย · DoD: coverage ≥ 90%

**P3-T2 EnvironmentQueryService + WSL helper** · Files: `main/env-query/*`, `main/wsl/helper-client.ts`, `resources/shell-integration/wsl-helper.sh` · Approach: ตาม §7.1/§8 helper restart อัตโนมัติเมื่อ crash (สูงสุด 3 ครั้ง/นาที) · Err: timeout ต่อ request 1.5 วินาทีแล้วคืนผลว่าง · Verify: integration test ใน WSL (ชื่อไฟล์มีช่องว่าง/ไทย/newline) · DoD: ไม่มี code path ที่ต่อ string เป็นคำสั่ง shell (ตรวจด้วย review + lint rule ห้าม `exec`/`shell: true`)

**P3-T3 CompletionEngine + providers** · Files: `main/completion/*` · Approach: รัน provider แบบขนานพร้อม AbortSignal, merge/dedupe/rank, จำกัด 50 รายการ · DoD: ผลแยกตาม environment (WSL session ไม่เห็น `Get-ChildItem` และ pwsh session ไม่เห็น `/usr/bin/*`)

**P3-T4 History provider + import** · Files: `main/persistence/history-repo.ts`, `main/completion/providers/history.ts` · Approach: frecency, ไม่บันทึกคำสั่งที่ขึ้นต้นด้วยช่องว่าง (ตามธรรมเนียม `HISTCONTROL=ignorespace`), ตั้งค่าจำนวนสูงสุด (default 10,000 ต่อ envKey), ปุ่มลบ history, import แบบ opt-in · DoD: คำสั่งภาษาไทยค้นหาได้

**P3-T5 Autocomplete overlay + ghost text** · Files: `features/editor/AutocompleteOverlay.tsx`, `ghost-text.ts` · Approach: ตาม §7.5 จัดตำแหน่งตามพื้นที่ (ด้านบน editor เมื่อใกล้ขอบล่าง), ARIA listbox · Verify: e2e ตามขั้นตอน "พิมพ์ `git ch` → เห็น checkout → Tab → ข้อความเป็น `git checkout `" · DoD: ไม่มีการส่งอะไรเข้า PTY ระหว่างใช้ autocomplete (ตรวจด้วย spy ใน e2e)

**Phase 3 acceptance**: ได้ suggestion จาก history/commands/paths/git/scripts ใน pwsh และ WSL bash/zsh ภายในเป้าหมายเวลาใน §16 การใช้งาน terminal ปกติไม่เสีย และไม่มี suggestion ถูกรันอัตโนมัติ

---

### Phase 4 — AI Agent Integration

**P4-T1 Agent adapter interfaces + registry** · Files: `shared/types/agent.ts`, `main/agents/agent-manager.ts` · DoD: เพิ่ม agent ใหม่ได้ด้วยไฟล์ adapter ไฟล์เดียว

**P4-T2 Detection** · Files: `main/agents/detect.ts` · Approach: ตาม §9.1 · Err: timeout/version parse ล้มเหลวยังถือว่าติดตั้ง (version = unknown) และซ่อน flag ที่ต้อง gate ตามเวอร์ชัน · Verify: เครื่องนี้ต้องได้ codex(Win), claude(WSL), codex(WSL) และ claude(Win) = ไม่พบ · DoD: มีปุ่ม re-scan และ path override

**P4-T3 Claude Code adapter** · Files: `main/agents/adapters/claude-code.ts` · Approach: launch/resume/flags ตาม ADR-004 · Verify: manual login, approval prompt, Esc interrupt, Shift+Enter, paste รูป/ข้อความยาว, ภาษาไทย · DoD: ใช้งานจริง 30 นาทีไม่มีปัญหาเรื่อง input

**P4-T4 Codex adapter** · เหมือน P4-T3 ทั้งบน Windows (`codex.exe`) และ WSL · DoD: เหมือน P4-T3

**P4-T5 Agent session lifecycle** · Approach: tab ชนิด agent (ไอคอน/ชื่อ agent + environment), แถบเมื่อ agent จบ, Restart/Resume/Open shell here · Err: agent ไม่พบตอน launch (ถูกถอนหลัง detect) แสดง error card พร้อมปุ่ม re-scan · DoD: หลาย agent session พร้อมกันได้อิสระ

**P4-T6 Dynamic bottom toolbar** · Files: `features/toolbar/*` · Approach: เลือก variant ตาม `SessionInfo.kind` และ capability (control ที่ capability ไม่รองรับ **ไม่ render**), shell variant: shell, cwd (คลิกเพื่อ copy), git branch, integration badge · DoD: ทดสอบ snapshot ของ toolbar กับ capability หลายชุด

**P4-T7 Prompt composer + native command shortcuts** · Approach: ตาม §9.4 ส่งผ่าน bracketed paste ไม่ส่ง Enter · DoD: ข้อความไทย 2,000 ตัวอักษรไปถึง Claude Code/Codex ครบถูกต้อง

**P4-T8 (opt-in, best-effort) Structured status** · Approach: Claude hooks ผ่าน `--settings` ไฟล์ชั่วคราว (event: Stop, Notification, UserPromptSubmit) และ Codex `notify` เขียนลง named pipe `\\.\pipe\arctri-<session>-<nonce>` (WSL ส่งผ่าน helper) · DoD: ปิดเป็นค่าเริ่มต้น ไม่กระทบการขออนุญาตของ agent ถ้าเกินเวลาของ phase นี้ให้ย้ายไป MVP 2 โดยไม่กระทบ acceptance

**P4-T9 Agent ใน shell tab (best-effort)** · Approach: เมื่อ `commandLine` ขึ้นต้นด้วย `claude`/`codex` ให้แสดงตัวตน agent ใน toolbar ระหว่าง block นั้น · DoD: แสดงเฉพาะระหว่างที่ block ยังรันอยู่

**Phase 4 acceptance**: เปิดและใช้งาน Codex และ Claude Code ที่ติดตั้งไว้ได้ทั้งบน Windows และ WSL พร้อมกันหลาย session, TUI และการขออนุญาตทำงานแบบ native, toolbar แสดงเฉพาะ control ที่ทำได้จริง, agent ที่ไม่ได้ติดตั้งแสดงข้อความที่เข้าใจได้

---

### Phase 5 — Polish, Testing and Packaging

| Task | สาระสำคัญ | DoD |
|---|---|---|
| P5-T1 Settings UI | ภาษา, theme, font/size, default profile, presentation ต่อ profile, scrollback, conpty mode, agent paths, history (ลบ/จำกัด/import), OSC 52 | ทุก pref ผ่าน zod และมีผลทันทีหรือแจ้งว่า "มีผลกับ tab ใหม่" |
| P5-T2 Error handling sweep | ทุกจุดที่ spawn/IO มี error state ที่ผู้ใช้เข้าใจ (th/en) | checklist ใน `docs/testing/manual-checklist.md` |
| P5-T3 Performance | profile ตามเป้า §16 ปรับ batching, virtualization, จำนวน WebGL context (ปิด WebGL ของ tab ที่ซ่อนนานเกิน 60 วินาที) | ผ่านเป้า §16 |
| P5-T4 Packaging | electron-builder NSIS per-user, fuses, ไอคอน, file associations ไม่มี, uninstall ล้างไฟล์ (เก็บ `%APPDATA%` ถ้าผู้ใช้เลือก) | ติดตั้งและรันบน Win10/11 ที่สะอาด |
| P5-T5 Compatibility runs | Win10 22H2 (เครื่องนี้ + VM สะอาด), Win11 23H2/24H2, scaling 100–175%, PS 5.1 อย่างเดียว (ไม่มี pwsh), ไม่มี WSL, WSL ที่ distro Stopped | รายงานผลใน `docs/testing/` |
| P5-T6 Thai IME validation | thai-matrix ครบทุกช่อง | ไม่มี regression จาก ADR-003 |
| P5-T7 Docs | `README.md`, `docs/RELEASE.md` (build, sign ภายหลัง, ข้อจำกัด), `CHANGELOG.md` | |

**Phase 5 acceptance**: ได้ตัวติดตั้งที่ผ่าน acceptance ของ MVP 1 ทุกข้อ บน Windows 10 และ Windows 11

---

## 15. ลำดับการพึ่งพา (Dependency graph)

```
P0-T1 ─┬─ PoC-1 (ConPTY/OSC) ─┬─ PoC-2 (block lifecycle) ─┐
       ├─ PoC-6 (packaging)    ├─ PoC-3 (Thai)             ├─► ADRs ─► Phase 1
       ├─ PoC-7 (throughput)   └─ PoC-4 (agents), PoC-5    ┘

Phase 1: T1 → T2,T3 → T4 → T5 ; T6,T7 → T4(profiles) ; T4 → T8 → T9 ; T10,T11 ขนานได้
Phase 2: T1 → T2 → T3 ⇄ T4 → T5 → T6 → T7 ; T8 ต้องมี T3 ; T9,T10 หลัง T5
Phase 3: T1 ขนานกับ T2 → T3 → T4 → T5          (ต้องมี P2-T8 editor และ P2-T3 cwd)
Phase 4: T1 → T2 → T3,T4 (ขนาน) → T5 → T6 → T7 ; T8,T9 optional
Phase 5: T1–T3 เริ่มได้หลัง Phase 4 ; T4 packaging pipeline เริ่มตั้งแต่ Phase 1 (CI สร้าง installer ทุก PR บน main)
```

ทำ packaging ตั้งแต่ต้น (CI ทุก phase) เพื่อให้ปัญหา native module โผล่เร็ว ไม่ไปเจอตอนท้าย

---

## 16. Testing strategy

### 16.1 ระดับการทดสอบ
| ระดับ | เครื่องมือ | รันที่ไหน | ครอบคลุม |
|---|---|---|---|
| Unit | Vitest (node env) | ทุกที่ (WSL/CI ใดก็ได้) | tokenizer, state machine, ranking, quoting, wsl list parser, path mapper, IPC schemas, capability gating |
| Component | Vitest + jsdom + Testing Library | ทุกที่ | BlockCard, toolbar variants, editor/overlay keyboard |
| PTY integration | Vitest + node-pty จริง + `@xterm/headless` | **Windows เท่านั้น** (เครื่องนี้ + CI `windows-latest`) ส่วน WSL test รันเมื่อพบ distro (CI ใช้ action ติดตั้ง Ubuntu) | integration scripts, block events, snapshot, cleanup |
| E2E | Playwright `_electron` | Windows | flow หลักของผู้ใช้ |
| Manual | checklist | Win10 จริง (เครื่องนี้), Win11 จริง/VM | IME, agent auth, installer, scaling, TUI feel |

### 16.2 Scenario matrix
| Scenario | Auto | Manual | หมายเหตุ |
|---|---|---|---|
| PowerShell command execution (5.1/7) | ✅ integration+e2e | | |
| CMD command execution | ✅ integration | | classic mode |
| WSL Bash execution | ✅ integration (ถ้ามี distro) | ✅ | |
| WSL unavailable | ✅ unit (mock wsl.exe/registry) + e2e ด้วย env override | ✅ VM ไม่มี WSL | |
| Distribution not found / stopped | ✅ unit + integration (`-d NoSuchDistro`) | ✅ stopped (`wsl --terminate`) | |
| Large output (100 MB) | ✅ integration (เวลา/หน่วยความจำ) | ✅ ความลื่นของ UI | |
| Long-running commands | ✅ (`Start-Sleep`, `sleep`) | | |
| Command cancellation (Ctrl+C) | ✅ integration | ✅ | exit 130 / interrupted |
| Nonzero exit codes | ✅ | | `exit 3`, `false`, `cmd /c exit 5`, cmdlet error |
| Multiline commands | ✅ integration | ✅ | ตาม ADR-005 |
| ANSI colors / cursor movement | ✅ fixture (vttest บางส่วน, progress bar) เทียบ headless | ✅ | |
| Alternate screen programs | ✅ (`less`, `vim -c q`) | ✅ vim/htop | |
| Resize during execution | ✅ (resize 50 ครั้งระหว่างรัน) | ✅ | ไม่มีข้อความผี |
| Multiple simultaneous sessions | ✅ (10 sessions พร้อม output) | | |
| Command block lifecycle | ✅ state machine + integration + e2e | | |
| Completion suggestions | ✅ unit + e2e | ✅ | |
| Paths containing spaces / Thai | ✅ | | |
| Thai IME composition | ⚠️ e2e จำลอง composition events ได้บางส่วน | ✅ **ต้อง manual** Thai Kedmanee/Pattachote, Microsoft IME | |
| Thai combining characters | ✅ snapshot/width unit test | ✅ ภาพหน้าจอเทียบ matrix | |
| Agent interactive input | ❌ (ต้อง login จริง) | ✅ | ใช้ fake TUI สคริปต์ Node ใน auto test แทน (ทดสอบ keys/alt-screen/paste) |
| Agent approval prompts | ❌ | ✅ | ตรวจว่า Arctri ไม่ตอบแทน |
| Windows installer startup | ✅ CI: ติดตั้งแบบ silent `/S` แล้ว launch + smoke e2e | ✅ VM สะอาด Win10/11 | |
| Process cleanup | ✅ ตรวจ process tree ก่อน/หลัง | | |
| Security (IPC/CSP/fuses) | ✅ unit + e2e (เรียก channel ด้วย args ผิด, ตรวจ fuses ของ exe) | | |

### 16.3 เป้าหมายประสิทธิภาพและความเสถียร (วัดบนเครื่องนี้ Win10)
| ตัวชี้วัด | เป้าหมาย |
|---|---|
| Cold start ถึงหน้าต่างพร้อม | ≤ 1.5 วินาที (p95) |
| Cold start ถึง prompt แรกของ pwsh 7 | ≤ 1 วินาทีเหนือเวลา start ของ pwsh เอง |
| Keystroke → echo (local pwsh/bash) | p95 ≤ 30 ms |
| Throughput (`cat` 100 MB) | ≥ 20 MB/s, UI ยัง ≥ 30 fps, Ctrl+C หยุดภายใน 1 วินาที |
| Snapshot block 10,000 บรรทัด | ≤ 50 ms |
| Autocomplete (history/commands) | p95 ≤ 50 ms · paths ≤ 150 ms (Windows), ≤ 250 ms (WSL) |
| หน่วยความจำ | ≤ 350 MB สำหรับ 5 tab ที่ idle |
| ความถูกต้องของ block | 0 block ผิดใน integration suite 1,000 คำสั่งแบบสุ่ม |
| Orphan processes | 0 หลังปิด tab/แอป ในทุก scenario |
| Crash | ไม่มี crash ใน soak test 8 ชั่วโมง (5 tab, output ต่อเนื่อง) |

---

## 17. Deferred to MVP 2
- ~~Split panes~~ (done after MVP 1: docs/decisions/ADR-011-split-panes.md)
- Programmable shell completion (bash-completion, PowerShell argument completers ผ่าน sidecar)
- AI command prediction/suggestion
- Command palette และค้นหาใน block (search addon)
- Blocks สำหรับ cmd.exe, fish, ssh remote integration
- บันทึก output ของ block ลงดิสก์ และ restore หลังเปิดแอปใหม่
- Deep agent control (Claude Agent SDK / Codex app-server protocol) และสถานะ agent แบบ structured ที่เปิดเป็นค่าเริ่มต้น
- Auto-update, code signing, ARM64, macOS/Linux
- Theme editor, workflow/snippet, sharing
- Mica/Acrylic บน Windows 11
- Non-goals ตามสเปก §8 (editor, file explorer, cloud, account, orchestration ฯลฯ) ไม่อยู่ในแผนใดๆ

---

## 18. คำถามที่ยังเปิดอยู่
1. เครื่อง Windows 11 สำหรับทดสอบ: มีเครื่องจริงหรือต้องเตรียม VM (Hyper-V/VirtualBox)?
2. Code signing certificate: ยังไม่มีใน MVP 1 (ยอมรับคำเตือน SmartScreen) ถูกต้องไหม
3. ชื่อ/ไอคอน/สี accent ของแบรนด์: ใช้ชั่วคราวไปก่อนได้หรือไม่
4. ถ้า PoC-1 พบว่า block บน Win10 inbox conpty ไม่น่าเชื่อถือและต้องพึ่ง bundled conpty.dll ยอมรับได้หรือไม่ (ค่าเริ่มต้นที่เสนอคือใช้ bundled)

---

## 19. Milestone แรกหลังอนุมัติ
1. บันทึกเอกสารนี้เป็น `D:\Desktop\Arctri\PLAN.md` และ `git init` (branch `main`) แล้ว commit
2. **Phase 0**: P0-T1 bootstrap → PoC-1 (ConPTY/OSC) และ PoC-6 (packaging) ก่อน เพราะสองตัวนี้ตัดสินว่าสถาปัตยกรรมหลักยืนได้หรือไม่ จากนั้น PoC-2/3/4/5/7
3. รายงานผล ADR ทั้งหมดให้ผู้ใช้ก่อนเริ่ม Phase 1

---

# Implementation status (2026-10-09)

The plan above was implemented in this order: Phase 0 proofs of concept, then Phases 1 to 5 together as one working application. Results and the
reasoning for each deviation are in `docs/decisions/ADR-*.md`; the release limits are in `docs/RELEASE.md`.

## Result against the acceptance criteria

| Phase | Status | Evidence |
|---|---|---|
| 0 Bootstrap and PoCs | Done | ADR-001 to ADR-008 (ConPTY/OSC, block lifecycle, Thai, agents, submission, native modules and packaging, throughput, worker threads) |
| 1 Terminal foundation | Done | real PTYs for PowerShell 5.1/7, cmd, WSL bash/zsh; tabs, rename, reorder, resize, copy/paste, scrollback, alternate screen; WSL optional |
| 2 Command blocks | Done for PowerShell 5.1/7, bash, zsh | 36 PTY tests + 14 multi-line/scope tests + headless snapshot tests + e2e; classic fallback tested |
| 3 Autocomplete | Done | providers for history, commands, paths, git, scripts; per-environment; safe by construction; WSL helper tested with hostile arguments |
| 4 Agents | Done except structured status | Codex and Claude Code launch in Windows and WSL; real TUIs driven; fake full-screen agent in the automated suite |
| 5 Polish, tests, packaging | Done on Windows 10 | NSIS installer, silent install + smoke test, fuses, cleanup tests, CI workflow, docs. **Not done: Windows 11, real IME, clean-VM install** |

## Deviations from the plan (and why)

1. Native modules are not rebuilt: both ship N-API prebuilds (ADR-006). `node:sqlite` fallback not needed.
2. The bundled conpty.dll is the default, not an option of last resort: the inbox ConPTY of Windows 10 reorders OSC, drops Thai vowels in PowerShell 5.1 and is 6 to 10 times slower (ADR-001, 003, 007).
3. The shell clears the screen right after echoing a command, so output always starts at row 0 (ADR-002); the live terminal covers the block list while a command runs.
4. Multi-line commands for bash and PowerShell are sent as one decodable line (ADR-005).
5. PTYs run in worker threads, one per session (ADR-008); the plan had them in the main process.
6. Structured agent status (P4-T8) is deferred to MVP 2; the toolbar shows Running / Exited and launch options only.
7. UI components are hand-written in the shadcn style (Radix + class-variance-authority); the shadcn CLI was not used. No Prettier.
8. `hello` reports "boundaries are available"; whether the screen is cleared is a separate environment flag (found when classic tabs showed no tracking bar).
9. Settings are applied immediately where possible; scrollback and conpty mode apply to new tabs.

## Tests at the end of the work

- Unit (Vitest, no PTY): 87 tests: OSC tokenizer, state machine, block tracker on headless xterm, completion, persistence, IPC validation, agents, i18n, launch builder, session manager with a fake PTY, data pump.
- Integration (Vitest, real PTYs and a real Ubuntu): 78 tests: blocks and snapshots on four shells, rapid and multi-line submission, WSL helper, cleanup of 20 tabs, throughput, Thai width, worker backend.
- End to end (Playwright against the built app): 20 tests, plus 3 opt-in tests with the real agent CLIs.
- Installer: `scripts/smoke-installed.mjs --install` (silent install, start, prompt, uninstall).

## Round 2 (agent UX), 2026-10-09

Requested after use: stable tab dots, a status bar that does not cover the terminal, detecting `claude`/`codex` typed in a shell, and an agent bar per agent
(attach files, changed files, remote-control for Claude, file panel, Rich Input, Codex notifications). Details and decisions: `docs/decisions/ADR-009-agent-in-shell-and-bar.md`.

Scope change decided by the product owner: a **read-only file panel inside the app** is now in scope (it replaces the non-goal "IDE-style file explorer"). It cannot open, edit or leave the tab's folder.
