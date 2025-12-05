import { App, TFile, Vault } from 'obsidian';
import { GitHubService, GitHubTreeEntry, BatchFileChange } from './githubService';
import {
    hashContent,
    isBinaryFile,
    encodeBase64,
    encodeBase64Binary,
    decodeBase64,
    decodeBase64Binary,
    matchesIgnorePattern,
    normalizePath,
    computeGitBlobSha,
    computeGitBlobShaBinary
} from '../utils/fileUtils';

// ============================================================================
// Sync Service - Core sync logic for pull, push, and conflict detection
// ============================================================================

/** Status of a file in the sync comparison */
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'unchanged' | 'conflict' | 'renamed';

/** Represents a file's sync state */
export interface FileSyncState {
    path: string;
    localHash: string | null;
    remoteHash: string | null;
    remoteSha: string | null;
    status: FileChangeStatus;
    localModified: number | null;
    remoteModified: string | null;
}

/** Local file index entry */
export interface LocalFileEntry {
    path: string;
    hash: string;
    gitSha: string;  // Git blob SHA for comparison with GitHub
    modified: number;
    size: number;
    isBinary: boolean;
}

/** Remote file index entry */
export interface RemoteFileEntry {
    path: string;
    sha: string;
    size?: number;
}

/** Sync result for a single file */
export interface FileSyncResult {
    path: string;
    action: 'pulled' | 'pushed' | 'deleted-local' | 'deleted-remote' | 'conflict' | 'skipped';
    success: boolean;
    error?: string;
}

/** Overall sync result */
export interface SyncResult {
    success: boolean;
    filesProcessed: number;
    filesPulled: number;
    filesPushed: number;
    filesDeleted: number;
    conflicts: string[];
    errors: string[];
    commitSha?: string;
}

/** Persisted sync state */
export interface PersistedSyncState {
    lastSyncTime: number;
    lastCommitSha: string;
    fileHashes: Record<string, string>;  // path -> hash at last sync
    fileShas: Record<string, string>;    // path -> GitHub SHA at last sync
}

/** Sync options */
export interface SyncOptions {
    dryRun?: boolean;
    direction?: 'pull' | 'push' | 'sync';
    paths?: string[];  // Optional: only sync specific paths
}

/**
 * Sync Service - handles synchronization between local vault and GitHub
 */
export class SyncService {
    private app: App;
    private vault: Vault;
    private githubService: GitHubService;
    private ignorePatterns: string[];
    private subfolderPath: string;

    constructor(
        app: App,
        githubService: GitHubService,
        ignorePatterns: string[] = [],
        subfolderPath: string = ''
    ) {
        this.app = app;
        this.vault = app.vault;
        this.githubService = githubService;
        this.ignorePatterns = ignorePatterns;
        this.subfolderPath = subfolderPath;
    }

    /**
     * Update configuration
     */
    configure(ignorePatterns: string[], subfolderPath: string): void {
        this.ignorePatterns = ignorePatterns;
        this.subfolderPath = subfolderPath;
    }

    // ========================================================================
    // Local File Index
    // ========================================================================

    /**
     * Build index of all local files in the vault
     */
    async buildLocalIndex(): Promise<Map<string, LocalFileEntry>> {
        const index = new Map<string, LocalFileEntry>();
        const files = this.vault.getFiles();

        for (const file of files) {
            // Skip ignored files
            if (this.shouldIgnore(file.path)) {
                continue;
            }

            const isBin = isBinaryFile(file.path);
            let hash: string;
            let gitSha: string;

            if (isBin) {
                const content = await this.vault.readBinary(file);
                hash = hashContent(Array.from(new Uint8Array(content)).join(','));
                gitSha = await computeGitBlobShaBinary(content);
            } else {
                const content = await this.vault.read(file);
                hash = hashContent(content);
                gitSha = await computeGitBlobSha(content);
            }

            index.set(file.path, {
                path: file.path,
                hash,
                gitSha,
                modified: file.stat.mtime,
                size: file.stat.size,
                isBinary: isBin,
            });
        }

        return index;
    }

