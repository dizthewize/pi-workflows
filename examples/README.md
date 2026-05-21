# pi-workflows Examples

## Example Files

| File | Purpose |
|------|---------|
| `sample-prd.md` | Fill-in PRD template for `plan_workflow` |
| `sample-spec.md` | Output of `plan_workflow` — ready for `execute_workflow` |

## Workflow → Factory Integration

Use these examples to test the full pipeline:

```bash
# 1. Copy the sample PRD
cp sample-prd.md ./my-auth-plan.md
# (edit to match your project)

# 2. Run the planner
plan_workflow({ input: "./my-auth-plan.md", output: "./spec.md", name: "auth" })

# 3. Execute the workflow
execute_workflow({ name: "auth", plan: "./spec.md", options: { maxCost: 20 } })
```

## Integration with pi-dark-factory

Drop a queue entry and let the factory handle it:

```bash
jq '.append += [{"title":"Auth refactor","description":"Run sample-prd.md through plan_workflow then execute_workflow","priority":"high","roleId":"planner"}]' ~/.pi/agent/factory/queue.manual.json > /tmp/q.json && mv /tmp/q.json ~/.pi/agent/factory/queue.manual.json
```
