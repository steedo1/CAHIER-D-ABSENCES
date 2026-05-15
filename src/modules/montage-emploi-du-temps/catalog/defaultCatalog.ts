import type {
  DefaultSubjectHour,
  LevelDefinition,
  SubjectDefinition,
} from "./types";

export const defaultLevels: LevelDefinition[] = [
  { code: "6e", label: "6e", cycle: "college", displayOrder: 1 },
  { code: "5e", label: "5e", cycle: "college", displayOrder: 2 },
  { code: "4e", label: "4e", cycle: "college", displayOrder: 3 },
  { code: "3e", label: "3e", cycle: "college", displayOrder: 4 },

  { code: "2A", label: "2nde A", cycle: "lycee", displayOrder: 5 },
  { code: "2C", label: "2nde C", cycle: "lycee", displayOrder: 6 },

  { code: "1A", label: "1re A", cycle: "lycee", displayOrder: 7 },
  { code: "1A1", label: "1re A1", cycle: "lycee", displayOrder: 7.1 },
  { code: "1A2", label: "1re A2", cycle: "lycee", displayOrder: 7.2 },
  { code: "1C", label: "1re C", cycle: "lycee", displayOrder: 8 },
  { code: "1D", label: "1re D", cycle: "lycee", displayOrder: 9 },

  { code: "TleA", label: "Terminale A", cycle: "lycee", displayOrder: 10 },
  { code: "TleA1", label: "Terminale A1", cycle: "lycee", displayOrder: 10.1 },
  { code: "TleA2", label: "Terminale A2", cycle: "lycee", displayOrder: 10.2 },
  { code: "TleC", label: "Terminale C", cycle: "lycee", displayOrder: 11 },
  { code: "TleD", label: "Terminale D", cycle: "lycee", displayOrder: 12 },
];

export const defaultSubjects: SubjectDefinition[] = [
  {
    id: "maths",
    code: "MATHS",
    name: "Mathématiques",
    shortName: "Maths",
    category: "scientific",
    isHeavy: true,
    color: "#2563eb",
    displayOrder: 1,
  },
  {
    id: "pc",
    code: "PC",
    name: "Physique-Chimie",
    shortName: "P.C",
    category: "scientific",
    isHeavy: true,
    defaultRoomType: "pc_lab",
    color: "#16a34a",
    displayOrder: 2,
  },
  {
    id: "svt",
    code: "SVT",
    name: "Sciences de la Vie et de la Terre",
    shortName: "SVT",
    category: "scientific",
    isHeavy: true,
    defaultRoomType: "svt_lab",
    color: "#854d0e",
    displayOrder: 3,
  },
  {
    id: "francais",
    code: "FR",
    name: "Français",
    shortName: "Français",
    category: "literary",
    isHeavy: true,
    color: "#eab308",
    displayOrder: 4,
  },
  {
    id: "hg",
    code: "HG",
    name: "Histoire-Géographie",
    shortName: "H-G",
    category: "literary",
    isHeavy: true,
    color: "#1d4ed8",
    displayOrder: 5,
  },
  {
    id: "anglais",
    code: "ANG",
    name: "Anglais",
    shortName: "Anglais",
    category: "language",
    isHeavy: false,
    color: "#db2777",
    displayOrder: 6,
  },
  {
    id: "lv2",
    code: "LV2",
    name: "Langue vivante 2",
    shortName: "LV2",
    category: "language",
    isHeavy: false,
    color: "#7c3aed",
    displayOrder: 7,
  },
  {
    id: "philo",
    code: "PHILO",
    name: "Philosophie",
    shortName: "Philo",
    category: "literary",
    isHeavy: true,
    color: "#f97316",
    displayOrder: 8,
  },
  {
    id: "eps",
    code: "EPS",
    name: "Éducation Physique et Sportive",
    shortName: "EPS",
    category: "sport",
    isHeavy: false,
    defaultRoomType: "sports_field",
    color: "#ea580c",
    displayOrder: 9,
  },
  {
    id: "edhc",
    code: "EDHC",
    name: "Éducation aux Droits de l’Homme et à la Citoyenneté",
    shortName: "EDHC",
    category: "civic",
    isHeavy: false,
    color: "#64748b",
    displayOrder: 10,
  },
  {
    id: "ap",
    code: "ARTS",
    name: "Arts plastiques",
    shortName: "Arts plastiques",
    category: "art",
    isHeavy: false,
    color: "#94a3b8",
    displayOrder: 11,
  },
  {
    id: "musique",
    code: "MUS",
    name: "Éducation musicale",
    shortName: "Musique",
    category: "art",
    isHeavy: false,
    color: "#cbd5e1",
    displayOrder: 12,
  },
  {
    id: "informatique",
    code: "TICE",
    name: "Technologies de l’Information et de la Communication",
    shortName: "TICE",
    category: "technical",
    isHeavy: false,
    defaultRoomType: "computer_lab",
    color: "#0f766e",
    displayOrder: 13,
  },
  {
    id: "entrepreneuriat",
    code: "ENT",
    name: "Entrepreneuriat",
    shortName: "Entrep",
    category: "technical",
    isHeavy: false,
    color: "#9333ea",
    displayOrder: 14,
  },
];