    /**
     * Check if a path should be ignored
     */
    private shouldIgnore(path: string): boolean {
        return matchesIgnorePattern(path, this.ignorePatterns);
    }

    /**
     * Convert local path to remote path (with subfolder prefix)
     */
    private toRemotePath(localPath: string): string {
        if (this.subfolderPath) {
            return normalizePath(`${this.subfolderPath}/${localPath}`);
        }
        return localPath;
    }

    /**
     * Convert remote path to local path (strip subfolder prefix)
     */
    private toLocalPath(remotePath: string): string {
        if (this.subfolderPath && remotePath.startsWith(this.subfolderPath + '/')) {
            return remotePath.slice(this.subfolderPath.length + 1);
        }
        return remotePath;
    }

    // ========================================================================
    // Remote File Index
    // ========================================================================

    /**
     * Build index of files on GitHub
     */
    async buildRemoteIndex(
        owner: string,
        repo: string,
        branch: string
    ): Promise<Map<string, RemoteFileEntry>> {
        const index = new Map<string, RemoteFileEntry>();

        try {
            const tree = await this.githubService.getTree(owner, repo, branch);
            console.log(`[Sync] buildRemoteIndex: got ${tree.length} entries from GitHub tree`);

            for (const entry of tree) {
                // Only include blobs (files), not trees (directories)
                if (entry.type !== 'blob') continue;

                // Apply subfolder filter if configured
                // Note: '/' or empty string means root (no filtering)
                let localPath = entry.path;
                const hasSubfolder = this.subfolderPath && this.subfolderPath !== '/' && this.subfolderPath !== '';
                if (hasSubfolder) {
                    if (!entry.path.startsWith(this.subfolderPath + '/')) {
                        console.log(`[Sync] Skipping ${entry.path}: not in subfolder '${this.subfolderPath}'`);
                        continue; // Skip files outside our subfolder
                    }
                    localPath = this.toLocalPath(entry.path);
                }

                // Skip ignored files
                if (this.shouldIgnore(localPath)) {
                    console.log(`[Sync] Skipping ${localPath}: matches ignore pattern`);
                    continue;
                }

                console.log(`[Sync] Including: ${entry.path} -> ${localPath}`);
                index.set(localPath, {
                    path: entry.path,
                    sha: entry.sha,
                    size: entry.size,
                });
            }
            console.log(`[Sync] buildRemoteIndex: indexed ${index.size} files (after filtering)`);
        } catch (error) {
            console.error('[Sync] Failed to build remote index:', error);
            throw error;
        }

        return index;
    }

    // ========================================================================
    // Comparison & Diff
    // ========================================================================

