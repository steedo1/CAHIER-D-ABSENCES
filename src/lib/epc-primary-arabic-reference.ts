/**
 * Validated by EPC Dimbokro for the 2026–2027 primary Arabic curriculum.
 * This is a reference for testing and safe institution-scoped provisioning.
 * It does not redefine primary French classes or historical scores.
 *
 * All listed subjects are /10 in Arabic teaching, with no coefficients.
 * The CP/CE lower-level jurisprudence and belief unit remains combined.
 */
export const EPC_PRIMARY_ARABIC_REFERENCE_2026 = {
  CP1: [
    "Apprentissage des lettres", "Chant", "Dessin", "Coran", "Poème",
    "Écriture", "Hadith (tradition prophétique)",
    "Jurisprudence et croyance (Al-Muslim As-Saghîr)", "Mathématiques",
  ],
  CP2: [
    "Apprentissage des lettres", "Chant", "Dessin", "Coran", "Poème",
    "Écriture", "Hadith (tradition prophétique)",
    "Jurisprudence et croyance (Al-Muslim As-Saghîr)", "Mathématiques",
  ],
  CE1: [
    "Apprentissage des lettres", "Coran", "Poème", "Écriture",
    "Hadith (tradition prophétique)", "Mathématiques", "Expression orale",
    "Jurisprudence et croyance (Al-Muslim As-Saghîr)",
  ],
  CE2: [
    "Coran", "Poème", "Écriture", "Dictée", "Expression orale",
    "Hadith (tradition prophétique)", "Lecture",
    "Jurisprudence et croyance (Al-Muslim As-Saghîr)",
  ],
  CM1: [
    "Coran", "Hadith (tradition prophétique)",
    "Biographie du Prophète (SAW)", "Lecture", "Écriture", "Dictée",
    "Jurisprudence islamique (Fiqh)", "Unicité divine (Tawhîd)",
  ],
  CM2: [
    "Lecture du Coran", "Mémorisation du Coran",
    "Règles de lecture du Coran (Tajwid)",
    "Interprétation du Coran (Tafsir)",
    "Jurisprudence islamique (Fiqh)", "Unicité divine (Tawhîd)",
    "Lecture", "Biographie du Prophète (SAW)", "Dictée", "Écriture",
    "Grammaire arabe", "Conjugaison arabe", "Poème",
  ],
} as const;
