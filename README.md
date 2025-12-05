# GitHub Octokit - Obsidian Plugin

Sync your Obsidian Vault with a GitHub repository using the the GitHub official API Octokit. 

The aim of this tool is to provide a simple and efficient way to sync your Obsidian vault with a GitHub repository without using any external dependencies.  This enables the use of GitHub as a remote backup and collaboration tool for your Obsidian vault on any device.

## Features

- **Two-way sync**: Pull changes from GitHub and push local changes
- **Conflict detection**: Automatically detects when files have been modified both locally and remotely
- **Visual diff view**: Side-by-side and inline diff comparison for conflicting files
- **Batch commits**: Efficiently commits multiple files in a single operation
- **Auto-sync options**: Sync on save, on interval, or on startup
- **Subfolder mapping**: Sync a specific folder in your vault to a subfolder in the repository
- **Ignore patterns**: Configure which files and folders to exclude from sync

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Settings → Community Plugins
2. Search for "GitHub Octokit"
3. Click Install, then Enable

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

## Ignore Patterns

By default, the following are excluded from sync:
- `.obsidian/` (Obsidian settings)
- `.git/`
- `node_modules/`
- `.DS_Store`

Add custom patterns in settings using glob syntax:
- `*.log` - All log files
- `private/**` - Everything in the private folder
- `*.tmp` - All .tmp files

## Development

```bash
# Clone and install
git clone <repo>
cd obsidian-github
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
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

## License

MIT
