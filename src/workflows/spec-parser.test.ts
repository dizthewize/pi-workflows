import { parseSpec, validateSpec, specToTasks } from "./spec-parser.js";
import { describe, it, expect } from "vitest";

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
    expect(spec.title).toBe("Authentication Implementation");
    expect(spec.description?.includes("Refactor auth with JWT")).toBe(true);
    expect(spec.tasks.length).toBe(3);

    const t1 = spec.tasks[0];
    expect(t1.id).toBe("TASK-01");
    expect(t1.title).toBe("Create auth types");
    expect(t1.priority).toBe("P0");
    expect(t1.files).toStrictEqual([{ path: "src/auth/types.ts", action: "create" }]);
    expect(t1.dependsOn).toStrictEqual([]);
    expect(t1.acceptance).toBe("Exports User, Session, Token interfaces");

    const t2 = spec.tasks[1];
    expect(t2.id).toBe("TASK-02");
    expect(t2.dependsOn).toStrictEqual(["TASK-01"]);
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
    expect(t.acceptance.includes("Must define:")).toBe(true);
    expect(t.acceptance.includes("- GET /users endpoint")).toBe(true);
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
    expect(t.files).toStrictEqual([
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
    expect(sub?.parentTaskId).toBe("TASK-06");
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
    expect(result.valid).toBe(true);
  });

  it("fails on circular dependency", () => {
    const spec = parseSpec(`
## TASK-01: A
Depends on: TASK-02

## TASK-02: B
Depends on: TASK-01
`);
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Circular"))).toBe(true);
  });

  it("fails on missing dependency", () => {
    const spec = parseSpec(`
## TASK-01: A
Depends on: TASK-99
`);
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-existent"))).toBe(true);
  });

  it("fails on no entry point", () => {
    const spec = parseSpec(`
## TASK-01: A
Depends on: TASK-02

## TASK-02: B
Depends on: TASK-01
`);
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("entry point"))).toBe(true);
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
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe("TASK-01");
    expect(tasks[0].files).toStrictEqual(["src/types.ts"]);
    expect(tasks[0].gate).toBe(true);
  });
});
