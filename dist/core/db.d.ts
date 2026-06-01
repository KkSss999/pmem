import Database from 'better-sqlite3';
import type { EdgeRow } from '../types';
export declare function openDatabase(pmemPath: string): Database.Database;
export declare function closeDatabase(): void;
export declare function getDatabase(): Database.Database | null;
export declare function createSchema(db: Database.Database): void;
export declare function hasFTS5(db: Database.Database): boolean;
export declare function createFTS5(db: Database.Database): void;
export declare function getSchemaVersion(db: Database.Database): string | null;
export declare function setSchemaVersion(db: Database.Database, version: string): void;
export declare function upsertCard(db: Database.Database, card: import('../types').CardRow): void;
export declare function deleteCardEdges(db: Database.Database, cardId: string): void;
export declare function deleteExplicitCardEdges(db: Database.Database, cardId: string): void;
export declare function insertEdge(db: Database.Database, edge: import('../types').EdgeRow): void;
export declare function deleteCardAliases(db: Database.Database, cardId: string): void;
export declare function insertAlias(db: Database.Database, cardId: string, alias: string, language?: string): void;
export declare function deleteCardTags(db: Database.Database, cardId: string): void;
export declare function insertTag(db: Database.Database, cardId: string, tag: string): void;
export declare function deleteCardPaths(db: Database.Database, cardId: string): void;
export declare function insertPath(db: Database.Database, cardId: string, filePath: string, relation: string): void;
export declare function clearAllTables(db: Database.Database): void;
export declare function getCardHash(db: Database.Database, filePath: string): {
    file_hash: string;
    frontmatter_hash: string;
    body_hash: string;
} | null;
export declare function insertDirtyFlag(db: Database.Database, scope: string, target: string, reason: string, sessionId?: string): void;
export declare function resolveDirtyFlags(db: Database.Database, scope?: string, target?: string): number;
export declare function getUnresolvedDirtyFlags(db: Database.Database): Array<{
    scope: string;
    target: string;
    reason: string;
    created_at: string;
}>;
export interface DirtyFlagDetailed {
    id: number;
    scope: string;
    target: string;
    reason: string;
    created_at: string;
    session_id: string | null;
}
export declare function getUnresolvedDirtyFlagsDetailed(db: Database.Database): DirtyFlagDetailed[];
export declare function startSession(db: Database.Database, id: string, agentName?: string): void;
export declare function endSession(db: Database.Database, id: string, status?: string, taskSummary?: string): void;
export declare function getActiveSession(db: Database.Database): {
    id: string;
    agent_name: string | null;
    started_at: string;
} | null;
export declare function insertUpdateLog(db: Database.Database, action: string, summary?: string, sessionId?: string, affectedCards?: string[], success?: boolean, error?: string): void;
export declare function getRecentUpdateLogs(db: Database.Database, limit?: number): Array<{
    action: string;
    summary: string | null;
    created_at: string;
    success: number;
}>;
export declare function deleteInferredEdges(db: Database.Database): number;
export declare function getInferredEdges(db: Database.Database): EdgeRow[];
export declare function getEdgesForCard(db: Database.Database, cardId: string, source?: 'explicit' | 'inferred' | 'mention'): EdgeRow[];
export declare function updateEdgeSource(db: Database.Database, edgeIds: number[], newSource: 'explicit' | 'inferred', newConfidence: number): number;
export declare function deleteEdgesByIds(db: Database.Database, edgeIds: number[]): number;
export declare function getOrphanEdges(db: Database.Database): EdgeRow[];
//# sourceMappingURL=db.d.ts.map