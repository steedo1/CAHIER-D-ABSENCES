# Reprise des appels hors ligne — 11 novembre 2026

Constat en lecture seule sur CSCA : le 10 novembre, 35 séances, 32 reçus d'appel élèves et 30 clôtures. Des réceptions des jours précédents arrivent plusieurs jours après la saisie. Cette observation ne permet pas de connaître les opérations encore détenues uniquement par les téléphones.

Deux défauts reproduits avec les véritables journaux et l'outbox IndexedDB : une clôture présente uniquement dans le journal durable ne rejoint pas la file d'envoi ; la reprise globale ne découvre pas l'établissement à partir du cache de compte classe. Les tests échouent avant correction (une clôture restante / aucun envoi), puis passent après correction.

La reprise matérialise maintenant ouverture, présences et clôture avec les mêmes identifiants et heures d'origine. L'index des établissements est enregistré atomiquement avec chacun des trois journaux. La confirmation exacte reste obligatoire avant retrait local et les présences non confirmées continuent de protéger la clôture. Les transitions de relais, conflits et opérations archivées restent protégés.

Les réveils simultanés partagent une reprise ; les autres reprises sont sérialisées. Chaque phase est bornée à 50 confirmations et ne cible que les appels. La tentative périodique existante est conservée avec espacement progressif des échecs, jusqu'à cinq minutes ; le retour réseau et la réouverture de la PWA relancent immédiatement. Une file vide ne sonde pas le serveur. Aucune modification des statistiques, de l'EDT, de Finance, de la BDD ou de la configuration Render.

Validation : tests de reprise interrompue, ordre, dédoublonnage, conservation des heures, isolation des autres modules, file vide et espacement des échecs ; suite Cloud/PWA et contrôle TypeScript. Le banc de test de retour de session charge désormais sa dépendance Parent Connect existante.

Limite opérationnelle : un téléphone sans réseau, fermé ou suspendu par Android peut encore détenir des appels. Reconnecter puis rouvrir Mon Cahier permet la reprise ; ne pas effacer ses données. La réception des appels historiques restant sur les appareils doit être constatée après leur reconnexion.
