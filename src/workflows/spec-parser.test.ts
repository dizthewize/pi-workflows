import { describe, it } from "node:test";
import assert from "node:assert";
import { parseSpec, validateSpec, specToTasks } from "./spec-parser.js";

describe("parseSpec", () => {
  it("parses a full spec with tasks", () => {
    const md = `
# Authentication Implementation

Refactor auth with JWT.

## TASK-01: Create auth types
Priority: P0
Files: src/auth/types.ts (create)
Depends on: none
Acceptance: Exports User, Session, Token interfaces

## TASK-02: Implement JWT utilities
Priority: P1
Files: src/auth/jwt.ts (create)
Depends on: TASK-01
Acceptance: signToken() and verifyToken() functions work

## TASK-03: Create auth middleware
Priority: P2
Files: src/middleware/auth.ts (create)
Depends on: TASK-02
Acceptance: Middleware validates JWT from cookies
`;
    const spec = parseSpec(md);
    assert.strictEqual(spec.title, "Authentication Implementation");
    assert.ok(spec.description?.includes("Refactor auth with JWT"));
    assert.strictEqual(spec.tasks.length, 3);

    const t1 = spec.tasks[0];
    assert.strictEqual(t1.id, "TASK-01");
    assert.strictEqual(t1.title, "Create auth types");
    assert.strictEqual(t1.priority, "P0");
    assert.deepStrictEqual(t1.files, [{ path: "src/auth/types.ts", action: "create" }]);
    assert.deepStrictEqual(t1.dependsOn, []);
    assert.strictEqual(t1.acceptance, "Exports User, Session, Token interfaces");

    const t2 = spec.tasks[1];
    assert.strictEqual(t2.id, "TASK-02");
    assert.deepStrictEqual(t2.dependsOn, ["TASK-01"]);
  });

  it("parses multi-line acceptance", () => {
    const md = `
## TASK-04: API contract
Acceptance: Must define:
- GET /users endpoint
- POST /users endpoint
`;
    const spec = parseSpec(md);
    const t = spec.tasks[0];
    assert.ok(t.acceptance.includes("Must define:"));
    assert.ok(t.acceptance.includes("- GET /users endpoint"));
  });

  it("parses modify and delete file annotations", () => {
    const md = `
## TASK-05: Update routes
Files: src/routes.ts (modify), src/old.ts (delete)
Depends on: none
Acceptance: Routes updated
`;
    const spec = parseSpec(md);
    const t = spec.tasks[0];
    assert.deepStrictEqual(t.files, [
      { path: "src/routes.ts", action: "modify" },
      { path: "src/old.ts", action: "delete" },
    ]);
  });

  it("detects subtask parent", () => {
    const md = `
## TASK-06: Parent
Priority: P1
Depends on: none

## TASK-06.1: Subtask
Depends on: TASK-06
Acceptance: Subtask done
`;
    const spec = parseSpec(md);
    const sub = spec.tasks.find((t) => t.id === "TASK-06.1");
    assert.strictEqual(sub?.parentTaskId, "TASK-06");
  });
});

describe("validateSpec", () => {
  it("validates good spec", () => {
    const md = `
## TASK-01: Types
Files: src/types.ts (create)
Depends on: none
Acceptance: Exports interfaces

## TASK-02: Service
Files: src/service.ts (create)
Depends on: TASK-01
Acceptance: Works
`;
    const spec = parseSpec(md);
    const result = validateSpec(spec);
    assert.strictEqual(result.valid, true);
  });

  it("fails on circular dependency", () => {
    const spec = parseSpec(`
## TASK-01: A
Depends on: TASK-02

## TASK-02: B
Depends on: TASK-01
`);
    const result = validateSpec(spec);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Circular")));
  });

  it("fails on missing dependency", () => {
    const spec = parseSpec(`
## TASK-01: A
Depends on: TASK-99
`);
    const result = validateSpec(spec);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("non-existent")));
  });

  it("fails on no entry point", () => {
    const spec = parseSpec(`
## TASK-01: A
Depends on: TASK-02

## TASK-02: B
Depends on: TASK-01
`);
    const result = validateSpec(spec);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("entry point")));
  });
});

describe("specToTasks", () => {
  it("converts spec to workflow tasks", () => {
    const spec = parseSpec(`
## TASK-01: Create types
Files: src/types.ts (create)
Depends on: none
Acceptance: Exports interfaces
`);
    const tasks = specToTasks(spec);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].id, "TASK-01");
    assert.deepStrictEqual(tasks[0].files, ["src/types.ts"]);
    assert.strictEqual(tasks[0].gate, true);
  });
});
