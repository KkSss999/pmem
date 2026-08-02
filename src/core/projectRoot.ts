import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProjectPaths {
  /** The directory that owns the discovered `.pmem` directory. */
  projectRoot: string;
  /** Absolute path to the project's `.pmem` directory. */
  pmemPath: string;
  /** The original absolute starting directory, retained for relative output. */
  cwd: string;
}

/**
 * Find the nearest project-scoped `.pmem` directory by walking upward.
 *
 * A command may be started from the project root, any source subdirectory, or
 * from `.pmem` itself.  The nearest match is intentional: it mirrors git's
 * project discovery behavior and prevents the historical `.pmem/.pmem` path.
 */
export function findProjectPaths(startPath: string = process.cwd()): ProjectPaths | null {
  const absoluteStart = path.resolve(startPath);
  let cwd = absoluteStart;
  try {
    if (fs.existsSync(absoluteStart) && fs.statSync(absoluteStart).isFile()) {
      cwd = path.dirname(absoluteStart);
    }
  } catch {
    // Treat an unreadable/non-existent starting path as a directory path.
  }

  let current = cwd;
  while (true) {
    if (path.basename(current) === '.pmem' && isDirectory(current)) {
      return { projectRoot: path.dirname(current), pmemPath: current, cwd: absoluteStart };
    }

    const pmemPath = path.join(current, '.pmem');
    if (isDirectory(pmemPath)) {
      return { projectRoot: current, pmemPath, cwd: absoluteStart };
    }

    // A nested Git repository is an explicit project boundary. Without this
    // guard, test fixtures, submodules, and checked-out child projects inside
    // another pmem repository would silently operate on the parent's memory.
    if (fs.existsSync(path.join(current, '.git'))) return null;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function resolveProjectPaths(startPath: string = process.cwd()): ProjectPaths {
  const paths = findProjectPaths(startPath);
  if (paths) return paths;

  const cwd = path.resolve(startPath);
  throw new Error(
    `No pmem project found from ${cwd}. Walked upward looking for a .pmem directory; run pmem init from the project root.`,
  );
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