    /**
     * Compare local and remote indexes to determine sync actions needed
     */
    async compareIndexes(
        localIndex: Map<string, LocalFileEntry>,
        remoteIndex: Map<string, RemoteFileEntry>,
        lastSyncState?: PersistedSyncState
    ): Promise<FileSyncState[]> {
        const results: FileSyncState[] = [];
        const allPaths = new Set([...localIndex.keys(), ...remoteIndex.keys()]);

        console.log(`[Sync] compareIndexes: localFiles=${localIndex.size}, remoteFiles=${remoteIndex.size}, hasLastSyncState=${!!lastSyncState}`);
        if (lastSyncState) {
            console.log(`[Sync] lastSyncState: fileHashes=${Object.keys(lastSyncState.fileHashes || {}).length}, fileShas=${Object.keys(lastSyncState.fileShas || {}).length}`);
        }

        for (const path of allPaths) {
            const local = localIndex.get(path);
            const remote = remoteIndex.get(path);
            const lastHash = lastSyncState?.fileHashes[path];
            const lastSha = lastSyncState?.fileShas[path];

            let status: FileChangeStatus;

            if (local && remote) {
                // File exists both locally and remotely
                // Compare git blob SHAs directly - if they match, content is identical
                if (local.gitSha === remote.sha) {
                    status = 'unchanged';
                    console.log(`[Sync] ${path}: UNCHANGED (SHA match)`);
                } else {
                    // Content differs - check if it's a conflict or one-sided change
                    const localChanged = lastHash ? local.hash !== lastHash : true;
                    const remoteChanged = lastSha ? remote.sha !== lastSha : true;

                    // Debug: log SHA mismatch
                    console.log(`[Sync] ${path}: SHA mismatch`, {
                        localGitSha: local.gitSha,
                        remoteSha: remote.sha,
                        lastHash,
                        lastSha,
                        localChanged,
                        remoteChanged
                    });

                    if (localChanged && remoteChanged) {
                        status = 'conflict';
                    } else if (localChanged) {
                        status = 'modified'; // Local is newer
                    } else if (remoteChanged) {
                        status = 'modified'; // Remote is newer (will be handled by direction)
                    } else {
                        status = 'unchanged';
                    }
                }
            } else if (local && !remote) {
                // File only exists locally
                console.log(`[Sync] ${path}: LOCAL ONLY (lastSha=${lastSha})`);
                if (lastSha) {
                    status = 'deleted'; // Was on remote, now deleted there
                } else {
                    status = 'added'; // New local file
                }
            } else if (!local && remote) {
                // File only exists remotely
                console.log(`[Sync] ${path}: REMOTE ONLY (lastHash=${lastHash})`);
                if (lastHash) {
                    status = 'deleted'; // Was local, now deleted locally
                } else {
                    status = 'added'; // New remote file
                }
            } else {
                continue; // Shouldn't happen
            }

            // Skip unchanged files
            if (status === 'unchanged') {
                continue;
            }

            results.push({
                path,
                localHash: local?.hash || null,
                remoteHash: remote?.sha || null,
                remoteSha: remote?.sha || null,
                status,
                localModified: local?.modified || null,
                remoteModified: null, // Would need additional API call
            });
        }

        return results;
    }

    // ========================================================================
    // Pull Operations
    // ========================================================================

