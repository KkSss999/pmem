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
exports.detectLanguages = detectLanguages;
exports.filterPatterns = filterPatterns;
const path = __importStar(require("path"));
const fs_1 = require("../fs");
/**
 * Auto-detect languages from indicator files in the project root.
 * Returns language names matching the LanguagePattern registry keys.
 */
function detectLanguages(rootDir, patterns) {
    const detected = [];
    for (const pattern of patterns) {
        for (const indicator of pattern.indicators) {
            const indicatorPath = path.join(rootDir, indicator);
            if ((0, fs_1.fileExists)(indicatorPath)) {
                detected.push(pattern.language);
                break; // one indicator is enough
            }
        }
    }
    return detected;
}
/**
 * Filter patterns to only the specified languages.
 * If langs is ['auto'] or empty, return all patterns.
 */
function filterPatterns(patterns, langs) {
    if (!langs || langs.length === 0 || (langs.length === 1 && langs[0] === 'auto')) {
        return patterns;
    }
    const langSet = new Set(langs.map(l => l.toLowerCase()));
    return patterns.filter(p => langSet.has(p.language));
}
//# sourceMappingURL=detect.js.map