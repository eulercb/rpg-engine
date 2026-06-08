// ---------------------------------------------------------------------------
// engine.ts
// The loop. interpret -> validate -> resolve -> narrate, in that strict order.
// Narration is ALWAYS last and is handed the mechanical truth; it is never
// asked to invent an outcome. Invalid actions short-circuit to a player-facing
// "you can't" message and never reach the resolver.
// ---------------------------------------------------------------------------

import type { Action, ResolutionResult, ValidationResult } from "./types";
import type { GameState } from "./state";
import type { RNG } from "./dice";
import type { Interpreter } from "./interpreter";
import type { Narrator } from "./narrator";
import { validate } from "./validator";
import { resolve } from "./resolver";

export interface TurnDeps {
  interpret: Interpreter;
  narrate: Narrator;
  rng: RNG;
}

// Full trace of one turn, so every layer's output is inspectable.
export interface TurnTrace {
  actorId: string;
  input: string;
  action: Action;
  validation: ValidationResult;
  result?: ResolutionResult;
  narration: string;
}

// validate -> resolve -> narrate for an action that has ALREADY been chosen.
// The player path reaches this via runTurn (after the LLM interprets free text);
// an NPC reaches it directly, with an action picked by code instead of a model.
// Either way the action runs the same validator and resolver — the interpreter
// is the only layer an NPC skips, and the mechanical truth is owned by code
// regardless of who proposed the action.
export async function resolveAction(
  state: GameState,
  actorId: string,
  input: string,
  action: Action,
  deps: { narrate: Narrator; rng: RNG },
): Promise<TurnTrace> {
  // validate: is it legal for this character in this state?
  const validation = validate(state, actorId, action);
  if (!validation.ok) {
    return { actorId, input, action, validation, narration: `You can't do that: ${validation.reason}` };
  }

  // resolve: deterministic 5e math, mutates state, returns the truth
  const result = resolve(state, actorId, validation.action, deps.rng);

  // narrate: reword the truth, never contradict it
  const narration = await deps.narrate(result, state);

  return { actorId, input, action, validation, result, narration };
}

export async function runTurn(
  state: GameState,
  actorId: string,
  input: string,
  deps: TurnDeps,
): Promise<TurnTrace> {
  // interpret: free text -> structured action, then run the rest of the pipeline
  const action = await deps.interpret(input, state, actorId);
  return resolveAction(state, actorId, input, action, deps);
}
