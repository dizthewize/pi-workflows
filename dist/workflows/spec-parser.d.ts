/**
 * Spec Parser - Parse TASK-XX format markdown into pi-workflows Task[] DAG.
 *
 * Supports standard TASK-XX format from pi-coordination:
 *   ## TASK-01: Create auth types
 *   Priority: P1
 *   Files: src/auth/types.ts (create), src/other.ts (modify)
 *   Depends on: none
 *   Acceptance: Exports User, Session, Token interfaces
 *
 * Optional detailed description (free text after acceptance).
 */
import { Task } from "../types.js";
/** Valid task ID patterns. */
export declare const TASK_ID_PATTERNS: {
    taskMain: RegExp;
    taskSub: RegExp;
    any: RegExp;
    header: RegExp;
};
/** File action annotation for contract-first builds. */
export type FileAction = "create" | "modify" | "delete";
export interface SpecFile {
    path: string;
    action?: FileAction;
}
export interface SpecTask {
    id: string;
    title: string;
    priority: "P0" | "P1" | "P2" | "P3";
    files: SpecFile[];
    dependsOn: string[];
    acceptance: string;
    description?: string;
    parentTaskId?: string;
}
export interface Spec {
    title: string;
    description?: string;
    tasks: SpecTask[];
    context?: string;
}
export declare function parseSpec(markdown: string): Spec;
export declare function validateSpec(spec: Spec): {
    valid: boolean;
    errors: string[];
    warnings: string[];
};
/** Convert a Spec to pi-workflows Task[]. */
export declare function specToTasks(spec: Spec): Task[];
//# sourceMappingURL=spec-parser.d.ts.map