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
exports.extractSymbols = extractSymbols;
const path = __importStar(require("path"));
function extractSymbols(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();
    const symbols = [];
    if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
                continue;
            // 1. function
            const funcMatch = trimmed.match(/(?:export\s+)?(?:default\s+)?function\s+([a-zA-Z0-9_$]+)/);
            if (funcMatch) {
                symbols.push(`function:${funcMatch[1]}`);
                continue;
            }
            // 2. const/let/var function (arrow or regular)
            const varFuncMatch = trimmed.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/);
            if (varFuncMatch) {
                symbols.push(`function:${varFuncMatch[1]}`);
                continue;
            }
            const varFuncMatch2 = trimmed.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*function\b/);
            if (varFuncMatch2) {
                symbols.push(`function:${varFuncMatch2[1]}`);
                continue;
            }
            // 3. class
            const classMatch = trimmed.match(/(?:export\s+)?(?:default\s+)?class\s+([a-zA-Z0-9_$]+)/);
            if (classMatch) {
                symbols.push(`class:${classMatch[1]}`);
                continue;
            }
            // 4. interface
            const interfaceMatch = trimmed.match(/(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
            if (interfaceMatch) {
                symbols.push(`interface:${interfaceMatch[1]}`);
                continue;
            }
            // 5. type
            const typeMatch = trimmed.match(/(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/);
            if (typeMatch) {
                symbols.push(`type:${typeMatch[1]}`);
                continue;
            }
        }
    }
    else if (ext === '.css') {
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Class selectors
            const classMatches = trimmed.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);
            for (const m of classMatches) {
                symbols.push(`css-class:${m[1]}`);
            }
            // ID selectors
            const idMatches = trimmed.matchAll(/#([a-zA-Z][a-zA-Z0-9_-]*)/g);
            for (const m of idMatches) {
                if (/^[a-fA-F0-9]{3,6}$/.test(m[1]))
                    continue; // Skip hex colors
                symbols.push(`css-id:${m[1]}`);
            }
            // Keyframes
            const keyframeMatch = trimmed.match(/@keyframes\s+([a-zA-Z0-9_-]+)/);
            if (keyframeMatch) {
                symbols.push(`css-keyframes:${keyframeMatch[1]}`);
            }
            // Variables
            const varMatches = trimmed.matchAll(/(--[a-zA-Z0-9_-]+)/g);
            for (const m of varMatches) {
                symbols.push(`css-var:${m[1]}`);
            }
        }
    }
    else if (filename === 'package.json') {
        try {
            const parsed = JSON.parse(content);
            if (parsed.scripts) {
                for (const script of Object.keys(parsed.scripts)) {
                    symbols.push(`npm-script:${script}`);
                }
            }
            if (parsed.dependencies) {
                for (const dep of Object.keys(parsed.dependencies)) {
                    symbols.push(`dependency:${dep}`);
                }
            }
            if (parsed.devDependencies) {
                for (const dep of Object.keys(parsed.devDependencies)) {
                    symbols.push(`dev-dependency:${dep}`);
                }
            }
        }
        catch {
            // Ignored if JSON is invalid
        }
    }
    else if (ext === '.md') {
        const lines = content.split('\n');
        for (const line of lines) {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                symbols.push(`heading:${match[2].trim()}`);
            }
        }
    }
    return Array.from(new Set(symbols));
}
//# sourceMappingURL=symbols.js.map