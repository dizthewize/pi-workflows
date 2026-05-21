/**
 * Spec Parser - Parse TASK-XX format markdown into pi-workflows Task[] DAG.
 *
 * Supports standard TASK-XX format from pi-coordination:
 *   ## TASK-01: Create auth types
 *   Priority: P1
 *   Files: src/auth/types.ts (create), src/other.ts (modify)
 *   Depends on: none
 *   Acceptance: Exports User, Session, Token interfaces
 *
 * Optional detailed description (free text after acceptance).
 */

import { Task } from "../types.js";

/** Valid task ID patterns. */
export const TASK_ID_PATTERNS = {
  taskMain: /^TASK-\d{2,}$/,
  taskSub: /^TASK-\d{2,}\.\d+$/,
  any: /^(TASK-\d{2,}(\.\d+)?)$/,
  header: /^##\s+(TASK-\d{2,}(?:\.\d+)?):\s*(.+)$/,
};

/** File action annotation for contract-first builds. */
export type FileAction = "create" | "modify" | "delete";

export interface SpecFile {
  path: string;
  action?: FileAction;
}

export interface SpecTask {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2" | "P3";
  files: SpecFile[];
  dependsOn: string[];
  acceptance: string;
  description?: string;
  parentTaskId?: string;
}

export interface Spec {
  title: string;
  description?: string;
  tasks: SpecTask[];
  context?: string;
}

function parsePriority(value: string | undefined): SpecTask["priority"] {
  const normalized = value?.toUpperCase().trim();
  if (normalized === "P0" || normalized === "P1" || normalized === "P2" || normalized === "P3") {
    return normalized;
  }
  return "P2"; // default
}

function getParentTaskId(taskId: string): string | undefined {
  if (TASK_ID_PATTERNS.taskSub.test(taskId)) {
    return taskId.replace(/\.\d+$/, "");
  }
  return undefined;
}

function parseFiles(text: string): SpecFile[] {
  const files: SpecFile[] = [];
  const parts = text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);

  for (let part of parts) {
    part = part.replace(/^-\s*/, "");
    const actionMatch = part.match(/\((\w+)\)\s*$/);
    let action: FileAction | undefined;
    if (actionMatch) {
      const actionStr = actionMatch[1].toLowerCase();
      if (actionStr === "create" || actionStr === "modify" || actionStr === "delete") {
        action = actionStr;
      }
      part = part.replace(/\(\w+\)\s*$/, "").trim();
    }
    if (part) files.push({ path: part, action });
  }
  return files;
}

function parseDependsOn(text: string): string[] {
  const normalized = text.toLowerCase().trim();
  if (normalized === "none" || normalized === "-" || normalized === "n/a") return [];

  return text
    .split(/[,\n]/)
    .map((d) => d.trim().toUpperCase())
    .filter((d) => TASK_ID_PATTERNS.any.test(d));
}

function parseTaskSection(section: string): SpecTask | null {
  const firstLine = section.split("\n")[0];
  const headerMatch = firstLine.match(TASK_ID_PATTERNS.header);
  if (!headerMatch) return null;

  const lines = section.split("\n");
  const task: SpecTask = {
    id: headerMatch[1],
    title: headerMatch[2].trim(),
    priority: "P2",
    files: [],
    dependsOn: [],
    acceptance: "",
    parentTaskId: getParentTaskId(headerMatch[1]),
  };

  let currentField: "acceptance" | "files" | null = null;
  const descriptionLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (TASK_ID_PATTERNS.header.test(trimmed)) continue;

    const priorityMatch = trimmed.match(/^priority:\s*(.+)/i);
    if (priorityMatch) {
      task.priority = parsePriority(priorityMatch[1]);
      currentField = null;
      continue;
    }

    const filesMatch = trimmed.match(/^files?:\s*(.*)$/i);
    if (filesMatch) {
      if (filesMatch[1].trim()) {
        task.files = parseFiles(filesMatch[1]);
        currentField = null;
      } else {
        currentField = "files";
      }
      continue;
    }

    const dependsMatch = trimmed.match(/^depends\s+on:\s*(.+)/i);
    if (dependsMatch) {
      task.dependsOn = parseDependsOn(dependsMatch[1]);
      currentField = null;
      continue;
    }

    const acceptanceMatch = trimmed.match(/^acceptance:\s*(.*)$/i);
    if (acceptanceMatch) {
      if (acceptanceMatch[1].trim()) {
        task.acceptance = acceptanceMatch[1].trim();
        currentField = "acceptance"; // stay open for continuation
      } else {
        currentField = "acceptance";
        task.acceptance = "";
      }
      continue;
    }

    // Multi-line field continuations
    if (currentField === "files" && trimmed.startsWith("-")) {
      task.files.push(...parseFiles(trimmed));
      continue;
    }

    if (currentField === "acceptance" && trimmed) {
      task.acceptance += (task.acceptance ? "\n" : "") + trimmed;
      continue;
    }

    if (currentField === "acceptance" && !trimmed) {
      currentField = null; // empty line closes acceptance
      continue;
    }

    // Everything else is description (only if not in a field)
    if (trimmed && currentField === null) {
      descriptionLines.push(trimmed);
    }
  }

  if (descriptionLines.length > 0) {
    task.description = descriptionLines.join("\n");
  }

  return task;
}

