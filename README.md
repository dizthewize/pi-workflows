# pi-workflows

Dependency-aware multi-agent workflow execution for Pi. Define tasks with dependencies, files, and acceptance criteria. The runtime topologically sorts tasks into parallel waves, reserves files, tracks cost, and enforces review gates on code-producing tasks.

## Features

- **DAG execution** — Tasks with `dependsOn` are topologically sorted into waves. Independent tasks run in parallel.
- **File reservations** — Wave-level file locking prevents agent collisions.
- **Review gates** — Code-producing tasks get mandatory review by a reviewer agent. Supports `APPROVE`, `NEEDS_CHANGES`, and `CHALLENGE` verdicts with challenge cycles.
- **Cost tracking** — Budget limit (`maxCost`) with graceful shutdown.
- **Role dispatch** — Tasks can specify `roleId` to delegate to [pi-agent-roles](/pi-agent-roles).
- **Plan parsing** — Execute from structured TASK-XX markdown specs.
- **Mesh integration** — Optionally broadcast status to [pi-mesh](/pi-mesh).

## Install

```bash
pi package add pi-workflows
```

## Usage

### Direct task DAG

```typescript
execute_workflow({
  name: "auth-refactor",
  tasks: [
    { id: "types", prompt: "Create auth types", files: ["src/auth/types.ts"] },
    { id: "service", prompt: "Create auth service", files: ["src/auth/service.ts"], dependsOn: ["types"] },
    { id: "middleware", prompt: "Create middleware", files: ["src/middleware/auth.ts"], dependsOn: ["service"], gate: true }
  ],
  options: { maxParallel: 4, maxCost: 15 }
})
```

### From TASK-XX spec file

```typescript
execute_workflow({
  name: "auth-refactor",
  plan: "./spec.md",
  options: { maxParallel: 4, maxCost: 15 }
})
```

### Generate spec from PRD

```typescript
plan_workflow({
  input: "./session-manager-plan.md",
  output: "./spec.md",
  name: "session-manager"
})
```

Then execute:
```typescript
execute_workflow({
  name: "session-manager",
  plan: "./spec.md",
  options: { maxParallel: 4, maxCost: 20 }
})
```

### With pi-agent-roles

```typescript
execute_workflow({
  name: "security-audit",
  tasks: [
    { id: "audit", prompt: "Audit auth.ts", roleId: "security-auditor", files: ["src/auth.ts"] }
  ]
})
```

### With pi-mesh broadcast

```typescript
execute_workflow({
  name: "fullstack-build",
  tasks: [...],
  options: { meshPublish: true, meshName: "build-agent" }
})
```

## Task Format

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique task identifier |
| `prompt` | ✅ | What the agent should do |
| `files` | — | Files this task touches (triggers review gate) |
| `dependsOn` | — | Task IDs that must complete first |
| `gate` | — | Override review gate (`true` force review, `false` skip) |
| `roleId` | — | Delegate to pi-agent-roles role |
| `agent` | — | Agent name from team config |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxParallel` | 4 | Max concurrent workers |
| `maxCost` | 20 | Dollar budget limit |
| `maxDurationMs` | 1,200,000 | Max total runtime |
| `autoApproveGates` | false | Skip review gates (CI mode) |
| `reserveFiles` | true | Enable file reservations |
| `failFast` | false | Stop on first failure |
| `meshPublish` | false | Broadcast to pi-mesh |
| `meshName` | workflow name | Mesh agent name |

## TASK-XX Spec Format

```markdown
# Auth Refactor

Refactor authentication with JWT.

## TASK-01: Create auth types
Priority: P0
Files: src/auth/types.ts (create)
Depends on: none
Acceptance: Exports User, Session, Token interfaces

## TASK-02: Implement JWT utilities
Priority: P0
Files: src/auth/jwt.ts (create)
Depends on: TASK-01
Acceptance: signToken() and verifyToken() pass tests
```

## Review Gate Verdicts

When a code-producing task completes:

1. Reviewer agent spawned automatically
2. Verdict: `APPROVE` | `NEEDS_CHANGES` | `CHALLENGE`
3. `CHALLENGE` → worker receives feedback, fixes, resubmits (up to `maxChallengeCycles`, default 2)
4. `APPROVE` → task complete, wave continues

## Inline Dashboard

`/workflows` renders a live status block for all active workflows.

![pi-workflows dashboard](docs/dashboard.png)

```
Workflow: ws-sweetcrumb-build │ Wave 2/3 │ 2● 1✓ 0✗
Cost: $1.24 / $15.00 limit                    Elapsed: 3m 12s
──────────────────────────────────────────────────────────
Agent          File              Status    Dur      Cost
→ worker-3     menu.tsx          ● running 45s      $0.04
  worker-4     about.tsx         ○ waiting --       --
──────────────────────────────────────────────────────────
+45s  [worker-1] completed: task-t1
+12s  [worker-3] started: task-t3
──────────────────────────────────────────────────────────
Cost: worker-1 $0.08 | worker-2 $0.04 | worker-3 $0.04
```

| Command | Description |
|---------|-------------|
| `/workflows status` | Show all active workflows |
| `/workflows clear` | Remove stale snapshots |

Snapshots are written to `~/.pi/workflows/registry/<id>.json` every 250ms as agents progress.

## Inter-Extension Bridges

`pi-workflows` exposes EventBus endpoints for other extensions:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `workflows:plan:request` | in | Convert PRD file → TASK-XX spec file |
| `workflows:execute:request` | in | Run a workflow from tasks/plan |

On `execute`, if `pi-agent-roles` is available, workflows use `roles:dispatch:request` to spawn agents instead of local subprocesses.

**Used by:** `pi-dark-factory` (planning + execution cycle).

## Storage

Workflow state is persisted to `.pi/workflows/<name>/`:
- `config.json` — initial config
- `checkpoints/wave-N.json` — per-wave checkpoint
- `results/<task-id>/` — per-task artifacts
- `workflow-log-*.md` — human-readable log
