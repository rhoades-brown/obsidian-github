import { FileSyncState, LocalFileEntry, RemoteFileEntry, PersistedSyncState } from '../../src/services/syncService';

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

