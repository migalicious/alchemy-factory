import type { GameData } from '../model/types';
import type { PlanState } from '../state/plan';
import type { effectiveChoices } from '../state/plan';
import type { SolveResult } from '../solver/solve';
import type { HeatResult } from '../solver/heat';

export interface App {
  db: GameData;
  plan: PlanState;
  result: SolveResult;
  heat: HeatResult;
  eff: ReturnType<typeof effectiveChoices>;
  /** Mutate the plan, re-solve and re-render everything. */
  update(mutate?: (p: PlanState) => void): void;
  openPicker(item: string): void;
}
