import { FileSyncState, LocalFileEntry, RemoteFileEntry, PersistedSyncState } from '../../src/services/syncService';
import { matchesIgnorePattern } from '../../src/utils/fileUtils';

/**
 * Tests for sync service deletion behavior
 *
 * These tests verify that file deletions are properly detected and synced:
 * - Local deletions should be pushed to remote
 * - Remote deletions should be pulled (deleted locally)
 */

// Helper type for testing filter logic
interface FilterTestCase {
    name: string;
    change: FileSyncState;
    localIndex: Map<string, LocalFileEntry>;
    remoteIndex: Map<string, RemoteFileEntry>;
    lastSyncState: PersistedSyncState | undefined;
    direction: 'push' | 'pull' | 'sync';
    expectedInPush: boolean;
    expectedInPull: boolean;
}

// Recreate the filter logic from syncService for testing
function shouldPush(
    change: FileSyncState,
    localIndex: Map<string, LocalFileEntry>,
    remoteIndex: Map<string, RemoteFileEntry>,
    lastSyncState: PersistedSyncState | undefined,
    direction: 'push' | 'pull' | 'sync'
): boolean {
    if (change.status === 'conflict') return false;
    if (direction === 'pull') return false;

    const remote = remoteIndex.get(change.path);
    const local = localIndex.get(change.path);

    if (!local && remote) {
        // File exists only on remote - push deletion if it was deleted locally
        return change.status === 'deleted';
    }
    if (local && !remote) {
        // File exists only locally - push if it's new, not if it's a remote deletion
        return change.status !== 'deleted';
    }

    // Both exist and content differs - check who changed
    const lastSha = lastSyncState?.fileShas[change.path];
    const lastHash = lastSyncState?.fileHashes[change.path];
    const remoteChanged = !lastSha || (remote && remote.sha !== lastSha);
    const localChanged = !lastHash || (local && local.hash !== lastHash);

    return localChanged && !remoteChanged;
}

function shouldPull(
    change: FileSyncState,
    localIndex: Map<string, LocalFileEntry>,
    remoteIndex: Map<string, RemoteFileEntry>,
    lastSyncState: PersistedSyncState | undefined,
    direction: 'push' | 'pull' | 'sync'
): boolean {
    if (change.status === 'conflict') return false;
    if (direction === 'push') return false;

    const remote = remoteIndex.get(change.path);
    const local = localIndex.get(change.path);

    if (!remote && local) {
        // File exists only locally - check if it was deleted on remote
        return change.status === 'deleted';
    }
    if (remote && !local) {
        // File exists only on remote - pull if it's new (added), not if it's a local deletion
        return change.status !== 'deleted';
    }

    // Both exist and content differs - check who changed
    const lastSha = lastSyncState?.fileShas[change.path];
    const lastHash = lastSyncState?.fileHashes[change.path];
    const remoteChanged = !lastSha || (remote && remote.sha !== lastSha);
    const localChanged = !lastHash || (local && local.hash !== lastHash);

    return remoteChanged && !localChanged;
}

