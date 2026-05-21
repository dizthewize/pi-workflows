import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { CostTracker } from "./cost-tracker.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("CostTracker", () => {
  let tmp: string;
  let tracker: CostTracker;

  beforeEach(() => {
    tmp = mkTmpDir("cost-test-");
    tracker = new CostTracker(tmp, 5.0);
  });

  afterEach(() => {
    rmTmpDir(tmp);
  });

  it("starts at zero", () => {
    assert.strictEqual(tracker.exceeded(), false);
    assert.strictEqual(tracker.summary().total, 0);
  });

  it("accumulates cost by phase", () => {
    tracker.add(1.2, "wave-0");
    tracker.add(0.8, "wave-1");
    assert.strictEqual(tracker.summary().total, 2.0);
    assert.strictEqual(tracker.summary().byPhase["wave-0"], 1.2);
    assert.strictEqual(tracker.summary().byPhase["wave-1"], 0.8);
  });

  it("returns true at limit", () => {
    tracker.add(5.0, "wave-0");
    assert.strictEqual(tracker.exceeded(), true);
  });

  it("stays false just below limit", () => {
    tracker.add(4.99, "wave-0");
    assert.strictEqual(tracker.exceeded(), false);
  });

  it("persists to disk and reloads", () => {
    tracker.add(2.5, "wave-0");
    const tracker2 = new CostTracker(tmp, 5.0);
    assert.strictEqual(tracker2.summary().total, 2.5);
    assert.strictEqual(tracker2.summary().byPhase["wave-0"], 2.5);
  });
});
