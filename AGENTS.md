# Development process

## Plan with superpowers, execute without it

Use the superpowers skill set (brainstorming, writing-plans, and related planning skills) to turn every nontrivial feature or fix into a spec and an implementation plan before writing code. That's the only role superpowers plays here.

Do not use superpowers' own execution skills — subagent-driven-development, using-git-worktrees, or any other skill that drives task execution — to carry out the plan. Once a spec and plan exist, execution follows the process below instead, not the superpowers execution loop.

## Always execute in parallel

Break the plan into tasks and dispatch every task that has no real dependency on another task's output in a single batch of parallel agents, not one at a time. Only serialize tasks that genuinely depend on each other (shared files, required ordering).

When parallel tasks touch the same file, isolate each in its own git worktree and merge sequentially afterward rather than letting them race on a shared working tree.

Keep dispatch prompts minimal: state the task, the files involved, and the acceptance check. Skip elaborate rationale, background, or reporting requirements — every extra sentence in a dispatch prompt is spent on every parallel task, so keep it lean.

## Never use expensive models

Never dispatch the flagship model (currently GPT-5.6 Sol) for implementation or for validating the codebase (code review, test-writing, typecheck triage, etc.).

- Implementation: GPT-5.6 Terra.
- Validation (review, test-writing, lint/typecheck triage): GPT-5.6 Luna — the cheapest, fastest model capable of the task.
- Sol: never, for any dev or validation task in this repo.

Only escalate one tier (Luna → Terra) if the cheaper model has already tried and demonstrably failed at the specific task, and say so explicitly when escalating. Never escalate to Sol.

These are the current cheapest-to-most-capable tiers in the GPT-5.6 lineup as of this writing (Sol/Terra/Luna are durable capability tiers within a generation, not fixed names — GPT-5.4 and GPT-5.4 mini are retiring in favor of Terra and Luna respectively); re-check the current model/pricing docs before assuming these names are still accurate — model names and tiers change.

## Verification

Run typecheck and the full test suite after every merge of parallel task branches, not only once at the very end. A task is not done until both are clean.
