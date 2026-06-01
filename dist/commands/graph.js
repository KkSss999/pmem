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
exports.relatedCommand = relatedCommand;
exports.traceCommand = traceCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const db_1 = require("../core/db");
const PMEM_DIR = '.pmem';
function relatedCommand(id, options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const depth = options?.depth ?? 1;
    const edgeTypeFilter = options?.type;
    const fmt = options?.format ?? 'compact';
    const sourceFilter = (options?.source && options.source !== 'all')
        ? options.source
        : undefined;
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id);
    if (!card) {
        if (fmt === 'json') {
            console.log(JSON.stringify({ error: `Node "${id}" not found` }, null, 2));
        }
        else {
            console.log(`Node "${id}" not found in database.`);
            console.log(`Try: pmem ask "${id}" to search for related nodes.`);
        }
        return;
    }
    let directEdges = (0, db_1.getEdgesForCard)(db, id, sourceFilter);
    if (edgeTypeFilter) {
        directEdges = directEdges.filter(e => e.type === edgeTypeFilter);
    }
    const getCard = (cardId) => {
        return db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(cardId);
    };
    if (fmt === 'json') {
        const edgesByType = {};
        for (const edge of directEdges) {
            const isOut = edge.from_id === id;
            const targetId = isOut ? edge.to_id : edge.from_id;
            const targetCard = getCard(targetId);
            if (!edgesByType[edge.type]) {
                edgesByType[edge.type] = [];
            }
            edgesByType[edge.type].push({
                direction: isOut ? 'out' : 'in',
                target_id: targetId,
                target_title: targetCard?.title ?? targetId,
                source: edge.source,
                confidence: edge.confidence,
            });
        }
        const highConfidence = [];
        const needsReview = [];
        for (const items of Object.values(edgesByType)) {
            for (const item of items) {
                if (item.source === 'inferred' && item.confidence < 0.7) {
                    needsReview.push(item);
                }
                else {
                    highConfidence.push(item);
                }
            }
        }
        console.log(JSON.stringify({
            card: { id: card.id, type: card.type, title: card.title, status: card.status, file: card.file_path },
            total_edges: directEdges.length,
            high_confidence: highConfidence,
            needs_review: needsReview,
            edges_by_type: edgesByType,
        }, null, 2));
        return;
    }
    // Compact output
    console.log(`${card.id}`);
    console.log(`Type: ${card.type}`);
    console.log(`Title: ${card.title}`);
    if (card.status) {
        console.log(`Status: ${card.status}`);
    }
    if (directEdges.length === 0) {
        console.log('\nNo related nodes.');
        return;
    }
    const grouped = new Map();
    for (const edge of directEdges) {
        const isOut = edge.from_id === id;
        const targetId = isOut ? edge.to_id : edge.from_id;
        const targetCard = getCard(targetId);
        const targetTitle = targetCard ? targetCard.title : targetId;
        if (!grouped.has(edge.type)) {
            grouped.set(edge.type, []);
        }
        grouped.get(edge.type).push({
            targetId,
            targetTitle,
            direction: isOut ? 'out' : 'in',
            source: edge.source,
            confidence: edge.confidence,
        });
    }
    console.log('\nDirect Relations:');
    for (const [edgeType, targets] of grouped) {
        for (const t of targets) {
            const prefix = t.direction === 'in' ? '←' : '';
            const srcTag = t.source === 'inferred' ? ` [${t.source}, ${t.confidence.toFixed(1)}]` : '';
            console.log(`  ${prefix}${edgeType}: ${t.targetId} (${t.targetTitle})${srcTag}`);
        }
    }
    // BFS for multi-hop traversal when depth > 1
    if (depth > 1) {
        const visited = new Set([id]);
        let frontier = new Set();
        for (const edge of directEdges) {
            const neighborId = edge.from_id === id ? edge.to_id : edge.from_id;
            if (!visited.has(neighborId)) {
                visited.add(neighborId);
                frontier.add(neighborId);
            }
        }
        let totalExtendedEdges = 0;
        for (let hop = 1; hop < depth; hop++) {
            if (frontier.size === 0)
                break;
            const frontierArr = Array.from(frontier);
            const nextFrontier = new Set();
            const placeholders = frontierArr.map(() => '?').join(',');
            let edgeQuery = `SELECT * FROM edges WHERE (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`;
            const params = [...frontierArr, ...frontierArr];
            if (edgeTypeFilter) {
                edgeQuery += ' AND type = ?';
                params.push(edgeTypeFilter);
            }
            const hopEdges = db.prepare(edgeQuery).all(...params);
            totalExtendedEdges += hopEdges.length;
            for (const edge of hopEdges) {
                const neighborId = frontier.has(edge.from_id) ? edge.to_id : edge.from_id;
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    nextFrontier.add(neighborId);
                }
            }
            frontier = nextFrontier;
        }
        const totalReachable = visited.size - 1;
        if (totalReachable > 0) {
            console.log(`\nExtended Network (depth ${depth}):`);
            console.log(`  ${totalReachable} reachable node(s) via ${totalExtendedEdges + directEdges.length} edge(s) across all hops`);
        }
    }
}
function traceCommand(id) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id);
    if (!card) {
        console.log(`Node "${id}" not found in database.`);
        return;
    }
    console.log(`Trace for ${card.id}:`);
    console.log(`Type: ${card.type}`);
    console.log(`Title: ${card.title}`);
    console.log(`File: ${card.file_path}`);
    // Find evidence: decision and trace type cards connected via edges
    const evidenceRows = db.prepare(`
    SELECT DISTINCT c.id, c.type, c.title, c.file_path
    FROM edges e
    JOIN cards c ON (c.id = e.from_id OR c.id = e.to_id) AND c.id != ?
    WHERE (e.from_id = ? OR e.to_id = ?)
      AND (c.type = 'decision' OR c.type = 'trace')
      AND c.is_deleted = 0
  `).all(id, id, id);
    if (evidenceRows.length > 0) {
        console.log('');
        console.log('Evidence Sources:');
        for (const row of evidenceRows) {
            console.log(`  - ${row.id}: ${row.title}`);
            console.log(`    ${row.file_path}`);
        }
    }
    // Find depends_on chain
    const dependsOn = db.prepare(`
    SELECT e.to_id, c.title as to_title, e.source, e.confidence
    FROM edges e
    LEFT JOIN cards c ON c.id = e.to_id AND c.is_deleted = 0
    WHERE e.from_id = ? AND e.type = 'depends_on'
  `).all(id);
    if (dependsOn.length > 0) {
        console.log('\nDepends On:');
        for (const row of dependsOn) {
            const srcTag = row.source === 'inferred' ? ` [${row.source}, ${row.confidence.toFixed(1)}]` : '';
            console.log(`  - ${row.to_id}${row.to_title ? ` (${row.to_title})` : ''}${srcTag}`);
        }
    }
    // Find depended_by
    const dependedBy = db.prepare(`
    SELECT e.from_id, c.title as from_title, e.source, e.confidence
    FROM edges e
    LEFT JOIN cards c ON c.id = e.from_id AND c.is_deleted = 0
    WHERE e.to_id = ? AND e.type = 'depends_on'
  `).all(id);
    if (dependedBy.length > 0) {
        console.log('\nDepended On By:');
        for (const row of dependedBy) {
            const srcTag = row.source === 'inferred' ? ` [${row.source}, ${row.confidence.toFixed(1)}]` : '';
            console.log(`  - ${row.from_id}${row.from_title ? ` (${row.from_title})` : ''}${srcTag}`);
        }
    }
    // Read and display card body content
    const filePath = path.join(cwd, card.file_path);
    if ((0, fs_1.fileExists)(filePath)) {
        const content = (0, fs_1.readFile)(filePath);
        if (content) {
            const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
            if (bodyMatch) {
                console.log('\n--- Card Content ---');
                console.log(bodyMatch[1].trim().substring(0, 3000));
            }
        }
    }
}
//# sourceMappingURL=graph.js.map