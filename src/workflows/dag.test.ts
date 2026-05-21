import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDAG, validateDAG, topoSortWaves } from "./dag.js";
import { Task } from "../types.js";

describe("parseDAG", () => {
  it("parses tasks with empty dependsOn", () => {
    const tasks: Task[] = [
      { id: "t1", prompt: "a" },
      { id: "t2", prompt: "b" },
    ];
    const dag = parseDAG(tasks);
    assert.strictEqual(dag.tasks.size, 2);
    assert.ok(dag.roots.has("t1"));
    assert.ok(dag.roots.has("t2"));
  });

  it("parses tasks with dependencies", () => {
    const tasks: Task[] = [
      { id: "t1", prompt: "a" },
      { id: "t2", prompt: "b", dependsOn: ["t1"] },
    ];
    const dag = parseDAG(tasks);
    assert.deepStrictEqual(
      dag.edges.get("t2"),
      new Set(["t1"])
    );
    assert.ok(!dag.roots.has("t2"));
  });
});

describe("validateDAG", () => {
  it("passes for valid acyclic graph", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
    ]);
    assert.strictEqual(validateDAG(dag).valid, true);
  });

  it("fails on self-referencing task", () => {
    const dag = parseDAG([{ id: "a", prompt: "1", dependsOn: ["a"] }]);
    const v = validateDAG(dag);
    assert.strictEqual(v.valid, false);
    assert.match(v.error ?? "", /depends on itself/);
  });

  it("fails on missing dependency", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1", dependsOn: ["ghost"] },
    ]);
    const v = validateDAG(dag);
    assert.strictEqual(v.valid, false);
    assert.match(v.error ?? "", /ghost/);
  });

  it("detects A→B→C→A cycle", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1", dependsOn: ["c"] },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["b"] },
    ]);
    const v = validateDAG(dag);
    assert.strictEqual(v.valid, false);
    assert.match(v.error ?? "", /cycle/i);
  });

  it("allows diamond dependency", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["a"] },
      { id: "d", prompt: "4", dependsOn: ["b", "c"] },
    ]);
    assert.strictEqual(validateDAG(dag).valid, true);
  });
});

describe("topoSortWaves", () => {
  it("puts independent tasks in wave 0", () => {
    const waves = topoSortWaves([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2" },
    ]);
    assert.strictEqual(waves.length, 1);
    assert.strictEqual(waves[0].tasks.length, 2);
  });

  it("chains sequential tasks across waves", () => {
    const waves = topoSortWaves([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["b"] },
    ]);
    assert.strictEqual(waves.length, 3);
    assert.deepStrictEqual(
      waves.map((w) => w.tasks.map((t) => t.id)),
      [["a"], ["b"], ["c"]]
    );
  });

  it("groups parallel-ready tasks in same wave", () => {
    const waves = topoSortWaves([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["a"] },
      { id: "d", prompt: "4", dependsOn: ["b", "c"] },
    ]);
    assert.strictEqual(waves.length, 3);
    assert.deepStrictEqual(
      waves.map((w) => w.tasks.map((t) => t.id)),
      [["a"], ["b", "c"], ["d"]]
    );
  });

  it("throws on cycle", () => {
    assert.throws(() => {
      topoSortWaves([
        { id: "a", prompt: "1", dependsOn: ["b"] },
        { id: "b", prompt: "2", dependsOn: ["a"] },
      ]);
    }, /cycle/i);
  });
});
