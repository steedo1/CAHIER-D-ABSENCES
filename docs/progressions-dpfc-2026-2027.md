# Progressions DPFC 2026–2027 — import du 8 novembre 2026

59 programmes nationaux et 1 922 éléments ont été ajoutés à la bibliothèque :

| Discipline | Programmes |
| --- | ---: |
| Mathématiques | 14 |
| Physique-Chimie | 11 |
| SVT | 12 |
| Philosophie | 10 |
| Français | 12 |

Les huit programmes d'anglais du second cycle déjà présents sont conservés.
Les PDF fournis sont transcrits en éléments de suivi ; les métadonnées de chaque
programme et élément conservent le fichier source, les pages et l'empreinte du
document. Les documents d'années antérieures ne sont pas réétiquetés 2026–2027.

L'import utilise la clé `dpfc_progressions_2026_2027_20261108`. Les identifiants
déterministes et les insertions sans écrasement permettent de reprendre l'import.
Les séances, validations et journaux existants n'ont pas été modifiés. Aucun
élément n'a été déclaré terminé au nom d'un enseignant.

108 nouvelles attributions ont été créées après vérification des affectations
classe–matière, du type d'enseignement, de l'année et du code officiel de série :

| Établissement | Classes | Attributions ajoutées |
| --- | ---: | ---: |
| CSCA Aboisso | 19 | 80 |
| Collège privé Dieudonné de Yamoussoukro | 6 | 24 |
| EPC Markaz At-Talim Al-Islami de Dimbokro | 1 | 4 |

Les classes d'autres années restent inchangées. Le premier cycle d'anglais et
les disciplines sans document 2026–2027 fourni ne reçoivent pas de programme
inventé ou repris d'une ancienne année.

Les contrôles après import trouvent zéro copie incomplète, zéro lien entre
établissements incohérent et zéro nouvelle attribution sans enseignant affecté.
Une seconde exécution de l'attribution ajoute zéro programme, élément ou lien.

Le CSCA dispose maintenant de 1 480 éléments de progression pour cette année.
Les lecteurs du cahier utilisent donc des pages de 500 lignes pour dépasser la
limite de réponse PostgREST. L'échec d'une page renvoie une erreur au lieu d'un
avancement partiel. Les filtres d'accès et les ordres pédagogiques sont conservés.

Les volumes de mathématiques ont été comparés aux totaux annuels des PDF. Les
32 semaines de SVT et de philosophie sont contrôlées ; le français du premier
cycle couvre les quatre rubriques chaque semaine. Les volumes du français du
second cycle sont conservés par bloc dans les métadonnées : aucune répartition
incertaine par leçon n'a été inventée.
