import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import type GitHubOctokitPlugin from '../../main';
import { FileSyncState } from '../services/syncService';
import { LogEntry } from '../services/loggerService';

export const SYNC_VIEW_TYPE = 'github-octokit-sync-view';

type FileGroupStatus = 'added' | 'modified' | 'deleted' | 'conflict' | 'renamed';

interface FileGroup {
    status: FileGroupStatus;
    label: string;
    icon: string;
    files: FileSyncState[];
}

export class SyncView extends ItemView {
    private plugin: GitHubOctokitPlugin;
    private changes: FileSyncState[] = [];
    private stagedPaths: Set<string> = new Set();
    private isRefreshing = false;
    private logUnsubscribe: (() => void) | null = null;
    private commitsExpanded = true;
    private logsExpanded = false;

    constructor(leaf: WorkspaceLeaf, plugin: GitHubOctokitPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return SYNC_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'GitHub sync';
    }

    getIcon(): string {
        return 'github';
    }

    async onOpen(): Promise<void> {
        await this.refresh();
    }

    async onClose(): Promise<void> {
        // Cleanup log listener
        if (this.logUnsubscribe) {
            this.logUnsubscribe();
            this.logUnsubscribe = null;
        }
        await Promise.resolve();
    }

    /**
     * Refresh the view by fetching current changes
     */
    async refresh(): Promise<void> {
        if (this.isRefreshing) return;

        this.isRefreshing = true;
        this.renderLoading();

        try {
            if (!this.plugin.githubService.isAuthenticated || !this.plugin.settings.repo) {
                this.renderNotConnected();
                return;
            }

            // Build indexes and compare
            const localIndex = await this.plugin.syncService.buildLocalIndex();
            const remoteIndex = await this.plugin.syncService.buildRemoteIndex(
                this.plugin.settings.repo.owner,
                this.plugin.settings.repo.name,
                this.plugin.settings.repo.branch
            );

            this.changes = await this.plugin.syncService.compareIndexes(
                localIndex,
                remoteIndex,
                this.plugin['syncState'] || undefined
            );

            // Filter to only changed files
            this.changes = this.changes.filter(c => c.status !== 'unchanged');

            this.render();
        } catch (error) {
            console.error('Failed to refresh sync view:', error);
            this.renderError(error instanceof Error ? error.message : String(error));
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Stage or unstage a file
     */
    toggleStaged(path: string): void {
        if (this.stagedPaths.has(path)) {
            this.stagedPaths.delete(path);
        } else {
            this.stagedPaths.add(path);
        }
        this.render();
    }

    /**
     * Stage all files
     */
    stageAll(): void {
        for (const change of this.changes) {
            this.stagedPaths.add(change.path);
        }
        this.render();
    }

    /**
     * Unstage all files
     */
    unstageAll(): void {
        this.stagedPaths.clear();
        this.render();
    }

    private renderLoading(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('github-octokit-sync-view');
        container.createEl('p', { text: 'Loading...', cls: 'sync-loading' });
    }

    private renderNotConnected(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('github-octokit-sync-view');

        const msg = container.createDiv({ cls: 'sync-message' });
        msg.createEl('h3', { text: 'Not connected' });
        msg.createEl('p', { text: 'Please configure your GitHub connection in settings.' });

        const btn = msg.createEl('button', { text: 'Open settings', cls: 'mod-cta' });
        btn.addEventListener('click', () => {
            this.plugin.openSettings();
        });
    }

    private renderError(message: string): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('github-octokit-sync-view');

        const msg = container.createDiv({ cls: 'sync-error' });
        msg.createEl('h3', { text: 'Error' });
        msg.createEl('p', { text: message });

        const btn = msg.createEl('button', { text: 'Retry' });
        btn.addEventListener('click', () => { void this.refresh(); });
    }

    private render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('github-octokit-sync-view');

        // Header
        this.renderHeader(container);

        // File list
        this.renderFileList(container);

        // Action buttons
        this.renderActions(container);

        // Commit history (foldable)
        void this.renderCommitHistory(container);

        // Logs section (foldable, only if logging enabled)
        if (this.plugin.settings.logging.enabled) {
            this.renderLogs(container);
        }
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'sync-header' });

        const title = header.createDiv({ cls: 'sync-title' });
        title.createEl('h3', { text: 'GitHub sync' });

        if (this.plugin.settings.repo) {
            title.createSpan({
                cls: 'sync-repo',
                text: `${this.plugin.settings.repo.owner}/${this.plugin.settings.repo.name}`
            });
        }

        const refreshBtn = header.createEl('button', { cls: 'sync-refresh-btn', text: '↻' });
        refreshBtn.title = 'Refresh';
        refreshBtn.addEventListener('click', () => { void this.refresh(); });

        // Stats
        const stats = header.createDiv({ cls: 'sync-stats' });
        const added = this.changes.filter(c => c.status === 'added').length;
        const modified = this.changes.filter(c => c.status === 'modified').length;
        const deleted = this.changes.filter(c => c.status === 'deleted').length;
        const conflicts = this.changes.filter(c => c.status === 'conflict').length;

        if (added) stats.createSpan({ cls: 'stat-added', text: `+${added}` });
        if (modified) stats.createSpan({ cls: 'stat-modified', text: `~${modified}` });
        if (deleted) stats.createSpan({ cls: 'stat-deleted', text: `-${deleted}` });
        if (conflicts) stats.createSpan({ cls: 'stat-conflict', text: `!${conflicts}` });
        if (!added && !modified && !deleted && !conflicts) {
            stats.createSpan({ cls: 'stat-uptodate', text: 'Up to date' });
        }
    }

    private renderFileList(container: HTMLElement): void {
        const listContainer = container.createDiv({ cls: 'sync-file-list' });

        if (this.changes.length === 0) {
            listContainer.createEl('p', {
                text: 'No changes to sync.',
                cls: 'sync-empty'
            });
            return;
        }

        // Group files by status
        const groups: FileGroup[] = [
            { status: 'conflict', label: 'Conflicts', icon: '⚠️', files: [] },
            { status: 'added', label: 'Added', icon: 'A', files: [] },
            { status: 'modified', label: 'Modified', icon: '+', files: [] },
            { status: 'deleted', label: 'Deleted', icon: '-', files: [] },
            { status: 'renamed', label: 'Renamed', icon: 'R', files: [] },
        ];

        for (const change of this.changes) {
            const group = groups.find(g => g.status === change.status);
            if (group) group.files.push(change);
        }

        for (const group of groups) {
            if (group.files.length === 0) continue;
            this.renderFileGroup(listContainer, group);
        }
    }

    private renderFileGroup(container: HTMLElement, group: FileGroup): void {
        const groupEl = container.createDiv({ cls: `file-group file-group-${group.status}` });

        const groupHeader = groupEl.createDiv({ cls: 'file-group-header' });
        groupHeader.createSpan({ cls: 'group-icon', text: group.icon });
        groupHeader.createSpan({ cls: 'group-label', text: `${group.label} (${group.files.length})` });

        const fileList = groupEl.createDiv({ cls: 'file-group-files' });

        for (const file of group.files) {
            const fileEl = fileList.createDiv({ cls: 'sync-file' });
            const isStaged = this.stagedPaths.has(file.path);

            // Checkbox
            const checkbox = fileEl.createEl('input', { type: 'checkbox' });
            checkbox.checked = isStaged;
            checkbox.addEventListener('change', () => this.toggleStaged(file.path));

            // File name with hover tooltip
            const pathParts = file.path.split('/');
            const displayName = pathParts[pathParts.length - 1];
            const fileNameEl = fileEl.createSpan({ cls: 'file-name', text: displayName });
            fileNameEl.setAttribute('title', file.path);

            // Actions
            const actions = fileEl.createDiv({ cls: 'file-actions' });

            // View diff button
            const diffBtn = actions.createEl('button', { text: 'Diff', cls: 'file-action' });
            diffBtn.addEventListener('click', () => {
                void this.openFileDiff(file.path);
            });

            // Open in GitHub
            if (this.plugin.settings.repo) {
                const ghBtn = actions.createEl('button', { text: 'GitHub', cls: 'file-action' });
                ghBtn.addEventListener('click', () => {
                    const url = `https://github.com/${this.plugin.settings.repo!.owner}/${this.plugin.settings.repo!.name}/blob/${this.plugin.settings.repo!.branch}/${file.path}`;
                    window.open(url, '_blank');
                });
            }
        }
    }

    private async openFileDiff(path: string): Promise<void> {
        try {
            // Get local content
            const file = this.app.vault.getAbstractFileByPath(path);
            let localContent = '';
            if (file instanceof TFile) {
                localContent = await this.app.vault.read(file);
            }

            // Get remote content
            let remoteContent = '';
            if (this.plugin.settings.repo) {
                try {
                    const remote = await this.plugin.githubService.getFileContent(
                        this.plugin.settings.repo.owner,
                        this.plugin.settings.repo.name,
                        path
                    );
                    remoteContent = atob(remote.content);
                } catch {
                    // File doesn't exist on remote
                }
            }

            await this.plugin.openDiffView(path, localContent, remoteContent);
        } catch (error) {
            new Notice(`Failed to open diff: ${error}`);
        }
    }

    private renderActions(container: HTMLElement): void {
        const actionsBar = container.createDiv({ cls: 'sync-actions-bar' });

        // Stage controls
        const stageControls = actionsBar.createDiv({ cls: 'stage-controls' });

        const stageAllBtn = stageControls.createEl('button', { text: 'Stage all' });
        stageAllBtn.addEventListener('click', () => { this.stageAll(); });

        const unstageAllBtn = stageControls.createEl('button', { text: 'Unstage all' });
        unstageAllBtn.addEventListener('click', () => { this.unstageAll(); });

        // Sync controls
        const syncControls = actionsBar.createDiv({ cls: 'sync-controls' });

        const pullBtn = syncControls.createEl('button', { text: '⬇ Pull' });  // eslint-disable-line obsidianmd/ui/sentence-case
        pullBtn.addEventListener('click', () => {
            void this.plugin.performSync('pull').then(() => this.refresh());
        });

        const pushBtn = syncControls.createEl('button', { text: '⬆ Push' });  // eslint-disable-line obsidianmd/ui/sentence-case
        pushBtn.addEventListener('click', () => {
            void this.plugin.performSync('push').then(() => this.refresh());
        });

        const syncBtn = syncControls.createEl('button', { text: '⟳ Sync', cls: 'mod-cta' });  // eslint-disable-line obsidianmd/ui/sentence-case
        syncBtn.addEventListener('click', () => {
            void this.plugin.performSync().then(() => this.refresh());
        });

        // Staged count
        if (this.stagedPaths.size > 0) {
            actionsBar.createSpan({
                cls: 'staged-count',
                text: `${this.stagedPaths.size} files staged`
            });
        }
    }

    private async renderCommitHistory(container: HTMLElement): Promise<void> {
        const historySection = container.createDiv({ cls: 'commit-history' });

        // Foldable header
        const header = historySection.createDiv({ cls: 'history-header foldable-header' });
        const chevron = header.createSpan({ cls: `fold-chevron ${this.commitsExpanded ? 'expanded' : ''}` });
        chevron.textContent = '▶';
        header.createEl('h4', { text: 'Commit history' });

        header.addEventListener('click', () => {
            this.commitsExpanded = !this.commitsExpanded;
            void this.render();
        });

        if (!this.commitsExpanded) {
            return;
        }

        if (!this.plugin.settings.repo) {
            historySection.createEl('p', { text: 'No repository selected', cls: 'history-empty' });
            return;
        }

        try {
            const commits = await this.plugin.githubService.getCommits(
                this.plugin.settings.repo.owner,
                this.plugin.settings.repo.name,
                this.plugin.settings.repo.branch,
                5
            );

            if (commits.length === 0) {
                historySection.createEl('p', { text: 'No commits yet', cls: 'history-empty' });
                return;
            }

            const list = historySection.createDiv({ cls: 'commit-list' });
            for (const commit of commits) {
                const commitEl = list.createDiv({ cls: 'commit-item' });

                const message = commitEl.createDiv({ cls: 'commit-message' });
                message.textContent = commit.message.split('\n')[0]; // First line only

                const meta = commitEl.createDiv({ cls: 'commit-meta' });
                const date = commit.date
                    ? new Date(commit.date).toLocaleDateString()
                    : '';
                meta.textContent = `${commit.author} • ${date}`;

                // Link to GitHub
                commitEl.addEventListener('click', () => {
                    window.open(commit.url, '_blank');
                });
            }
        } catch {
            historySection.createEl('p', {
                text: 'Failed to load commits',
                cls: 'history-error'
            });
        }
    }

    private renderLogs(container: HTMLElement): void {
        const logsSection = container.createDiv({ cls: 'sync-logs-section' });

        // Foldable header
        const header = logsSection.createDiv({ cls: 'logs-header foldable-header' });
        const chevron = header.createSpan({ cls: `fold-chevron ${this.logsExpanded ? 'expanded' : ''}` });
        chevron.textContent = '▶';
        header.createEl('h4', { text: 'Sync logs' });

        header.addEventListener('click', (e) => {
            // Don't toggle if clicking on controls
            if ((e.target as HTMLElement).closest('.logs-controls')) return;
            this.logsExpanded = !this.logsExpanded;
            void this.render();
        });

        // Controls (always visible in header)
        const controls = header.createDiv({ cls: 'logs-controls' });

        // Copy button
        const copyBtn = controls.createEl('button', { text: 'Copy', cls: 'logs-copy-btn' });
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = this.plugin.logger.exportAsText();
            void navigator.clipboard.writeText(text);
            new Notice('Logs copied to clipboard');
        });

        // Clear button
        const clearBtn = controls.createEl('button', { text: 'Clear', cls: 'logs-clear-btn' });
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.plugin.logger.clear();
            if (this.logsExpanded) {
                this.renderLogEntries(logsContainer, 'all');
            }
        });

        if (!this.logsExpanded) {
            return;
        }

        // Log level filter (only when expanded)
        const filterContainer = logsSection.createDiv({ cls: 'logs-filter' });
        filterContainer.createSpan({ text: 'Filter: ' });
        const levelSelect = filterContainer.createEl('select', { cls: 'logs-level-select' });
        ['all', 'debug', 'info', 'warn', 'error'].forEach(level => {
            const option = levelSelect.createEl('option', { text: level, value: level });
            if (level === 'all') option.selected = true;
        });

        // Logs container
        const logsContainer = logsSection.createDiv({ cls: 'sync-logs-container' });

        // Initial render
        this.renderLogEntries(logsContainer, 'all');

        // Filter change
        levelSelect.addEventListener('change', () => {
            this.renderLogEntries(logsContainer, levelSelect.value);
        });

        // Subscribe to new log entries
        if (this.logUnsubscribe) {
            this.logUnsubscribe();
        }
        this.logUnsubscribe = this.plugin.logger.onEntry((entry: LogEntry) => {
            const currentFilter = levelSelect.value;
            if (currentFilter === 'all' || entry.level === currentFilter) {
                this.appendLogEntry(logsContainer, entry, true); // prepend to show newest first
            }
        });
    }

    private renderLogEntries(container: HTMLElement, filter: string): void {
        container.empty();

        const entries = this.plugin.logger.getRecentEntries(50);
        const filtered = filter && filter !== 'all'
            ? entries.filter(e => e.level === filter)
            : entries;

        if (filtered.length === 0) {
            container.createDiv({ text: 'No log entries', cls: 'logs-empty' });
            return;
        }

        // Show newest first - reverse and append (not prepend)
        [...filtered].reverse().forEach(entry => {
            this.appendLogEntry(container, entry, false);
        });
    }

    private appendLogEntry(container: HTMLElement, entry: LogEntry, prepend = false): void {
        // Remove "No log entries" placeholder if present
        const emptyPlaceholder = container.querySelector('.logs-empty');
        if (emptyPlaceholder) {
            emptyPlaceholder.remove();
        }

        const entryEl = createDiv({ cls: `log-entry log-${entry.level}` });

        const time = entry.timestamp.toLocaleTimeString();
        entryEl.createSpan({ text: `[${time}]`, cls: 'log-time' });
        entryEl.createSpan({ text: `[${entry.level.toUpperCase()}]`, cls: 'log-level' });
        entryEl.createSpan({ text: `[${entry.category}]`, cls: 'log-category' });
        entryEl.createSpan({ text: entry.message, cls: 'log-message' });

        if (entry.data) {
            const dataEl = entryEl.createEl('pre', { cls: 'log-data' });
            dataEl.textContent = JSON.stringify(entry.data, null, 2);
        }

        if (prepend) {
            // Always prepend new entries at the top (newest first)
            if (container.firstChild) {
                container.insertBefore(entryEl, container.firstChild);
            } else {
                container.appendChild(entryEl);
            }
        } else {
            container.appendChild(entryEl);
        }

        // Limit entries displayed - remove from bottom (oldest) when prepending
        while (container.children.length > 50) {
            container.lastChild?.remove();
        }
    }
}
