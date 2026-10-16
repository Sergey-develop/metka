# METKA — Token Efficiency and Model Routing

## 1. Primary objective
Develop the METKA MVP with minimal unnecessary token consumption while preserving correctness, security, maintainability, and test quality. Optimize for total cost of a completed task, not minimum tokens per response.

## 2. Model selection

### Default: Sonnet
Use Sonnet for:
- Vue 3 Composition API and TypeScript implementation
- Vue components, layouts, routing, Pinia, SCSS
- API integrations and routine backend work
- routine bug fixes and tests
- implementation of approved architecture

Do not escalate simply because a task touches multiple files.

### Escalation: Opus
Use Opus only for:
- high-impact architecture decisions
- security-sensitive backend design
- risky database migrations
- image-recognition architecture and evaluation
- difficult bugs unresolved after focused investigation
- review of critical security or data-integrity changes

Before escalating, summarize the exact problem, relevant files, attempts, actual errors, and remaining uncertainty. Do not send the entire repository unless necessary. Return to Sonnet for implementation after the decision is made.

### Lightweight: Haiku
Use Haiku, when available, for:
- small documentation edits
- simple type declarations
- straightforward isolated tests
- minor CSS changes
- summarizing a specific file
- mechanical changes with explicit acceptance criteria

Do not use Haiku for architecture or security-sensitive decisions.

### Availability
Use only model names/aliases supported by the installed Claude Code version. If an alias is unavailable, continue with the current model instead of repeatedly retrying it.

## 3. Task decomposition
Split large tasks into independently verifiable units. For each task, identify:
1. Expected behavior
2. Relevant files/modules
3. Dependencies
4. Acceptance criteria
5. Required tests

Do not repeatedly re-plan an approved task unless new evidence invalidates the plan.

## 4. Repository exploration
Explore incrementally. Start with `CLAUDE.md`, `package.json`, entry points, router, relevant feature modules, related tests, and API/database definitions. Do not read every source file before every task. Use targeted searches and avoid repeatedly inspecting unchanged files.

Maintain a concise `PROJECT_STATUS.md` containing:
- architecture decisions
- implemented features
- important file locations
- current test status
- known blockers
- next steps

Update it only when meaningful information changes.

## 5. Context management
Keep task summaries concise. Do not reproduce entire source files or the full project specification in every response. Reference existing requirements and relevant files. If context becomes too large, finish the current coherent task, update `PROJECT_STATUS.md`, and continue in a fresh task with a concise handoff. Never discard critical architecture decisions, security constraints, or failing test information.

## 6. Implementation discipline
Inspect existing code before modifying it. Prefer minimal, targeted diffs. Do not rewrite working components for stylistic reasons. Avoid duplicate abstractions, unnecessary dependencies, speculative features, or new architecture without justification. Preserve unrelated user changes. Never remove tests or weaken assertions to get a green suite. Do not use `any` as a shortcut. Do not create fake production implementations.

## 7. Testing efficiency
Run the smallest relevant test set first. Run broader checks when shared modules, routing, authentication, database behavior, critical integrations, or release milestones change. Do not rerun identical failing commands without changing the underlying conditions. Record actual results. Never claim a test, build, device integration, or external service was verified if it was not executed.

## 8. Debugging policy
When a failure occurs:
1. Capture the exact error.
2. Identify the smallest relevant code area.
3. Form a root-cause hypothesis.
4. Make one targeted correction.
5. Run the smallest relevant verification.

Avoid random changes and repeated full-project scans. If two targeted attempts fail, reassess the hypothesis. Escalate difficult reasoning only when necessary.

## 9. Tool and command efficiency
Prefer existing project scripts. Use targeted searches instead of dumping large directories or source files. Avoid unnecessary dependency installation and repeated builds when relevant code has not changed. Do not run destructive commands or modify environment configuration without justification. Never expose secrets in logs, source files, summaries, or prompts.

## 10. Completion criteria
A task is complete only when acceptance criteria are satisfied, relevant checks have been executed, regressions have been considered, and incomplete integrations are documented. Token efficiency must never mean skipping essential security checks or fabricating successful results.

## 11. Final response format
For each task, report only:
1. Result
2. Changed files
3. Verification performed and actual results
4. Remaining blockers
5. Recommended next task

Keep the final response concise and factual.
