---
name: onboarding-skill
description: Scaffold skill for user onboarding conversation flow without runtime wiring.
status: active
owner: athly
---

# Purpose
Provide instruction-only guidance for onboarding turns.

This skill now drives the first onboarding follow-up shown right after split selection.

# Scope
In scope:
- Ask concise onboarding questions.
- Capture profile basics for downstream tools.
- Keep safety-first wording and clear user prompts.
- Trigger once per signed-in user session after split save.

Out of scope:
- Tool execution logic.
- Auth/session control.
- Loop control, retries, or transport handling.
- Persistence or business computations.

# Intended Inputs
- Split selection completion event from the Home flow.
- Optional selected split label for contextual wording.

# Intended Outputs
- A concise onboarding prompt sequence.
- Structured handoff instructions for deterministic orchestrator code.
- Four onboarding questions covering goals, equipment, constraints, and readiness.

# Draft Behavior Contract
1. Clarify user goals, training frequency, equipment, and constraints.
2. Include safety check wording for pain, soreness, fatigue, and low energy.
3. Avoid internal IDs and internal reasoning in user-facing output.
4. Defer all tool calls to orchestrator policy.
5. Fire once per user session when split is first saved.

# Wiring Notes
- Triggered from client Home split save flow.
- Runtime implementation lives in client agent hook as an assistant kickoff prompt.
- Not a replacement for system prompt orchestration.

# TODO
- Tighten question ordering.
- Define optional vs required onboarding fields.
- Align with future schema updates.
