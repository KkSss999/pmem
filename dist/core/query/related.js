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
exports.relatedQuery = relatedQuery;
const path = __importStar(require("path"));
const fs_1 = require("../fs");
const db_1 = require("../db");
function relatedQuery(pmemPath, id, options) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        throw new Error('No SQLite database found. Run `pmem rebuild` first.');
    }
    const edgeTypeFilter = options?.type;
    const sourceFilter = (options?.source && options.source !== 'all')
        ? options.source
        : undefined;
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id);
    if (!card) {
        throw new Error(`Node "${id}" not found in database.`);
    }
    let directEdges = (0, db_1.getEdgesForCard)(db, id, sourceFilter);
    if (edgeTypeFilter) {
        directEdges = directEdges.filter(e => e.type === edgeTypeFilter);
    }
    const getCard = (cardId) => {
        return db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(cardId);
    };
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
            target_type: targetCard?.type ?? 'unknown',
            target_status: targetCard?.status ?? null,
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
    return {
        card: {
            id: card.id,
            type: card.type,
            title: card.title,
            status: card.status,
            file: card.file_path,
        },
        total_edges: directEdges.length,
        edges_by_type: edgesByType,
        high_confidence: highConfidence,
        needs_review: needsReview,
    };
}
//# sourceMappingURL=related.js.map