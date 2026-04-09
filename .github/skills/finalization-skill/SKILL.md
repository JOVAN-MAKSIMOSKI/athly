---
name: finalization-skill
description: Scaffold skill for final user-facing response shaping without runtime wiring.
status: draft
owner: athly
---

# Purpose
Provide instruction-only guidance for final response rendering after tool activity.

This skill is a placeholder and must not be wired into runtime yet.

# Scope
In scope:
- Concise user-facing summary style.
- Safe formatting constraints.
- Privacy and ID redaction expectations.

Out of scope:
- Tool calling.
- Tool retry or continuation logic.
- Any deterministic orchestration decisions.

# Intended Inputs
- Prior conversation and tool outputs prepared by orchestrator code.

# Intended Outputs
- Clean final message intended for end user.
- Optional markdown table formatting when workout data exists.

# Draft Behavior Contract
1. Do not call tools in this phase.
2. Do not expose internal IDs, debug details, or hidden reasoning.
3. Keep tone concise, coach-like, and readable.
4. If save failed, state failure clearly and ask user to retry.

# Wiring Notes
- Not active.
- Do not attach to loop until explicitly requested.

# TODO
- Split into domain-specific variants if needed (workout, progression, onboarding completion).
- Add concrete formatting examples after schema freeze.
