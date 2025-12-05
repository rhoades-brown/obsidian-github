import { App, TFile } from 'obsidian';

/** Log levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Log entry structure */
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    category: string;
    message: string;
    data?: unknown;
}

/** Logger configuration */
export interface LoggerConfig {
    enabled: boolean;
    level: LogLevel;
    persistToFile: boolean;
    logFilePath: string;
    maxEntries: number;
}

/** Default logger configuration */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
    enabled: true,
    level: 'info',
    persistToFile: false,
    logFilePath: '.github-sync.log',
    maxEntries: 1000,
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * Logger service for the GitHub Octokit plugin
 */
export class LoggerService {
    private entries: LogEntry[] = [];
    private config: LoggerConfig;
    private app: App | null = null;
    private listeners: ((entry: LogEntry) => void)[] = [];

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    }

    /**
     * Initialize with Obsidian app for file persistence
     */
    initialize(app: App): void {
        this.app = app;
    }

    /**
     * Update logger configuration
     */
    configure(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): LoggerConfig {
        return { ...this.config };
    }

    /**
     * Check if a log level should be logged
     */
    private shouldLog(level: LogLevel): boolean {
        if (!this.config.enabled) return false;
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
    }

    /**
     * Add a log entry
     */
    private async addEntry(level: LogLevel, category: string, message: string, data?: unknown): Promise<void> {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            category,
            message,
            data,
        };

        this.entries.push(entry);

        // Trim old entries
        if (this.entries.length > this.config.maxEntries) {
            this.entries = this.entries.slice(-this.config.maxEntries);
        }

        // Console output
        const logMessage = `[${entry.timestamp.toISOString()}] [${level.toUpperCase()}] [${category}] ${message}`;
        switch (level) {
            case 'debug':
                console.debug(logMessage, data ?? '');
                break;
            case 'info':
                console.info(logMessage, data ?? '');
                break;
            case 'warn':
                console.warn(logMessage, data ?? '');
                break;
            case 'error':
                console.error(logMessage, data ?? '');
                break;
        }

        // Notify listeners
        this.listeners.forEach(listener => listener(entry));

        // Persist to file if enabled
        if (this.config.persistToFile) {
            await this.persistEntry(entry);
        }
    }

    /**
     * Persist a log entry to file
     */
    private async persistEntry(entry: LogEntry): Promise<void> {
        if (!this.app) return;

        try {
            const line = `${entry.timestamp.toISOString()} [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}${entry.data ? ' ' + JSON.stringify(entry.data) : ''}\n`;

            const file = this.app.vault.getAbstractFileByPath(this.config.logFilePath);
            if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                await this.app.vault.modify(file, content + line);
            } else {
                await this.app.vault.create(this.config.logFilePath, line);
            }
        } catch (error) {
            console.error('Failed to persist log entry:', error);
        }
    }

    // Convenience methods for each log level
    debug(category: string, message: string, data?: unknown): void {
        this.addEntry('debug', category, message, data);
    }

    info(category: string, message: string, data?: unknown): void {
        this.addEntry('info', category, message, data);
    }

    warn(category: string, message: string, data?: unknown): void {
        this.addEntry('warn', category, message, data);
    }

    error(category: string, message: string, data?: unknown): void {
        this.addEntry('error', category, message, data);
    }

    /**
     * Get all log entries
     */
    getEntries(): LogEntry[] {
        return [...this.entries];
    }

    /**
     * Get entries filtered by level
     */
    getEntriesByLevel(level: LogLevel): LogEntry[] {
        return this.entries.filter(e => e.level === level);
    }

    /**
     * Get entries filtered by category
     */
    getEntriesByCategory(category: string): LogEntry[] {
        return this.entries.filter(e => e.category === category);
    }

    /**
     * Get recent entries
     */
    getRecentEntries(count: number = 50): LogEntry[] {
        return this.entries.slice(-count);
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.entries = [];
    }

    /**
     * Add a listener for new log entries
     */
    onEntry(listener: (entry: LogEntry) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Export logs as text
     */
    exportAsText(): string {
        return this.entries
            .map(e => `${e.timestamp.toISOString()} [${e.level.toUpperCase()}] [${e.category}] ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`)
            .join('\n');
    }

    /**
     * Export logs as JSON
     */
    exportAsJson(): string {
        return JSON.stringify(this.entries, null, 2);
    }

    /**
     * Clear the log file
     */
    async clearLogFile(): Promise<void> {
        if (!this.app) return;

        try {
            const file = this.app.vault.getAbstractFileByPath(this.config.logFilePath);
            if (file instanceof TFile) {
                await this.app.vault.modify(file, '');
            }
        } catch (error) {
            console.error('Failed to clear log file:', error);
        }
    }
}

