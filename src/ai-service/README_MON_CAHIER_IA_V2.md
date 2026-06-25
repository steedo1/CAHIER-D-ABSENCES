# Mon Cahier IA v2 — Service ML

Ce dossier contient la brique Python qui transforme Mon Cahier IA en vrai modèle entraînable.

## 1. Installation locale

```powershell
cd C:\Projects\CAHIER-D-ABSENCES\src\ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2. Lancer le service

```powershell
python -m uvicorn mon_cahier_ai_service:app --host 127.0.0.1 --port 8001
```

Dans `.env.local` :

```env
MON_CAHIER_AI_SERVICE_URL=http://127.0.0.1:8001
ML_PREDICT_URL=http://127.0.0.1:8001/predict
```

## 3. Entraîner un modèle

Exporter les données d'entraînement via :

```txt
/admin/mon-cahier-ia puis API /api/admin/mon-cahier-ia/training-export?academic_year=2025-2026
```

Puis :

```powershell
python train_mon_cahier_model.py --input .\exports\training_2025_2026.json --version 2.0.0-trained-csca
```

Le fichier généré est :

```txt
src/ai-service/models/mon_cahier_ai_latest.joblib
```

## 4. Important

Sans fichier modèle, le service fonctionne en fallback explicable. Avec fichier modèle, il utilise `predict_proba` du modèle entraîné.

Ne jamais partager les données nominatives des élèves à l'extérieur. Pour un entraînement externe, anonymiser d'abord les identifiants.


## Installation recommandée

Pour lancer seulement le service de prédiction/fallback, installer le fichier léger :

```powershell
pip install -r requirements.txt
```

Pour entraîner réellement le modèle avec scikit-learn, utiliser idéalement Python 3.11 ou 3.12 puis installer :

```powershell
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements-train.txt
```

Si `numpy` se compile depuis les sources sous Windows, c’est généralement un problème de version Python ou de wheel indisponible. Dans ce cas, utiliser Python 3.12 64 bits pour l’entraînement.
