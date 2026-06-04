export declare function ensureDir(dirPath: string): void;
export declare function writeFile(filePath: string, content: string): void;
export declare function atomicWrite(filePath: string, content: string): void;
export declare function readFile(filePath: string): string | null;
export declare function listFiles(dirPath: string, pattern: RegExp): string[];
export declare function fileExists(filePath: string): boolean;
export declare function removeFile(filePath: string): void;
export declare function copyFile(src: string, dest: string): void;
export declare function acquireLock(lockPath: string, timeoutMs?: number): boolean;
export declare function releaseLock(lockPath: string): void;
export declare function isLockStale(lockPath: string, staleAfterMs?: number): boolean;
export declare function breakLock(lockPath: string): void;
export declare function getLockAge(lockPath: string): number | null;
export declare function getLockStatus(lockPath: string): {
    exists: boolean;
    stale: boolean;
    age: number | null;
};
export declare function getLockInfo(lockPath: string, staleAfterMs?: number): {
    exists: boolean;
    is_stale: boolean;
    age_seconds: number | null;
    owner_pid: number | null;
    stale_threshold_seconds: number;
};
export declare function readJson<T>(filePath: string): T | null;
export declare function writeJson(filePath: string, data: unknown): void;
export declare function getFileMtime(filePath: string): number | null;
/**
 * Checks if a relative file path matches a target path (exact or sub-directory).
 * Used for precise path matching based on project root.
 */
export declare function isPathMatch(filePath: string, targetPath: string): boolean;
//# sourceMappingURL=fs.d.ts.map