import * as fs from "node:fs";
import * as path from "node:path";
export class CostTracker {
    total = 0;
    byPhase = {};
    logPath;
    limit;
    constructor(workflowDir, limit) {
        this.limit = limit;
        this.logPath = path.join(workflowDir, "cost.json");
        this.load();
    }
    add(cost, phase) {
        this.total += cost;
        this.byPhase[phase] = (this.byPhase[phase] ?? 0) + cost;
        this.save();
    }
    exceeded() {
        return this.total >= this.limit;
    }
    summary() {
        return { total: this.total, byPhase: { ...this.byPhase } };
    }
    save() {
        try {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
            fs.writeFileSync(this.logPath, JSON.stringify({
                total: this.total,
                byPhase: this.byPhase,
                limit: this.limit,
            }), "utf-8");
        }
        catch {
            // Best-effort persistence
        }
    }
    load() {
        try {
            if (!fs.existsSync(this.logPath))
                return;
            const raw = JSON.parse(fs.readFileSync(this.logPath, "utf-8"));
            if (typeof raw.total === "number")
                this.total = raw.total;
            if (raw.byPhase)
                this.byPhase = raw.byPhase;
        }
        catch {
            // Start fresh on read error
        }
    }
}
//# sourceMappingURL=cost-tracker.js.map