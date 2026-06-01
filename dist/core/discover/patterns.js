"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_PATTERNS = exports.BUILTIN_MODULES = void 0;
exports.isBuiltinModule = isBuiltinModule;
exports.loadPatternRegistry = loadPatternRegistry;
/**
 * Language-level builtin / stdlib module names that should NEVER be treated as
 * project-internal references. Matching imports are silently dropped from
 * `discovered_edges` and `ambiguous` so the agent only sees actionable items.
 *
 * Format: bare name only (no `node:` prefix, no path). For namespaced builtins
 * (`fs/promises`, `node:fs`), the first segment is checked.
 */
exports.BUILTIN_MODULES = {
    nodejs: new Set([
        // Core modules (no node: prefix)
        'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
        'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
        'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
        'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
        'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
        'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
        // Namespaced submodules (first-segment match)
        'fs/promises', 'path/posix', 'path/win32', 'stream/promises', 'stream/consumers',
        'stream/web', 'util/types', 'util/promisify', 'crypto/webcrypto',
        // Common test/build runners — npm packages but stable enough to treat as external noise
        '@types', 'tslib',
    ]),
    python: new Set([
        'abc', 'aifc', 'argparse', 'array', 'ast', 'asynchat', 'asyncio', 'asyncore',
        'atexit', 'audioop', 'base64', 'bdb', 'binascii', 'binhex', 'bisect',
        'builtins', 'bz2', 'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd',
        'code', 'codecs', 'codeop', 'collections', 'colorsys', 'compileall',
        'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg',
        'cProfile', 'crypt', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime',
        'dbm', 'decimal', 'difflib', 'dis', 'distutils', 'doctest', 'email',
        'encodings', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput',
        'fnmatch', 'formatter', 'fractions', 'ftplib', 'functools', 'gc', 'getopt',
        'getpass', 'gettext', 'glob', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac',
        'html', 'http', 'idlelib', 'imaplib', 'imghdr', 'imp', 'importlib', 'inspect',
        'io', 'ipaddress', 'itertools', 'json', 'keyword', 'lib2to3', 'linecache',
        'locale', 'logging', 'lzma', 'mailbox', 'mailcap', 'marshal', 'math',
        'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc', 'nis',
        'nntplib', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'parser',
        'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform',
        'plistlib', 'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats',
        'pty', 'pwd', 'py_compile', 'pyclbr', 'pydoc', 'queue', 'quopri', 'random',
        're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched',
        'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal',
        'site', 'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'spwd',
        'sqlite3', 'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct',
        'subprocess', 'sunau', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny',
        'tarfile', 'telnetlib', 'tempfile', 'termios', 'test', 'textwrap',
        'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize', 'tomllib',
        'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types',
        'typing', 'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings',
        'wave', 'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib',
        'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib', '_thread',
    ]),
    rust: new Set([
        // Crates can never be resolved as project cards; only "crate::", "self::", "super::"
        // are local. We don't need to enumerate crate names, but we list common std crates.
        'std', 'core', 'alloc', 'proc_macro', 'test',
    ]),
    go: new Set([
        // Go standard library packages
        'archive', 'bufio', 'builtin', 'bytes', 'compress', 'container', 'context',
        'crypto', 'database', 'debug', 'embed', 'encoding', 'errors', 'expvar',
        'flag', 'fmt', 'go', 'hash', 'heap', 'html', 'image', 'index', 'io', 'log',
        'math', 'mime', 'net', 'os', 'path', 'plugin', 'reflect', 'regexp', 'runtime',
        'sort', 'strconv', 'strings', 'sync', 'syscall', 'testing', 'text', 'time',
        'unicode', 'unsafe', 'vendor',
    ]),
    cpp: new Set([
        // C/C++ standard library headers — we list bare names without the `.h` since
        // matches are usually <stdio.h> or <stdio>. Stdio pattern matches the basename
        // after stripping the extension, so we cover the core set.
        'stdio', 'stdlib', 'string', 'cstring', 'string.h', 'stdio.h', 'stdlib.h',
        'iostream', 'fstream', 'sstream', 'iomanip', 'vector', 'list', 'map', 'set',
        'unordered_map', 'unordered_set', 'algorithm', 'functional', 'memory',
        'utility', 'tuple', 'array', 'deque', 'queue', 'stack', 'bitset', 'regex',
        'thread', 'mutex', 'atomic', 'condition_variable', 'chrono', 'ratio',
        'random', 'numeric', 'complex', 'valarray', 'type_traits', 'typeinfo',
        'exception', 'stdexcept', 'cerrno', 'cassert', 'cctype', 'cmath', 'cstdlib',
        'cstdio', 'cstring', 'ctime', 'climits', 'cfloat', 'cstdint', 'cstddef',
        'limits', 'new', 'initializer_list', 'variant', 'optional', 'any',
        'filesystem', 'ranges', 'span', 'concepts', 'coroutine', 'format',
        'source_location', 'version', 'bit', 'numbers', 'string_view',
    ]),
    java: new Set([
        // Java SE / Jakarta EE / common Spring package prefixes
        'java', 'javax', 'jakarta', 'org.springframework', 'org.apache',
        'org.junit', 'org.testng', 'org.mockito', 'com.google', 'org.slf4j',
        'org.apache.commons', 'org.apache.logging', 'org.apache.maven',
        'org.gradle', 'org.hibernate', 'io.netty', 'org.bouncycastle', 'org.xml',
        'org.w3c', 'org.omg', 'org.relaxng', 'org.json', 'org.yaml', 'com.fasterxml',
        'lombok', 'android', 'androidx', 'kotlin', 'kotlinx', 'scala', 'org.scalatest',
        'org.apache.spark', 'org.apache.kafka', 'org.apache.flink', 'org.apache.hadoop',
    ]),
};
/**
 * Check if a target name is a language-level builtin (stdlib / core module / framework).
 * For namespaced targets (e.g. `fs/promises`, `node:fs`), checks the first segment
 * after stripping an optional `node:` prefix.
 * For dot-separated languages (java, python), checks if the target starts with
 * any of the prefix entries in the set (e.g. `org.springframework`, `java`).
 */
