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
      system:
        "You narrate the outcome of one D&D action in 1-2 vivid sentences. You are given the resolved mechanical truth as JSON. Honour every number and the hit/success outcome exactly; never change what happened. Do not invent new mechanics or rolls.",
      messages: [{ role: "user", content: JSON.stringify(result) }],
    });
    const text = msg.content.find((b: any) => b.type === "text") as any;
    return text?.text ?? (await mockNarrate(result, state));
  } catch {
    return mockNarrate(result, state);
  }
};