export const defaultSubjectHours: DefaultSubjectHour[] = [
  // ============================================================
  // Référentiel officiel DPFC/MENA 2025-2026
  // Circulaire n°0311 : Horaires dans l'enseignement secondaire général
  //
  // Convention HoraClasse :
  // - weeklyUnits = volume horaire élève à placer dans l'emploi du temps.
  // - Les mentions entre parenthèses de la circulaire sont conservées en notes.
  // - QZ = quinzaine. En attendant un moteur natif "quinzaine",
  //   HoraClasse utilise une moyenne hebdomadaire.
  // ============================================================

  // =========================
  // 6e — Total officiel : 22h
  // =========================
  { levelCode: "6e", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "6e", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "6e", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "6e", subjectId: "edhc", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "6e", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "6e", subjectId: "francais", weeklyUnits: 5, splitPattern: "2+1+1+1" },
  { levelCode: "6e", subjectId: "hg", weeklyUnits: 2, splitPattern: "1+1" },
  { levelCode: "6e", subjectId: "maths", weeklyUnits: 4, splitPattern: "1+1+1+1" },
  { levelCode: "6e", subjectId: "informatique", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "6e", subjectId: "pc", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "pc_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },
  { levelCode: "6e", subjectId: "svt", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },

  // =========================
  // 5e — Total officiel : 22h
  // =========================
  { levelCode: "5e", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "5e", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "5e", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "5e", subjectId: "edhc", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "5e", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "5e", subjectId: "francais", weeklyUnits: 5, splitPattern: "2+1+1+1" },
  { levelCode: "5e", subjectId: "hg", weeklyUnits: 2, splitPattern: "1+1" },
  { levelCode: "5e", subjectId: "maths", weeklyUnits: 4, splitPattern: "1+1+1+1" },
  { levelCode: "5e", subjectId: "informatique", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "5e", subjectId: "pc", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "pc_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },
  { levelCode: "5e", subjectId: "svt", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },

  // =========================
  // 4e — Total officiel : 27h
  // =========================
  { levelCode: "4e", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "4e", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "4e", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "4e", subjectId: "edhc", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "4e", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "4e", subjectId: "francais", weeklyUnits: 6, splitPattern: "2+1+1+1+1" },
  { levelCode: "4e", subjectId: "hg", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "4e", subjectId: "lv2", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "4e", subjectId: "maths", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "4e", subjectId: "informatique", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "4e", subjectId: "pc", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "pc_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },
  { levelCode: "4e", subjectId: "svt", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },

  // =========================
  // 3e — Total officiel : 29h
  // =========================
  { levelCode: "3e", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "3e", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "3e", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "3e", subjectId: "edhc", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "3e", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "3e", subjectId: "francais", weeklyUnits: 6, splitPattern: "2+1+1+1+1" },
  { levelCode: "3e", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "3e", subjectId: "lv2", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "3e", subjectId: "maths", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "3e", subjectId: "informatique", weeklyUnits: 1, splitPattern: "1" },
  { levelCode: "3e", subjectId: "pc", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "pc_lab", notes: "Officiel : 0 + (2h), demi-classe/TP." },
  { levelCode: "3e", subjectId: "svt", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (2h), demi-classe/TP." },

  // =========================
  // 2nde A — Total officiel : 25h
  // =========================
  { levelCode: "2A", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "2A", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "2A", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "2A", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "2A", subjectId: "francais", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "2A", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "2A", subjectId: "lv2", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "2A", subjectId: "maths", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "2A", subjectId: "pc", weeklyUnits: 3.5, splitPattern: "2+1.5", roomTypeRequired: "pc_lab", notes: "Officiel : 2 + (1h30), demi-classe/TP." },
  { levelCode: "2A", subjectId: "svt", weeklyUnits: 1.5, splitPattern: "1.5", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (1h30), demi-classe/TP." },

  // =========================
  // 2nde C — Total officiel : 29h
  // =========================
  { levelCode: "2C", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "2C", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "2C", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "2C", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "2C", subjectId: "francais", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "2C", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "2C", subjectId: "lv2", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "2C", subjectId: "maths", weeklyUnits: 5, splitPattern: "2+2+1" },
  { levelCode: "2C", subjectId: "pc", weeklyUnits: 5, splitPattern: "1+2+2", roomTypeRequired: "pc_lab", notes: "Officiel : 1 + 2 + (2h), demi-classe/TP." },
  { levelCode: "2C", subjectId: "svt", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (2h), demi-classe/TP." },

  // =========================
  // 1re A — Total officiel : A1 = 27h30, A2 = 26h30
  // Par défaut : A1. Pour A2, ramener Maths de 4h à 3h.
  // =========================
  { levelCode: "1A", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "1A", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "1A", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "1A", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "1A", subjectId: "francais", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "1A", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "1A", subjectId: "lv2", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "1A", subjectId: "maths", weeklyUnits: 4, splitPattern: "2+1+1", notes: "Officiel : A1 = 4h, A2 = 3h. Valeur par défaut HoraClasse : A1." },
  { levelCode: "1A1", subjectId: "maths", weeklyUnits: 4, splitPattern: "2+1+1", notes: "Officiel : 1re A1 = 4h." },
  { levelCode: "1A2", subjectId: "maths", weeklyUnits: 3, splitPattern: "2+1", notes: "Officiel : 1re A2 = 3h." },
  { levelCode: "1A", subjectId: "philo", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "1A", subjectId: "pc", weeklyUnits: 1.75, splitPattern: "1+0.75", roomTypeRequired: "pc_lab", notes: "Officiel : 1 + (1h30) QZ. QZ ramené en moyenne hebdomadaire." },
  { levelCode: "1A", subjectId: "svt", weeklyUnits: 1.75, splitPattern: "1+0.75", roomTypeRequired: "svt_lab", notes: "Officiel : 1 + (1h30) QZ. QZ ramené en moyenne hebdomadaire." },

  // =========================
  // 1re C — Total officiel : 30h30
  // =========================
  { levelCode: "1C", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "1C", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "1C", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "1C", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "1C", subjectId: "francais", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "1C", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "1C", subjectId: "lv2", weeklyUnits: 2, splitPattern: "1+1", isOptional: true, notes: "Officiel : 2h facultatives." },
  { levelCode: "1C", subjectId: "maths", weeklyUnits: 6, splitPattern: "2+2+2" },
  { levelCode: "1C", subjectId: "philo", weeklyUnits: 2, splitPattern: "2" },
  { levelCode: "1C", subjectId: "pc", weeklyUnits: 5.5, splitPattern: "1+2.5+2", roomTypeRequired: "pc_lab", notes: "Officiel : 1 + 2h30 + (2h), demi-classe/TP." },
  { levelCode: "1C", subjectId: "svt", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (2h), demi-classe/TP." },

  // =========================
  // 1re D — Total officiel : 29h30
  // =========================
  { levelCode: "1D", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "1D", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "1D", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "1D", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "1D", subjectId: "francais", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "1D", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "1D", subjectId: "lv2", weeklyUnits: 2, splitPattern: "1+1", isOptional: true, notes: "Officiel : 2h facultatives." },
  { levelCode: "1D", subjectId: "maths", weeklyUnits: 5, splitPattern: "2+2+1" },
  { levelCode: "1D", subjectId: "philo", weeklyUnits: 2, splitPattern: "2" },
  { levelCode: "1D", subjectId: "pc", weeklyUnits: 4.5, splitPattern: "1+2+1.5", roomTypeRequired: "pc_lab", notes: "Officiel : 1 + 2 + (1h30), demi-classe/TP." },
  { levelCode: "1D", subjectId: "svt", weeklyUnits: 3, splitPattern: "1+2", roomTypeRequired: "svt_lab", notes: "Officiel : 1 + (2h), demi-classe/TP." },

  // =========================
  // Terminale A — Total officiel : A1 = 32h, A2 = 31h
  // Par défaut : A1. Pour A2, ramener Maths de 5h à 4h.
  // =========================
  { levelCode: "TleA", subjectId: "anglais", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "TleA", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "TleA", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "TleA", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "TleA", subjectId: "francais", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "TleA", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "TleA", subjectId: "lv2", weeklyUnits: 3, splitPattern: "1+1+1" },
  { levelCode: "TleA", subjectId: "maths", weeklyUnits: 5, splitPattern: "2+2+1", notes: "Officiel : A1 = 5h, A2 = 4h. Valeur par défaut HoraClasse : A1." },
  { levelCode: "TleA1", subjectId: "maths", weeklyUnits: 5, splitPattern: "2+2+1", notes: "Officiel : Tle A1 = 5h." },
  { levelCode: "TleA2", subjectId: "maths", weeklyUnits: 4, splitPattern: "2+1+1", notes: "Officiel : Tle A2 = 4h." },
  { levelCode: "TleA", subjectId: "philo", weeklyUnits: 8, splitPattern: "2+2+2+2" },
  { levelCode: "TleA", subjectId: "svt", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "svt_lab" },

  // =========================
  // Terminale C — Total officiel : 33h
  // =========================
  { levelCode: "TleC", subjectId: "anglais", weeklyUnits: 2, splitPattern: "1+1" },
  { levelCode: "TleC", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "TleC", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "TleC", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "TleC", subjectId: "francais", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "TleC", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "TleC", subjectId: "lv2", weeklyUnits: 2, splitPattern: "1+1", isOptional: true, notes: "Officiel : 2h facultatives." },
  { levelCode: "TleC", subjectId: "maths", weeklyUnits: 8, splitPattern: "2+2+2+2" },
  { levelCode: "TleC", subjectId: "philo", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "TleC", subjectId: "pc", weeklyUnits: 6, splitPattern: "2+2+2", roomTypeRequired: "pc_lab", notes: "Officiel : 2 + 2 + (2h), demi-classe/TP." },
  { levelCode: "TleC", subjectId: "svt", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "svt_lab", notes: "Officiel : 0 + (2h), demi-classe/TP." },

  // =========================
  // Terminale D — Total officiel : 33h
  // =========================
  { levelCode: "TleD", subjectId: "anglais", weeklyUnits: 2, splitPattern: "1+1" },
  { levelCode: "TleD", subjectId: "ap", weeklyUnits: 1, splitPattern: "1", notes: "Arts plastiques." },
  { levelCode: "TleD", subjectId: "musique", weeklyUnits: 1, splitPattern: "1", isOptional: true, notes: "Éducation musicale. Optionnelle selon l’organisation de l’établissement." },
  { levelCode: "TleD", subjectId: "eps", weeklyUnits: 2, splitPattern: "2", roomTypeRequired: "sports_field" },
  { levelCode: "TleD", subjectId: "francais", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "TleD", subjectId: "hg", weeklyUnits: 4, splitPattern: "2+1+1" },
  { levelCode: "TleD", subjectId: "lv2", weeklyUnits: 2, splitPattern: "1+1", isOptional: true, notes: "Officiel : 2h facultatives." },
  { levelCode: "TleD", subjectId: "maths", weeklyUnits: 6, splitPattern: "2+2+2" },
  { levelCode: "TleD", subjectId: "philo", weeklyUnits: 3, splitPattern: "2+1" },
  { levelCode: "TleD", subjectId: "pc", weeklyUnits: 5, splitPattern: "1+2+2", roomTypeRequired: "pc_lab", notes: "Officiel : 1 + 2 + (2h), demi-classe/TP." },
  { levelCode: "TleD", subjectId: "svt", weeklyUnits: 5, splitPattern: "1+1+3", roomTypeRequired: "svt_lab", notes: "Officiel : 1 + 1 + (3h), demi-classe/TP." },
];

export function getDefaultHoursForLevel(
  levelCode: string,
): DefaultSubjectHour[] {
  return defaultSubjectHours.filter((item) => item.levelCode === levelCode);
}