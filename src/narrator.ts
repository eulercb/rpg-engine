// ---------------------------------------------------------------------------
// narrator.ts
// The LAST step. It receives the mechanical truth and may reword it, never
// contradict it. Like the interpreter, there's a real (LLM) version and a
// deterministic mock so the loop runs offline.
// ---------------------------------------------------------------------------

import type { ResolutionResult } from "./types";
import type { GameState } from "./state";

export type Narrator = (result: ResolutionResult, state: GameState) => Promise<string>;

function name(state: GameState, id: string): string {
  return state.combatants[id]?.name ?? id;
}

// Deterministic narration — clear, faithful, no flourish.
export const mockNarrate: Narrator = async (result, state) => {
  if (result.kind === "weapon_attack") {
    const attacker = name(state, result.attacker_id);
    const target = name(state, result.target_id);
    const weapon = state.weapons[result.weapon_id].name;
    if (!result.hit) {
      const why = result.d20.natural1 ? " (a critical miss)" : "";
      return `${attacker} swings the ${weapon} at ${target} and misses${why}. [${result.attackTotal} vs AC ${result.targetAC}]`;
    }
    const crit = result.critical ? "a critical hit! " : "";
    const dmg = result.damage!;
    const downed = result.targetHpAfter <= 0 ? ` ${target} drops.` : "";
    return `${crit}${attacker}'s ${weapon} bites into ${target} for ${dmg.total} ${dmg.type} damage.${downed} [${result.attackTotal} vs AC ${result.targetAC}; HP ${result.targetHpBefore}->${result.targetHpAfter}]`;
  }

  // ability_check (including adjudicated freeform)
  const actor = name(state, result.actor_id);
  const label = result.skill ? `${result.ability.toUpperCase()} (${result.skill})` : result.ability.toUpperCase();
  const outcome = result.success ? "succeeds" : "fails";
  const prefix = result.adjudicated ? `${actor} attempts: "${result.adjudicated.description}". ` : "";
  return `${prefix}${actor} makes a ${label} check and ${outcome}. [${result.total} vs DC ${result.dc}]`;
};

// Shared instruction for every real narrator. The narrator's whole job is to
// reword the resolved truth, never contradict it — so this prompt is the single
// place that constraint lives, and the Claude and local paths stay in lockstep.
const NARRATOR_SYSTEM =
  "You narrate the outcome of one D&D action in 1-2 vivid sentences. You are given the resolved mechanical truth as JSON. Honour every number and the hit/success outcome exactly; never change what happened. Do not invent new mechanics or rolls.";

// Real narrator. Lazy SDK import; falls back to the mock on any failure so the
// game never stalls on a narration call.
export const llmNarrate: Narrator = async (result, state) => {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
    const msg = await client.messages.create({
      model,
      max_tokens: 200,
      system: NARRATOR_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(result) }],
    });
    const block = msg.content.find((b: any) => b.type === "text") as any;
    const text = block?.text?.trim();
    return text ? text : await mockNarrate(result, state);
  } catch {
    return mockNarrate(result, state);
  }
};

// Local narrator. Same contract as llmNarrate, against any OpenAI-compatible
// server (Ollama by default). Narration needs no tool calling, so this works
// with ANY chat model — including ones whose tool support is too shaky for the
// interpreter. Falls back to the mock on any failure, same as the Claude path.
export const localNarrate: Narrator = async (result, state) => {
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      baseURL: process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:11434/v1",
      apiKey: process.env.LOCAL_LLM_API_KEY ?? "ollama", // Ollama ignores it; the SDK requires a value
    });
    const model = process.env.LOCAL_NARRATOR_MODEL ?? process.env.LOCAL_LLM_MODEL ?? "gemma4:26b";
    const res = await client.chat.completions.create({
      model,
      max_tokens: 200,
      messages: [
        { role: "system", content: NARRATOR_SYSTEM },
        { role: "user", content: JSON.stringify(result) },
      ],
    });
    // Some local models (notably Gemma 4 via Ollama's /v1 endpoint) return empty
    // content with the text in a separate reasoning field; treat empty/whitespace
    // as a miss and fall back to the deterministic mock rather than print nothing.
    const text = res.choices[0]?.message?.content?.trim();
    return text ? text : await mockNarrate(result, state);
  } catch {
    return mockNarrate(result, state);
  }
};
