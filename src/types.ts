// ---------------------------------------------------------------------------
// types.ts
// The vocabulary shared by all four layers. Nothing in here knows *how* to
// interpret, validate, resolve, or narrate — it only describes the data that
// flows between those layers.
// ---------------------------------------------------------------------------

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type Skill =
  | "athletics"
  | "acrobatics"
  | "sleight_of_hand"
  | "stealth"
  | "arcana"
  | "history"
  | "investigation"
  | "nature"
  | "religion"
  | "animal_handling"
  | "insight"
  | "medicine"
  | "perception"
  | "survival"
  | "deception"
  | "intimidation"
  | "performance"
  | "persuasion";

// Which ability governs each skill (PHB).
export const SKILL_ABILITY: Record<Skill, Ability> = {
  athletics: "str",
  acrobatics: "dex",
  sleight_of_hand: "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  animal_handling: "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

// DMG "Typical Difficulty Classes" table. The adjudicator only ever picks a
// band; this table is the *only* place a band becomes a number, which keeps
// improvised DCs consistent across sessions.
export type DifficultyBand =
  | "very_easy"
  | "easy"
  | "medium"
  | "hard"
  | "very_hard"
  | "nearly_impossible";

export const DC_BANDS: Record<DifficultyBand, number> = {
  very_easy: 5,
  easy: 10,
  medium: 15,
  hard: 20,
  very_hard: 25,
  nearly_impossible: 30,
};

// ---------------------------------------------------------------------------
// The action contract — the structured output of the interpreter layer.
// A discriminated union: every variant carries exactly the fields its resolver
// needs and nothing else. `freeform` is the escape hatch that preserves player
// freedom, and it is the ONLY variant that carries LLM judgement (the proposal).
// ---------------------------------------------------------------------------

// The model PROPOSES this for an action the rules don't cover. Code clamps the
// band to a DC and decides whether to accept — the model never sets a number.
export interface ProposedAdjudication {
  ability: Ability;
  skill?: Skill;
  difficulty: DifficultyBand;
  rationale: string;
}

export type Action =
  | {
      kind: "weapon_attack";
      target_id: string;
      weapon_id: string;
    }
  | {
      kind: "ability_check";
      ability: Ability;
      skill?: Skill;
      dc?: number; // optional fixed DC; falls back to a default if omitted
      contest_target_id?: string; // if set, this is a contest, not a flat DC
    }
  | {
      kind: "freeform";
      description: string;
      proposal: ProposedAdjudication;
    };

export type ActionKind = Action["kind"];

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; action: Action }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Dice + resolution results. These are the "mechanical truth" handed to the
// narrator. The narrator may reword them but may never contradict them.
// ---------------------------------------------------------------------------

export interface DieRoll {
  sides: number;
  result: number;
}

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface D20Roll {
  rolls: number[]; // one die normally, two for adv/dis
  mode: RollMode;
  chosen: number; // the kept natural d20 (before modifiers)
  natural20: boolean;
  natural1: boolean;
}

export interface AttackResult {
  kind: "weapon_attack";
  attacker_id: string;
  target_id: string;
  weapon_id: string;
  abilityUsed: Ability;
  proficient: boolean;
  d20: D20Roll;
  attackTotal: number;
  targetAC: number;
  hit: boolean;
  critical: boolean;
  damage?: { rolls: DieRoll[]; modifier: number; total: number; type: string };
  targetHpBefore: number;
  targetHpAfter: number;
}

export interface CheckResult {
  kind: "ability_check";
  actor_id: string;
  ability: Ability;
  skill?: Skill;
  proficient: boolean;
  d20: D20Roll;
  total: number;
  dc: number;
  success: boolean;
  // Present only when this check came from an adjudicated freeform action.
  adjudicated?: {
    description: string;
    difficulty: DifficultyBand;
    rationale: string;
  };
}

export type ResolutionResult = AttackResult | CheckResult;
