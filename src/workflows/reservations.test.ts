import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  acquireWaveReservations,
  releaseReservations,
  listAllReservations,
} from "./reservations.js";
import { Wave } from "../types.js";
import { describe, it, expect } from "vitest";

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
    expect(reserved.has("src/a.ts")).toBe(true);
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
    expect(reserved.has("src/a.ts")).toBe(true);
    expect(reserved.has("src/b.ts")).toBe(true);
  });

  it("throws on file collision", async () => {
    await acquireWaveReservations(
      { index: 0, tasks: [{ id: "t1", prompt: "a", files: ["src/a.ts"] }] },
      tmp
    );
    await expect(acquireWaveReservations(
        { index: 1, tasks: [{ id: "t2", prompt: "b", files: ["src/a.ts"] }] },
        tmp
      )).rejects.toThrow(/collision/);
  });

  it("releases reservations by task id", async () => {
    await acquireWaveReservations(
      { index: 0, tasks: [{ id: "t1", prompt: "a", files: ["src/a.ts"] }] },
      tmp
    );
    await releaseReservations(tmp, ["t1"]);
    const reserved = await listAllReservations(tmp);
    expect(reserved.has("src/a.ts")).toBe(false);
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
    expect(meta.agent).toBe("custom-role");
    expect(meta.ttl > 0).toBe(true);
    expect(meta.claimedAt > 0).toBe(true);
  });
});
