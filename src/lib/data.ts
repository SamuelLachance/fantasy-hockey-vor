import type { ProjectionsDataset } from "@/lib/types";
import dataset from "@/data/players.json";

export function getProjections(): ProjectionsDataset {
  return dataset as ProjectionsDataset;
}

export function getPlayerById(id: number) {
  const data = getProjections();
  return data.players.find((p) => p.id === id);
}
