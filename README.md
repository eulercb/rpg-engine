# rpg-engine — free text → 5e mechanics

A scaffold for the architecture we discussed: a player types anything, an LLM
**interprets** it into a structured action, code **validates** that it's legal,
a deterministic engine **resolves** the 5e math, and the LLM **narrates** the
result it's handed. The model never owns state and never rolls dice.

```
free text ──▶ interpret ──▶ validate ──▶ resolve ──▶ narrate ──▶ prose
              (LLM)         (code)       (code+dice)  (LLM)
                 │                          ▲
                 └──── grounded in a ───────┘
                       projection of state
```

## Run the offline demo (no API key)

```bash
npm install
npm run demo
```

It drives four free-text inputs through the loop using a keyword-matching mock
interpreter and a deterministic narrator, printing each layer's output —
including one input the validator rejects (a second attack in the same turn)
and one the rules don't cover (kicking a table over), which routes through the
`freeform` escape hatch.

## Go live with Claude

```bash
export ANTHROPIC_API_KEY=sk-...
export ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # optional
```

In `src/demo.ts`, swap the deps:

```ts
import { llmInterpret } from "./interpreter";
import { llmNarrate } from "./narrator";
const deps = { interpret: llmInterpret, narrate: llmNarrate, rng: mulberry32(Date.now()) };
```

Nothing else changes — the engine, validator, and resolver are identical.

## Files

| File             | Layer / role                                                        |
|------------------|---------------------------------------------------------------------|
| `types.ts`       | Action union, 5e tables (skills→abilities, DC bands), result shapes |
| `dice.ts`        | Seedable RNG; d20 with advantage; damage expressions                |
| `state.ts`       | Authoritative game state + sample encounter                         |
| `interpreter.ts` | Free text → Action. `llmInterpret` (tool calling) + `mockInterpret` |
| `validator.ts`   | Is this action legal for this character/state?                      |
| `resolver.ts`    | Deterministic 5e math; mutates state; returns the truth             |
| `narrator.ts`    | Result → prose. `llmNarrate` + `mockNarrate`                        |
| `engine.ts`      | Wires the four layers; returns a full per-layer trace               |
| `demo.ts`        | Runnable example                                                    |

## Design rules baked in

- **The resolver owns dice and state.** The model proposes; code disposes.
- **Tool calling, not free JSON.** Each action is a tool with a strict schema.
- **Grounding.** The interpreter sees only a projection of the character
  (`buildContext`), so it can't reference spells/weapons the character lacks;
  anything it invents anyway is caught by the validator.
- **The DC table is the single source of truth** for improvised difficulty
  (`DC_BANDS`). The model picks a band; the number is set in exactly one place.
- **Narration is last and subordinate.** It receives the mechanical truth and
  is told to honour every number.

## Where to take it next (in rough order of payoff)

1. **`cast_spell`** — the real test of the contract: slot tracking, save vs.
   attack spells, concentration (one at a time, broken by failed CON saves),
   area targeting. This is where 5e's weight lives.
2. **Full action economy** — bonus action / reaction / one free object
   interaction, plus reactions interrupting other turns.
3. **Advantage as data** — promote the ad-hoc condition checks in `resolver.ts`
   into a table of sources, and add the situational-advantage *confirm* step
   (model flags it, an adjudicator policy confirms before it applies).
4. **Promote frequent freeform actions** into first-class tools — log every
   `freeform` call and let the data tell you which to formalize.
5. **Disambiguation turn** — when targets/weapons are ambiguous, have the
   interpreter ask one question instead of guessing.
