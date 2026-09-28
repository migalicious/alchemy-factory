import type { GameData } from '../model/types';
import type { PlanState } from '../state/plan';
import type { effectiveChoices } from '../state/plan';
import type { SolveResult } from '../solver/solve';
import type { HeatResult } from '../solver/heat';
import type { BuildOutcome } from '../solver/build';

export interface App {
  db: GameData;
  plan: PlanState;
  result: SolveResult;
  heat: HeatResult;
  eff: ReturnType<typeof effectiveChoices>;
  /** Build mode: what the machine counts reach, and where it chokes. */
  build?: BuildOutcome & { aimMachines: Record<string, number> };
  /** Same plan solved with coins ignored, to show what the coin weight buys. */
  coinCompare?: { coinsSaved: number; extraMachines: number };
  /** Mutate the plan, re-solve and re-render everything. */
  update(mutate?: (p: PlanState) => void): void;
  openPicker(item: string): void;
}
