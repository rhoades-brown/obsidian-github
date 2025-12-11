import { LoggerConfig } from '../services/loggerService';

// ============================================================================
// Type Definitions
// ============================================================================

/** File change status */
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'unchanged' | 'conflict';

/** Sync operation type */
export type SyncOperation = 'pull' | 'push' | 'sync';

/** Conflict resolution strategy */
export type ConflictResolution = 'keep-local' | 'keep-remote' | 'keep-both' | 'manual';

/** Current sync state */
export type SyncState = 'idle' | 'syncing' | 'error' | 'conflict';

// ============================================================================
// Interfaces
// ============================================================================

/** Repository information */
export interface RepoInfo {
	owner: string;
	name: string;
	branch: string;
	defaultBranch: string;
	isPrivate: boolean;
	url: string;
}

/** GitHub authentication configuration */
export interface AuthConfig {
	token: string;
	tokenValidated: boolean;
	username: string;
}

/** Sync schedule configuration - individual toggles for each trigger */
export interface SyncScheduleConfig {
	syncOnSave: boolean;
	syncOnInterval: boolean;
	syncOnStartup: boolean;
	intervalMinutes: number;
}

/** Commit message template configuration */
export interface CommitConfig {
	messageTemplate: string;
	includeTimestamp: boolean;
	includeFileCount: boolean;
}

/** Main plugin settings */
export interface GitHubOctokitSettings {
	// Authentication
	auth: AuthConfig;

	// Repository
	repo: RepoInfo | null;
	subfolderPath: string;

	// Sync configuration
	syncSchedule: SyncScheduleConfig;
	commitConfig: CommitConfig;
	syncConfiguration: boolean; // Whether to sync .obsidian config folder

	// Conflict handling
	defaultConflictResolution: ConflictResolution;

	// Ignore patterns
	ignorePatterns: string[];

	// UI preferences
	showStatusBar: boolean;
	showNotifications: boolean;

	// Logging
	logging: LoggerConfig;
}

/** Represents a file's state for sync comparison */
export interface FileState {
	path: string;
	localHash: string | null;
	remoteHash: string | null;
	remoteSha: string | null;
	localModified: number | null;
	remoteModified: number | null;
	status: FileChangeStatus;
	size: number;
	isBinary: boolean;
}

/** Information about a sync conflict */
export interface ConflictInfo {
	path: string;
	localContent: string;
	remoteContent: string;
	baseContent: string | null;
	localModified: number;
	remoteModified: number;
	resolution: ConflictResolution | null;
}

/** Current sync status */
export interface SyncStatus {
	state: SyncState;
	lastSyncTime: number | null;
	lastSyncCommitSha: string | null;
	pendingChanges: {
		toPush: number;
		toPull: number;
		conflicts: number;
	};
	currentOperation: SyncOperation | null;
	progress: {
		current: number;
		total: number;
		currentFile: string | null;
	} | null;
	error: string | null;
}

/** Stored sync state for persistence */
export interface SyncStateData {
	lastSyncTime: number;
	lastSyncCommitSha: string;
	fileHashes: Record<string, string>;
	fileShas: Record<string, string>;
}

/** Commit information from GitHub */
export interface CommitInfo {
	sha: string;
	message: string;
	author: string;
	timestamp: number;
	filesChanged: number;
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SETTINGS: GitHubOctokitSettings = {
	auth: {
		token: '',
		tokenValidated: false,
		username: '',
	},
	repo: null,
	subfolderPath: '',
	syncSchedule: {
		syncOnSave: false,
		syncOnInterval: false,
		syncOnStartup: false,
		intervalMinutes: 30,
	},
	commitConfig: {
		messageTemplate: 'Vault sync: {date}',
		includeTimestamp: true,
		includeFileCount: true,
	},
	syncConfiguration: false, // Don't sync .obsidian by default
	defaultConflictResolution: 'manual',
	/* eslint-disable obsidianmd/hardcoded-config-path -- default patterns, will be filtered at runtime using configDir */
	ignorePatterns: [
		'.obsidian/workspace.json',
		'.obsidian/workspace-mobile.json',
		'.obsidian/github-sync-metadata.json',
		'.git/**',
		'.gitignore',
	],
	/* eslint-enable obsidianmd/hardcoded-config-path */
	showStatusBar: true,
	showNotifications: true,
	logging: {
		enabled: true,
		level: 'info',
		persistToFile: false,
		logFilePath: '.github-sync.log',
		maxEntries: 1000,
	},
};

