# train_ml_model.py

import os
import json
import pandas as pd
from sqlalchemy import create_engine
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, classification_report
from sklearn.linear_model import LogisticRegression
from xgboost import XGBClassifier
import joblib

# -------------------------------------------------------------------
# 1) Connexion à la base
# -------------------------------------------------------------------
# Mets ici ton URL Postgres Supabase :
# format typique : postgres://user:password@host:port/dbname
DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL is None:
  raise RuntimeError("Veuillez définir la variable d'environnement DATABASE_URL")

engine = create_engine(DATABASE_URL)

# -------------------------------------------------------------------
# 2) Charger les données d'entraînement
# -------------------------------------------------------------------
print("Chargement des données depuis ml_training_samples_v1...")
df = pd.read_sql("select * from public.ml_training_samples_v1", engine)

if "y" not in df.columns:
  raise RuntimeError("La vue ml_training_samples_v1 doit contenir une colonne 'y' (0/1).")

print(f"Nombre de lignes dans le dataset : {len(df)}")

# On sépare les features et le label
y = df["y"].astype(int)

# Colonnes à ignorer (identifiants, dates, textes...)
cols_to_drop = [
  "y",
  "id",
  "student_id",
  "class_id",
  "institution_id",
  "academic_year",
  "exam_label",
  "exam_date",
  "created_at",
]

X = df.drop(columns=[c for c in cols_to_drop if c in df.columns])

# Ne garder que les colonnes numériques
X = X.select_dtypes(include=["number"]).copy()

print(f"Nombre de features numériques utilisées : {X.shape[1]}")

# -------------------------------------------------------------------
# 3) Split train / test
# -------------------------------------------------------------------
X_train, X_test, y_train, y_test = train_test_split(
  X, y, test_size=0.2, random_state=42, stratify=y
)

# -------------------------------------------------------------------
# 4) Modèle interprétable : Régression logistique
# -------------------------------------------------------------------
print("Entraînement du modèle de régression logistique...")

log_reg = LogisticRegression(
  solver="lbfgs",
  max_iter=1000,
  class_weight="balanced"  # utile si classes déséquilibrées
)
log_reg.fit(X_train, y_train)

y_proba_log = log_reg.predict_proba(X_test)[:, 1]
auc_log = roc_auc_score(y_test, y_proba_log)
print(f"AUC (logistic): {auc_log:.3f}")

# -------------------------------------------------------------------
# 5) Modèle avancé : XGBoost (Gradient Boosted Trees)
# -------------------------------------------------------------------
print("Entraînement du modèle XGBoost...")

xgb = XGBClassifier(
  n_estimators=300,
  max_depth=4,
  learning_rate=0.05,
  subsample=0.8,
  colsample_bytree=0.8,
  objective="binary:logistic",
  eval_metric="auc",
)

xgb.fit(X_train, y_train)

y_proba_xgb = xgb.predict_proba(X_test)[:, 1]
auc_xgb = roc_auc_score(y_test, y_proba_xgb)
print(f"AUC (XGBoost): {auc_xgb:.3f}")

# -------------------------------------------------------------------
# 6) Combinaison simple des deux modèles
# -------------------------------------------------------------------
# Ici on fait juste une moyenne 50/50 des probabilités.
# Plus tard, tu pourras affiner (poids différents, calibration, etc.)
y_proba_final = 0.5 * y_proba_log + 0.5 * y_proba_xgb
auc_final = roc_auc_score(y_test, y_proba_final)
print(f"AUC (ensemble log+XGB): {auc_final:.3f}")

print("\nRapport de classification (seuil 0.5, modèle combiné) :")
y_pred_final = (y_proba_final >= 0.5).astype(int)
print(classification_report(y_test, y_pred_final))

# -------------------------------------------------------------------
# 7) Sauvegarde des modèles + métadonnées
# -------------------------------------------------------------------
os.makedirs("models", exist_ok=True)

joblib.dump(log_reg, "models/logistic_model.joblib")
joblib.dump(xgb, "models/xgb_model.joblib")

metadata = {
  "version": "v1.0.0",
  "features": list(X.columns),
  "auc_logistic": float(auc_log),
  "auc_xgb": float(auc_xgb),
  "auc_ensemble": float(auc_final),
}

with open("models/metadata.json", "w", encoding="utf-8") as f:
  json.dump(metadata, f, indent=2, ensure_ascii=False)

print("\nModèles sauvegardés dans le dossier 'models/'.")
print("metadata.json décrit la version et les features utilisées.")
