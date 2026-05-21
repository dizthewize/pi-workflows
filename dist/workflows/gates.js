function resolveAgentConfig(role, team) {
    return (team[role] ?? {
        name: role,
        model: null,
        tools: null,
        thinking: "off",
        systemPrompt: "",
        systemPromptMode: "append",
    });
}
export function extractVerdict(rawOutput) {
    // Try to parse structured JSON from the reviewer's output
    try {
        // Look for a JSON block
        const jsonMatch = rawOutput.match(/\{.*?\}/s);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const verdict = parsed.verdict;
            if (verdict === "APPROVE" ||
                verdict === "NEEDS_CHANGES" ||
                verdict === "CHALLENGE") {
                return {
                    verdict,
                    feedback: (parsed.feedback ?? parsed.message ?? ""),
                    message: (parsed.message ?? parsed.feedback ?? ""),
                    severity: parsed.severity ?? "blocking",
                };
            }
        }
    }
    catch {
        // Not valid JSON, fall through
    }
    // Heuristic fallback: look for keywords in plain text
    const lower = rawOutput.toLowerCase();
    if (lower.includes("approve")) {
        return { verdict: "APPROVE" };
    }
    if (lower.includes("needs changes") || lower.includes("request changes")) {
        return {
            verdict: "NEEDS_CHANGES",
            feedback: rawOutput.slice(0, 500),
            severity: "blocking",
        };
    }
    if (lower.includes("challenge")) {
        return {
            verdict: "CHALLENGE",
            message: rawOutput.slice(0, 500),
            severity: "blocking",
        };
    }
    // Fail-safe: default to APPROVE so we don't block forever on parse errors
    return { verdict: "APPROVE" };
}
import { runSingleAgent } from "../agents/runner.js";
export async function challengeCycle(params) {
    const { task, initialResult, challengeMessage, team, maxCycles, runtime, signal, spawnFn, } = params;
    let currentResult = initialResult;
    let currentMessage = challengeMessage;
    for (let cycle = 0; cycle < maxCycles; cycle++) {
        if (signal?.aborted) {
            return { status: "needs_changes", finalFeedback: "Aborted" };
        }
        const workerConfig = resolveAgentConfig(task.agent ?? "worker", team);
        const workerSteerPrompt = `
A reviewer has challenged your implementation:
"${currentMessage}"

Please fix the issue or explain why the current implementation is correct.
If you make changes, re-run any relevant tests.
`;
        const response = await runSingleAgent({
            cwd: runtime.cwd,
            agent: workerConfig,
            task: workerSteerPrompt,
            signal,
            spawnFn,
        });
        if (signal?.aborted) {
            return { status: "needs_changes", finalFeedback: "Aborted" };
        }
        const reviewerConfig = resolveAgentConfig(task.reviewAgent ?? "reviewer", team);
        const reReviewPrompt = `
Worker responded to your challenge.
Their response: "${response.output ?? ""}"
Original challenge: "${currentMessage}"
Do you APPROVE, or CHALLENGE again with new feedback?
`;
        const reReviewResult = await runSingleAgent({
            cwd: runtime.cwd,
            agent: reviewerConfig,
            task: reReviewPrompt,
            signal,
            spawnFn,
        });
        const verdict = extractVerdict(reReviewResult.output ?? "");
        if (verdict.verdict === "APPROVE") {
            return { status: "resolved", finalResult: response };
        }
        if (verdict.verdict === "NEEDS_CHANGES") {
            return {
                status: "needs_changes",
                finalResult: response,
                finalFeedback: verdict.feedback,
            };
        }
        currentMessage = verdict.message ?? verdict.feedback ?? "Please fix.";
        currentResult = response;
    }
    return {
        status: "max_cycles_exceeded",
        finalResult: currentResult,
        finalFeedback: currentMessage,
    };
}
//# sourceMappingURL=gates.js.map