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
      // v0.6.4 polish 6: record PID inside the lock directory for diagnostics.
      // Best-effort: if writing fails (e.g., read-only FS), still treat lock as acquired.
      try {
        fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
      } catch {
        // ignore — older pmem versions or unusual FS may not support this
      }
      return true;
    } catch {
      // Lock exists — check if it's stale before waiting
      if (isLockStale(lockPath, 60000)) {
        breakLock(lockPath);
        // Retry immediately after cleaning stale lock
        try {
          fs.mkdirSync(lockPath);
          try {
            fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
          } catch {
            // ignore
          }
          return true;
        } catch {
          // Another process grabbed it, fall through to wait loop
        }
      }
      // Active lock, wait and retry
      const waitUntil = Date.now() + 50 + Math.random() * 50;
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }
  return false;
}

// NEW: Release file lock
export function releaseLock(lockPath: string): void {
  try {
    if (typeof fs.rmSync === 'function') {
      fs.rmSync(lockPath, { recursive: true, force: true });
    } else {
      try {
        fs.unlinkSync(path.join(lockPath, 'pid'));
      } catch {
        // ignore
      }
      fs.rmdirSync(lockPath);
    }
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

// NEW: Get lock age in milliseconds, or null if lock doesn't exist
export function getLockAge(lockPath: string): number | null {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

// NEW: Get lock status for diagnostics
export function getLockStatus(lockPath: string): { exists: boolean; stale: boolean; age: number | null } {
  const age = getLockAge(lockPath);
  if (age === null) return { exists: false, stale: false, age: null };
  return { exists: true, stale: age > 60000, age };
}

// v0.6.4 polish 6: Richer lock info for doctor output (age in seconds, owner PID, stale flag).
// PID is read from a `pid` file inside the lock directory if present (added in v0.6.4).
// Older pmem versions that did not write the pid file will report owner_pid = null.
export function getLockInfo(lockPath: string, staleAfterMs: number = 60000): {
  exists: boolean;
  is_stale: boolean;
  age_seconds: number | null;
  owner_pid: number | null;
  stale_threshold_seconds: number;
} {
  const age = getLockAge(lockPath);
  if (age === null) {
    return { exists: false, is_stale: false, age_seconds: null, owner_pid: null, stale_threshold_seconds: Math.round(staleAfterMs / 1000) };
  }
  let owner_pid: number | null = null;
  const pidFile = path.join(lockPath, 'pid');
  try {
    if (fs.existsSync(pidFile)) {
      const raw = fs.readFileSync(pidFile, 'utf-8').trim();
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        owner_pid = parsed;
      }
    }
  } catch {
    owner_pid = null;
  }
  return {
    exists: true,
    is_stale: age > staleAfterMs,
    age_seconds: Math.round(age / 1000),
    owner_pid,
    stale_threshold_seconds: Math.round(staleAfterMs / 1000),
  };
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
