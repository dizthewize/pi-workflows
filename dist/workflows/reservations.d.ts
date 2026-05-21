import { Wave, ReservationEntry } from "../types.js";
export declare function acquireWaveReservations(wave: Wave, workflowDir: string): Promise<void>;
export declare function releaseReservations(workflowDir: string, taskIds: string[]): Promise<void>;
export declare function listAllReservations(workflowDir: string): Promise<Set<string>>;
export declare function getReservationMeta(workflowDir: string, taskId: string): Promise<ReservationEntry | null>;
//# sourceMappingURL=reservations.d.ts.map