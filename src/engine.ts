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
  input: string;
  action: Action;
  validation: ValidationResult;
  result?: ResolutionResult;
  narration: string;
}

export async function runTurn(
  state: GameState,
  actorId: string,
  input: string,
  deps: TurnDeps,
): Promise<TurnTrace> {
  // 1. interpret: free text -> structured action
  const action = await deps.interpret(input, state, actorId);

  // 2. validate: is it legal for this character in this state?
  const validation = validate(state, actorId, action);
  if (!validation.ok) {
    return { input, action, validation, narration: `You can't do that: ${validation.reason}` };
  }

  // 3. resolve: deterministic 5e math, mutates state, returns the truth
  const result = resolve(state, actorId, validation.action, deps.rng);

  // 4. narrate: reword the truth, never contradict it
  const narration = await deps.narrate(result, state);

  return { input, action, validation, result, narration };
}
