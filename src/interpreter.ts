// ---------------------------------------------------------------------------
// interpreter.ts
// Free text -> structured Action. This is the ONLY layer with creative freedom.
// Two implementations share one signature:
//   - llmInterpret:  real Claude tool-calling (needs ANTHROPIC_API_KEY)
//   - mockInterpret: deterministic keyword matcher, so the loop runs offline
// The model is grounded in a *projection* of state (what the character can
// actually do) so it can't invent capabilities — anything it does invent is
// caught later by the validator.
// ---------------------------------------------------------------------------

import type { Action } from "./types";
import type { GameState } from "./state";

export type Interpreter = (input: string, state: GameState, actorId: string) => Promise<Action>;

// What the model is allowed to see about the acting character. Deliberately
// narrow: enough to choose a legal action, nothing that leaks hidden state.
export function buildContext(state: GameState, actorId: string) {
  const actor = state.combatants[actorId];
  const enemies = Object.values(state.combatants).filter((c) => c.id !== actorId && c.hp > 0);
  return {
    self: {
      id: actor.id,
      name: actor.name,
      hp: `${actor.hp}/${actor.maxHp}`,
      conditions: actor.conditions,
      weapons_in_hand: actor.inventory,
      proficient_skills: actor.proficientSkills,
      action_available: actor.economy.action,
    },
    visible_targets: enemies.map((e) => ({ id: e.id, name: e.name })),
  };
}

// ---------------------------------------------------------------------------
// Tool schemas. Each 5e action type is a tool with a strict schema, so the
// model fills typed arguments rather than writing free JSON.
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "weapon_attack",
    description: "Attack a visible target with a weapon the character is wielding.",
    input_schema: {
      type: "object",
      properties: {
        target_id: { type: "string", description: "id of the target from visible_targets" },
        weapon_id: { type: "string", description: "id of a weapon from weapons_in_hand" },
      },
      required: ["target_id", "weapon_id"],
    },
  },
  {
    name: "ability_check",
    description: "Resolve a deliberate non-combat attempt that maps cleanly to one ability/skill.",
    input_schema: {
      type: "object",
      properties: {
        ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
        skill: { type: "string" },
        dc: { type: "number", description: "omit unless a specific DC is obviously implied" },
      },
      required: ["ability"],
    },
  },
  {
    name: "freeform_action",
    description:
      "Use ONLY when the action doesn't fit another tool. Describe it and PROPOSE how to adjudicate it. You propose the difficulty band; the engine sets the actual DC and rolls.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
        skill: { type: "string" },
        difficulty: {
          type: "string",
          enum: ["very_easy", "easy", "medium", "hard", "very_hard", "nearly_impossible"],
        },
        rationale: { type: "string", description: "one sentence: why this ability and band" },
      },
      required: ["description", "ability", "difficulty", "rationale"],
    },
  },
];

const SYSTEM_PROMPT = `You are the rules interpreter for a D&D 5e game. Convert the player's free-text intent into exactly ONE tool call.
Rules:
- Choose weapon_attack or ability_check when the intent maps cleanly to them.
- Use only target ids and weapon ids present in the provided context. Never invent capabilities.
- If the intent fits nothing else, use freeform_action and PROPOSE an ability and difficulty band. You never set DCs or roll dice — the engine does.
- Do not narrate outcomes. Emit the tool call only.`;

function toAction(toolName: string, input: any): Action {
  switch (toolName) {
    case "weapon_attack":
      return { kind: "weapon_attack", target_id: input.target_id, weapon_id: input.weapon_id };
    case "ability_check":
      return { kind: "ability_check", ability: input.ability, skill: input.skill, dc: input.dc };
    case "freeform_action":
      return {
        kind: "freeform",
        description: input.description,
        proposal: {
          ability: input.ability,
          skill: input.skill,
          difficulty: input.difficulty,
          rationale: input.rationale,
        },
      };
    default:
      throw new Error(`Model called unknown tool "${toolName}".`);
  }
}

