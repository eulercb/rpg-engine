// ---------------------------------------------------------------------------
// demo.ts
// Runs the loop end-to-end with the OFFLINE interpreter + narrator so you can
// see all four layers without an API key. Swap in llmInterpret / llmNarrate
// (and set ANTHROPIC_API_KEY) to go live.
//
//   npx tsx src/demo.ts
// ---------------------------------------------------------------------------

import { sampleState, advanceTurn } from "./state";
import { mulberry32 } from "./dice";
import { mockInterpret /*, llmInterpret */ } from "./interpreter";
import { mockNarrate /*, llmNarrate */ } from "./narrator";
import { runTurn, type TurnTrace } from "./engine";

function printTrace(t: TurnTrace) {
  console.log(`\nPLAYER: ${t.input}`);
  console.log(`  ├─ interpreted: ${JSON.stringify(t.action)}`);
  console.log(`  ├─ validated:   ${t.validation.ok ? "ok" : "REJECTED — " + t.validation.reason}`);
  if (t.result) {
    if (t.result.kind === "weapon_attack") {
      const r = t.result;
      console.log(
        `  ├─ resolved:    d20[${r.d20.rolls.join(",")}]=${r.d20.chosen} (${r.d20.mode}) -> ${r.attackTotal} vs AC ${r.targetAC} -> ${r.hit ? (r.critical ? "CRIT" : "hit") : "miss"}` +
          (r.damage ? `, ${r.damage.total} ${r.damage.type}` : ""),
      );
    } else {
      const r = t.result;
      console.log(
        `  ├─ resolved:    d20[${r.d20.rolls.join(",")}]=${r.d20.chosen} -> total ${r.total} vs DC ${r.dc} -> ${r.success ? "success" : "fail"}`,
      );
    }
  }
  console.log(`  └─ narration:   ${t.narration}`);
}

async function main() {
  const state = sampleState();
  const deps = { interpret: mockInterpret, narrate: mockNarrate, rng: mulberry32(20260607) };

  console.log("=== Thorin's turn (round 1) ===");

  // A clean weapon attack -> weapon_attack tool.
  printTrace(await runTurn(state, "thorin", "I swing my longsword at the goblin", deps));

  // A second attack the same turn -> validator catches the action-economy violation.
  printTrace(await runTurn(state, "thorin", "I attack the goblin again with my dagger", deps));

  // A clean knowledge check -> ability_check tool.
  printTrace(await runTurn(state, "thorin", "I try to recall what I know about goblin warbands", deps));

  // Advance to a fresh turn so the action is available again.
  advanceTurn(state); // goblin
  advanceTurn(state); // back to thorin, economy reset
  console.log("\n=== Thorin's turn (round 2) ===");

  // An action the rules don't cover -> escape hatch -> adjudicated check.
  printTrace(await runTurn(state, "thorin", "I kick the heavy table over to pin the goblin against the wall", deps));

  console.log(`\nFinal goblin HP: ${state.combatants.goblin.hp}/${state.combatants.goblin.maxHp}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
