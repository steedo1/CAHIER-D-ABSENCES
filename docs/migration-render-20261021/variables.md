# Bilan nominatif Vercel / Render — 21 octobre 2026

Source Vercel : inventaire courant du projet `cahier-d-absences-pro-web`, 27 clés. Source Render : page Environment de `srv-dbc291on74is73f4692g`, liste développée après connexion sécurisée, 10 clés, aucun groupe lié. Aucune valeur secrète n'est publiée. La présence des sept clés communes ne prouve pas l'égalité de leurs valeurs.

| Clé Vercel | Render | Classe / décision | Justification dans le code actuel |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Présente | Indispensable | Auth, middleware, navigateur ; valeur publique figée au build |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Présente | Indispensable | Client public et session serveur |
| SUPABASE_URL | Présente | Alias conservé | URL serveur, repli possible sur NEXT_PUBLIC_SUPABASE_URL |
| SUPABASE_SERVICE_ROLE_KEY | Présente | Indispensable | Routes privilégiées, médias privés, signature offline en repli |
| NEXT_PUBLIC_APP_URL | Présente | Nécessaire aux URLs | SMS, liens et paiements ; contrôler l'origine canonique |
| NEXT_PUBLIC_BASE_URL | Présente | Nécessaire aux URLs | Déclenchement push et SMS ; contrôler l'origine canonique |
| NEXT_PUBLIC_SITE_URL | Présente | Nécessaire aux URLs | Supervision, liens ; contrôler l'origine canonique |
| CRON_SECRET | Absente | Indispensable, rétablir | Refus 403 SMS observé ; helper inline bloqué ; conserver le secret d'origine |
| PARENT_JWT_SECRET | Absente | Indispensable, rétablir | Création de session parent lève une erreur sans secret ; conserver les sessions existantes |
| BULLETIN_QR_SECRET | Absente | Indispensable aux QR, rétablir | Signature/vérification ; préserver les QR existants ; aucun QR à imposer au primaire |
| VAPID_PUBLIC_KEY | Absente | Indispensable push, rétablir | API publique vide ; job push HTTP 500 confirmé |
| VAPID_PRIVATE_KEY | Absente | Indispensable push, rétablir | Même paire historique, ne pas régénérer les souscriptions |
| NEXT_PUBLIC_VAPID_PUBLIC_KEY | Absente | Ancien alias facultatif | Aucune référence dans src ; client courant récupère /api/push/vapid. Alias historique égal à VAPID_PUBLIC_KEY |
| ORANGE_CLIENT_ID | Absente | Indispensable SMS, rétablir | OAuth Orange ; aucune alternative ORANGE_AUTH_HEADER présente |
| ORANGE_CLIENT_SECRET | Absente | Indispensable SMS, rétablir | Même configuration Orange, sans nouvelle souscription |
| ORANGE_SMS_SENDER | Absente | Indispensable SMS, rétablir | Le repli du code est un expéditeur factice |
| ORANGE_OAUTH_URL | Absente | Facultative | Valeur historique contrôlée : identique au défaut officiel du code |
| ORANGE_SMS_BASE_URL | Absente | Facultative | Valeur historique contrôlée : identique au défaut du code |
| SMS_WAIT_STATUS | Absente | Facultative | Valeur historique identique au défaut pending |
| SMS_MAX_ATTEMPTS | Absente | Facultative | Valeur historique identique au défaut 5 |
| ATTENDANCE_LATE_THRESHOLD_MIN | Absente | Réglage métier à rétablir | **Valeur historique différente du défaut 15** : migration modifie actuellement ce seuil |
| DEFAULT_TEMP_PASSWORD | Absente | Réglage de comptes à rétablir | Plusieurs routes utilisent un mot de passe fixe de repli ; création/réinitialisation à contrôler sans toucher aux comptes existants |
| DEFAULT_PHONE_PREFIX | Absente | Facultative | Valeur historique identique au défaut +225 |
| NEXT_PUBLIC_DEFAULT_PHONE_PREFIX | Absente | Facultative | Valeur historique identique au défaut +225 ; figée au build si définie |
| ACADEMIC_YEAR_START_MONTH | Absente | Facultative | Valeur historique identique au défaut 8 |
| DEBUG_BULLETIN_QR | Absente | Diagnostic obsolète ici | Aucune référence dans src ; ne pas réactiver de logs inutiles |
| AI_GATEWAY_MODEL | Absente | Inutilisée dans cette version | Aucune référence dans le code de la branche Render ou de sa base ac615564 ; ne rétablit pas à elle seule Cahier IA |

