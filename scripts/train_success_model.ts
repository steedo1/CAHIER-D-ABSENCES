import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env"
  );
}

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type Sample = {
  label_id: string;
  target_level: string | null;
  success_label: boolean | null;

  current_general_avg_20: number | null;
  current_presence_rate: number | null;
  current_conduct_total_20: number | null;
  current_bonus_points_total: number | null;
  current_draft_ratio: number | null;
  current_class_size: number | null;
};

type LevelGroup = {
  level: string; // ex: '6e' ou 'ALL'
  samples: Sample[];
};

function isStringOrNull(v: any): v is string | null {
  return v === null || typeof v === "string";
}
function isBooleanOrNull(v: any): v is boolean | null {
  return v === null || typeof v === "boolean";
}
function isNumberOrNull(v: any): v is number | null {
  return v === null || typeof v === "number";
}

/**
 * Garde-fou runtime + fix TS:
 * Sur certains projets, supabase-js infère `data` comme `GenericStringError[]`
 * si la table n'est pas présente dans les types générés. On convertit vers
 * `unknown[]` puis on filtre/valide pour obtenir `Sample[]` proprement.
 */
function isSample(x: any): x is Sample {
  return (
    x &&
    typeof x === "object" &&
    typeof (x as any).label_id === "string" &&
    isStringOrNull((x as any).target_level) &&
    isBooleanOrNull((x as any).success_label) &&
    isNumberOrNull((x as any).current_general_avg_20) &&
    isNumberOrNull((x as any).current_presence_rate) &&
    isNumberOrNull((x as any).current_conduct_total_20) &&
    isNumberOrNull((x as any).current_bonus_points_total) &&
    isNumberOrNull((x as any).current_draft_ratio) &&
    isNumberOrNull((x as any).current_class_size)
  );
}

function normalizeFeatures(s: Sample) {
  const x1_general = Number.isFinite(s.current_general_avg_20 as number)
    ? Math.max(0, Math.min(1, (s.current_general_avg_20 as number) / 20))
    : 0.5;

  const x2_presence = Number.isFinite(s.current_presence_rate as number)
    ? Math.max(0, Math.min(1, s.current_presence_rate as number))
    : 0.9;

  const x3_conduct = Number.isFinite(s.current_conduct_total_20 as number)
    ? Math.max(0, Math.min(1, (s.current_conduct_total_20 as number) / 20))
    : 0.75;

  const bonus = Number.isFinite(s.current_bonus_points_total as number)
    ? (s.current_bonus_points_total as number)
    : 0;
  const x4_bonus = Math.max(0, Math.min(1, 1 - bonus / 5));

  const draft = Number.isFinite(s.current_draft_ratio as number)
    ? (s.current_draft_ratio as number)
    : 0;
  const x5_draft = Math.max(0, Math.min(1, 1 - draft));

  const size = Number.isFinite(s.current_class_size as number)
    ? (s.current_class_size as number)
    : 40;
  const x6_class = Math.max(0, Math.min(1, 1 - (size - 30) / 50));

  return [x1_general, x2_presence, x3_conduct, x4_bonus, x5_draft, x6_class];
}

function trainLogistic(samples: Sample[]) {
  if (!samples.length) {
    throw new Error("No samples for this level");
  }

  const X: number[][] = [];
  const y: number[] = [];

  for (const s of samples) {
    if (s.success_label === null || s.success_label === undefined) continue;
    const features = normalizeFeatures(s); // 6
    X.push([1, ...features]); // biais + 6 features => 7
    y.push(s.success_label ? 1 : 0);
  }

  const n = X.length;
  if (!n) {
    throw new Error("No valid samples with label");
  }

  const dim = 7; // w0..w6
  let w = new Array(dim).fill(0); // initialisation
  const lr = 0.1;
  const epochs = 800;

  const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array(dim).fill(0);

    for (let i = 0; i < n; i++) {
      const xi = X[i];
      const yi = y[i];

      let z = 0;
      for (let j = 0; j < dim; j++) {
        z += w[j] * xi[j];
      }
      const p = sigmoid(z);
      const error = p - yi;

      for (let j = 0; j < dim; j++) {
        grad[j] += error * xi[j];
      }
    }

    for (let j = 0; j < dim; j++) {
      w[j] -= (lr * grad[j]) / n;
    }
  }

  let correct = 0;
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    let z = 0;
    for (let j = 0; j < dim; j++) {
      z += w[j] * xi[j];
    }
    const p = sigmoid(z);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === y[i]) correct++;
  }
  const accuracy = correct / n;

  return { w, accuracy, n_samples: n };
}

