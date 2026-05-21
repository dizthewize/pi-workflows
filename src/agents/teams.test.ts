import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAgentTeam, resolveAgentConfig } from "./teams.js";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("loadAgentTeam", () => {
  it("returns default team with worker and reviewer", () => {
    const team = loadAgentTeam(undefined, "/nonexistent");
    assert.ok(team.worker);
    assert.ok(team.reviewer);
    assert.strictEqual(team.worker.model, null);
    assert.strictEqual(team.reviewer.thinking, "high");
    assert.deepStrictEqual(team.reviewer.tools, ["read", "diff"]);
  });

  it("loads custom team from cwd/.pi/workflows/teams/", () => {
    const tmp = mkTmpDir("teams-test-");
    try {
      fs.mkdirSync(path.join(tmp, ".pi", "workflows", "teams"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".pi", "workflows", "teams", "web.json"),
        JSON.stringify({
          worker: { model: "custom-model", tools: ["read"] },
          api: { model: "api-model", thinking: "medium" },
        })
      );
      const team = loadAgentTeam("web", tmp);
      assert.strictEqual(team.worker.model, "custom-model");
      assert.deepStrictEqual(team.worker.tools, ["read"]);
      assert.strictEqual(team.api?.model, "api-model");
      assert.strictEqual(team.api?.thinking, "medium");
    } finally {
      rmTmpDir(tmp);
    }
  });
});

describe("resolveAgentConfig", () => {
  it("returns requested role", () => {
    const team = loadAgentTeam(undefined, "/tmp");
    const cfg = resolveAgentConfig("reviewer", team);
    assert.strictEqual(cfg.name, "reviewer");
    assert.strictEqual(cfg.thinking, "high");
  });

  it("falls back to worker for unknown role", () => {
    const team = loadAgentTeam(undefined, "/tmp");
    const cfg = resolveAgentConfig("does-not-exist", team);
    assert.strictEqual(cfg.name, "worker");
  });
});
