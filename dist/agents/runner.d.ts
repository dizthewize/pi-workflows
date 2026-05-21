import { AgentConfig, SingleResult, OnUpdateCallback, OutputLimits } from "../types.js";
export type SpawnFunction = (options: SpawnOptions) => Promise<SingleResult>;
export interface SpawnOptions {
    cwd: string;
    agent: AgentConfig;
    task: string;
    signal?: AbortSignal;
    onUpdate?: OnUpdateCallback;
    useSubprocess?: boolean;
    extensions?: string[];
    attachments?: string[];
    outputLimits?: OutputLimits;
    artifactsDir?: string;
    artifactLabel?: string;
    customTools?: unknown[];
}
export interface RunSingleAgentOptions {
    cwd: string;
    agent: AgentConfig;
    task: string;
    signal?: AbortSignal;
    onUpdate?: OnUpdateCallback;
    outputLimits?: OutputLimits;
    artifactsDir?: string;
    artifactLabel?: string;
    extensions?: string[];
    attachments?: string[];
    spawnFn?: SpawnFunction;
}
export declare function runSingleAgent(options: RunSingleAgentOptions): Promise<SingleResult>;
//# sourceMappingURL=runner.d.ts.map