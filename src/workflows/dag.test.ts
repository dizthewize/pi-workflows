import { parseDAG, validateDAG, topoSortWaves } from "./dag.js";
import { Task } from "../types.js";
import { describe, it, expect } from "vitest";

describe("parseDAG", () => {
  it("parses tasks with empty dependsOn", () => {
    const tasks: Task[] = [
      { id: "t1", prompt: "a" },
      { id: "t2", prompt: "b" },
    ];
    const dag = parseDAG(tasks);
    expect(dag.tasks.size).toBe(2);
    expect(dag.roots.has("t1")).toBe(true);
    expect(dag.roots.has("t2")).toBe(true);
  });

  it("parses tasks with dependencies", () => {
    const tasks: Task[] = [
      { id: "t1", prompt: "a" },
      { id: "t2", prompt: "b", dependsOn: ["t1"] },
    ];
    const dag = parseDAG(tasks);
    expect(dag.edges.get("t2")).toStrictEqual(new Set(["t1"]));
    expect(!dag.roots.has("t2")).toBe(true);
  });
});

describe("validateDAG", () => {
  it("passes for valid acyclic graph", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
    ]);
    expect(validateDAG(dag).valid).toBe(true);
  });

  it("fails on self-referencing task", () => {
    const dag = parseDAG([{ id: "a", prompt: "1", dependsOn: ["a"] }]);
    const v = validateDAG(dag);
    expect(v.valid).toBe(false);
    expect(v.error ?? "").toMatch(/depends on itself/);
  });

  it("fails on missing dependency", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1", dependsOn: ["ghost"] },
    ]);
    const v = validateDAG(dag);
    expect(v.valid).toBe(false);
    expect(v.error ?? "").toMatch(/ghost/);
  });

  it("detects A→B→C→A cycle", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1", dependsOn: ["c"] },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["b"] },
    ]);
    const v = validateDAG(dag);
    expect(v.valid).toBe(false);
    expect(v.error ?? "").toMatch(/cycle/i);
  });

  it("allows diamond dependency", () => {
    const dag = parseDAG([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["a"] },
      { id: "d", prompt: "4", dependsOn: ["b", "c"] },
    ]);
    expect(validateDAG(dag).valid).toBe(true);
  });
});

describe("topoSortWaves", () => {
  it("puts independent tasks in wave 0", () => {
    const waves = topoSortWaves([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2" },
    ]);
    expect(waves.length).toBe(1);
    expect(waves[0].tasks.length).toBe(2);
  });

  it("chains sequential tasks across waves", () => {
    const waves = topoSortWaves([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["b"] },
    ]);
    expect(waves.length).toBe(3);
    expect(waves.map((w) => w.tasks.map((t) => t.id))).toStrictEqual([["a"], ["b"], ["c"]]);
  });

  it("groups parallel-ready tasks in same wave", () => {
    const waves = topoSortWaves([
      { id: "a", prompt: "1" },
      { id: "b", prompt: "2", dependsOn: ["a"] },
      { id: "c", prompt: "3", dependsOn: ["a"] },
      { id: "d", prompt: "4", dependsOn: ["b", "c"] },
    ]);
    expect(waves.length).toBe(3);
    expect(waves.map((w) => w.tasks.map((t) => t.id))).toStrictEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("throws on cycle", () => {
    expect(() => {
      topoSortWaves([
        { id: "a", prompt: "1", dependsOn: ["b"] },
        { id: "b", prompt: "2", dependsOn: ["a"] },
      ]);
    }).toThrow(/cycle/i);
  });
});