Clés spécifiques Render présentes : `NODE_OPTIONS`, `NODE_VERSION`, `PORT`. Leur valeur masquée n'a pas été exposée. La commande réelle fixe explicitement le heap runtime à 288 Mio. Le build utilise un heap de 4096 Mio, distinct du runtime.

## Lot de configuration préparé, non appliqué

Rétablir **10 clés** : CRON_SECRET, PARENT_JWT_SECRET, BULLETIN_QR_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET, ORANGE_SMS_SENDER, DEFAULT_TEMP_PASSWORD, ATTENDANCE_LATE_THRESHOLD_MIN.

Les valeurs historiques ont pu être récupérées sans affichage et sans fichier de secrets. Les sept défauts facultatifs ont été comparés au code ; aucune copie aveugle. Aucune écriture Render ni activation d'envoi effectuée. Les valeurs communes Render/Vercel restent à contrôler par des tests et une comparaison sécurisée.

**Attention aux files en attente :** rétablir CRON/VAPID/Orange peut relancer des traitements réels déjà planifiés. Avant activation, examiner les 100 notifications pending relevées (18 push ; 82 inapp+push), vérifier leur pertinence sans modifier/supprimer la file automatiquement. Aucun ancien message error ne doit être remis en attente en masse.

## Au-delà des 27 clés

Le relevé `code-env-references.json` recense **68 noms** directement référencés dans src, y compris valeurs par défaut, drapeaux et compatibilité. Ce nombre ne signifie pas qu'il faut configurer 68 variables.

- `MON_CAHIER_AI_SERVICE_URL` / `ML_PREDICT_URL` : aucune des deux n'est dans les 27 clés Vercel ou les 10 Render. Le code utilise un service de prédiction externe. Identifier l'hébergement existant avant toute création payante. AI_GATEWAY_MODEL ne remplace pas ces URLs.
- `MON_CAHIER_OFFLINE_AUTH_SECRET` : repli actuel sur SUPABASE_SERVICE_ROLE_KEY dans le middleware et /api/auth/role. Ne pas faire de rotation pendant cette migration.
- `BULLETIN_PUBLIC_VERIFY_ORIGIN` / `NEXT_PUBLIC_BULLETIN_VERIFY_ORIGIN` : facultatives, vérifier que les QR existants aboutissent au domaine public ; paramètres de rendu QR et exports avec défauts.
- `ORANGE_MONEY_WEBPAY_*` : distincts des SMS Orange. L'adaptateur Orange Money réel est **non implémenté**, même si le drapeau est activé. Limitation déjà présente dans ac615564 ; ne pas présenter ce module comme restauré ou encaisser un paiement de test réel.
- `FCM_SERVER_KEY` : uniquement si une livraison Android FCM existante doit être maintenue ; ne pas la confondre avec Web Push/VAPID.
- WhatsApp/Twilio : désactivés dans le code ; conserver cette désactivation.
- Drapeaux de tests paiements et mocks : laisser désactivés en production.
- `RENDER_GIT_COMMIT` : variable de plateforme pour la release PWA ; raccordement au build proposé dans ce lot.

## Vérification réutilisable

`node scripts/audit-render-env.mjs` inspecte seulement les noms prévus et leur présence, plus la validité des origines et la cohérence des alias publics VAPID. Aucune valeur, empreinte ou longueur de secret n'est affichée. Ce contrôle n'atteste ni la validité des clés, ni leur disponibilité dans un ancien build, ni l'envoi effectif d'un SMS.
