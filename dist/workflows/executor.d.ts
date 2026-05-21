import { Task, WorkflowResult, WorkflowOptions, SingleResult } from "../types.js";
import { SpawnFunction } from "../agents/runner.js";
export interface ExecutorOptions {
    name: string;
    tasks?: Task[];
    plan?: string;
    options?: WorkflowOptions;
    runtime: {
        cwd: string;
    };
    onUpdate?: (update: {
        content: Array<{
            type: string;
            text: string;
        }>;
        details?: {
            mode: string;
            agentScope: string;
            projectAgentsDir: null;
            results: SingleResult[];
        };
    }) => void;
    signal?: AbortSignal;
    spawnFn?: SpawnFunction;
    defaultModel?: string;
}
export declare function executeWorkflow(opts: ExecutorOptions): Promise<WorkflowResult>;
//# sourceMappingURL=executor.d.ts.map