    /**
     * Ensure all parent folders exist for a file path
     */
    private async ensureParentFolders(filePath: string): Promise<void> {
        const parts = filePath.split('/');
        parts.pop(); // Remove filename

        let currentPath = '';
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const folder = this.vault.getAbstractFileByPath(currentPath);
            if (!folder) {
                try {
                    await this.vault.createFolder(currentPath);
                } catch (error) {
                    // Folder might have been created by another operation
                    if (!(error instanceof Error && error.message.includes('already exists'))) {
                        throw error;
                    }
                }
            }
        }
    }

    /**
     * Pull a single file from GitHub to local vault
     */
    async pullFile(
        owner: string,
        repo: string,
        remotePath: string,
        localPath: string
    ): Promise<FileSyncResult> {
        try {
            console.log(`[Sync] Pulling file: ${remotePath} -> ${localPath}`);
            const content = await this.githubService.getFileContent(owner, repo, remotePath);
            const isBin = isBinaryFile(localPath);

            if (isBin) {
                // Need to ensure parent folders exist for binary files too
                await this.ensureParentFolders(localPath);
                const binaryData = decodeBase64Binary(content.content);
                await this.vault.adapter.writeBinary(localPath, binaryData);
            } else {
                const textContent = decodeBase64(content.content);
                const existingFile = this.vault.getAbstractFileByPath(localPath);
                if (existingFile instanceof TFile) {
                    await this.vault.modify(existingFile, textContent);
                } else {
                    // Check if file exists at adapter level (e.g., .obsidian files)
                    const fileExists = await this.vault.adapter.exists(localPath);
                    if (fileExists) {
                        // Use adapter to write directly
                        await this.vault.adapter.write(localPath, textContent);
                    } else {
                        // Need to create parent folders if they don't exist
                        await this.ensureParentFolders(localPath);
                        await this.vault.create(localPath, textContent);
                    }
                }
            }

            console.log(`[Sync] Successfully pulled: ${localPath}`);
            return { path: localPath, action: 'pulled', success: true };
        } catch (error) {
            console.error(`[Sync] Failed to pull ${localPath}:`, error);
            return {
                path: localPath,
                action: 'pulled',
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Pull all changed files from GitHub
     */
    async pullChanges(
        owner: string,
        repo: string,
        branch: string,
        changes: FileSyncState[],
        remoteIndex: Map<string, RemoteFileEntry>
    ): Promise<FileSyncResult[]> {
        const results: FileSyncResult[] = [];

        for (const change of changes) {
            if (change.status === 'unchanged' || change.status === 'conflict') {
                continue;
            }

            const remote = remoteIndex.get(change.path);

            if (remote) {
                // File exists on remote - pull it
                const result = await this.pullFile(
                    owner,
                    repo,
                    remote.path,
                    change.path
                );
                results.push(result);
            } else if (change.status === 'deleted') {
                // File was deleted on remote - delete locally
                try {
                    const file = this.vault.getAbstractFileByPath(change.path);
                    if (file) {
                        await this.vault.delete(file);
                    }
                    results.push({ path: change.path, action: 'deleted-local', success: true });
                } catch (error) {
                    results.push({
                        path: change.path,
                        action: 'deleted-local',
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        return results;
    }

    // ========================================================================
    // Push Operations
    // ========================================================================

    /**
     * Push all changed files to GitHub using batch commit
     */
    async pushChanges(
        owner: string,
        repo: string,
        branch: string,
        changes: FileSyncState[],
        localIndex: Map<string, LocalFileEntry>,
        remoteIndex: Map<string, RemoteFileEntry>,
        commitMessage: string
    ): Promise<SyncResult> {
        const batchChanges: BatchFileChange[] = [];
        const errors: string[] = [];

        for (const change of changes) {
            if (change.status === 'unchanged' || change.status === 'conflict') {
                continue;
            }

            const local = localIndex.get(change.path);
            const remotePath = this.toRemotePath(change.path);

            if (local) {
                // File exists locally - push it
                try {
                    const file = this.vault.getAbstractFileByPath(change.path);
                    if (!(file instanceof TFile)) continue;

                    let content: string;
                    if (local.isBinary) {
                        const binaryData = await this.vault.readBinary(file);
                        content = encodeBase64Binary(binaryData);
                    } else {
                        const textContent = await this.vault.read(file);
                        content = encodeBase64(textContent);
                    }

                    batchChanges.push({
                        path: remotePath,
                        action: change.status === 'added' ? 'create' : 'update',
                        content,
                        encoding: 'base64',
                    });
                } catch (error) {
                    errors.push(`Failed to read ${change.path}: ${error}`);
                }
            } else if (change.status === 'deleted') {
                // File was deleted locally - delete on remote
                batchChanges.push({
                    path: remotePath,
                    action: 'delete',
                });
            }
        }

        if (batchChanges.length === 0) {
            return {
                success: true,
                filesProcessed: 0,
                filesPulled: 0,
                filesPushed: 0,
                filesDeleted: 0,
                conflicts: [],
                errors,
            };
        }

        try {
            const result = await this.githubService.createBatchCommit(
                owner,
                repo,
                branch,
                commitMessage,
                batchChanges
            );

            const pushed = batchChanges.filter(c => c.action !== 'delete').length;
            const deleted = batchChanges.filter(c => c.action === 'delete').length;

            return {
                success: true,
                filesProcessed: batchChanges.length,
                filesPulled: 0,
                filesPushed: pushed,
                filesDeleted: deleted,
                conflicts: [],
                errors,
                commitSha: result.commitSha,
            };
        } catch (error) {
            return {
                success: false,
                filesProcessed: 0,
                filesPulled: 0,
                filesPushed: 0,
                filesDeleted: 0,
                conflicts: [],
                errors: [...errors, `Batch commit failed: ${error}`],
            };
        }
    }

    // ========================================================================
    // Full Sync Operation
    // ========================================================================

    /**
     * Perform a full sync operation
     */
    async sync(
        owner: string,
        repo: string,
        branch: string,
        commitMessage: string,
        lastSyncState?: PersistedSyncState,
        options: SyncOptions = {}
    ): Promise<{ result: SyncResult; newState: PersistedSyncState }> {
        const direction = options.direction || 'sync';

        // Build indexes
        const localIndex = await this.buildLocalIndex();
        const remoteIndex = await this.buildRemoteIndex(owner, repo, branch);

        // Compare
        let changes = await this.compareIndexes(localIndex, remoteIndex, lastSyncState);

        // Filter to specific paths if requested
        if (options.paths && options.paths.length > 0) {
            changes = changes.filter(c => options.paths!.includes(c.path));
        }

        // Separate by what needs to happen
        // Note: unchanged files are already filtered out in compareIndexes
        const conflicts = changes.filter(c => c.status === 'conflict');
        const toPull = changes.filter(c => {
            if (c.status === 'conflict') return false;
            if (direction === 'push') return false;
            // Pull: remote-only files (added on remote), or files where remote has changes
            const remote = remoteIndex.get(c.path);
            const local = localIndex.get(c.path);
            if (!remote && local) return false; // Local-only file, should push not pull
            if (remote && !local) return true;  // Remote-only file (new from remote)
            // Both exist and content differs - check who changed
            const lastSha = lastSyncState?.fileShas[c.path];
            const lastHash = lastSyncState?.fileHashes[c.path];
            const remoteChanged = !lastSha || (remote && remote.sha !== lastSha);
            const localChanged = !lastHash || (local && local.hash !== lastHash);
            // Pull if only remote changed, or if no sync state and we prefer remote
            return remoteChanged && !localChanged;
        });
        const toPush = changes.filter(c => {
            if (c.status === 'conflict') return false;
            if (direction === 'pull') return false;
            // Push: local-only files (added locally), or files where local has changes
            const remote = remoteIndex.get(c.path);
            const local = localIndex.get(c.path);
            if (!local && remote) return false; // Remote-only file, should pull not push
            if (local && !remote) return true;  // Local-only file (new locally)
            // Both exist and content differs - check who changed
            const lastSha = lastSyncState?.fileShas[c.path];
            const lastHash = lastSyncState?.fileHashes[c.path];
            const remoteChanged = !lastSha || (remote && remote.sha !== lastSha);
            const localChanged = !lastHash || (local && local.hash !== lastHash);
            // Push if only local changed
            return localChanged && !remoteChanged;
        });

        let result: SyncResult = {
            success: true,
            filesProcessed: 0,
            filesPulled: 0,
            filesPushed: 0,
            filesDeleted: 0,
            conflicts: conflicts.map(c => c.path),
            errors: [],
        };

        // Execute pull
        if (toPull.length > 0 && direction !== 'push') {
            const pullResults = await this.pullChanges(owner, repo, branch, toPull, remoteIndex);
            result.filesPulled = pullResults.filter(r => r.success && r.action === 'pulled').length;
            result.filesDeleted += pullResults.filter(r => r.success && r.action === 'deleted-local').length;
            result.errors.push(...pullResults.filter(r => !r.success).map(r => r.error || 'Unknown error'));
        }

        // Execute push
        if (toPush.length > 0 && direction !== 'pull') {
            const pushResult = await this.pushChanges(
                owner, repo, branch, toPush, localIndex, remoteIndex, commitMessage
            );
            result.filesPushed = pushResult.filesPushed;
            result.filesDeleted += pushResult.filesDeleted;
            result.errors.push(...pushResult.errors);
            result.commitSha = pushResult.commitSha;
            if (!pushResult.success) result.success = false;
        }

        result.filesProcessed = result.filesPulled + result.filesPushed + result.filesDeleted;

        // Build new sync state
        const newLocalIndex = await this.buildLocalIndex();
        const newRemoteIndex = await this.buildRemoteIndex(owner, repo, branch);

        const newState: PersistedSyncState = {
            lastSyncTime: Date.now(),
            lastCommitSha: result.commitSha || lastSyncState?.lastCommitSha || '',
            fileHashes: {},
            fileShas: {},
        };

        for (const [path, entry] of newLocalIndex) {
            newState.fileHashes[path] = entry.hash;
        }
        for (const [path, entry] of newRemoteIndex) {
            newState.fileShas[path] = entry.sha;
        }

        return { result, newState };
    }
}
