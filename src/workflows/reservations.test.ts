import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  acquireWaveReservations,
  releaseReservations,
  listAllReservations,
} from "./reservations.js";
import { Wave } from "../types.js";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("file reservations", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmpDir("reservations-test-");
  });

  afterEach(() => {
    rmTmpDir(tmp);
  });

  it("acquires reservation for a single task", async () => {
    await acquireWaveReservations(
      { index: 0, tasks: [{ id: "t1", prompt: "a", files: ["src/a.ts"] }] },
      tmp
    );
    const reserved = await listAllReservations(tmp);
    assert.strictEqual(reserved.has("src/a.ts"), true);
  });

  it("acquires multiple files in same wave", async () => {
    await acquireWaveReservations(
      {
        index: 0,
        tasks: [
          { id: "t1", prompt: "a", files: ["src/a.ts"] },
          { id: "t2", prompt: "b", files: ["src/b.ts"] },
        ],
      },
      tmp
    );
    const reserved = await listAllReservations(tmp);
    assert.strictEqual(reserved.has("src/a.ts"), true);
    assert.strictEqual(reserved.has("src/b.ts"), true);
  });

  it("throws on file collision", async () => {
    await acquireWaveReservations(
      { index: 0, tasks: [{ id: "t1", prompt: "a", files: ["src/a.ts"] }] },
      tmp
    );
    await assert.rejects(
      acquireWaveReservations(
        { index: 1, tasks: [{ id: "t2", prompt: "b", files: ["src/a.ts"] }] },
        tmp
      ),
      /collision/
    );
  });

  it("releases reservations by task id", async () => {
    await acquireWaveReservations(
      { index: 0, tasks: [{ id: "t1", prompt: "a", files: ["src/a.ts"] }] },
      tmp
    );
    await releaseReservations(tmp, ["t1"]);
    const reserved = await listAllReservations(tmp);
    assert.strictEqual(reserved.has("src/a.ts"), false);
  });

  it("stores TTL and agent metadata", async () => {
    await acquireWaveReservations(
      {
        index: 0,
        tasks: [
          { id: "t1", prompt: "a", files: ["src/a.ts"], agent: "custom-role" },
        ],
      },
      tmp
    );
    const metaPath = path.join(tmp, "reservations", "t1.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    assert.strictEqual(meta.agent, "custom-role");
    assert.ok(meta.ttl > 0);
    assert.ok(meta.claimedAt > 0);
  });
});
