# GitHub Octokit Sync

[![CI](https://github.com/rhoades-brown/obsidian-github/actions/workflows/ci.yml/badge.svg)](https://github.com/rhoades-brown/obsidian-github/actions/workflows/ci.yml)

Sync your Obsidian vault with GitHub using the official Octokit API — no Git CLI required. Use GitHub as a remote backup and collaboration tool for your vault on any device, including mobile.

## Features

### Sync

- **Two-way sync** — pull changes from GitHub and push local changes in a single operation
- **Selective sync** — stage individual files or sync everything at once
- **Auto-sync** — sync on save, on a configurable interval, or on startup
- **Subfolder mapping** — sync your vault to a specific subfolder within the repository
- **Configuration sync** — optionally sync `.obsidian` settings (themes, snippets, hotkeys) across devices
- **Batch commits** — multiple file changes are committed in a single Git tree operation for efficiency

### Multi-repo support

- **Additional repositories** — sync extra GitHub repos into specific vault directories (e.g., a shared notes folder)
- **Independent sync** — each additional repo syncs independently with its own branch, subfolder, and ignore patterns
- **Shared config across devices** — additional repo configurations are stored in `.github-sync-repos.json` inside the vault, so they are synced with the primary repo and automatically picked up on other devices
- **Per-repo tokens** — use the main token or a separate PAT for each additional repo

### Settings

- **Declarative settings UI** — built on Obsidian's 1.13.0 declarative Settings API with searchable, keyboard-navigable settings
- **Inline validation** — connection failures and path overlaps shown as inline error messages directly on the setting
- **Confirmation dialogs** — destructive actions (deleting repos, clearing logs) prompt for confirmation via native `ConfirmationModal`

### Security

- **Encrypted token storage** — all GitHub tokens (main and per-repo) are stored in Obsidian's encrypted `SecretStorage`, never in plaintext `data.json`
- **Auto-migration** — existing plaintext tokens are automatically migrated to `SecretStorage` on first load after upgrade

### Conflict resolution

- **Automatic detection** — files modified both locally and on GitHub are flagged as conflicts
- **Visual diff view** — side-by-side and inline diff comparison for conflicting files
- **Resolution options** — keep local, keep remote, or edit manually and re-sync

### Sync panel

- **File change overview** — files grouped by status (added, modified, deleted, conflict) with repo labels for multi-repo setups
- **Commit history** — view recent commits with author, message, and timestamp (collapsible)
- **Live logs** — real-time sync log viewer with filtering (collapsible)
- **Persistent UI state** — panel collapse states are remembered across restarts via per-vault local storage

### Other

- **Clipboard access** — the "Copy logs" and "Export logs" buttons write sync log text to the system clipboard (write-only; the plugin never reads from the clipboard)
- **Ignore patterns** — glob-based patterns to exclude files and folders from sync
- **Commit message templates** — customisable templates with `{date}` and `{action}` variables
- **Status bar** — live sync status indicator; click to open the sync panel
- **Ribbon icon** — left-click to sync, right-click for quick actions (pull, push, open panel, settings)
- **Configurable logging** — adjustable log level (debug/info/warn/error) with optional file persistence
- **Mobile compatible** — works on iOS and Android (not desktop-only)

## Prerequisites

- Obsidian v1.13.0 or later
- A GitHub account with a Personal Access Token

## Installation

> **Note**: Back up your vault before installing. This plugin is in early development.

### From Obsidian Community Plugins

1. Open **Settings → Community plugins → Browse**
2. Search for "GitHub Octokit Sync"
3. Select **Install**, then **Enable**

### BRAT (for beta releases, not recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Open **Settings → Community plugins → BRAT**
3. Select **Add beta plugin**
4. Enter `rhoades-brown/obsidian-github`
5. Choose **latest** as the version
6. Select **Add Plugin**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/rhoades-brown/obsidian-github/releases)
2. Create `<vault>/.obsidian/plugins/github-octokit/`
3. Copy the downloaded files into this folder
4. Reload Obsidian and enable the plugin in **Settings → Community plugins**

## Setup

### 1. Generate a GitHub Personal Access Token

1. Go to [GitHub → Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Select **Generate new token (classic)**
3. Name it (e.g., "Obsidian Vault Sync") and select the `repo` scope
4. Select **Generate token** and copy it

### 2. Configure the plugin

1. Open **Settings → GitHub Octokit Sync**
2. Paste your token and select **Connect**
3. Select a repository from the dropdown
4. Optionally configure branch, subfolder, sync triggers, and commit message template

### 3. Add additional repositories (optional)

1. In settings, scroll to **Additional repositories**
2. Select **Add** and enter the repo owner, name, branch, and local vault directory
3. Choose whether to use the main token or a separate one
4. The configuration is saved to `.github-sync-repos.json` in your vault and synced automatically

## Usage

### Commands

Open the command palette (`Ctrl/Cmd + P`) and search for:

| Command | Description |
| ------- | ----------- |
| **Sync now** | Full bidirectional sync |
| **Pull from GitHub** | Download remote changes only |
| **Push to GitHub** | Upload local changes only |
| **Open sync panel** | Open the sidebar sync panel |
| **Open sync modal** | Open the sync modal |
| **Open diff view** | Open the diff comparison view |
| **View sync conflicts** | Jump to conflicts in the sync panel |
| **Open GitHub settings** | Open plugin settings |

### Ribbon and status bar

- **Left-click** the GitHub ribbon icon to sync
- **Right-click** for quick actions (pull, push, open panel, settings)
- **Click the status bar** indicator to open the sync panel

### Resolving conflicts

1. Conflicting files appear in the sync panel under **Conflicts**
2. Select **Diff** to see a side-by-side comparison
3. Choose a resolution:
   - **Keep local** — use your version
   - **Keep remote** — use the GitHub version
   - **Manual** — edit the file yourself, then sync again

## Configuration

| Setting | Description |
| ------- | ----------- |
| **GitHub token** | Your Personal Access Token (stored encrypted) |
| **Repository** | The GitHub repo to sync with |
| **Branch** | Branch name (default: main) |
| **Subfolder path** | Sync only a subfolder of the remote repo |
| **Sync configuration** | Include `.obsidian` settings in sync |
| **Sync on save** | Auto-sync when you modify a file (debounced) |
| **Sync on interval** | Sync every N minutes |
| **Sync on startup** | Sync when Obsidian opens |
| **Commit message** | Template with `{date}` and `{action}` variables |
| **Conflict strategy** | Default resolution: manual, keep-local, keep-remote, keep-both |
| **Status bar** | Show/hide the sync status indicator |
| **Notifications** | Show/hide sync result notices |
| **Logging** | Enable/disable, set level, optionally persist to file |

## Ignore patterns

The following paths are always excluded from sync:

- `.obsidian/plugins/**` — plugin files are managed separately
- `.obsidian/workspace.json` and `workspace-mobile.json` — machine-specific
- `.git/**`, `.gitignore`

Add custom glob patterns in **Settings → Ignore patterns**:

```text
*.log
private/**
*.tmp
drafts/wip-*
```

## Development & contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, project structure, conventional commit guidelines, and the automated CI/CD versioning workflow.

## Troubleshooting

### "Authentication failed"

- Verify your token has the `repo` scope
- Check if the token has expired
- Generate a new token and re-connect

### "Rate limit exceeded"

- GitHub allows 5,000 API requests per hour for authenticated users
- The notification shows when the limit resets
- Reduce sync frequency in settings

### "Conflict detected"

- Open the sync panel to view and resolve conflicts
- Use the diff view to compare local and remote versions

### Files keep re-syncing

- Enable debug logging to inspect sync state
- Verify line endings are consistent (the plugin normalises to LF)
- Check that ignore patterns are correctly configured

### Debug with logs

1. Enable logging in **Settings → Logging**
2. Set log level to **Debug** for verbose output
3. Open the developer console (`Cmd+Option+I` on macOS, `Ctrl+Shift+I` on Windows) for real-time logs
4. Or select **View logs** in settings to see recent entries in-app

## License

MIT
