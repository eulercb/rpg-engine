// ---------------------------------------------------------------------------
// validator.ts
// Sits between interpreter and resolver. Its job is to turn "the model emitted
// a structured action" into "this action is legal for THIS character in THIS
// state" — or a clean, player-facing reason why not. No dice here.
// ---------------------------------------------------------------------------

import type { Action, ValidationResult } from "./types";
import type { GameState } from "./state";

export function validate(state: GameState, actorId: string, action: Action): ValidationResult {
  const actor = state.combatants[actorId];
  if (!actor) return { ok: false, reason: `Unknown actor "${actorId}".` };

  switch (action.kind) {
    case "weapon_attack": {
      // Action economy: a weapon attack costs your action.
      if (actorId === state.currentTurn && !actor.economy.action) {
        return { ok: false, reason: `${actor.name} has already used an action this turn.` };
      }
      const weapon = state.weapons[action.weapon_id];
      if (!weapon) return { ok: false, reason: `No such weapon "${action.weapon_id}".` };
      if (!actor.inventory.includes(weapon.id)) {
        return { ok: false, reason: `${actor.name} isn't wielding a ${weapon.name}.` };
      }
      const target = state.combatants[action.target_id];
      if (!target) return { ok: false, reason: `No such target "${action.target_id}".` };
      if (target.hp <= 0) return { ok: false, reason: `${target.name} is already down.` };
      return { ok: true, action };
    }

    case "ability_check": {
      // Ability checks are cheap here; we only sanity-check references.
      if (action.contest_target_id && !state.combatants[action.contest_target_id]) {
        return { ok: false, reason: `No such contest target "${action.contest_target_id}".` };
      }
      return { ok: true, action };
    }

    case "freeform": {
      // The escape hatch is always structurally valid — its legality is a
      // judgement call the resolver makes via the (clamped) proposal. We only
      // guard against an empty proposal.
      if (!action.proposal) {
        return { ok: false, reason: "Freeform action arrived without an adjudication proposal." };
      }
      return { ok: true, action };
    }
  }
}
