import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Wave, ReservationEntry } from "../types.js";

export async function acquireWaveReservations(
  wave: Wave,
  workflowDir: string
): Promise<void> {
  const reservationsDir = path.join(workflowDir, "reservations");
  await fs.mkdir(reservationsDir, { recursive: true });

  const allFiles = new Set<string>(
    wave.tasks.flatMap((t) => t.files ?? [])
  );

  // Check existing reservations
  const existing = await listAllReservations(workflowDir);
  for (const file of allFiles) {
    if (existing.has(file)) {
      throw new Error(
        `File collision: "${file}" is already reserved by another task`
      );
    }
  }

  // Write all reservation entries atomically
  for (const t of wave.tasks) {
    const entry: ReservationEntry = {
      taskId: t.id,
      files: t.files ?? [],
      claimedAt: Date.now(),
      ttl: 600_000, // 10 minutes
      agent: t.agent ?? "worker",
    };
    await fs.writeFile(
      path.join(reservationsDir, `${t.id}.json`),
      JSON.stringify(entry, null, 2),
      "utf-8"
    );
  }
}

export async function releaseReservations(
  workflowDir: string,
  taskIds: string[]
): Promise<void> {
  const reservationsDir = path.join(workflowDir, "reservations");
  for (const id of taskIds) {
    const filePath = path.join(reservationsDir, `${id}.json`);
    try {
      await fs.unlink(filePath);
    } catch {
      // Already released or never existed
    }
  }
}

export async function listAllReservations(
  workflowDir: string
): Promise<Set<string>> {
  const reservationsDir = path.join(workflowDir, "reservations");
  const files = new Set<string>();
  try {
    const entries = await fs.readdir(reservationsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const raw = await fs.readFile(
        path.join(reservationsDir, entry),
        "utf-8"
      );
      const data = JSON.parse(raw) as ReservationEntry;
      for (const f of data.files) files.add(f);
    }
  } catch {
    // Directory doesn't exist yet
  }
  return files;
}

export async function getReservationMeta(
  workflowDir: string,
  taskId: string
): Promise<ReservationEntry | null> {
  const filePath = path.join(workflowDir, "reservations", `${taskId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as ReservationEntry;
  } catch {
    return null;
  }
}
