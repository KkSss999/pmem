"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOutput = formatOutput;
function formatOutput(result, format, budget = 1600) {
    switch (format) {
        case 'compact': return formatCompact(result);
        case 'json': return formatJson(result);
        case 'paths': return formatPaths(result);
        case 'pack': return formatPack(result, budget);
        default: return formatCompact(result);
    }
}
function formatCompact(result) {
    const r = result;
    if (r.query !== undefined) {
        return formatAskCompact(r);
    }
    if (r.project !== undefined) {
        return formatRecallCompact(r);
    }
    if (r.related !== undefined) {
        return formatRelatedCompact(r);
    }
    if (r.trace !== undefined) {
        return formatTraceCompact(r);
    }
    return String(result);
}
function formatJson(result) {
    return JSON.stringify(result, null, 2);
}
function formatPaths(result) {
    const r = result;
    const paths = [];
    if (Array.isArray(r.recommended_files)) {
        paths.push(...r.recommended_files);
    }
    else if (Array.isArray(r.recommendedRead)) {
        paths.push(...r.recommendedRead);
    }
    else if (Array.isArray(r.mustRead)) {
        paths.push(...r.mustRead);
    }
    if (Array.isArray(r.evidencePaths)) {
        for (const p of r.evidencePaths) {
            if (!paths.includes(p))
                paths.push(p);
        }
    }
    if (Array.isArray(r.matched)) {
        for (const m of r.matched) {
            if (m.file && !paths.includes(m.file))
                paths.push(m.file);
        }
    }
    return paths.join('\n');
}
function formatPack(result, budget) {
    const r = result;
    const parts = [];
    let used = 0;
    function add(line, cost) {
        const c = cost ?? Math.ceil(line.length / 4);
        if (used + c > budget)
            return false;
        parts.push(line);
        used += c;
        return true;
    }
    if (r.project) {
        if (!add(`PROJECT: ${r.project}`))
            return parts.join('\n');
    }
    if (r.stage) {
        if (!add(`STAGE: ${r.stage}`))
            return parts.join('\n');
    }
    if (r.focus) {
        if (!add(`FOCUS: ${r.focus}`))
            return parts.join('\n');
    }
    if (r.query && add(`\nQUERY: ${r.query}`)) {
        if (Array.isArray(r.matched)) {
            for (const m of r.matched) {
                if (!add(`  - ${m.id} (${m.matchType || m.match_type}, score: ${m.score ?? m.confidence ?? '?'})`))
                    break;
            }
        }
    }
    if (Array.isArray(r.recommended_files)) {
        if (add('\nRECOMMENDED:')) {
            for (const f of r.recommended_files) {
                if (!add(`  ${f}`))
                    break;
            }
        }
    }
    else if (Array.isArray(r.recommendedRead)) {
        if (add('\nRECOMMENDED:')) {
            for (const f of r.recommendedRead) {
                if (!add(`  ${f}`))
                    break;
            }
        }
    }
    return parts.join('\n');
}
function formatRecallCompact(r) {
    const lines = [];
    lines.push(`PROJECT: ${r.project || 'Unknown'}`);
    if (r.stage)
        lines.push(`STAGE: ${r.stage}`);
    if (r.focus) {
        lines.push('');
        lines.push(`FOCUS: ${r.focus}`);
    }
    if (r.next) {
        lines.push('');
        lines.push('NEXT:');
        lines.push(`${r.next}`);
    }
    if (Array.isArray(r.state) && r.state.length > 0) {
        lines.push('');
        lines.push('STATE:');
        for (const s of r.state) {
            lines.push(`  ${s}`);
        }
    }
    if (Array.isArray(r.mustRead) && r.mustRead.length > 0) {
        lines.push('');
        lines.push('READ_IF_NEEDED:');
        for (const f of r.mustRead) {
            lines.push(`  ${f}`);
        }
    }
    return lines.join('\n');
}
function formatAskCompact(r) {
    const lines = [];
    lines.push(`Query: ${r.query}`);
    const matched = r.matched;
    if (matched && matched.length > 0) {
        const direct = matched.filter(m => m.matchType !== 'graph_expansion' && m.match_type !== 'graph_expansion');
        const expanded = matched.filter(m => m.matchType === 'graph_expansion' || m.match_type === 'graph_expansion');
        if (direct.length > 0) {
            lines.push('\nMatched:');
            for (const m of direct) {
                lines.push(`  - ${m.id} by ${m.matchType || m.match_type}: "${m.title}"`);
            }
        }
        if (expanded.length > 0) {
            lines.push('\nExpanded:');
            for (const m of expanded) {
                lines.push(`  - ${m.id} via ${m.edgeType || m.edge_type || 'related'} (d=${m.graphDistance || m.graph_distance || 1})`);
            }
        }
    }
    else {
        lines.push('\nNo matching memory cards found.');
    }
    const recFiles = Array.isArray(r.recommended_files) ? r.recommended_files : [];
    const recRead = Array.isArray(r.recommendedRead) ? r.recommendedRead : [];
    if (recFiles.length > 0) {
        lines.push('\nRecommended:');
        for (const f of recFiles.slice(0, 6)) {
            lines.push(`  ${f}`);
        }
    }
    else if (recRead.length > 0) {
        lines.push('\nRecommended:');
        for (const f of recRead.slice(0, 6)) {
            lines.push(`  ${f}`);
        }
    }
    else if (!matched || matched.length === 0) {
        lines.push('\nTry:');
        lines.push('  pmem recall                  — full project context');
        lines.push('  pmem ask "<keyword>"         — try a different query');
        lines.push('  Check card aliases and tags  — frontmatter alias: / tags:');
    }
    return lines.join('\n');
}
function formatRelatedCompact(r) {
    const lines = [];
    lines.push(`${r.id}`);
    lines.push(`Type: ${r.type}`);
    lines.push(`Title: ${r.title}`);
    if (r.status)
        lines.push(`Status: ${r.status}`);
    const related = r.related;
    if (related && related.length > 0) {
        lines.push('\nDirect Relations:');
        for (const rel of related) {
            const prefix = rel.direction === 'in' ? '<-' : '';
            lines.push(`  ${prefix}${rel.type}: ${rel.targetId} (${rel.targetTitle})`);
        }
    }
    return lines.join('\n');
}
function formatTraceCompact(r) {
    const lines = [];
    lines.push(`Trace for ${r.id}:`);
    lines.push(`Type: ${r.type}`);
    lines.push(`Title: ${r.title}`);
    if (r.file)
        lines.push(`File: ${r.file}`);
    if (Array.isArray(r.dependsOn) && r.dependsOn.length > 0) {
        lines.push('\nDepends On:');
        for (const d of r.dependsOn) {
            lines.push(`  - ${d.id} (${d.title || ''})`);
        }
    }
    if (Array.isArray(r.dependedBy) && r.dependedBy.length > 0) {
        lines.push('\nDepended On By:');
        for (const d of r.dependedBy) {
            lines.push(`  - ${d.id} (${d.title || ''})`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=format.js.map