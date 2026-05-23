import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAgentTeam, resolveAgentConfig } from "./teams.js";
import { describe, it, expect } from "vitest";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("loadAgentTeam", () => {
  it("returns default team with worker and reviewer", () => {
    const team = loadAgentTeam(undefined, "/nonexistent");
    expect(team.worker).toBeTruthy();
    expect(team.reviewer).toBeTruthy();
    expect(team.worker.model).toBe(null);
    expect(team.reviewer.thinking).toBe("high");
    expect(team.reviewer.tools).toStrictEqual(["read", "diff"]);
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
      expect(team.worker.model).toBe("custom-model");
      expect(team.worker.tools).toStrictEqual(["read"]);
      expect(team.api?.model).toBe("api-model");
      expect(team.api?.thinking).toBe("medium");
    } finally {
      rmTmpDir(tmp);
    }
  });
});

describe("resolveAgentConfig", () => {
  it("returns requested role", () => {
    const team = loadAgentTeam(undefined, "/tmp");
    const cfg = resolveAgentConfig("reviewer", team);
    expect(cfg.name).toBe("reviewer");
    expect(cfg.thinking).toBe("high");
  });

  it("falls back to worker for unknown role", () => {
    const team = loadAgentTeam(undefined, "/tmp");
    const cfg = resolveAgentConfig("does-not-exist", team);
    expect(cfg.name).toBe("worker");
  });
});
