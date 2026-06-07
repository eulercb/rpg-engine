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

The demo picks its interpreter + narrator from the `RPG_LLM` env var
(`mock` by default). Nothing else changes between backends — the engine,
validator, and resolver are identical.

## Go live with Claude

```bash
export ANTHROPIC_API_KEY=sk-...
export ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # optional
npm run demo:claude                                # = RPG_LLM=claude npm run demo
```

## Run against a local model (Ollama)

The simplest way to run a model locally is [Ollama](https://ollama.com): it
downloads/manages models and serves an **OpenAI-compatible API** on
`localhost:11434`, which is exactly what the local backend here talks to (via
the `openai` SDK pointed at that base URL).

```bash
ollama pull gemma4:26b        # download the model (~18 GB)
ollama serve                  # start the server (often already running)
npm run demo:local            # = RPG_LLM=local npm run demo
```

Configure it with env vars (all optional):

| Variable                 | Default                       | Purpose                                            |
|--------------------------|-------------------------------|----------------------------------------------------|
| `LOCAL_LLM_BASE_URL`     | `http://localhost:11434/v1`   | Any OpenAI-compatible server (llama.cpp, LM Studio, vLLM) |
| `LOCAL_LLM_MODEL`        | `gemma4:26b`                  | Model used for both edges unless overridden        |
| `LOCAL_INTERPRETER_MODEL`| — (falls back to `LOCAL_LLM_MODEL`) | Override just the interpreter's model         |
| `LOCAL_NARRATOR_MODEL`   | — (falls back to `LOCAL_LLM_MODEL`) | Override just the narrator's model            |
| `LOCAL_LLM_API_KEY`      | `ollama`                      | Ignored by Ollama; set it for servers that require a key |

**The one requirement: the interpreter needs a tool-calling model.** The
interpreter forces a structured tool call (the project's core invariant); the
narrator just writes prose and works with any chat model. `gemma4:26b` supports
tool calling, but Gemma's tool support via Ollama has rough edges (keep Ollama
current, use the official tag, and disable "thinking" mode for the interpreter).
If your model's tool calls prove flaky, point **only the interpreter** at a model
with battle-tested tool support and keep your model for narration:

```bash
export LOCAL_INTERPRETER_MODEL=llama3.1:8b   # solid tool calling
export LOCAL_NARRATOR_MODEL=gemma4:26b       # any chat model is fine here
npm run demo:local
```

Because it speaks the OpenAI wire format, swapping Ollama for llama.cpp,
LM Studio, or vLLM is just a different `LOCAL_LLM_BASE_URL`.

### Troubleshooting: `gemma4` returns no tool call / empty narration

As of mid-2026, `gemma4:26b` is unreliable through Ollama's OpenAI-compatible
(`/v1`) endpoint, due to bugs in Ollama — not in this code:

- `/v1` returns **empty `content`** with the text in a separate reasoning field,
  and `think=false` isn't honored there ([ollama#15288](https://github.com/ollama/ollama/issues/15288)).
- the tool-call parser **drops `tool_calls`** when a system prompt + tools are
  combined ([ollama#15539](https://github.com/ollama/ollama/issues/15539)), and the
  MoE build returns empty responses on system prompts over ~500 chars
  ([ollama#15428](https://github.com/ollama/ollama/issues/15428)).

The narrator now falls back to the deterministic mock on empty replies, and the
interpreter fails with a message showing what the model returned. For a reliable
local run, point the **interpreter** at a model with battle-tested Ollama tool
support — `llama3.1:8b` or `qwen2.5:7b` — which is what `LOCAL_INTERPRETER_MODEL`
is for. (Make sure Ollama is on its latest version and you're using the official
tag, not a community quant.)

## Files

| File             | Layer / role                                                        |
|------------------|---------------------------------------------------------------------|
| `types.ts`       | Action union, 5e tables (skills→abilities, DC bands), result shapes |
| `dice.ts`        | Seedable RNG; d20 with advantage; damage expressions                |
| `state.ts`       | Authoritative game state + sample encounter                         |
| `interpreter.ts` | Free text → Action. `llmInterpret` (Claude) / `localInterpret` (Ollama) tool calling + `mockInterpret` |
| `validator.ts`   | Is this action legal for this character/state?                      |
| `resolver.ts`    | Deterministic 5e math; mutates state; returns the truth             |
| `narrator.ts`    | Result → prose. `llmNarrate` (Claude) / `localNarrate` (Ollama) + `mockNarrate` |
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
