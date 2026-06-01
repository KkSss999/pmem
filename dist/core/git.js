"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGitStatusPorcelain = parseGitStatusPorcelain;
function parseGitStatusPorcelain(output) {
    const changes = [];
    for (const rawLine of output.split('\n')) {
        if (!rawLine.trim())
            continue;
        const status = rawLine.slice(0, 2).trim() || rawLine.slice(0, 2);
        let filePath = rawLine.slice(3).trim();
        if (status.includes('R')) {
            const arrowIdx = filePath.indexOf(' -> ');
            if (arrowIdx > 0)
                filePath = filePath.slice(arrowIdx + 4);
        }
        changes.push({ status, path: filePath });
    }
    return changes;
}
//# sourceMappingURL=git.js.map