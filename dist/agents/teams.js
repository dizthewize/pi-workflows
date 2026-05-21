import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
function deepMergeDefaults(target, defaults) {
    return {
        name: target.name ?? defaults.name,
        source: target.source ?? defaults.source ?? "user",
        model: target.model ?? defaults.model,
        tools: target.tools ?? defaults.tools,
        thinking: target.thinking ?? defaults.thinking ?? "off",
        systemPrompt: target.systemPrompt ?? defaults.systemPrompt ?? "",
        systemPromptMode: target.systemPromptMode ?? defaults.systemPromptMode ?? "append",
    };
}
export function loadAgentTeam(name, cwd) {
    const teamName = name ?? "default";
    const paths = [
        path.join(cwd, ".pi", "workflows", "teams", `${teamName}.json`),
        path.join(os.homedir(), ".pi", "agent", "workflows", "teams", `${teamName}.json`),
    ];
    for (const p of paths) {
        try {
            if (fs.existsSync(p)) {
                const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
                return normalizeTeam(raw);
            }
        }
        catch {
            // Continue to fallback
        }
    }
    // Hardcoded fallback team — zero user setup required
    const fallback = {
        worker: {
            name: "worker",
            model: null,
            tools: null,
            thinking: "off",
            systemPrompt: "",
            systemPromptMode: "append",
        },
        reviewer: {
            name: "reviewer",
            model: null,
            tools: ["read", "diff"],
            thinking: "high",
            systemPrompt: "You are a meticulous code reviewer. You check every file changed against the requirements and the team's style standards. Return structured JSON: { verdict: 'APPROVE' | 'NEEDS_CHANGES' | 'CHALLENGE', feedback?: string, message?: string, severity?: 'blocking' | 'non-blocking' }.",
            systemPromptMode: "append",
        },
        designer: {
            name: "designer",
            model: null,
            tools: null,
            thinking: "medium",
            systemPrompt: "You are a senior UX engineer. You design clean interfaces.",
            systemPromptMode: "append",
        },
    };
    return fallback;
}
export function resolveAgentConfig(role, team) {
    const resolved = team[role] ?? team["worker"]; // fallback to generic worker
    return resolved;
}
function normalizeTeam(raw) {
    const out = {};
    for (const [key, cfg] of Object.entries(raw)) {
        if (!cfg || typeof cfg !== "object")
            continue;
        out[key] = {
            name: cfg.name ?? key,
            model: cfg.model ?? null,
            tools: cfg.tools ?? null,
            thinking: cfg.thinking ?? "off",
            systemPrompt: cfg.systemPrompt ?? "",
            systemPromptMode: cfg.systemPromptMode ?? "append",
        };
    }
    return out;
}
//# sourceMappingURL=teams.js.map