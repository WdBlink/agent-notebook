import { createSeedData } from "../src/state";
import type { CockpitData } from "../src/types";

export function seededData(): CockpitData {
  return createSeedData();
}

export function fullTodayData(): CockpitData {
  const data = createSeedData();
  const timestamp = "2026-07-02T09:00:00.000Z";
  return {
    ...data,
    items: [
      ...data.items,
      {
        id: "today-2",
        title: "第二件今天要守住的事",
        body: "保持边界。",
        state: "today",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "today-3",
        title: "第三件今天要守住的事",
        body: "只做必要的。",
        state: "today",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "today-4",
        title: "第四件今天要守住的事",
        body: "不要扩张范围。",
        state: "today",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "today-5",
        title: "第五件今天要守住的事",
        body: "达到上限。",
        state: "today",
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}