function isBuiltinModule(target, language) {
    const set = exports.BUILTIN_MODULES[language];
    if (!set)
        return false;
    // Strip node: prefix (Node.js ESM)
    let t = target.startsWith('node:') ? target.slice(5) : target;
    // For namespaced like `fs/promises`, check first segment
    if (t.includes('/')) {
        t = t.split('/')[0];
    }
    // Direct match (works for Node.js, Go, Rust, C/C++)
    if (set.has(t))
        return true;
    // For dot-separated languages (java, python): check prefix match
    // Examples: `org.springframework.boot.X` should match `org.springframework`
    if (language === 'java' || language === 'python') {
        // Single-segment: `java`, `javax`, `lombok`
        const firstDot = t.indexOf('.');
        const firstSegment = firstDot === -1 ? t : t.substring(0, firstDot);
        if (set.has(firstSegment))
            return true;
        // Compound prefix: `org.springframework`, `org.junit`, `com.google`
        // Find any dot-separated prefix in the set that `t` starts with.
        for (const prefix of set) {
            if (!prefix.includes('.'))
                continue;
            if (t === prefix || t.startsWith(prefix + '.'))
                return true;
        }
    }
    return false;
}
/**
 * Built-in language pattern registry for 6 major ecosystems.
 * Each language has: indicator files, source extensions, import patterns, dependency file patterns, and exclude dirs.
 */