describe('SyncService - Deletion Sync Logic', () => {
    describe('Local file deletion (push to remote)', () => {
        it('should include locally deleted file in push when file was previously synced', () => {
            const change: FileSyncState = {
                path: 'deleted-file.md',
                localHash: null,
                remoteHash: 'abc123',
                remoteSha: 'sha123',
                status: 'deleted',
                localModified: null,
                remoteModified: '2024-01-01T00:00:00Z',
            };
            
            const localIndex = new Map<string, LocalFileEntry>();
            // File NOT in local index (deleted)
            
            const remoteIndex = new Map<string, RemoteFileEntry>();
            remoteIndex.set('deleted-file.md', { path: 'deleted-file.md', sha: 'sha123' });
            
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: { 'deleted-file.md': 'hash123' }, // Was synced before
                fileShas: { 'deleted-file.md': 'sha123' },
            };
            
            expect(shouldPush(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(true);
            expect(shouldPush(change, localIndex, remoteIndex, lastSyncState, 'push')).toBe(true);
            expect(shouldPull(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(false);
        });

        it('should not include remote-only new file in push', () => {
            const change: FileSyncState = {
                path: 'new-remote-file.md',
                localHash: null,
                remoteHash: 'abc123',
                remoteSha: 'sha123',
                status: 'added',
                localModified: null,
                remoteModified: '2024-01-01T00:00:00Z',
            };
            
            const localIndex = new Map<string, LocalFileEntry>();
            const remoteIndex = new Map<string, RemoteFileEntry>();
            remoteIndex.set('new-remote-file.md', { path: 'new-remote-file.md', sha: 'sha123' });
            
            // No previous sync state for this file
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: {},
                fileShas: {},
            };
            
            expect(shouldPush(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(false);
            expect(shouldPull(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(true);
        });
    });

    describe('Remote file deletion (pull to local)', () => {
        it('should include remotely deleted file in pull when file was previously synced', () => {
            const change: FileSyncState = {
                path: 'deleted-remote.md',
                localHash: 'hash123',
                remoteHash: null,
                remoteSha: null,
                status: 'deleted',
                localModified: Date.now(),
                remoteModified: null,
            };

            const localIndex = new Map<string, LocalFileEntry>();
            localIndex.set('deleted-remote.md', {
                path: 'deleted-remote.md',
                hash: 'hash123',
                gitSha: 'gitsha123',
                modified: Date.now(),
                size: 100,
                isBinary: false,
            });

            const remoteIndex = new Map<string, RemoteFileEntry>();
            // File NOT in remote index (deleted on remote)

            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: { 'deleted-remote.md': 'hash123' },
                fileShas: { 'deleted-remote.md': 'sha123' }, // Was synced before
            };

            expect(shouldPull(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(true);
            expect(shouldPull(change, localIndex, remoteIndex, lastSyncState, 'pull')).toBe(true);
            expect(shouldPush(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(false);
        });

        it('should not include local-only new file in pull', () => {
            const change: FileSyncState = {
                path: 'new-local-file.md',
                localHash: 'hash123',
                remoteHash: null,
                remoteSha: null,
                status: 'added',
                localModified: Date.now(),
                remoteModified: null,
            };

            const localIndex = new Map<string, LocalFileEntry>();
            localIndex.set('new-local-file.md', {
                path: 'new-local-file.md',
                hash: 'hash123',
                gitSha: 'gitsha123',
                modified: Date.now(),
                size: 100,
                isBinary: false,
            });

            const remoteIndex = new Map<string, RemoteFileEntry>();

            // No previous sync state for this file
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: {},
                fileShas: {},
            };

            expect(shouldPull(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(false);
            expect(shouldPush(change, localIndex, remoteIndex, lastSyncState, 'sync')).toBe(true);
        });
    });

    describe('Direction filtering', () => {
        it('should not push when direction is pull-only', () => {
            const change: FileSyncState = {
                path: 'local-file.md',
                localHash: 'hash123',
                remoteHash: null,
                remoteSha: null,
                status: 'added',
                localModified: Date.now(),
                remoteModified: null,
            };

            const localIndex = new Map<string, LocalFileEntry>();
            localIndex.set('local-file.md', {
                path: 'local-file.md',
                hash: 'hash123',
                gitSha: 'gitsha123',
                modified: Date.now(),
                size: 100,
                isBinary: false,
            });

            const remoteIndex = new Map<string, RemoteFileEntry>();

            expect(shouldPush(change, localIndex, remoteIndex, undefined, 'pull')).toBe(false);
        });

        it('should not pull when direction is push-only', () => {
            const change: FileSyncState = {
                path: 'remote-file.md',
                localHash: null,
                remoteHash: 'hash123',
                remoteSha: 'sha123',
                status: 'added',
                localModified: null,
                remoteModified: '2024-01-01T00:00:00Z',
            };

            const localIndex = new Map<string, LocalFileEntry>();

            const remoteIndex = new Map<string, RemoteFileEntry>();
            remoteIndex.set('remote-file.md', { path: 'remote-file.md', sha: 'sha123' });

            expect(shouldPull(change, localIndex, remoteIndex, undefined, 'push')).toBe(false);
        });
    });

    describe('Conflict handling', () => {
        it('should not push or pull conflicting files', () => {
            const change: FileSyncState = {
                path: 'conflict-file.md',
                localHash: 'local-hash',
                remoteHash: 'remote-hash',
                remoteSha: 'sha123',
                status: 'conflict',
                localModified: Date.now(),
                remoteModified: '2024-01-01T00:00:00Z',
            };

            const localIndex = new Map<string, LocalFileEntry>();
            localIndex.set('conflict-file.md', {
                path: 'conflict-file.md',
                hash: 'local-hash',
                gitSha: 'local-gitsha',
                modified: Date.now(),
                size: 100,
                isBinary: false,
            });

            const remoteIndex = new Map<string, RemoteFileEntry>();
            remoteIndex.set('conflict-file.md', { path: 'conflict-file.md', sha: 'sha123' });

            expect(shouldPush(change, localIndex, remoteIndex, undefined, 'sync')).toBe(false);
            expect(shouldPull(change, localIndex, remoteIndex, undefined, 'sync')).toBe(false);
        });
    });
});

describe('SyncService - Effective Ignore Patterns', () => {
    /**
     * Simulates getEffectiveIgnorePatterns logic for testing
     */
    function getEffectiveIgnorePatterns(
        basePatterns: string[],
        configDir: string,
        syncConfiguration: boolean
    ): string[] {
        const patterns = [...basePatterns];

        // Always exclude the sync metadata file
        const metadataPattern = `${configDir}/github-sync-metadata.json`;
        if (!patterns.includes(metadataPattern)) {
            patterns.push(metadataPattern);
        }

        // Always exclude the plugins folder
        const pluginsPattern = `${configDir}/plugins/**`;
        if (!patterns.includes(pluginsPattern)) {
            patterns.push(pluginsPattern);
        }

        // Add entire config folder if not syncing configuration
        if (!syncConfiguration) {
            const configPattern = `${configDir}/**`;
            if (!patterns.includes(configPattern)) {
                patterns.push(configPattern);
            }
        }

        return patterns;
    }

    describe('When syncConfiguration is disabled (default)', () => {
        it('should exclude entire config folder', () => {
            const patterns = getEffectiveIgnorePatterns([], '.obsidian', false);
            expect(matchesIgnorePattern('.obsidian/config.json', patterns)).toBe(true);
            expect(matchesIgnorePattern('.obsidian/themes/custom.css', patterns)).toBe(true);
            expect(matchesIgnorePattern('.obsidian/snippets/my.css', patterns)).toBe(true);
        });

        it('should not exclude vault content files', () => {
            const patterns = getEffectiveIgnorePatterns([], '.obsidian', false);
            expect(matchesIgnorePattern('notes/my-note.md', patterns)).toBe(false);
            expect(matchesIgnorePattern('attachments/image.png', patterns)).toBe(false);
        });
    });

    describe('When syncConfiguration is enabled', () => {
        it('should allow config files to be synced', () => {
            const patterns = getEffectiveIgnorePatterns([], '.obsidian', true);
            expect(matchesIgnorePattern('.obsidian/app.json', patterns)).toBe(false);
            expect(matchesIgnorePattern('.obsidian/appearance.json', patterns)).toBe(false);
            expect(matchesIgnorePattern('.obsidian/hotkeys.json', patterns)).toBe(false);
        });

        it('should always exclude plugins folder', () => {
            const patterns = getEffectiveIgnorePatterns([], '.obsidian', true);
            expect(matchesIgnorePattern('.obsidian/plugins/my-plugin/main.js', patterns)).toBe(true);
            expect(matchesIgnorePattern('.obsidian/plugins/my-plugin/manifest.json', patterns)).toBe(true);
        });

        it('should always exclude sync metadata file', () => {
            const patterns = getEffectiveIgnorePatterns([], '.obsidian', true);
            expect(matchesIgnorePattern('.obsidian/github-sync-metadata.json', patterns)).toBe(true);
        });

        it('should still respect user-defined ignore patterns', () => {
            const userPatterns = ['.obsidian/workspace.json', '*.tmp'];
            const patterns = getEffectiveIgnorePatterns(userPatterns, '.obsidian', true);
            expect(matchesIgnorePattern('.obsidian/workspace.json', patterns)).toBe(true);
            expect(matchesIgnorePattern('temp.tmp', patterns)).toBe(true);
        });
    });

    describe('Pattern deduplication', () => {
        it('should not add duplicate patterns', () => {
            const basePatterns = [
                '.obsidian/github-sync-metadata.json',
                '.obsidian/plugins/**',
            ];
            const patterns = getEffectiveIgnorePatterns(basePatterns, '.obsidian', true);

            const metadataCount = patterns.filter(p => p === '.obsidian/github-sync-metadata.json').length;
            const pluginsCount = patterns.filter(p => p === '.obsidian/plugins/**').length;

            expect(metadataCount).toBe(1);
            expect(pluginsCount).toBe(1);
        });
    });
});

describe('SyncService - Path Conversion', () => {
    /**
     * Simulates toRemotePath logic
     */
    function toRemotePath(localPath: string, subfolderPath: string): string {
        if (subfolderPath) {
            return `${subfolderPath}/${localPath}`.replace(/\/+/g, '/');
        }
        return localPath;
    }

    /**
     * Simulates toLocalPath logic
     */
    function toLocalPath(remotePath: string, subfolderPath: string): string {
        if (subfolderPath && remotePath.startsWith(subfolderPath + '/')) {
            return remotePath.slice(subfolderPath.length + 1);
        }
        return remotePath;
    }

    describe('toRemotePath', () => {
        it('should add subfolder prefix when configured', () => {
            expect(toRemotePath('note.md', 'vault')).toBe('vault/note.md');
            expect(toRemotePath('folder/note.md', 'my-vault')).toBe('my-vault/folder/note.md');
        });

        it('should return path unchanged when no subfolder', () => {
            expect(toRemotePath('note.md', '')).toBe('note.md');
            expect(toRemotePath('folder/note.md', '')).toBe('folder/note.md');
        });

        it('should handle nested subfolders', () => {
            expect(toRemotePath('note.md', 'path/to/vault')).toBe('path/to/vault/note.md');
        });
    });

    describe('toLocalPath', () => {
        it('should strip subfolder prefix when configured', () => {
            expect(toLocalPath('vault/note.md', 'vault')).toBe('note.md');
            expect(toLocalPath('my-vault/folder/note.md', 'my-vault')).toBe('folder/note.md');
        });

        it('should return path unchanged when no subfolder', () => {
            expect(toLocalPath('note.md', '')).toBe('note.md');
            expect(toLocalPath('folder/note.md', '')).toBe('folder/note.md');
        });

        it('should return path unchanged when it does not match subfolder', () => {
            expect(toLocalPath('other/note.md', 'vault')).toBe('other/note.md');
        });

        it('should handle nested subfolders', () => {
            expect(toLocalPath('path/to/vault/note.md', 'path/to/vault')).toBe('note.md');
        });
    });

    describe('Round-trip conversion', () => {
        it('should preserve path through round-trip', () => {
            const original = 'folder/subfolder/note.md';
            const subfolder = 'my-vault';

            const remote = toRemotePath(original, subfolder);
            const local = toLocalPath(remote, subfolder);

            expect(local).toBe(original);
        });
    });
});

describe('SyncService - Modified File Detection', () => {
    describe('File modification scenarios', () => {
        it('should detect when only local has changed', () => {
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: { 'file.md': 'old-hash' },
                fileShas: { 'file.md': 'sha123' },
            };

            const localHash = 'new-hash'; // Changed
            const remoteSha = 'sha123'; // Same as lastSyncState

            const localChanged = localHash !== lastSyncState.fileHashes['file.md'];
            const remoteChanged = remoteSha !== lastSyncState.fileShas['file.md'];

            expect(localChanged).toBe(true);
            expect(remoteChanged).toBe(false);
        });

        it('should detect when only remote has changed', () => {
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: { 'file.md': 'hash123' },
                fileShas: { 'file.md': 'old-sha' },
            };

            const localHash = 'hash123'; // Same as lastSyncState
            const remoteSha = 'new-sha'; // Changed

            const localChanged = localHash !== lastSyncState.fileHashes['file.md'];
            const remoteChanged = remoteSha !== lastSyncState.fileShas['file.md'];

            expect(localChanged).toBe(false);
            expect(remoteChanged).toBe(true);
        });

        it('should detect conflict when both have changed', () => {
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: { 'file.md': 'old-hash' },
                fileShas: { 'file.md': 'old-sha' },
            };

            const localHash = 'new-hash'; // Changed
            const remoteSha = 'new-sha'; // Changed

            const localChanged = localHash !== lastSyncState.fileHashes['file.md'];
            const remoteChanged = remoteSha !== lastSyncState.fileShas['file.md'];

            expect(localChanged).toBe(true);
            expect(remoteChanged).toBe(true);
            // This would be a conflict
        });

        it('should detect no changes when both match last sync', () => {
            const lastSyncState: PersistedSyncState = {
                lastSyncTime: Date.now() - 10000,
                lastCommitSha: 'commit123',
                fileHashes: { 'file.md': 'hash123' },
                fileShas: { 'file.md': 'sha123' },
            };

            const localHash = 'hash123'; // Same
            const remoteSha = 'sha123'; // Same

            const localChanged = localHash !== lastSyncState.fileHashes['file.md'];
            const remoteChanged = remoteSha !== lastSyncState.fileShas['file.md'];

            expect(localChanged).toBe(false);
            expect(remoteChanged).toBe(false);
        });
    });
});
