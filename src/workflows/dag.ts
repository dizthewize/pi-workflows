import { Task, TaskConfig, Wave } from "../types.js";

export interface DAG {
  tasks: Map<string, TaskConfig>;
  edges: Map<string, Set<string>>;
  roots: Set<string>;
}

export function parseDAG(tasks: Task[]): DAG {
  const taskMap = new Map<string, TaskConfig>();
  const edges = new Map<string, Set<string>>();
  const roots = new Set<string>();

  for (const t of tasks) {
    const config: TaskConfig = {
      ...t,
      status: "pending",
      dependsOn: t.dependsOn ?? [],
      files: t.files ?? [],
      agent: t.agent ?? "worker",
      reviewAgent: t.reviewAgent ?? "reviewer",
      maxChallengeCycles: t.maxChallengeCycles ?? 2,
    };
    taskMap.set(t.id, config);
    edges.set(t.id, new Set(t.dependsOn ?? []));
  }

  for (const [id, config] of taskMap) {
    if ((config.dependsOn ?? []).length === 0) {
      roots.add(id);
    }
  }

  return { tasks: taskMap, edges, roots };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDAG(dag: DAG): ValidationResult {
  const seen = new Set<string>();

  for (const [id, config] of dag.tasks) {
    // Self-reference check
    if ((config.dependsOn ?? []).includes(id)) {
      return { valid: false, error: `Task "${id}" depends on itself` };
    }

    // Missing dependency check
    for (const dep of config.dependsOn ?? []) {
      if (!dag.tasks.has(dep)) {
        return { valid: false, error: `Task "${id}" depends on "${dep}" which does not exist` };
      }
    }
  }

  // Cycle detection (DFS with recursion stack)
  const color = new Map<string, "white" | "gray" | "black">();
  for (const id of dag.tasks.keys()) color.set(id, "white");

  function visit(nodeId: string): string | null {
    color.set(nodeId, "gray");
    const deps = dag.edges.get(nodeId) ?? new Set();
    for (const dep of deps) {
      if (color.get(dep) === "gray") {
        return `Cycle detected involving "${dep}"`;
      }
      if (color.get(dep) === "white") {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    color.set(nodeId, "black");
    return null;
  }

  for (const id of dag.tasks.keys()) {
    if (color.get(id) === "white") {
      const cycle = visit(id);
      if (cycle) {
        return { valid: false, error: cycle };
      }
    }
  }

  return { valid: true };
}

export function topoSortWaves(tasks: Task[]): Wave[] {
  if (tasks.length === 0) return [];

  const dag = parseDAG(tasks);
  const validation = validateDAG(dag);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const remaining = new Map(dag.tasks);
  const completed = new Set<string>();
  const waves: Wave[] = [];

  while (remaining.size > 0) {
    const ready: TaskConfig[] = [];
    for (const [id, t] of remaining) {
      const deps = t.dependsOn ?? [];
      const allDone = deps.every((dep) => completed.has(dep));
      if (allDone) {
        ready.push(t);
      }
    }

    if (ready.length === 0) {
      const ids = Array.from(remaining.keys()).join(", ");
      throw new Error(`Wave scheduling deadlock: unscheduled tasks [${ids}]`);
    }

    waves.push({ index: waves.length, tasks: ready });
    for (const t of ready) {
      completed.add(t.id);
      remaining.delete(t.id);
    }
  }

  return waves;
}

export function getTaskDependencies(taskId: string, dag: DAG): Set<string> {
  return dag.edges.get(taskId) ?? new Set();
}
