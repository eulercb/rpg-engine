// ---------------------------------------------------------------------------
// state.ts
// The authoritative game state and the sample content the demo runs on.
// The resolver mutates this; the interpreter only READS a projection of it
// (see buildContext) so the model knows what the character can actually do.
// ---------------------------------------------------------------------------

import type { Ability, Skill } from "./types";

export interface Weapon {
  id: string;
  name: string;
  damage: string; // e.g. "1d8"
  damageType: string; // "slashing"
  finesse?: boolean; // may use the higher of STR/DEX
  ranged?: boolean; // uses DEX
  ability?: Ability; // explicit override
}

export interface TurnEconomy {
  action: boolean; // true = still available
  bonus: boolean;
  reaction: boolean;
  movementRemaining: number;
}

export interface Combatant {
  id: string;
  name: string;
  isPlayer: boolean;
  abilities: Record<Ability, number>;
  proficiencyBonus: number;
  ac: number;
  hp: number;
  maxHp: number;
  speed: number;
  conditions: string[]; // e.g. ["prone", "poisoned"]
  proficientSkills: Skill[];
  proficientWeapons: string[]; // weapon ids
  inventory: string[]; // weapon ids in hand/inventory
  economy: TurnEconomy;
}

export interface GameState {
  combatants: Record<string, Combatant>;
  weapons: Record<string, Weapon>;
  turnOrder: string[];
  currentTurn: string;
  round: number;
}

// 5e ability modifier.
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function freshEconomy(speed: number): TurnEconomy {
  return { action: true, bonus: true, reaction: true, movementRemaining: speed };
}

// Reset the current combatant's turn economy and advance initiative.
export function advanceTurn(state: GameState): void {
  const idx = state.turnOrder.indexOf(state.currentTurn);
  const nextIdx = (idx + 1) % state.turnOrder.length;
  if (nextIdx === 0) state.round += 1;
  state.currentTurn = state.turnOrder[nextIdx];
  const c = state.combatants[state.currentTurn];
  c.economy = freshEconomy(c.speed);
}

// ---------------------------------------------------------------------------
// Sample weapons + a one-on-one encounter to exercise the loop.
// ---------------------------------------------------------------------------

export function sampleState(): GameState {
  const weapons: Record<string, Weapon> = {
    longsword: { id: "longsword", name: "longsword", damage: "1d8", damageType: "slashing" },
    dagger: { id: "dagger", name: "dagger", damage: "1d4", damageType: "piercing", finesse: true },
    shortbow: { id: "shortbow", name: "shortbow", damage: "1d6", damageType: "piercing", ranged: true },
  };

  const thorin: Combatant = {
    id: "thorin",
    name: "Thorin",
    isPlayer: true,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 11, cha: 8 },
    proficiencyBonus: 2,
    ac: 16,
    hp: 12,
    maxHp: 12,
    speed: 30,
    conditions: [],
    proficientSkills: ["athletics", "intimidation", "perception"],
    proficientWeapons: ["longsword", "dagger", "shortbow"],
    inventory: ["longsword", "dagger"],
    economy: freshEconomy(30),
  };

  const goblin: Combatant = {
    id: "goblin",
    name: "Goblin",
    isPlayer: false,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    proficiencyBonus: 2,
    ac: 15,
    hp: 7,
    maxHp: 7,
    speed: 30,
    conditions: [],
    proficientSkills: ["stealth"],
    proficientWeapons: ["dagger", "shortbow"],
    inventory: ["dagger"],
    economy: freshEconomy(30),
  };

  return {
    combatants: { thorin, goblin },
    weapons,
    turnOrder: ["thorin", "goblin"],
    currentTurn: "thorin",
    round: 1,
  };
}
