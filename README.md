# GitHub Octokit - Obsidian Plugin

[![CI](https://github.com/rhoades-brown/obsidian-github/actions/workflows/ci.yml/badge.svg)](https://github.com/rhoades-brown/obsidian-github/actions/workflows/ci.yml)

Sync your Obsidian Vault with a GitHub repository using the official GitHub API (Octokit).

This plugin provides a simple and efficient way to sync your Obsidian vault with a GitHub repository without external dependencies like Git CLI. Use GitHub as a remote backup and collaboration tool for your Obsidian vault on any device.

## Features

- **Two-way sync**: Pull changes from GitHub and push local changes
- **Conflict detection**: Automatically detects when files have been modified both locally and remotely
- **Visual diff view**: Side-by-side and inline diff comparison for conflicting files
- **Batch commits**: Efficiently commits multiple files in a single operation
- **Auto-sync options**: Sync on save, on interval, or on startup
- **Subfolder mapping**: Sync your vault to a specific subfolder in the repository
- **Ignore patterns**: Configure which files and folders to exclude from sync
- **Commit history**: View recent commits directly in Obsidian
- **Sync logging**: Debug sync operations with configurable logging
- **File status indicators**: See at a glance which files are added, modified, or deleted

## Prerequisites

- Obsidian
- A GitHub account

## Installation

> **Note**: Please make a backup copy of your vault before installing this plugin. This plugin is still in early development and there may be bugs.

### From Obsidian Community Plugins (Coming Soon)

1. Open Settings → Community Plugins
2. Search for "GitHub Octokit"
3. Click Install, then Enable

### BETA (BRAT) Installation

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Open Settings → Community Plugins → BRAT
3. Click "Add beta plugin"
4. Enter this repository `rhoades-brown\obsidian-github`.
5. Choose 'latest' as the version.
6. Click "Add Plugin"

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `<vault>/.obsidian/plugins/github-octokit/`
3. Copy the downloaded files into this folder
4. Reload Obsidian and enable the plugin in Settings → Community Plugins

## Setup

### 1. Generate a GitHub Personal Access Token (PAT)

1. Go to [GitHub Settings → Developer Settings → Personal Access Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Obsidian Vault Sync")
4. Select scopes:
   - `repo` (Full control of private repositories)
5. Click "Generate token" and copy it

### 2. Configure the Plugin

1. Open Obsidian Settings → GitHub Octokit
2. Paste your Personal Access Token
3. Click "Connect" to authenticate
4. Select a repository from the dropdown
5. Optionally configure:
   - Branch name (default: main)
   - Vault subfolder to sync
   - Sync triggers (on save, interval, startup)
   - Commit message template

## Usage

### Manual Sync

- **Command Palette**: Press `Ctrl/Cmd + P` and search for:
  - "GitHub Octokit: Sync now" - Full bidirectional sync
  - "GitHub Octokit: Pull from GitHub" - Download remote changes
  - "GitHub Octokit: Push to GitHub" - Upload local changes

- **Ribbon Icon**: Click the GitHub icon in the left ribbon, or right-click for quick actions

- **Status Bar**: Click the sync status in the bottom-right to open the sync panel

### Sync Panel

Open the sync panel via:

- Command: "GitHub Octokit: Open sync panel"
- Right-click the ribbon icon → "Open Sync Panel"
- Click the status bar indicator

The sync panel shows:

- Files with changes (grouped by status)
- Conflict resolution options
- Recent commit history

### Resolving Conflicts

When a file has been modified both locally and on GitHub:

1. The file appears in the "Conflicts" section
2. Click "Diff" to see a side-by-side comparison
3. Choose a resolution:
   - **Keep Local**: Use your local version
   - **Keep Remote**: Use the GitHub version
   - **Manual**: Edit the file yourself, then sync again

## Configuration Options

| Setting | Description |
|---------|-------------|
| **GitHub Token** | Your Personal Access Token |
| **Repository** | The GitHub repo to sync with |
| **Branch** | Branch name (default: main) |
| **Vault Subfolder** | Only sync files in this folder |
| **Sync on Save** | Auto-sync when you save a file |
| **Sync on Interval** | Sync automatically every X minutes |
| **Sync on Startup** | Sync when Obsidian opens |
| **Commit Message** | Template for commit messages. Variables: `{date}`, `{action}` |
| **Conflict Strategy** | Default resolution: ask, keep-local, keep-remote, keep-both |
| **Status Bar** | Show/hide sync status in status bar |
| **Notifications** | Show/hide sync notifications |
| **Enable Logging** | Log sync operations for debugging |
| **Log Level** | Minimum log level: debug, info, warn, error |
| **Persist Logs** | Save logs to a file in your vault |

## Ignore Patterns

By default, the following are excluded from sync:

- `.obsidian/workspace.json`
- `.obsidian/workspace-mobile.json`
- `.obsidian/github-sync-metadata.json`
- `.git/**`
- `.gitignore`

Add custom patterns in Settings → GitHub Octokit → Ignore Patterns:

- `*.log` - All log files
- `private/**` - Everything in the private folder
- `*.tmp` - All .tmp files
- `.obsidian/**` - All Obsidian settings (if desired)

## Development

```bash
# Clone and install
git clone https://github.com/rhoades-brown/obsidian-github.git
cd obsidian-github
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (rebuilds on file changes)
npm run dev
```

### Project Structure

```text
obsidian-github/
├── main.ts              # Plugin entry point
├── src/
│   ├── services/        # Core services (GitHub API, Sync, Logger)
│   ├── views/           # UI components (DiffView, SyncView)
│   └── utils/           # Utility functions (file, diff, encoding)
├── tests/               # Jest test suites
└── styles.css           # Plugin styles
```

## Troubleshooting

### "Authentication failed"

- Verify your token has the `repo` scope
- Check if the token has expired
- Try generating a new token

### "Rate limit exceeded"

- GitHub limits API requests (5000/hour for authenticated users)
- Wait for the reset time shown in the notification
- Reduce sync frequency in settings

### "Conflict detected"

- Open the sync panel to view and resolve conflicts
- Use the diff view to compare versions

### Files keep re-syncing

- Check if sync state is being preserved (enable logging to debug)
- Verify line endings are consistent (plugin normalizes to LF)
- Ensure ignore patterns are correctly configured

### Debug with Logs

1. Enable logging in Settings → GitHub Octokit → Logging
2. Set log level to "Debug" for verbose output
3. Open the debug console (macOS → cmd+option+i; Windows → ctrl+shift+i) to see real-time logs
4. Or click "View Logs" in settings to see recent entries

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT
