import {
    normalizePath,
    joinPath,
    getExtension,
    getParentPath,
    getFilename,
    hashContent,
    hashBinaryContent,
    matchesIgnorePattern,
    filterIgnoredFiles,
    encodeBase64,
    decodeBase64,
    encodeBase64Binary,
    decodeBase64Binary,
    isBinaryFile,
    computeGitBlobSha,
    computeGitBlobShaBinary,
} from '../../src/utils/fileUtils';

describe('Path Utilities', () => {
    describe('normalizePath', () => {
        it('should convert backslashes to forward slashes', () => {
            expect(normalizePath('path\\to\\file.md')).toBe('path/to/file.md');
        });

        it('should remove leading slashes', () => {
            expect(normalizePath('/path/to/file.md')).toBe('path/to/file.md');
        });

        it('should remove trailing slashes', () => {
            expect(normalizePath('path/to/folder/')).toBe('path/to/folder');
        });

        it('should collapse multiple slashes', () => {
            expect(normalizePath('path//to///file.md')).toBe('path/to/file.md');
        });

        it('should handle empty string', () => {
            expect(normalizePath('')).toBe('');
        });
    });

    describe('joinPath', () => {
        it('should join path segments', () => {
            expect(joinPath('path', 'to', 'file.md')).toBe('path/to/file.md');
        });

        it('should handle empty segments', () => {
            expect(joinPath('path', '', 'file.md')).toBe('path/file.md');
        });

        it('should handle single segment', () => {
            expect(joinPath('file.md')).toBe('file.md');
        });
    });

    describe('getExtension', () => {
        it('should return file extension', () => {
            expect(getExtension('file.md')).toBe('md');
        });

        it('should handle multiple dots', () => {
            expect(getExtension('file.test.ts')).toBe('ts');
        });

        it('should return empty for no extension', () => {
            expect(getExtension('README')).toBe('');
        });

        it('should handle hidden files', () => {
            // Hidden files without extension return empty
            expect(getExtension('.gitignore')).toBe('');
        });
    });

    describe('getParentPath', () => {
        it('should return parent directory', () => {
            expect(getParentPath('path/to/file.md')).toBe('path/to');
        });

        it('should return empty for root file', () => {
            expect(getParentPath('file.md')).toBe('');
        });

        it('should handle trailing slash', () => {
            expect(getParentPath('path/to/folder/')).toBe('path/to');
        });
    });

    describe('getFilename', () => {
        it('should return filename', () => {
            expect(getFilename('path/to/file.md')).toBe('file.md');
        });

        it('should handle root file', () => {
            expect(getFilename('file.md')).toBe('file.md');
        });
    });
});

describe('Hash Utilities', () => {
    describe('hashContent', () => {
        it('should return consistent hash for same content', () => {
            const hash1 = hashContent('test content');
            const hash2 = hashContent('test content');
            expect(hash1).toBe(hash2);
        });

        it('should return different hash for different content', () => {
            const hash1 = hashContent('content 1');
            const hash2 = hashContent('content 2');
            expect(hash1).not.toBe(hash2);
        });

        it('should handle empty string', () => {
            const hash = hashContent('');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should handle unicode content', () => {
            const hash = hashContent('你好世界 🌍');
            expect(typeof hash).toBe('string');
            expect(hash.length).toBe(8); // djb2 hash is 8 hex chars
        });
    });

    describe('hashBinaryContent', () => {
        it('should return consistent hash for same binary content', () => {
            const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
            const hash1 = hashBinaryContent(buffer);
            const hash2 = hashBinaryContent(buffer);
            expect(hash1).toBe(hash2);
        });

        it('should return different hash for different binary content', () => {
            const buffer1 = new Uint8Array([1, 2, 3]).buffer;
            const buffer2 = new Uint8Array([4, 5, 6]).buffer;
            expect(hashBinaryContent(buffer1)).not.toBe(hashBinaryContent(buffer2));
        });

        it('should handle empty buffer', () => {
            const buffer = new ArrayBuffer(0);
            const hash = hashBinaryContent(buffer);
            expect(typeof hash).toBe('string');
            expect(hash.length).toBe(8);
        });
    });
});

describe('Ignore Pattern Utilities', () => {
    describe('matchesIgnorePattern', () => {
        it('should match exact filename', () => {
            // matchesIgnorePattern takes an array of patterns
            expect(matchesIgnorePattern('file.md', ['file.md'])).toBe(true);
        });

        it('should match wildcard pattern', () => {
            expect(matchesIgnorePattern('file.md', ['*.md'])).toBe(true);
            expect(matchesIgnorePattern('file.txt', ['*.md'])).toBe(false);
        });

        it('should match double wildcard for directories', () => {
            expect(matchesIgnorePattern('path/to/file.md', ['**/file.md'])).toBe(true);
        });

        it('should match directory patterns', () => {
            expect(matchesIgnorePattern('.obsidian/config', ['.obsidian/**'])).toBe(true);
        });

        it('should return false for no matching patterns', () => {
            expect(matchesIgnorePattern('file.md', ['*.txt', '*.js'])).toBe(false);
        });
    });

    describe('filterIgnoredFiles', () => {
        // filterIgnoredFiles expects TFile objects, test at integration level
        it('should be tested with TFile objects', () => {
            // This is tested at integration level since it requires TFile
            expect(typeof filterIgnoredFiles).toBe('function');
        });
    });
});

describe('Binary File Detection', () => {
    describe('isBinaryFile', () => {
        it('should detect image files as binary', () => {
            expect(isBinaryFile('image.png')).toBe(true);
            expect(isBinaryFile('photo.jpg')).toBe(true);
            expect(isBinaryFile('icon.gif')).toBe(true);
            expect(isBinaryFile('graphic.webp')).toBe(true);
            expect(isBinaryFile('vector.svg')).toBe(true);
        });

        it('should detect audio/video files as binary', () => {
            expect(isBinaryFile('song.mp3')).toBe(true);
            expect(isBinaryFile('audio.wav')).toBe(true);
            expect(isBinaryFile('video.mp4')).toBe(true);
            expect(isBinaryFile('clip.webm')).toBe(true);
        });

        it('should detect archive files as binary', () => {
            expect(isBinaryFile('archive.zip')).toBe(true);
            expect(isBinaryFile('backup.tar')).toBe(true);
            expect(isBinaryFile('compressed.gz')).toBe(true);
        });

        it('should detect font files as binary', () => {
            expect(isBinaryFile('font.woff')).toBe(true);
            expect(isBinaryFile('font.woff2')).toBe(true);
            expect(isBinaryFile('font.ttf')).toBe(true);
        });

        it('should not detect text files as binary', () => {
            expect(isBinaryFile('readme.md')).toBe(false);
            expect(isBinaryFile('script.js')).toBe(false);
            expect(isBinaryFile('style.css')).toBe(false);
            expect(isBinaryFile('data.json')).toBe(false);
            expect(isBinaryFile('note.txt')).toBe(false);
        });

        it('should handle paths with directories', () => {
            expect(isBinaryFile('assets/images/photo.png')).toBe(true);
            expect(isBinaryFile('docs/readme.md')).toBe(false);
        });

        it('should be case-insensitive', () => {
            expect(isBinaryFile('IMAGE.PNG')).toBe(true);
            expect(isBinaryFile('Photo.JPG')).toBe(true);
        });
    });
});

describe('Base64 Encoding', () => {
    describe('encodeBase64 / decodeBase64 (text)', () => {
        it('should encode and decode simple text', () => {
            const original = 'Hello, World!';
            const encoded = encodeBase64(original);
            const decoded = decodeBase64(encoded);
            expect(decoded).toBe(original);
        });

        it('should handle unicode text', () => {
            const original = '你好世界 🌍 émoji';
            const encoded = encodeBase64(original);
            const decoded = decodeBase64(encoded);
            expect(decoded).toBe(original);
        });

        it('should handle empty string', () => {
            const encoded = encodeBase64('');
            const decoded = decodeBase64(encoded);
            expect(decoded).toBe('');
        });

        it('should handle multiline text', () => {
            const original = 'line1\nline2\nline3';
            const encoded = encodeBase64(original);
            const decoded = decodeBase64(encoded);
            expect(decoded).toBe(original);
        });

        it('should handle special characters', () => {
            const original = 'Special: <>&"\'\t\r\n';
            const encoded = encodeBase64(original);
            const decoded = decodeBase64(encoded);
            expect(decoded).toBe(original);
        });
    });

    describe('encodeBase64Binary / decodeBase64Binary', () => {
        it('should encode and decode binary data', () => {
            const original = new Uint8Array([0, 1, 2, 255, 128, 64]).buffer;
            const encoded = encodeBase64Binary(original);
            const decoded = decodeBase64Binary(encoded);
            expect(new Uint8Array(decoded)).toEqual(new Uint8Array(original));
        });

        it('should handle empty buffer', () => {
            const original = new ArrayBuffer(0);
            const encoded = encodeBase64Binary(original);
            const decoded = decodeBase64Binary(encoded);
            expect(decoded.byteLength).toBe(0);
        });

        it('should handle large binary data', () => {
            const size = 10000;
            const data = new Uint8Array(size);
            for (let i = 0; i < size; i++) {
                data[i] = i % 256;
            }
            const encoded = encodeBase64Binary(data.buffer);
            const decoded = decodeBase64Binary(encoded);
            expect(new Uint8Array(decoded)).toEqual(data);
        });
    });
});

describe('Git SHA Computation', () => {
    describe('computeGitBlobSha', () => {
        it('should compute correct SHA for known content', async () => {
            // "hello\n" has a known git blob SHA
            // git hash-object -t blob --stdin <<< "hello" gives a specific SHA
            const sha = await computeGitBlobSha('hello\n');
            expect(sha).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
        });

        it('should return consistent SHA for same content', async () => {
            const content = 'test content for sha';
            const sha1 = await computeGitBlobSha(content);
            const sha2 = await computeGitBlobSha(content);
            expect(sha1).toBe(sha2);
        });

        it('should return different SHA for different content', async () => {
            const sha1 = await computeGitBlobSha('content 1');
            const sha2 = await computeGitBlobSha('content 2');
            expect(sha1).not.toBe(sha2);
        });

        it('should normalize CRLF to LF', async () => {
            const shaCrlf = await computeGitBlobSha('line1\r\nline2');
            const shaLf = await computeGitBlobSha('line1\nline2');
            expect(shaCrlf).toBe(shaLf);
        });

        it('should handle empty content', async () => {
            const sha = await computeGitBlobSha('');
            expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'); // Known empty blob SHA
        });
    });

    describe('computeGitBlobShaBinary', () => {
        it('should return consistent SHA for same binary content', async () => {
            const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
            const sha1 = await computeGitBlobShaBinary(buffer);
            const sha2 = await computeGitBlobShaBinary(buffer);
            expect(sha1).toBe(sha2);
        });

        it('should return different SHA for different binary content', async () => {
            const sha1 = await computeGitBlobShaBinary(new Uint8Array([1, 2, 3]).buffer);
            const sha2 = await computeGitBlobShaBinary(new Uint8Array([4, 5, 6]).buffer);
            expect(sha1).not.toBe(sha2);
        });

        it('should handle empty buffer', async () => {
            const sha = await computeGitBlobShaBinary(new ArrayBuffer(0));
            expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'); // Same as empty text
        });

        it('should return 40-character hex string', async () => {
            const sha = await computeGitBlobShaBinary(new Uint8Array([1, 2, 3]).buffer);
            expect(sha.length).toBe(40);
            expect(/^[0-9a-f]+$/.test(sha)).toBe(true);
        });
    });
});
