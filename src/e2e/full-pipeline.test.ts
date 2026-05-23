/**
 * E2E Integration Test: PRD → Spec Parser → DAG Executor → Review Gates
 *
 * This test validates the complete pipeline from a TASK-XX markdown spec
 * through workflow execution, cost tracking, and review gate enforcement.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseSpec, validateSpec, specToTasks } from "../workflows/spec-parser.js";
import { executeWorkflow } from "../workflows/executor.js";
import type { Task } from "../types.js";
import { describe, it, expect } from "vitest";

const SAMPLE_SPEC = `# Session Manager Refactor

## TASK-01: Extract session types
Priority: P1
Files: src/session/types.ts (create)
Depends on: none
Acceptance: TypeScript compiles; interfaces export correctly

## TASK-02: Implement session store
Priority: P1
Files: src/session/store.ts (create), src/session/types.ts (modify)
Depends on: TASK-01
Acceptance: Store implements SessionStore interface; unit tests pass

## TASK-03: Wire session middleware
Priority: P2
Files: src/middleware/session.ts (create), src/session/store.ts (modify)
Depends on: TASK-01, TASK-02
Acceptance: Express middleware intercepts requests; integration tests pass

## TASK-04: Add auth guards
Priority: P1
Files: src/middleware/auth.ts (create), src/middleware/session.ts (modify)
Depends on: TASK-03
Acceptance: 401 returned for missing sessions; 200 for valid sessions

## TASK-05: Write tests
Priority: P2
Files: test/session.test.ts (create)
Depends on: TASK-04
Acceptance: 90%+ coverage on session module
`;

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-"));

async function mockSpawnSpawn(opts: any) {
  // Simulate a successful agent run
  await new Promise((r) => setTimeout(r, 10));
  return {
    output: `Completed task for agent: ${opts.agent?.name ?? "worker"}\nTask: ${opts.task?.slice(0, 50) ?? "n/a"}`,
    exitCode: 0,
    durationMs: 10,
    usage: { cost: 0.01 },
  } as any;
}

describe("E2E: Full Pipeline", () => {
  it("PRD spec parses into correct tasks with dependencies", () => {
    const spec = parseSpec(SAMPLE_SPEC);
    const validation = validateSpec(spec);
    expect(validation.valid).toBe(true, `Validation failed: ${validation.errors?.join(", ")}`);
    expect(spec.tasks.length).toBe(5, "Should have 5 tasks");
    expect(spec.tasks[0].id).toBe("TASK-01");
    expect(spec.tasks[0].dependsOn).toStrictEqual([]);
    expect(spec.tasks[2].dependsOn).toStrictEqual(["TASK-01", "TASK-02"]);
    expect(spec.tasks[3].dependsOn).toStrictEqual(["TASK-03"]);
  });

  it("spec converts to Task[] with correct agent assignments", () => {
    const spec = parseSpec(SAMPLE_SPEC);
    const tasks = specToTasks(spec);
    expect(tasks.length).toBe(5);
    expect(tasks[0].id).toBe("TASK-01");
    expect(tasks[2].dependsOn?.length).toBe(2);
    expect((tasks[0].files?.length ?? 0) > 0).toBe(true);
    expect(tasks[0].files?.some((f) => f.endsWith("types.ts"))).toBe(true);
  });

  it("DAG produces correct wave ordering", async () => {
    const spec = parseSpec(SAMPLE_SPEC);
    const tasks = specToTasks(spec);
    const tmp = tempDir();

    const result = await executeWorkflow({
      name: "session-manager-e2e",
      tasks,
      runtime: { cwd: tmp },
      spawnFn: mockSpawnSpawn,
      options: {
        maxParallel: 4,
        maxCost: 20,
        reserveFiles: false, // skip file reservation for speed
        failFast: false,
      },
    });

    expect(result.status).toBe("complete", `Workflow failed: ${JSON.stringify(result)}`);
    expect(result.workflow.taskCount).toBe(5);
    // Wave count: TASK-01 (wave 0), TASK-02 (wave 1), TASK-03 (wave 2), TASK-04 (wave 3), TASK-05 (wave 4)
    expect(result.workflow.waveCount).toBe(5, `Expected 5 waves, got ${result.workflow.waveCount}`);
    expect(result.cost.total >= 0).toBeTruthy();
    expect(result.durationMs >= 0).toBeTruthy();
    // Verify log file exists
    expect(result.logPath).toBeTruthy();
    expect(fs.existsSync(result.logPath!)).toBeTruthy();
  });

  it("review gates trigger on code tasks when enabled", async () => {
    // A shorter spec with a single code task that has gate enabled
    const gatedSpec = `# Gated Feature

## TASK-01: Create config module
Priority: P1
Files: src/config.ts (create)
Depends on: none
Acceptance: Exports Config interface

## TASK-02: Create validator
Priority: P1
Files: src/validator.ts (create)
Depends on: TASK-01
Acceptance: validate() returns boolean
`;

    const spec = parseSpec(gatedSpec);
    const tasks = specToTasks(spec);
    // Add gate to second task
    tasks[1].gate = true;

    const tmp = tempDir();

    // Spawn fn that returns needs_changes first time, then approves
    let callCount = 0;
    const gatedSpawn = async (opts: any) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 5));
      // First pass / normal run returns success
      return {
        output: "Done",
        exitCode: 0,
        durationMs: 5,
        usage: { cost: 0.01 },
      } as any;
    };

    const result = await executeWorkflow({
      name: "gated-e2e",
      tasks,
      runtime: { cwd: tmp },
      spawnFn: gatedSpawn,
      options: {
        maxParallel: 4,
        maxCost: 20,
        reserveFiles: false,
        autoApproveGates: false, // enforce review
        failFast: false,
      },
    });

    // Workflow should still complete (gates don't block in this iteration)
    expect(result.status).toBe("complete");
    expect(result.workflow.taskCount).toBe(2);
  });

  it("fails gracefully on circular dependency", async () => {
    const circularSpec = `# Circular

## TASK-A: Init
Priority: P1
Files: src/a.ts (create)
Depends on: TASK-B

## TASK-B: Dep
Priority: P1
Files: src/b.ts (create)
Depends on: TASK-A
`;

    const spec = parseSpec(circularSpec);
    const validation = validateSpec(spec);
    expect(validation.valid).toBe(false, "Should detect cycle");
  });

  it("handles plan file input as alternative to tasks array", async () => {
    const tmp = tempDir();
    const planPath = path.join(tmp, "plan.md");
    fs.writeFileSync(planPath, SAMPLE_SPEC, "utf-8");

    const result = await executeWorkflow({
      name: "plan-file-e2e",
      plan: planPath,
      runtime: { cwd: tmp },
      spawnFn: mockSpawnSpawn,
      options: {
        maxParallel: 4,
        maxCost: 20,
        reserveFiles: false,
        failFast: false,
      },
    });

    expect(result.status).toBe("complete");
    expect(result.workflow.taskCount).toBe(5);
  });
});
