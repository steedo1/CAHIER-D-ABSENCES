"""
Mon Cahier IA v2 - service ML pédagogique.

Ce service peut fonctionner de deux façons :
1) modèle entraîné présent dans ./models/mon_cahier_ai_latest.joblib ;
2) fallback explicable si aucun modèle n'est encore entraîné.

L'objectif est de brancher Mon Cahier sur un vrai modèle ML sans bloquer la production.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

MODEL_PATH = Path(__file__).resolve().parent / "models" / "mon_cahier_ai_latest.joblib"
MODEL_KEY = "mon_cahier_ai_pedagogy"
FALLBACK_VERSION = "2.0.0-rules-fallback"

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


class StudentPayload(BaseModel):
    student_id: str
    features: Dict[str, Any] = Field(default_factory=dict)


class PredictRequest(BaseModel):
    institution_id: Optional[str] = None
    academic_year: Optional[str] = None
    exam_date: Optional[str] = None
    core_completion_percent: float = 60
    students: List[StudentPayload] = Field(default_factory=list)


class StudentPrediction(BaseModel):
    student_id: str
    p_success: float
    risk_level: str
    model_source: str


class PredictResponse(BaseModel):
    ok: bool
    model_key: str
    model_version: str
    model_source: str
    students: List[StudentPrediction]


app = FastAPI(title="Mon Cahier IA Service", version="2.0.0")
_model_bundle: Optional[Dict[str, Any]] = None


def clamp(value: float, low: float, high: float) -> float:
    if not np.isfinite(value):
        return low
    return float(min(high, max(low, value)))


def as_float(value: Any, default: float) -> float:
    try:
        if value is None:
            return default
        value = float(value)
        if not np.isfinite(value):
            return default
        return value
    except Exception:
        return default


def risk_label(p_success: float) -> str:
    if p_success < 0.45:
        return "high"
    if p_success < 0.70:
        return "medium"
    return "low"


def baseline_predict(features: Dict[str, Any], request_completion: float) -> float:
    """Fallback explicable, utile avant l'entraînement du vrai modèle."""
    general = as_float(features.get("general_avg_20"), as_float(features.get("raw_all_avg_20"), 10.0))
    core = as_float(features.get("raw_core_avg_20"), general)
    presence = as_float(features.get("presence_rate"), 0.90)
    absent_hours = as_float(features.get("total_absent_hours"), 0.0)
    lates = as_float(features.get("nb_lates"), 0.0)
    conduct = as_float(features.get("conduct_total_20"), as_float(features.get("conduct_norm"), 0.75) * 20)
    completion = as_float(features.get("core_completion_percent"), request_completion) / 100.0

    academic = clamp((general * 0.55 + core * 0.45) / 20.0, 0.0, 1.0)
    attendance = clamp(presence - min(0.18, absent_hours / 240.0) - min(0.08, lates / 120.0), 0.0, 1.0)
    conduct_score = clamp(conduct / 20.0, 0.0, 1.0)
    completion_score = clamp(completion, 0.0, 1.0)

    p = academic * 0.58 + attendance * 0.17 + conduct_score * 0.10 + completion_score * 0.15
    return clamp(p, 0.02, 0.98)


def load_model() -> Optional[Dict[str, Any]]:
    global _model_bundle
    if _model_bundle is not None:
        return _model_bundle
    if not MODEL_PATH.exists():
        return None
    _model_bundle = joblib.load(MODEL_PATH)
    return _model_bundle


def features_to_matrix(students: List[StudentPayload], request_completion: float, feature_names: List[str]) -> np.ndarray:
    matrix = []
    for item in students:
        row = []
        for name in feature_names:
            default = request_completion if name == "core_completion_percent" else np.nan
            row.append(as_float(item.features.get(name), default))
        matrix.append(row)
    return np.asarray(matrix, dtype=float)


@app.get("/health")
def health() -> Dict[str, Any]:
    bundle = load_model()
    return {
        "ok": True,
        "model_key": MODEL_KEY,
        "model_loaded": bundle is not None,
        "model_version": bundle.get("model_version") if bundle else FALLBACK_VERSION,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest) -> PredictResponse:
    bundle = load_model()
    predictions: List[StudentPrediction] = []

    if bundle is not None and payload.students:
        model = bundle["model"]
        feature_names = bundle.get("features") or FEATURES
        model_version = bundle.get("model_version") or "2.0.0-trained"
        x = features_to_matrix(payload.students, payload.core_completion_percent, feature_names)
        probabilities = model.predict_proba(x)[:, 1]

        for item, p in zip(payload.students, probabilities):
            pp = clamp(float(p), 0.02, 0.98)
            predictions.append(
                StudentPrediction(
                    student_id=item.student_id,
                    p_success=pp,
                    risk_level=risk_label(pp),
                    model_source="trained_model",
                )
            )

        return PredictResponse(
            ok=True,
            model_key=MODEL_KEY,
            model_version=str(model_version),
            model_source="ml_service",
            students=predictions,
        )

    for item in payload.students:
        p = baseline_predict(item.features, payload.core_completion_percent)
        predictions.append(
            StudentPrediction(
                student_id=item.student_id,
                p_success=p,
                risk_level=risk_label(p),
                model_source="rules_fallback",
            )
        )

    return PredictResponse(
        ok=True,
        model_key=MODEL_KEY,
        model_version=FALLBACK_VERSION,
        model_source="rules_baseline",
        students=predictions,
    )
