import { App, TFile, TFolder, Vault } from 'obsidian';

// ============================================================================
// File Utilities for GitHub Octokit Plugin
// ============================================================================

/** Binary file extensions that should not be diffed as text */
const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg',
    'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov',
    'pdf', 'zip', 'tar', 'gz', '7z', 'rar',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'exe', 'dll', 'so', 'dylib',
]);

/**
 * Normalize a file path for consistent comparison
 * - Converts backslashes to forward slashes
 * - Removes leading/trailing slashes
 * - Collapses multiple slashes
 */
export function normalizePath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/|\/$/g, '');
}

/**
 * Join path segments with proper normalization
 */
export function joinPath(...segments: string[]): string {
    return normalizePath(segments.filter(s => s).join('/'));
}

/**
 * Get the file extension (lowercase, without dot)
 */
export function getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    
    if (lastDot <= lastSlash + 1) {
        return '';
    }
    
    return path.slice(lastDot + 1).toLowerCase();
}

/**
 * Check if a file is binary based on its extension
 */
export function isBinaryFile(path: string): boolean {
    return BINARY_EXTENSIONS.has(getExtension(path));
}

/**
 * Get the parent directory of a path
 */
export function getParentPath(path: string): string {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.slice(0, lastSlash) : '';
}

/**
 * Get the filename from a path
 */
export function getFilename(path: string): string {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

/**
 * Compute a simple hash of content for comparison
 * Uses a fast non-cryptographic hash (djb2)
 */
export function hashContent(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute hash from ArrayBuffer (for binary files)
 */
export function hashBinaryContent(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hash = 5381;
    for (let i = 0; i < bytes.length; i++) {
        hash = ((hash << 5) + hash) ^ bytes[i];
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute a Git blob SHA for content (compatible with GitHub's SHA)
 * Git blob SHA = SHA-1 of "blob {size}\0{content}"
 * Note: Normalizes line endings to LF to match GitHub's storage
 */
export async function computeGitBlobSha(content: string): Promise<string> {
    // Normalize line endings to LF (GitHub stores files with LF)
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const encoder = new TextEncoder();
    const contentBytes = encoder.encode(normalizedContent);
    const header = `blob ${contentBytes.length}\0`;
    const headerBytes = encoder.encode(header);

    const combined = new Uint8Array(headerBytes.length + contentBytes.length);
    combined.set(headerBytes);
    combined.set(contentBytes, headerBytes.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute a Git blob SHA for binary content
 */
export async function computeGitBlobShaBinary(buffer: ArrayBuffer): Promise<string> {
    const contentBytes = new Uint8Array(buffer);
    const header = `blob ${contentBytes.length}\0`;
    const headerBytes = new TextEncoder().encode(header);

    const combined = new Uint8Array(headerBytes.length + contentBytes.length);
    combined.set(headerBytes);
    combined.set(contentBytes, headerBytes.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read a text file from the vault
 */
export async function readTextFile(vault: Vault, path: string): Promise<string | null> {
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        return await vault.read(file);
    }
    return null;
}

/**
 * Read a binary file from the vault
 */
export async function readBinaryFile(vault: Vault, path: string): Promise<ArrayBuffer | null> {
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        return await vault.readBinary(file);
    }
    return null;
}

/**
 * Write a text file to the vault (creates parent folders if needed)
 */
export async function writeTextFile(vault: Vault, path: string, content: string): Promise<TFile> {
    const normalizedPath = normalizePath(path);
    
    // Ensure parent folders exist
    await ensureParentFolders(vault, normalizedPath);
    
    const existing = vault.getAbstractFileByPath(normalizedPath);
    if (existing instanceof TFile) {
        await vault.modify(existing, content);
        return existing;
    }
    
    return await vault.create(normalizedPath, content);
}

/**
 * Write a binary file to the vault (creates parent folders if needed)
 */
export async function writeBinaryFile(vault: Vault, path: string, content: ArrayBuffer): Promise<TFile> {
    const normalizedPath = normalizePath(path);
    
    // Ensure parent folders exist
    await ensureParentFolders(vault, normalizedPath);
    
    const existing = vault.getAbstractFileByPath(normalizedPath);
    if (existing instanceof TFile) {
        await vault.modifyBinary(existing, content);
        return existing;
    }
    
    return await vault.createBinary(normalizedPath, content);
}

/**
 * Ensure all parent folders exist for a given path
 */
export async function ensureParentFolders(vault: Vault, path: string): Promise<void> {
    const parentPath = getParentPath(path);
    if (!parentPath) return;

    const existing = vault.getAbstractFileByPath(parentPath);
    if (existing instanceof TFolder) return;

    // Create parent folders recursively
    const parts = parentPath.split('/');
    let currentPath = '';

    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const folder = vault.getAbstractFileByPath(currentPath);
        if (!folder) {
            await vault.createFolder(currentPath);
        }
    }
}

/**
 * Delete a file from the vault (using trash to respect user preferences)
 */
export async function deleteFile(app: App, path: string): Promise<boolean> {
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
        await app.fileManager.trashFile(file);
        return true;
    }
    return false;
}

/**
 * Check if a file exists in the vault
 */
export function fileExists(vault: Vault, path: string): boolean {
    return vault.getAbstractFileByPath(path) instanceof TFile;
}

/**
 * Check if a folder exists in the vault
 */
export function folderExists(vault: Vault, path: string): boolean {
    return vault.getAbstractFileByPath(path) instanceof TFolder;
}

/**
 * Get all files in the vault (excluding folders)
 */
export function getAllFiles(vault: Vault): TFile[] {
    return vault.getFiles();
}

/**
 * Get file metadata
 */
export interface FileInfo {
    path: string;
    name: string;
    extension: string;
    size: number;
    modified: number;
    created: number;
    isBinary: boolean;
}

export function getFileInfo(file: TFile): FileInfo {
    return {
        path: file.path,
        name: file.name,
        extension: file.extension,
        size: file.stat.size,
        modified: file.stat.mtime,
        created: file.stat.ctime,
        isBinary: isBinaryFile(file.path),
    };
}

/**
 * Check if a path matches any of the ignore patterns
 * Supports glob-like patterns: * (any chars), ** (any path), ? (single char)
 */
export function matchesIgnorePattern(path: string, patterns: string[]): boolean {
    const normalizedPath = normalizePath(path);

    for (const pattern of patterns) {
        if (matchPattern(normalizedPath, normalizePath(pattern))) {
            return true;
        }
    }

    return false;
}

/**
 * Match a path against a single pattern
 */
function matchPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*\*/g, '{{GLOBSTAR}}')     // Temporary placeholder
        .replace(/\*/g, '[^/]*')              // * matches anything except /
        .replace(/\?/g, '[^/]')               // ? matches single char except /
        .replace(/\{\{GLOBSTAR\}\}/g, '.*');  // ** matches anything including /

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
}

/**
 * Filter files by ignore patterns
 */
export function filterIgnoredFiles(files: TFile[], ignorePatterns: string[]): TFile[] {
    return files.filter(file => !matchesIgnorePattern(file.path, ignorePatterns));
}

/**
 * Encode content to base64 (for GitHub API)
 */
export function encodeBase64(content: string): string {
    // Use TextEncoder for proper UTF-8 handling
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decode base64 to string (from GitHub API)
 */
export function decodeBase64(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

/**
 * Encode ArrayBuffer to base64
 */
export function encodeBase64Binary(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decode base64 to ArrayBuffer
 */
export function decodeBase64Binary(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

