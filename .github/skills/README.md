# Athly Skill Scaffolding

This folder contains skill definitions that are intentionally scaffolded only.

Current status:
- Skills are documented but not wired into runtime orchestration.
- No client/server imports should reference these files yet.
- Activation and integration will be done in a later pass.

Goals of this setup:
- Keep intent-specific instruction blocks small and composable.
- Preserve deterministic loop control in orchestrator code.
- Follow boundaries from .github/INSTRUCTIONS.md and .github/CLIENT_GUIDELINES.md.

Initial skill stubs:
- onboarding-skill/SKILL.md
- finalization-skill/SKILL.md

Template:
- _templates/SKILL.template.md

Do not wire these skills until explicitly requested.
