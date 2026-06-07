# AGENTS.md

Context for any agent (or human) iterating on this repo. The README covers
setup and structure; this file covers the **ideals and invariants** behind the
design, so changes preserve what makes the project work rather than quietly
dismantling it. Read this before making structural changes.

## The thesis (read this first)

Free text in, real mechanics out. The LLM has creative latitude at exactly two
edges — **interpret** (intent → structured action) and **narrate** (resolved
truth → prose). Everything between those edges is deterministic code that owns
the truth. This single line is what separates the project from "an LLM
pretending to run D&D." Most proposed changes should be judged against it: does
this keep mechanical truth in code and give the model only the judgement call?

## Invariants — do not break these

Each is a hard constraint, not a preference. The rationale matters as much as
the rule.

1. **The LLM never rolls dice and never mutates state.** `dice.ts` is the only
   source of randomness; the resolver is the only mutator of `GameState`. The
   model *proposes*; code *disposes*. Letting the model compute a number "to
   save a round-trip" destroys the thesis — reject such changes.
2. **The pipeline order is fixed: interpret → validate → resolve → narrate.**
   Narration is always last and always receives the resolved result. It may
   reword the truth; it may never contradict it (no inventing hits, misses,
   damage, or rolls).
3. **The validator is the only gate.** An illegal action must never reach the
   resolver. Rejections are player-facing ("You can't do that: …"), never raw
   errors, and the model cannot override a "no."
4. **A difficulty band becomes a number in exactly one place** (`DC_BANDS` in
   `types.ts`). The model picks a band; it never sees or sets a DC. This is what
   keeps improvised difficulty consistent across sessions.
5. **The interpreter sees only `buildContext`'s projection of state** — never
   hidden state. If it references a capability the character lacks, catching
   that is the validator's job; the interpreter is never *trusted*, only
   *grounded*.
6. **Structured tool calls, not free JSON or prose parsing.** Every action is a
   tool with a strict schema. `tool_choice` is forced so output is always
   structured.
7. **Everything is seed-reproducible.** New randomness goes through the `dice.ts`
   RNG, never `Math.random()`. A given seed + inputs must always produce the
   same trace.
8. **Mock and real implementations share one signature and stay in lockstep.**
   The offline loop (`mockInterpret` + `mockNarrate`) must always run with no API
   key and no network. If you add capability to the real path, add it to the
   mock too.

## Anti-goals

- **Not AI Dungeon.** Total freedom with no mechanical consequence is the
  failure mode we exist to avoid. Actions must have mechanical weight.
- **The LLM is not the rules engine.** Any change that makes the model the
  source of mechanical truth is wrong, however convenient.
- **Not permanently welded to 5e.** Keep 5e-specific math/tables separable so a
  future system module could swap in (we discussed this could just as well be a
  rules-light system). Treat creeping 5e assumptions leaking into `engine.ts` or
  `validator.ts` as a smell — they belong in the resolver and content.

## Adding a new action type — checklist

The action contract is a discriminated union threaded through every layer, so a
new action (e.g. `cast_spell`) touches a known set of spots. Do all of them:

1. `types.ts` — add the variant to the `Action` union (and a result type if its
   output shape differs).
2. `interpreter.ts` — add the tool to `TOOLS`, map it in `toAction`, and teach
   `mockInterpret` a keyword path so the offline demo still exercises it.
3. `validator.ts` — add a case proving legality (resources available, targets
   valid, action economy).
4. `resolver.ts` — add the deterministic resolution: roll via `dice.ts`, mutate
   state, return a result.
5. `narrator.ts` — handle the new result shape in `mockNarrate` (`llmNarrate` is
   generic and needs no change).
6. `demo.ts` — exercise it by playing the interactive loop (type the intent and
   watch it run end-to-end); an illegal attempt should still surface a clean,
   player-facing rejection rather than a raw error.

The `switch` statements are intentionally exhaustive with no `default`, so
TypeScript will flag every place you forgot. Trust the compiler here.

## Known shortcuts (intentional, not bugs)

- **The resolver mutates `GameState` in place.** Fine for a single-player
  scaffold. If you move toward undo, replay, or multiplayer, switch to immutable
  updates or an event log. Flagged here so nobody "discovers" the mutation and
  assumes it was an accident.
- **Advantage is computed from a couple of hard-coded conditions.** The intended
  shape is a table of advantage sources plus a *situational-advantage confirm*
  step: the model flags a situational source, a policy confirms it before it
  applies. The model must never apply situational advantage directly.
- **Contests use a simplified opposed roll.** Replace as needed.
- **Sample content (one fighter, one goblin, three weapons) is a fixture, not
  the product.** The architecture is the product. Don't over-invest in content
  before the mechanics layers are where you want them.

## The freeform promotion loop (a process ideal)

`freeform` is the escape hatch that buys player freedom, and it is the *only*
place model judgement touches mechanics. Its intended lifecycle: log every
freeform call → watch which improvised actions recur → promote the common ones
into first-class tools (run the checklist above). Over time the escape hatch
should carry *less* traffic, not more. The freeform log is your tuning data.

## Decision log (don't relitigate these)

Choices that can look arbitrary but are deliberate:

- **`tool_choice` is forced** so the interpreter always returns a structured
  action, never prose.
- **Crit doubles the damage dice, not the modifier** — a 5e rule, not a knob.
- **Advantage and disadvantage cancel to a straight roll regardless of count** —
  a 5e rule.
- **Interpreter and narrator default to a fast/cheap model.** Mechanical truth
  doesn't depend on model quality (it's in code), so spend tokens on judgement,
  not math.
- **Three backends, one signature.** Alongside Claude (`llm*`) and the offline
  mock there is a local/OpenAI-compatible path (`localInterpret`/`localNarrate`,
  Ollama by default). It exists to keep the project provider-agnostic, and it
  obeys the same invariants — notably it forces `tool_choice: "required"`, so a
  **local interpreter model must support tool calling** (the narrator can be any
  chat model). When changing one real path, change the others to match (#8).

## When in doubt

If a feature seems to require trusting the model with a number, a die roll, or a
piece of state — there is almost always a design that keeps that in code and
hands the model only the judgement call. Finding that design *is* the work.