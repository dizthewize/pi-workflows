export function parseDAG(tasks) {
    const taskMap = new Map();
    const edges = new Map();
    const roots = new Set();
    for (const t of tasks) {
        const config = {
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
export function validateDAG(dag) {
    const seen = new Set();
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
    const color = new Map();
    for (const id of dag.tasks.keys())
        color.set(id, "white");
    function visit(nodeId) {
        color.set(nodeId, "gray");
        const deps = dag.edges.get(nodeId) ?? new Set();
        for (const dep of deps) {
            if (color.get(dep) === "gray") {
                return `Cycle detected involving "${dep}"`;
            }
            if (color.get(dep) === "white") {
                const cycle = visit(dep);
                if (cycle)
                    return cycle;
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
export function topoSortWaves(tasks) {
    if (tasks.length === 0)
        return [];
    const dag = parseDAG(tasks);
    const validation = validateDAG(dag);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    const remaining = new Map(dag.tasks);
    const completed = new Set();
    const waves = [];
    while (remaining.size > 0) {
        const ready = [];
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
export function getTaskDependencies(taskId, dag) {
    return dag.edges.get(taskId) ?? new Set();
}
//# sourceMappingURL=dag.js.map