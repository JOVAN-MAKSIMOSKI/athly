---
name: workout-start-skill
description: Guided first-set workout flow for starting and pacing a live training session.
status: draft
owner: athly
---

# Purpose
Provide concise, step-by-step coaching when a user starts a workout session.

This skill is a behavior contract only and is not wired to runtime execution yet.

# Scope
In scope:
- Confirm session readiness before the first working set.
- Guide exercise-by-exercise flow with short prompts.
- Capture set logs in plain language (reps, load, RPE, notes).
- Offer lightweight next-step coaching between sets.
- Keep safety-first wording for pain, dizziness, or unusual fatigue.

Out of scope:
- Tool execution and persistence logic.
- Session/auth control.
- Retry/transport handling.
- Program generation or split selection.

# Intended Inputs
- User intent to start workout (for example: "start workout", "begin leg day").
- Optional context from active plan (day, exercise list, targets, rest windows).
- Required runtime context: the currently started/active workout session (workout id/name and exercise list).
- Ongoing user check-ins during session (set completed, pain, low energy, substitutions).

# Active Workout Scope
- The skill must operate only on the currently started/active workout present in context.
- Do not reference, modify, or coach against any other saved/planned workout while an active workout exists.
- If no active workout context is present, ask for or establish the active workout before continuing set-by-set coaching.

# Intended Outputs
- A structured coaching sequence for the current workout.
- Short, actionable prompts for each step.
- A clean handoff format for orchestrator/tooling integration later.
- Include the weight for each of the exercise in the response and proper resting time between sets.

# Behavior Contract (Draft)
1. Start gate:
	- Confirm readiness in one line (energy, pain, time available).
	- If red flags appear, advise to reduce intensity or stop.
2. Session kickoff:
	- Restate workout name and first exercise.
	- Provide warm-up suggestion and first target.
3. Set loop (per exercise):
	- Ask for completed set details: reps, weight, effort.
	- Respond with a compact adjustment: keep/increase/decrease load.
	- Remind rest target before next set.
4. Exercise transition:
	- Summarize previous exercise in one short line.
	- Introduce next exercise and target.
5. Mid-session adaptation:
	- If user reports pain/fatigue/form breakdown, switch to a safer variant and reduce load.
6. Session close:
	- Give short recap (wins, bottlenecks, next-session cue).

# Response Style
- Keep responses brief and coach-like.
- Prioritize one clear action per message.
- Avoid internal IDs, schemas, or hidden reasoning.
- Prefer bullet-light outputs unless summary is needed.

# Safety Language
- If pain is sharp, escalating, or joint-specific: stop that movement.
- If dizziness, nausea, or unusual symptoms occur: end session and recover.
- Encourage conservative progression when recovery is poor.

# Wiring Notes
- Not active yet.
- Do not import into runtime modules yet.
- Integrate later from orchestration layer after tool contracts are finalized.

# Future Data Contract (Draft)
Expected fields to collect during flow:
- `sessionName`
- `exerciseName`
- `setNumber`
- `repsCompleted`
- `weightUsed`
- `rpeOrEffort`
- `painFlag`
- `notes`

# TODO
- Define exact start trigger phrases.
- Define rep/load adjustment heuristics by goal.
- Map substitutions by equipment availability.
- Add deterministic output schema for orchestrator handoff.