exports.BUILTIN_PATTERNS = {
    nodejs: {
        language: 'nodejs',
        indicators: ['package.json'],
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
        source_patterns: [
            {
                regex: 'import\\s+(?:[\\s\\S]*?\\s+from\\s+)?[\'"]([^\'"]+)[\'"]',
                confidence: 0.7,
                scope: 'both',
            },
            {
                regex: '(?:const|let|var)\\s+\\w+\\s*=\\s*require\\([\'"]([^\'"]+)[\'"]\\)',
                confidence: 0.7,
                scope: 'both',
            },
            {
                regex: 'import\\([\'"]([^\'"]+)[\'"]\\)',
                confidence: 0.65,
                scope: 'both',
            },
        ],
        dep_files: [
            {
                filename: 'package.json',
                parser: 'json',
                extractDeps: 'dependencies,devDependencies,peerDependencies',
                confidence: 0.85,
            },
        ],
        exclude_dirs: ['node_modules', '.git', 'dist', 'build', '.next'],
    },
    python: {
        language: 'python',
        indicators: ['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile'],
        extensions: ['.py', '.pyi', '.pyx'],
        source_patterns: [
            {
                regex: '^\\s*(?:from\\s+)\\.?(\\w+(?:\\.\\w+)*)\\s+import\\s+',
                confidence: 0.7,
                scope: 'both',
            },
            {
                regex: '^\\s*import\\s+(\\.?\\w+(?:\\.\\w+)*)',
                confidence: 0.7,
                scope: 'both',
            },
        ],
        dep_files: [
            {
                filename: 'requirements.txt',
                parser: 'text',
                extractDeps: 'line',
                confidence: 0.85,
            },
            {
                filename: 'pyproject.toml',
                parser: 'toml',
                extractDeps: 'project.dependencies',
                confidence: 0.85,
            },
        ],
        exclude_dirs: ['.venv', 'venv', '__pycache__', '.git', 'dist', 'build', 'node_modules'],
    },
    rust: {
        language: 'rust',
        indicators: ['Cargo.toml'],
        extensions: ['.rs'],
        source_patterns: [
            {
                regex: '^\\s*use\\s+((?:crate|self|super)::\\w+(?:::\\w+)*)',
                confidence: 0.7,
                scope: 'local',
            },
            {
                regex: '^\\s*extern\\s+crate\\s+(\\w+)',
                confidence: 0.75,
                scope: 'external',
            },
        ],
        dep_files: [
            {
                filename: 'Cargo.toml',
                parser: 'toml',
                extractDeps: 'dependencies,dev-dependencies',
                confidence: 0.85,
            },
        ],
        exclude_dirs: ['target', '.git', 'vendor'],
    },
    go: {
        language: 'go',
        indicators: ['go.mod'],
        extensions: ['.go'],
        source_patterns: [
            {
                regex: 'import\\s+(?:"([^"]+)"|\\b(\\w+)\\s+"([^"]+)")',
                confidence: 0.7,
                scope: 'both',
            },
        ],
        dep_files: [
            {
                filename: 'go.mod',
                parser: 'text',
                extractDeps: 'require',
                confidence: 0.85,
            },
        ],
        exclude_dirs: ['vendor', '.git', 'dist'],
    },
    cpp: {
        language: 'cpp',
        indicators: ['CMakeLists.txt', 'Makefile', 'meson.build'],
        extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'],
        source_patterns: [
            {
                regex: '#include\\s+"([^"]+)"',
                confidence: 0.7,
                scope: 'local',
            },
            {
                regex: '#include\\s+<([^>]+)>',
                confidence: 0.5,
                scope: 'external',
            },
        ],
        dep_files: [
            {
                filename: 'CMakeLists.txt',
                parser: 'text',
                extractDeps: 'target_link_libraries,find_package',
                confidence: 0.7,
            },
        ],
        exclude_dirs: ['build', 'cmake-build-*', '.git', 'third_party', 'vendor'],
    },
    java: {
        language: 'java',
        indicators: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
        extensions: ['.java', '.kt', '.scala'],
        source_patterns: [
            {
                regex: '^\\s*import\\s+((?:[a-z_]\\w*\\.)+[A-Z]\\w*(?:\\.\\*)?)',
                confidence: 0.7,
                scope: 'both',
            },
        ],
        dep_files: [
            {
                filename: 'pom.xml',
                parser: 'xml',
                extractDeps: 'dependency',
                confidence: 0.8,
            },
            {
                filename: 'build.gradle',
                parser: 'groovy',
                extractDeps: 'implementation,api',
                confidence: 0.8,
            },
        ],
        exclude_dirs: ['target', 'build', '.gradle', '.git', 'node_modules'],
    },
};
/**
 * Load the full pattern registry: builtin + manifest additional_patterns.
 * manifestPatterns take precedence (merge by language key).
 */
function loadPatternRegistry(manifestPatterns) {
    const merged = { ...exports.BUILTIN_PATTERNS };
    if (manifestPatterns) {
        for (const pattern of manifestPatterns) {
            merged[pattern.language] = pattern;
        }
    }
    return Object.values(merged);
}
//# sourceMappingURL=patterns.js.map