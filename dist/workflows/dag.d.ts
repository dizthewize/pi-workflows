import { Task, TaskConfig, Wave } from "../types.js";
export interface DAG {
    tasks: Map<string, TaskConfig>;
    edges: Map<string, Set<string>>;
    roots: Set<string>;
}
export declare function parseDAG(tasks: Task[]): DAG;
export interface ValidationResult {
    valid: boolean;
    error?: string;
}
export declare function validateDAG(dag: DAG): ValidationResult;
export declare function topoSortWaves(tasks: Task[]): Wave[];
export declare function getTaskDependencies(taskId: string, dag: DAG): Set<string>;
//# sourceMappingURL=dag.d.ts.map