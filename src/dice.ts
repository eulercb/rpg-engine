// ---------------------------------------------------------------------------
// dice.ts
// The ONLY place randomness enters the system. The resolver owns this; the
// LLM never touches it. Seedable so demos and tests are reproducible.
// ---------------------------------------------------------------------------

import type { DieRoll, D20Roll, RollMode } from "./types";

export type RNG = () => number; // returns a float in [0, 1)

// Small, fast, deterministic PRNG. Good enough for a game; not cryptographic.
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(sides: number, rng: RNG): number {
  return Math.floor(rng() * sides) + 1;
}

// Parse and roll a damage expression like "2d6" or "1d8".
export function rollExpr(expr: string, rng: RNG): DieRoll[] {
  const match = /^(\d+)d(\d+)$/.exec(expr.trim());
  if (!match) throw new Error(`Unsupported dice expression: "${expr}"`);
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const rolls: DieRoll[] = [];
  for (let i = 0; i < count; i++) rolls.push({ sides, result: rollDie(sides, rng) });
  return rolls;
}

// A d20 roll honouring advantage/disadvantage. Note the 5e rule: any single
// source of advantage and any single source of disadvantage cancel to a
// straight roll, regardless of how many of each — that netting happens in the
// resolver before this is called, so here `mode` is already final.
export function rollD20(mode: RollMode, rng: RNG): D20Roll {
  const first = rollDie(20, rng);
  if (mode === "normal") {
    return {
      rolls: [first],
      mode,
      chosen: first,
      natural20: first === 20,
      natural1: first === 1,
    };
  }
  const second = rollDie(20, rng);
  const chosen = mode === "advantage" ? Math.max(first, second) : Math.min(first, second);
  return {
    rolls: [first, second],
    mode,
    chosen,
    natural20: chosen === 20,
    natural1: chosen === 1,
  };
}

// Net a set of advantage/disadvantage sources into a final roll mode.
export function netMode(hasAdvantage: boolean, hasDisadvantage: boolean): RollMode {
  if (hasAdvantage && hasDisadvantage) return "normal";
  if (hasAdvantage) return "advantage";
  if (hasDisadvantage) return "disadvantage";
  return "normal";
}
