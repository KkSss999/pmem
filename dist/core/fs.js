"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDir = ensureDir;
exports.writeFile = writeFile;
exports.atomicWrite = atomicWrite;
exports.readFile = readFile;
exports.listFiles = listFiles;
exports.fileExists = fileExists;
exports.removeFile = removeFile;
exports.copyFile = copyFile;
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.isLockStale = isLockStale;
exports.breakLock = breakLock;
exports.getLockAge = getLockAge;
exports.getLockStatus = getLockStatus;
exports.getLockInfo = getLockInfo;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.getFileMtime = getFileMtime;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
function writeFile(filePath, content) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');
}
// NEW: Atomic write — write to .tmp first, then fsync + rename
function atomicWrite(filePath, content) {
    ensureDir(path.dirname(filePath));
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf-8');
    const fd = fs.openSync(tmpPath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpPath, filePath);
}
function readFile(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    return fs.readFileSync(filePath, 'utf-8');
}
function listFiles(dirPath, pattern) {
    if (!fs.existsSync(dirPath))
        return [];
    const results = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...listFiles(fullPath, pattern));
        }
        else if (pattern.test(entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}
function fileExists(filePath) {
    return fs.existsSync(filePath);
}
// NEW: Remove a file (no error if not exists)
function removeFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    }
    catch {
        // ignore
    }
}
// NEW: Copy a file
function copyFile(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}
// NEW: Simple file lock using mkdir (atomic operation)
function acquireLock(lockPath, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            fs.mkdirSync(lockPath);
            // v0.6.4 polish 6: record PID inside the lock directory for diagnostics.
            // Best-effort: if writing fails (e.g., read-only FS), still treat lock as acquired.
            try {
                fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
            }
            catch {
                // ignore — older pmem versions or unusual FS may not support this
            }
            return true;
        }
        catch {
            // Lock exists — check if it's stale before waiting
            if (isLockStale(lockPath, 60000)) {
                breakLock(lockPath);
                // Retry immediately after cleaning stale lock
                try {
                    fs.mkdirSync(lockPath);
                    try {
                        fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
                    }
                    catch {
                        // ignore
                    }
                    return true;
                }
                catch {
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
function releaseLock(lockPath) {
    try {
        fs.rmdirSync(lockPath);
    }
    catch {
        // ignore
    }
}
// NEW: Check if lock is stale (older than staleAfterMs)
function isLockStale(lockPath, staleAfterMs = 60000) {
    try {
        const stat = fs.statSync(lockPath);
        return Date.now() - stat.mtimeMs > staleAfterMs;
    }
    catch {
        return false;
    }
}
// NEW: Force remove a stale lock
function breakLock(lockPath) {
    releaseLock(lockPath);
}
// NEW: Get lock age in milliseconds, or null if lock doesn't exist
function getLockAge(lockPath) {
    try {
        const stat = fs.statSync(lockPath);
        return Date.now() - stat.mtimeMs;
    }
    catch {
        return null;
    }
}
// NEW: Get lock status for diagnostics
function getLockStatus(lockPath) {
    const age = getLockAge(lockPath);
    if (age === null)
        return { exists: false, stale: false, age: null };
    return { exists: true, stale: age > 60000, age };
}
// v0.6.4 polish 6: Richer lock info for doctor output (age in seconds, owner PID, stale flag).
// PID is read from a `pid` file inside the lock directory if present (added in v0.6.4).
// Older pmem versions that did not write the pid file will report owner_pid = null.
function getLockInfo(lockPath, staleAfterMs = 60000) {
    const age = getLockAge(lockPath);
    if (age === null) {
        return { exists: false, is_stale: false, age_seconds: null, owner_pid: null, stale_threshold_seconds: Math.round(staleAfterMs / 1000) };
    }
    let owner_pid = null;
    const pidFile = path.join(lockPath, 'pid');
    try {
        if (fs.existsSync(pidFile)) {
            const raw = fs.readFileSync(pidFile, 'utf-8').trim();
            const parsed = parseInt(raw, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                owner_pid = parsed;
            }
        }
    }
    catch {
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
function readJson(filePath) {
    const content = readFile(filePath);
    if (!content)
        return null;
    try {
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
// NEW: Write JSON file atomically
function writeJson(filePath, data) {
    atomicWrite(filePath, JSON.stringify(data, null, 2));
}
// NEW: Get file modification time (ms since epoch)
function getFileMtime(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=fs.js.map