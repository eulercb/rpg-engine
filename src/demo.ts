// ---------------------------------------------------------------------------
// demo.ts
// An interactive one-on-one duel. You type what you do in plain words; the
// interpreter turns it into a structured action, code validates + resolves it,
// and the narrator describes the result. The enemy then takes its own turn.
// The fight runs until the player or the enemy drops to 0 HP.
//
// Defaults to the OFFLINE mock interpreter + narrator so it runs with no API key
// and no network. Pick a live backend with the RPG_LLM env var:
//
//   npx tsx src/demo.ts                 # mock   (default; offline)
//   RPG_LLM=local  npx tsx src/demo.ts  # local OpenAI-compatible server (Ollama)
//   RPG_LLM=claude npx tsx src/demo.ts  # Anthropic API (needs ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { sampleState, advanceTurn, type Combatant, type GameState } from "./state";
import { mulberry32 } from "./dice";
import { mockInterpret, llmInterpret, localInterpret, type Interpreter } from "./interpreter";
import { mockNarrate, llmNarrate, localNarrate, type Narrator } from "./narrator";
import { runTurn, resolveAction, type TurnTrace } from "./engine";
import type { Action } from "./types";

// Backend selection. Defaults to the offline mock so `npm run demo` always runs
// with no key and no network. The SDKs behind the live paths are imported
// lazily inside their functions, so naming them here costs nothing until used.
const BACKEND = process.env.RPG_LLM ?? "mock";
const INTERPRETERS: Record<string, Interpreter> = {
  mock: mockInterpret,
  local: localInterpret,
  claude: llmInterpret,
};
const NARRATORS: Record<string, Narrator> = {
  mock: mockNarrate,
  local: localNarrate,
  claude: llmNarrate,
};

// A small HP bar so the numbers the player is fighting over are easy to read.
function hpBar(c: Combatant): string {
  const width = 10;
  const filled = Math.max(0, Math.round((Math.max(0, c.hp) / c.maxHp) * width));
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

// Both combatants' HP and AC — the stats the attack loop turns on.
function printStatus(state: GameState) {
  const lines = state.turnOrder
    .map((id) => state.combatants[id])
    .map((c) => `${c.name.padEnd(7)} ${hpBar(c)} ${String(Math.max(0, c.hp)).padStart(2)}/${c.maxHp} HP   AC ${c.ac}`);
  console.log(`\n  ${lines.join("\n  ")}`);
}

// Show every layer's output, so the interpret -> validate -> resolve -> narrate
// pipeline stays visible. The header echoes the player's words; an enemy turn is
// labelled plainly since no one typed it.
function printTrace(state: GameState, t: TurnTrace) {
  const actor = state.combatants[t.actorId];
  const who = actor?.name ?? t.actorId;
  console.log(actor?.isPlayer ? `\n${who}: ${t.input}` : `\n${who} (enemy turn):`);
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

// The enemy's "AI": pick a legal attack against a living player with whatever
// weapon it's holding. This is code, not the LLM — an NPC never needs the
// interpreter; it just hands a chosen action to the same validate/resolve path.
function chooseEnemyAction(state: GameState, actorId: string): Action {
  const self = state.combatants[actorId];
  const target =
    Object.values(state.combatants).find((c) => c.id !== actorId && c.isPlayer && c.hp > 0) ??
    Object.values(state.combatants).find((c) => c.id !== actorId && c.hp > 0);
  return { kind: "weapon_attack", target_id: target!.id, weapon_id: self.inventory[0] };
}

async function main() {
  // Seed-reproducible by default (invariant: same seed + inputs -> same trace);
  // set RPG_SEED to roll a different fight.
  const seed = process.env.RPG_SEED ? Number(process.env.RPG_SEED) : 20260607;
  const state = sampleState();
  const interpret = INTERPRETERS[BACKEND] ?? mockInterpret;
  const narrate = NARRATORS[BACKEND] ?? mockNarrate;
  const deps = { interpret, narrate, rng: mulberry32(seed) };

  const player = Object.values(state.combatants).find((c) => c.isPlayer)!;
  const enemy = Object.values(state.combatants).find((c) => !c.isPlayer)!;

  console.log(`=== Duel: ${player.name} vs ${enemy.name} ===`);
  console.log(`(LLM backend: ${BACKEND}${BACKEND === "mock" ? ", offline" : ""}; seed ${seed})`);
  console.log(
    `Describe your attack in your own words — e.g. "I swing my longsword at the goblin"\n` +
      `or "stab it with my dagger". The fight ends when one of you drops. Type "quit" to flee.`,
  );

  const rl = readline.createInterface({ input, output });
  const askPrompt = () => output.write(`\n${player.name}, what do you do? > `);

  printStatus(state);
  askPrompt();

  // One iteration per line the player types. The async iterator buffers input,
  // so it behaves the same whether typed at a prompt or piped in.
  for await (const line of rl) {
    const text = line.trim();
    if (!text) {
      askPrompt();
      continue;
    }
    if (/^(quit|exit|q)$/i.test(text)) break;

    // Player's turn: free text -> action -> resolved truth -> narration.
    printTrace(state, await runTurn(state, player.id, text, deps));
    if (enemy.hp <= 0) break;

    // Enemy's turn: a code-chosen attack runs the same validate/resolve/narrate.
    advanceTurn(state); // -> enemy
    printTrace(state, await resolveAction(state, enemy.id, `${enemy.name} attacks`, chooseEnemyAction(state, enemy.id), deps));
    if (player.hp <= 0) break;

    advanceTurn(state); // -> back to the player; action economy reset
    printStatus(state);
    askPrompt();
  }

  rl.close();

  printStatus(state);
  if (enemy.hp <= 0 && player.hp > 0) {
    console.log(`\n${enemy.name} collapses. ${player.name} wins the duel!`);
  } else if (player.hp <= 0) {
    console.log(`\n${player.name} falls. ${enemy.name} wins the duel.`);
  } else {
    console.log(`\n${player.name} breaks off the fight.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
