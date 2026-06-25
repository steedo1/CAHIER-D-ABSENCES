# Mon Cahier IA - Service ML optionnel

Ce dossier donne une première brique de service IA externe compatible avec `ML_PREDICT_URL`.

## Lancement local

```bash
cd src/ai-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn mon_cahier_ai_service:app --host 127.0.0.1 --port 8001
```

Dans `.env.local` de l'application Next.js :

```env
ML_PREDICT_URL=http://127.0.0.1:8001/predict
```

## Positionnement

La v1 est volontairement explicable. Elle peut être remplacée plus tard par un modèle entraîné sur l'historique `ai_prediction_students` + `ai_prediction_outcomes`, sans changer l'API consommée par Mon Cahier.