async function main() {
  console.log("🔍 Fetching training samples from ml_training_samples_v2...");

  const { data, error } = await supa
    .from("ml_training_samples_v2")
    .select(
      [
        "label_id",
        "target_level",
        "success_label",
        "current_general_avg_20",
        "current_presence_rate",
        "current_conduct_total_20",
        "current_bonus_points_total",
        "current_draft_ratio",
        "current_class_size",
      ].join(",")
    );

  if (error) {
    console.error("❌ Error fetching samples:", error);
    process.exit(1);
  }

  // ✅ FIX TS + robustesse runtime
  const raw: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
  const samples: Sample[] = raw.filter(isSample);

  if (raw.length !== samples.length) {
    console.log(
      `⚠️ Ignored ${raw.length - samples.length} invalid rows (typing mismatch / unexpected shape).`
    );
  }

  console.log(`✅ Loaded ${samples.length} samples`);

  if (!samples.length) {
    console.log("⚠️ No training data yet, aborting.");
    return;
  }

  const groups = new Map<string, Sample[]>();

  for (const s of samples) {
    const level = s.target_level || "ALL";
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level)!.push(s);
  }

  const allGroup: LevelGroup = {
    level: "ALL",
    samples: samples,
  };

  const levels = Array.from(groups.keys());

  console.log("📊 Levels detected:", levels.join(", "));

  for (const level of levels) {
    const groupSamples = groups.get(level)!;
    console.log(
      `\n🚀 Training model for level = ${level} (n=${groupSamples.length})`
    );

    try {
      const { w, accuracy, n_samples } = trainLogistic(groupSamples);
      console.log(
        `   -> accuracy=${(accuracy * 100).toFixed(1)}%, n=${n_samples}`
      );

      const [w0, w1, w2, w3, w4, w5, w6] = w;

      const { error: upsertError } = await supa.from("ml_success_models").upsert(
        {
          model_scope: "level",
          level,
          feature_version: "v2",
          n_samples,
          w0,
          w1,
          w2,
          w3,
          w4,
          w5,
          w6,
          metrics: {
            accuracy,
          },
        },
        {
          onConflict: "model_scope,level,feature_version",
        }
      );

      if (upsertError) {
        console.error(
          `   ❌ Error saving model for level ${level}:`,
          upsertError
        );
      } else {
        console.log(`   ✅ Model saved for level ${level}`);
      }
    } catch (e: any) {
      console.error(
        `   ❌ Training failed for level ${level}:`,
        e.message || e
      );
    }
  }

  console.log(`\n🚀 Training global model (scope=global, level=ALL)...`);
  try {
    const { w, accuracy, n_samples } = trainLogistic(allGroup.samples);
    console.log(
      `   -> accuracy=${(accuracy * 100).toFixed(1)}%, n=${n_samples}`
    );

    const [w0, w1, w2, w3, w4, w5, w6] = w;

    const { error: upsertError } = await supa.from("ml_success_models").upsert(
      {
        model_scope: "global",
        level: "ALL",
        feature_version: "v2",
        n_samples,
        w0,
        w1,
        w2,
        w3,
        w4,
        w5,
        w6,
        metrics: {
          accuracy,
        },
      },
      {
        onConflict: "model_scope,level,feature_version",
      }
    );

    if (upsertError) {
      console.error("   ❌ Error saving global model:", upsertError);
    } else {
      console.log("   ✅ Global model saved (ALL)");
    }
  } catch (e: any) {
    console.error("   ❌ Training failed for global model:", e.message || e);
  }

  console.log("\n✨ done.");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
