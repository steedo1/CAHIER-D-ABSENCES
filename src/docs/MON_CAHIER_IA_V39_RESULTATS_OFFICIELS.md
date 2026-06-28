# Mon Cahier IA v39 — Résultats officiels élèves

Objectif : persister en base les résultats officiels exploités par les bulletins, afin que le dataset IA ne dépende pas d’un PDF ou d’un calcul temporaire.

Tables principales :
- student_period_results : résultat officiel élève par période.
- student_subject_period_results : résultat officiel matière par période.
- student_year_decisions : décision annuelle officielle enrichie.

Principe :
- T1 et T2 servent à suivre l’évolution.
- T3 sert à consolider le résultat annuel.
- La décision de fin d’année doit exister en base, pas seulement dans le bulletin PDF.
