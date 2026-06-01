"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSimpleYaml = parseSimpleYaml;
exports.parseYamlValue = parseYamlValue;
exports.parseFrontmatter = parseFrontmatter;
/**
 * Simple inline YAML parser for pmem's constrained frontmatter format.
 * Handles: top-level scalars, nested objects (one level), list items, inline arrays.
 */
function parseSimpleYaml(yaml) {
    const result = {};
    const lines = yaml.split('\n');
    let currentArrayKey = null;
    let currentSubKey = null;
    for (const line of lines) {
        if (line.trim() === '')
            continue;
        // Sub-object key: "  key: value"
        const subMatch = line.match(/^  (\w[\w_]*):\s*(.*)/);
        if (subMatch) {
            const key = subMatch[1];
            const val = subMatch[2].trim();
            if (val === '') {
                currentSubKey = key;
                if (!result[currentArrayKey || ''])
                    result[currentArrayKey || ''] = {};
                continue;
            }
            if (currentArrayKey) {
                if (!result[currentArrayKey])
                    result[currentArrayKey] = {};
                result[currentArrayKey][key] = parseYamlValue(val);
            }
            else {
                result[key] = parseYamlValue(val);
            }
            continue;
        }
        // Array item: "  - value"
        const arrMatch = line.match(/^  -\s*(.*)/);
        if (arrMatch) {
            const val = arrMatch[1].trim();
            const arrKey = currentSubKey || currentArrayKey;
            if (arrKey) {
                if (!result[arrKey])
                    result[arrKey] = [];
                result[arrKey].push(val);
            }
            continue;
        }
        // Top-level key: value
        const topMatch = line.match(/^(\w[\w_]*):\s*(.*)/);
        if (topMatch) {
            const key = topMatch[1];
            const val = topMatch[2].trim();
            if (val === '') {
                currentArrayKey = key;
                currentSubKey = null;
            }
            else {
                result[key] = parseYamlValue(val);
                currentArrayKey = null;
                currentSubKey = null;
            }
        }
    }
    return result;
}
function parseYamlValue(val) {
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    if (/^\d+$/.test(val))
        return parseInt(val, 10);
    // Inline array: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1).trim();
        if (!inner)
            return [];
        return inner.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1')).filter(s => s.length > 0);
    }
    return val.replace(/^"(.*)"$/, '$1');
}
function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match)
        return null;
    return {
        data: parseSimpleYaml(match[1]),
        body: match[2] || '',
    };
}
//# sourceMappingURL=yaml.js.map