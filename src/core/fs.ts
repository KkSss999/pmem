import * as fs from 'fs';
import * as path from 'path';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

// NEW: Atomic write — write to .tmp first, then fsync + rename
export function atomicWrite(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  const fd = fs.openSync(tmpPath, 'r');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmpPath, filePath);
}

export function readFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function listFiles(dirPath: string, pattern: RegExp): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// NEW: Remove a file (no error if not exists)
export function removeFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

// NEW: Copy a file
export function copyFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// NEW: Simple file lock using mkdir (atomic operation)
export function acquireLock(lockPath: string, timeoutMs: number = 3000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      fs.mkdirSync(lockPath);
      return true;
    } catch {
      // Lock exists, wait and retry
      // Simple busy-wait (acceptable for sub-second lock timeouts)
      const waitUntil = Date.now() + 50 + Math.random() * 50;
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }
  return false;
}

// NEW: Release file lock
export function releaseLock(lockPath: string): void {
  try {
    fs.rmdirSync(lockPath);
  } catch {
    // ignore
  }
}

// NEW: Check if lock is stale (older than staleAfterMs)
export function isLockStale(lockPath: string, staleAfterMs: number = 60000): boolean {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}

// NEW: Force remove a stale lock
export function breakLock(lockPath: string): void {
  releaseLock(lockPath);
}

// NEW: Read JSON file
export function readJson<T>(filePath: string): T | null {
  const content = readFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// NEW: Write JSON file atomically
export function writeJson(filePath: string, data: unknown): void {
  atomicWrite(filePath, JSON.stringify(data, null, 2));
}

// NEW: Get file modification time (ms since epoch)
export function getFileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}
