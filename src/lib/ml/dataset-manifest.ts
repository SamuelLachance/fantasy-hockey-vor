/**
 * Identity of the ML dataset (src/data/ml/dataset.json, gitignored).
 *
 * Inference reads every player's history from that file, so the published
 * board is only as sound as the match between it and the dataset the v2
 * bundle was trained on. The 2026-07-30 board was generated with a dataset
 * that no longer matched training: raw forward goal rates +46 %, model GP
 * 50.6 on average (max 69) against 56.8 (max 82) with the matching file.
 * The rates were rescued by the post-hoc rate calibration; the games were
 * not, and nothing flagged it.
 *
 * The manifest (builtAt, row count, sha1 of the file's bytes) is written
 * into the bundle by `npm run ml:train-v2` and into the board's
 * dataManifest by `npm run generate`, which refuses to write when the
 * dataset on disk is not the one the bundle was trained on.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { MlDataset } from "./types";

export const DATASET_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

export interface DatasetManifest {
  builtAt: string;
  rows: number;
  seasons: number;
  sha1: string;
}

/** Manifest of a dataset file's raw bytes (sha1 over the exact bytes). */
export function datasetManifestOf(raw: string | Buffer, parsed?: MlDataset): DatasetManifest {
  const data = parsed ?? (JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as MlDataset);
  return {
    builtAt: data.builtAt,
    rows: data.rows.length,
    seasons: data.seasonIds.length,
    sha1: createHash("sha1").update(raw).digest("hex"),
  };
}

export function readDatasetManifest(path = DATASET_PATH): DatasetManifest | null {
  if (!existsSync(path)) return null;
  return datasetManifestOf(readFileSync(path));
}

/** The dataset fields a bundle records about what it was trained on. */
export interface BundleDatasetStamp {
  trainedAt?: string;
  datasetBuiltAt?: string;
  datasetSha1?: string;
  datasetRows?: number;
}

/**
 * Null when the dataset is the one the bundle was trained on, else why not.
 * A bundle stamped with a sha1 is matched on it (exact bytes); an older
 * bundle only recorded builtAt.
 */
export function datasetMismatch(
  bundle: BundleDatasetStamp,
  dataset: DatasetManifest,
): string | null {
  if (bundle.datasetSha1) {
    if (bundle.datasetSha1 !== dataset.sha1) {
      return `dataset.json sha1 ${dataset.sha1.slice(0, 12)} (built ${dataset.builtAt}, ${dataset.rows} rows) != the bundle's training dataset ${bundle.datasetSha1.slice(0, 12)} (built ${bundle.datasetBuiltAt}, ${bundle.datasetRows ?? "?"} rows)`;
    }
    return null;
  }
  if (bundle.datasetBuiltAt !== dataset.builtAt) {
    return `dataset.json built ${dataset.builtAt} != the bundle's training dataset built ${bundle.datasetBuiltAt}`;
  }
  return null;
}