export function parseSpec(markdown: string): Spec {
  const lines = markdown.split("\n");
  const spec: Spec = { title: "", tasks: [] };

  // Extract title from first # heading
  for (const line of lines) {
    const titleMatch = line.match(/^#\s+(.+)$/);
    if (titleMatch) {
      spec.title = titleMatch[1].trim();
      break;
    }
  }

  // Split into sections by ## headers
  const sections: string[] = [];
  let currentSection: string[] = [];
  const descriptionLines: string[] = [];
  let foundFirstTask = false;

  for (const line of lines) {
    if (line.match(/^##\s+/)) {
      const taskMatch = line.match(TASK_ID_PATTERNS.header);
      if (taskMatch) {
        if (currentSection.length > 0) sections.push(currentSection.join("\n"));
        currentSection = [line];
        foundFirstTask = true;
      } else if (!foundFirstTask) {
        // Non-task section before first task is description
        if (currentSection.length > 0) sections.push(currentSection.join("\n"));
        currentSection = [line];
      } else {
        if (currentSection.length > 0) sections.push(currentSection.join("\n"));
        currentSection = [line];
      }
    } else {
      if (!foundFirstTask && line.trim() && !line.match(/^#/)) {
        descriptionLines.push(line);
      }
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) sections.push(currentSection.join("\n"));

  if (descriptionLines.length > 0) {
    spec.description = descriptionLines.join("\n").trim();
  }

  // Parse task sections
  for (const section of sections) {
    const firstLine = section.split("\n")[0];
    if (TASK_ID_PATTERNS.header.test(firstLine)) {
      const task = parseTaskSection(section);
      if (task) spec.tasks.push(task);
    }
  }

  return spec;
}

export function validateSpec(spec: Spec): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (spec.tasks.length === 0) {
    errors.push("Spec has no tasks");
    return { valid: false, errors, warnings };
  }

  const taskIds = new Set<string>();
  for (const task of spec.tasks) {
    if (taskIds.has(task.id)) errors.push(`Duplicate task ID: ${task.id}`);
    taskIds.add(task.id);

    if (!TASK_ID_PATTERNS.any.test(task.id)) {
      errors.push(`Invalid task ID: ${task.id}`);
    }

    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep) && !spec.tasks.find((t) => t.id === dep)) {
        errors.push(`${task.id} depends on non-existent ${dep}`);
      }
    }

    if (task.files.length === 0) warnings.push(`${task.id} has no files specified`);
    if (!task.acceptance) warnings.push(`${task.id} has no acceptance criteria`);
  }

  // Circular dependency detection
  const taskMap = new Map(spec.tasks.map((t) => [t.id, t]));
  for (const task of spec.tasks) {
    const visited = new Set<string>();
    const stack = new Set<string>();
    function dfs(id: string): boolean {
      if (stack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      stack.add(id);
      const t = taskMap.get(id);
      if (t) {
        for (const dep of t.dependsOn) {
          if (dfs(dep)) return true;
        }
      }
      stack.delete(id);
      return false;
    }
    if (dfs(task.id)) {
      errors.push(`Circular dependency involving ${task.id}`);
      break;
    }
  }

  // Entry point check
  const entryPoints = spec.tasks.filter((t) => !t.parentTaskId && t.dependsOn.length === 0);
  if (entryPoints.length === 0) {
    errors.push("No entry point task (all top-level tasks have dependencies)");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Convert a Spec to pi-workflows Task[]. */
export function specToTasks(spec: Spec): Task[] {
  return spec.tasks.map((t) => ({
    id: t.id,
    prompt: t.description
      ? `${t.title}\n\n${t.description}\n\nAcceptance: ${t.acceptance}`
      : `${t.title}\n\nAcceptance: ${t.acceptance}`,
    files: t.files.map((f) => f.path),
    dependsOn: t.dependsOn,
    gate: t.files.length > 0 ? true : undefined,
  }));
}
