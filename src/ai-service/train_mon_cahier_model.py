"""
Entraînement Mon Cahier IA v2.

Entrée attendue : JSON exporté par /api/admin/mon-cahier-ia/training-export
ou fichier JSON contenant une clé rows[]. Chaque ligne doit contenir :
- features_json : variables pédagogiques avant l'examen ;
- label_json.passed ou label_json.success : 0/1.

Exemple :
python train_mon_cahier_model.py --input ./exports/training_2025_2026.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, VotingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = [
    "general_avg_20",
    "raw_all_avg_20",
    "raw_core_avg_20",
    "presence_rate",
    "total_absent_hours",
    "nb_lates",
    "conduct_total_20",
    "conduct_norm",
    "core_completion_percent",
]


def as_float(value: Any) -> float:
    if value is None:
        return np.nan
    try:
        value = float(value)
        return value if np.isfinite(value) else np.nan
    except Exception:
        return np.nan


def get_label(label_json: Dict[str, Any]) -> int | None:
    for key in ["passed", "success", "admitted", "is_success"]:
        if key in label_json:
            value = label_json[key]
            if isinstance(value, bool):
                return 1 if value else 0
            if value in [0, 1, "0", "1"]:
                return int(value)
    final_average = label_json.get("final_average_20")
    if final_average is not None:
        try:
            return 1 if float(final_average) >= 10 else 0
        except Exception:
            return None
    return None


def load_rows(path: Path) -> Tuple[pd.DataFrame, np.ndarray]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = raw.get("rows", raw if isinstance(raw, list) else [])
    x_rows: List[Dict[str, float]] = []
    y_rows: List[int] = []

    for row in rows:
        if not row:
            continue
        features_json = row.get("features_json") or row.get("features") or {}
        label_json = row.get("label_json") or row.get("label") or {}
        label = get_label(label_json)
        if label is None:
            continue
        x_rows.append({name: as_float(features_json.get(name)) for name in FEATURES})
        y_rows.append(label)

    if len(y_rows) < 50:
        raise SystemExit(
            f"Pas assez de lignes étiquetées pour entraîner un modèle sérieux ({len(y_rows)}). Viser au moins 200, idéalement 1000+."
        )

    return pd.DataFrame(x_rows, columns=FEATURES), np.asarray(y_rows, dtype=int)


def build_model() -> Pipeline:
    logistic = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=2000, class_weight="balanced")),
        ]
    )
    forest = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("clf", RandomForestClassifier(n_estimators=250, random_state=42, class_weight="balanced", min_samples_leaf=3)),
        ]
    )
    boosting = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("clf", GradientBoostingClassifier(random_state=42)),
        ]
    )
    return VotingClassifier(
        estimators=[("logistic", logistic), ("forest", forest), ("boosting", boosting)],
        voting="soft",
        weights=[1, 2, 2],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Fichier JSON d'entraînement")
    parser.add_argument("--output", default="models/mon_cahier_ai_latest.joblib")
    parser.add_argument("--version", default="2.0.0-trained")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = Path(__file__).resolve().parent / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)

    x, y = load_rows(input_path)
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.25, random_state=42, stratify=y)

    model = build_model()
    model.fit(x_train, y_train)
    proba = model.predict_proba(x_test)[:, 1]
    pred = (proba >= 0.5).astype(int)

    metrics = {
        "rows_total": int(len(y)),
        "rows_train": int(len(y_train)),
        "rows_test": int(len(y_test)),
        "accuracy": float(accuracy_score(y_test, pred)),
        "roc_auc": float(roc_auc_score(y_test, proba)) if len(set(y_test)) > 1 else None,
        "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
        "classification_report": classification_report(y_test, pred, output_dict=True),
    }

    bundle = {
        "model_key": "mon_cahier_ai_pedagogy",
        "model_version": args.version,
        "features": FEATURES,
        "metrics": metrics,
        "model": model,
    }
    joblib.dump(bundle, output_path)

    print(json.dumps({"ok": True, "saved_to": str(output_path), "metrics": metrics}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