// Real interpreter. SDK is imported lazily so the offline demo needs neither
// the dependency installed nor an API key.
export const llmInterpret: Interpreter = async (input, state, actorId) => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

  const context = buildContext(state, actorId);
  const msg = await client.messages.create({
    model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: TOOLS as any,
    tool_choice: { type: "any" }, // force a tool call
    messages: [
      {
        role: "user",
        content: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nPLAYER SAYS: "${input}"`,
      },
    ],
  });

  const toolUse = msg.content.find((b: any) => b.type === "tool_use") as any;
  if (!toolUse) throw new Error("Model did not return a tool call.");
  return toAction(toolUse.name, toolUse.input);
};

// ---------------------------------------------------------------------------
// Local interpreter. Same contract and same grounding as llmInterpret, but
// talks to any OpenAI-compatible server (Ollama by default; also llama.cpp,
// LM Studio, vLLM — switch by changing LOCAL_LLM_BASE_URL). The one hard
// requirement is that the model supports TOOL CALLING: we force a tool call
// (tool_choice "required") to keep output structured, never prose. SDK is
// imported lazily so the offline demo needs neither the dep nor a server.
// ---------------------------------------------------------------------------

// The same TOOLS, reshaped into OpenAI's function-tool envelope. The schemas
// stay the single source of truth; only the wrapper differs from Anthropic.
const OPENAI_TOOLS = TOOLS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

export const localInterpret: Interpreter = async (input, state, actorId) => {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    baseURL: process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:11434/v1",
    apiKey: process.env.LOCAL_LLM_API_KEY ?? "ollama", // Ollama ignores it; the SDK requires a value
  });
  const model = process.env.LOCAL_INTERPRETER_MODEL ?? process.env.LOCAL_LLM_MODEL ?? "gemma4:26b";

  const context = buildContext(state, actorId);
  const res = await client.chat.completions.create({
    model,
    max_tokens: 512,
    tools: OPENAI_TOOLS as any,
    tool_choice: "required", // force a tool call (OpenAI's equivalent of Anthropic's {type:"any"})
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nPLAYER SAYS: "${input}"`,
      },
    ],
  });

  const message: any = res.choices[0]?.message;
  const call: any = message?.tool_calls?.[0];
  if (!call) {
    // Some local models (notably Gemma via Ollama) reply with prose — or leak the
    // tool-call JSON into `content` — instead of a parsed tool call. Surface what
    // they said so the failure is diagnosable, and fail loudly: we never scrape a
    // tool call out of free text (invariant: structured tool calls only).
    const said = String(message?.content ?? "").trim();
    throw new Error(
      "Local model did not return a tool call" +
        (said ? `; it replied with text instead: ${JSON.stringify(said.slice(0, 200))}` : "") +
        '. The interpreter needs a tool-calling model — see the README "Run against a local model" notes.',
    );
  }
  // OpenAI returns tool arguments as a JSON *string*; Anthropic returned a parsed object.
  const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
  return toAction(call.function.name, args);
};

// ---------------------------------------------------------------------------
// Offline mock. Crude keyword matching — enough to drive the full loop without
// a network call. Swap llmInterpret in for the real thing.
// ---------------------------------------------------------------------------

export const mockInterpret: Interpreter = async (input, state, actorId) => {
  const text = input.toLowerCase();
  const ctx = buildContext(state, actorId);
  const target = ctx.visible_targets[0]?.id ?? "goblin";

  const weaponHit = ctx.self.weapons_in_hand.find((w) => text.includes(w));
  if (/\b(attack|swing|strike|hit|slash|stab|shoot)\b/.test(text)) {
    return { kind: "weapon_attack", target_id: target, weapon_id: weaponHit ?? ctx.self.weapons_in_hand[0] };
  }
  if (/recall|remember|know|knowledge|lore/.test(text)) {
    return { kind: "ability_check", ability: "int", skill: "history" };
  }
  if (/persuade|convince|talk|negotiate/.test(text)) {
    return { kind: "ability_check", ability: "cha", skill: "persuasion" };
  }
  // Anything else falls through to the escape hatch with a proposal.
  return {
    kind: "freeform",
    description: input,
    proposal: {
      ability: "str",
      skill: "athletics",
      difficulty: "medium",
      rationale: "Improvised physical action; defaulting to a Strength (Athletics) check at medium difficulty.",
    },
  };
};
