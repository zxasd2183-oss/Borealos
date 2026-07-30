# Borealos Workspace Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a clean, version-controlled Borealos maintenance workspace without changing or interrupting the existing runtime layout.

**Architecture:** Copy selected first-party source trees into a new monorepo-style directory and exclude runtime data, credentials, dependencies, binaries, caches, backups, and generated artifacts. Keep the current system as the active runtime and validate the new workspace independently.

**Tech Stack:** Node.js 24, Electron, Android/Gradle, JavaScript, Java, SQLite, PowerShell, Git.

## Global Constraints

- Source root remains `D:\KIMI`.
- Destination is exactly `D:\KIMI\Borealos-Workspace`.
- Do not move or delete source files.
- Do not restart or reconfigure services listening on ports 443 or 18789–18795.
- Do not copy real secrets, user data, OpenClaw state, browser profiles, dependencies, build outputs, installers, or backups.
- Use a new independent Git repository in the destination.

---

### Task 1: Create the workspace foundation

**Files:**
- Create: `Borealos-Workspace/.gitignore`
- Create: `Borealos-Workspace/README.md`
- Create: `Borealos-Workspace/docs/architecture.md`
- Create: `Borealos-Workspace/docs/migration-manifest.md`

**Interfaces:**
- Consumes: Approved migration design.
- Produces: Directory contract used by all later copy and validation tasks.

- [ ] **Step 1: Create the directory structure**

Create `apps`, `platforms`, `services`, `scripts`, and `docs` with the approved child directories.

- [ ] **Step 2: Add a defensive `.gitignore`**

Ignore dependencies, builds, caches, logs, databases, user data, credentials, certificates, environment files, installers, archives, screenshots, browser profiles, and runtime state.

- [ ] **Step 3: Add workspace documentation**

Document system ownership, source mapping, active-runtime boundary, common commands, and safety rules.

- [ ] **Step 4: Verify structure**

Run a directory listing and verify every approved destination exists.

### Task 2: Copy Borealos applications

**Files:**
- Create: `Borealos-Workspace/apps/web/**`
- Create: `Borealos-Workspace/apps/windows/**`
- Create: `Borealos-Workspace/apps/macos/**`
- Create: `Borealos-Workspace/apps/android/**`

**Interfaces:**
- Consumes: `work-ui`, `nexa-win`, `nexa-mac`, and `nexa-apk`.
- Produces: Maintainable application sources without generated dependencies.

- [ ] **Step 1: Copy the web application**

Copy first-party web source and documentation while excluding logs, installers, APKs, archives, runtime output, and generated media.

- [ ] **Step 2: Copy Windows and macOS clients**

Copy Electron source, package manifests, icons, build scripts, and documentation. Exclude `node_modules`, `dist`, logs, and screenshots.

- [ ] **Step 3: Copy Android**

Copy Gradle and application source while excluding `.gradle`, `build`, APK output, and machine-specific `local.properties`.

- [ ] **Step 4: Verify application entry points**

Verify the web server, web page, Electron main files, Android manifest, and Gradle files exist.

### Task 3: Copy internal platforms and supporting services

**Files:**
- Create: `Borealos-Workspace/platforms/codework/**`
- Create: `Borealos-Workspace/platforms/openclaw/README.md`
- Create: `Borealos-Workspace/services/vector/**`
- Create: `Borealos-Workspace/services/tunnel/**`
- Create: `Borealos-Workspace/services/watchdog/**`

**Interfaces:**
- Consumes: CodeWork, OpenClaw topology, vector service, tunnel scripts, and watchdog scripts.
- Produces: Internal platform source and non-sensitive operational documentation.

- [ ] **Step 1: Copy CodeWork**

Copy core, UI, tests, migrations, templates, plugins, documentation, and configuration examples. Exclude dependencies, runtime state, deliverables, projects with user content, temporary test trees, coverage, logs, and duplicate UI backups.

- [ ] **Step 2: Document OpenClaw**

Create a topology and startup guide without copying identity, sessions, credentials, models, logs, approvals, or state.

- [ ] **Step 3: Copy supporting first-party sources**

Copy vector web sources and watchdog/tunnel scripts only when they contain no embedded credentials. Record excluded third-party binaries.

- [ ] **Step 4: Verify platform entry points**

Verify CodeWork package, core, UI, tests, and service documentation.

### Task 4: Security and integrity validation

**Files:**
- Modify: `Borealos-Workspace/docs/migration-manifest.md`
- Create: `Borealos-Workspace/docs/validation-report.md`

**Interfaces:**
- Consumes: All copied workspace files.
- Produces: Evidence that excluded material did not enter the repository.

- [ ] **Step 1: Scan prohibited names**

Fail validation if the destination contains real `.env`, private keys, certificates, databases, user data, `node_modules`, `.gradle`, build outputs, browser profiles, installers, or archives.

- [ ] **Step 2: Scan sensitive content**

Search first-party text files for likely credentials. Record file names and categories without copying secret values into the report.

- [ ] **Step 3: Compare critical source files**

Compute SHA-256 hashes for copied entry points and confirm they match their source counterparts.

- [ ] **Step 4: Recheck active ports**

Confirm the original runtime ports remain listening after the copy.

### Task 5: Establish Git baseline and run checks

**Files:**
- Create: `Borealos-Workspace/.git/**`
- Modify: `Borealos-Workspace/docs/validation-report.md`

**Interfaces:**
- Consumes: Validated workspace.
- Produces: Reproducible clean baseline for future maintenance.

- [ ] **Step 1: Initialize Git**

Run `git init` in the destination and configure repository-local identity if no usable identity is available.

- [ ] **Step 2: Review ignored and staged files**

Use `git status --short --ignored` and ensure no prohibited files are staged.

- [ ] **Step 3: Run syntax and test checks**

Run JavaScript syntax checks for key entry points and run the CodeWork Vitest suite from the copied source using the existing dependency runtime without copying `node_modules`.

- [ ] **Step 4: Commit the baseline**

Commit with message `chore: establish Borealos workspace baseline`.

- [ ] **Step 5: Record final evidence**

Record file counts, Git commit ID, test totals, known failures, exclusions, and original runtime port status.
