import { createSeedData } from "../src/state";
import type { CockpitData } from "../src/types";

export function seededData(): CockpitData {
  return createSeedData();
}
