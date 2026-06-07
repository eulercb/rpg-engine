// ---------------------------------------------------------------------------
// resolver.ts
// The deterministic heart. Given a VALID action, it rolls the dice, applies
// the 5e math, mutates state, and returns the mechanical truth. The LLM never
// reaches in here. This is also where rules-defined advantage is *computed*
// from state (as opposed to situational advantage, which the model can only
// propose — see the note below).
// ---------------------------------------------------------------------------

import {
  Action,
  AttackResult,
  CheckResult,
  DC_BANDS,
  ResolutionResult,
  SKILL_ABILITY,
  Ability,
  Skill,
} from "./types";
import { abilityMod, Combatant, GameState } from "./state";
import { RNG, netMode, rollD20, rollExpr } from "./dice";

// Which ability a weapon attack uses: explicit override, else DEX for ranged,
// else the better of STR/DEX for finesse, else STR.
function attackAbility(weaponAbility: Ability | undefined, ranged: boolean, finesse: boolean, c: Combatant): Ability {
  if (weaponAbility) return weaponAbility;
  if (ranged) return "dex";
  if (finesse) return abilityMod(c.abilities.str) >= abilityMod(c.abilities.dex) ? "str" : "dex";
  return "str";
}

// Rules-DEFINED advantage/disadvantage the resolver can read straight off state.
// (Situational advantage the model flags would be confirmed by an adjudicator
// step before reaching here; this scaffold only implements the by-the-book set.)
function meleeAdvantageVsTarget(target: Combatant): boolean {
  return target.conditions.includes("prone") || target.conditions.includes("restrained");
}
function attackerDisadvantage(attacker: Combatant): boolean {
  return attacker.conditions.includes("poisoned") || attacker.conditions.includes("prone");
}

export function resolveWeaponAttack(
  state: GameState,
  attackerId: string,
  action: Extract<Action, { kind: "weapon_attack" }>,
  rng: RNG,
): AttackResult {
  const attacker = state.combatants[attackerId];
  const target = state.combatants[action.target_id];
  const weapon = state.weapons[action.weapon_id];

  const abilityUsed = attackAbility(weapon.ability, !!weapon.ranged, !!weapon.finesse, attacker);
  const mod = abilityMod(attacker.abilities[abilityUsed]);
  const proficient = attacker.proficientWeapons.includes(weapon.id);
  const profBonus = proficient ? attacker.proficiencyBonus : 0;

  const hasAdv = !weapon.ranged && meleeAdvantageVsTarget(target);
  const hasDis = attackerDisadvantage(attacker);
  const d20 = rollD20(netMode(hasAdv, hasDis), rng);

  const attackTotal = d20.chosen + mod + profBonus;
  // Nat 20 always hits and crits; nat 1 always misses.
  const hit = d20.natural20 || (!d20.natural1 && attackTotal >= target.ac);
  const critical = d20.natural20;

  const result: AttackResult = {
    kind: "weapon_attack",
    attacker_id: attackerId,
    target_id: action.target_id,
    weapon_id: weapon.id,
    abilityUsed,
    proficient,
    d20,
    attackTotal,
    targetAC: target.ac,
    hit,
    critical,
    targetHpBefore: target.hp,
    targetHpAfter: target.hp,
  };

  if (hit) {
    // Crit doubles the damage DICE, not the modifier.
    const diceRolls = critical
      ? [...rollExpr(weapon.damage, rng), ...rollExpr(weapon.damage, rng)]
      : rollExpr(weapon.damage, rng);
    const diceTotal = diceRolls.reduce((s, r) => s + r.result, 0);
    const total = Math.max(0, diceTotal + mod);
    target.hp = Math.max(0, target.hp - total);
    result.damage = { rolls: diceRolls, modifier: mod, total, type: weapon.damageType };
    result.targetHpAfter = target.hp;
  }

  // Spend the action.
  if (attackerId === state.currentTurn) attacker.economy.action = false;
  return result;
}

const DEFAULT_DC = 12;

export function resolveAbilityCheck(
  state: GameState,
  actorId: string,
  action: Extract<Action, { kind: "ability_check" }>,
  rng: RNG,
  adjudicated?: CheckResult["adjudicated"],
): CheckResult {
  const actor = state.combatants[actorId];
  const mod = abilityMod(actor.abilities[action.ability]);
  const proficient = action.skill ? actor.proficientSkills.includes(action.skill) : false;
  const profBonus = proficient ? actor.proficiencyBonus : 0;

  const hasDis = actor.conditions.includes("poisoned");
  const d20 = rollD20(netMode(false, hasDis), rng);
  const total = d20.chosen + mod + profBonus;

  // A contest resolves against the opponent's passive-style roll; for the
  // scaffold we roll the opponent's relevant check and compare.
  let dc = action.dc ?? DEFAULT_DC;
  if (action.contest_target_id) {
    const opp = state.combatants[action.contest_target_id];
    const oppAbility: Ability = action.ability;
    const oppMod = abilityMod(opp.abilities[oppAbility]);
    const oppRoll = rollD20("normal", rng);
    dc = oppRoll.chosen + oppMod; // beat the opposed roll
  }

  return {
    kind: "ability_check",
    actor_id: actorId,
    ability: action.ability,
    skill: action.skill,
    proficient,
    d20,
    total,
    dc,
    success: total >= dc,
    adjudicated,
  };
}

// Freeform: take the model's PROPOSAL, clamp the band to a DC via the table,
// and run it as a normal ability check. The model proposed; the code disposes.
export function resolveFreeform(
  state: GameState,
  actorId: string,
  action: Extract<Action, { kind: "freeform" }>,
  rng: RNG,
): CheckResult {
  const { ability, skill, difficulty, rationale } = action.proposal;
  const dc = DC_BANDS[difficulty]; // band -> number happens ONLY here
  const check: Extract<Action, { kind: "ability_check" }> = {
    kind: "ability_check",
    ability,
    skill,
    dc,
  };
  return resolveAbilityCheck(state, actorId, check, rng, {
    description: action.description,
    difficulty,
    rationale,
  });
}

export function resolve(
  state: GameState,
  actorId: string,
  action: Action,
  rng: RNG,
): ResolutionResult {
  switch (action.kind) {
    case "weapon_attack":
      return resolveWeaponAttack(state, actorId, action, rng);
    case "ability_check":
      return resolveAbilityCheck(state, actorId, action, rng);
    case "freeform":
      return resolveFreeform(state, actorId, action, rng);
  }
}
