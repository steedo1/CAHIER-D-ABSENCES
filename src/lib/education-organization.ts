export const EDUCATION_ORGANIZATION_SETTINGS_KEY = "education_organization_v1" as const;

export const EDUCATION_TYPE_OPTIONS = [
  {
    id: "general_secondary",
    label: "Secondaire général",
    shortLabel: "Général",
    description: "Collège et lycée général avec les interfaces actuellement utilisées dans Mon Cahier.",
  },
  {
    id: "technical_secondary",
    label: "Enseignement technique",
    shortLabel: "Technique",
    description: "Séries du baccalauréat technique et formations techniques de niveau secondaire.",
  },
  {
    id: "vocational_training",
    label: "Formation professionnelle",
    shortLabel: "Professionnel",
    description: "CAP, BT, BEP, CQP et autres diplômes ou certificats professionnels.",
  },
  {
    id: "higher_technical_short_cycle",
    label: "BTS / cycle supérieur court",
    shortLabel: "BTS",
    description: "Formations post-baccalauréat de type BTS ou cycle supérieur court.",
  },
] as const;

export type EducationType = (typeof EDUCATION_TYPE_OPTIONS)[number]["id"];

export type FormationReliability =
  | "verified"
  | "documented"
  | "partial"
  | "to_document";

export type FormationCatalogItem = {
  id: string;
  educationType: Exclude<EducationType, "general_secondary">;
  diplomaCode: string;
  diplomaLabel: string;
  name: string;
  shortCode: string;
  reliability: FormationReliability;
  note?: string;
};

/**
 * Catalogue V1 volontairement prudent.
 * Il sert uniquement à faciliter la sélection de l'offre de formation.
 * Les matières et coefficients seront appliqués plus tard dans les écrans existants,
 * après validation du référentiel correspondant.
 */
export const FORMATION_CATALOG: FormationCatalogItem[] = [
  {
    id: "technical_bac_b",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série B",
    shortCode: "B",
    reliability: "to_document",
    note: "Série intégrée au catalogue ; positionnement officiel, matières et coefficients à consolider.",
  },
  {
    id: "technical_bac_g1",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série G1",
    shortCode: "G1",
    reliability: "partial",
    note: "Matières repérées ; coefficients complets à confirmer.",
  },
  {
    id: "technical_bac_g2",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série G2",
    shortCode: "G2",
    reliability: "verified",
    note: "Grille détaillée disponible pour 2G2, 1G2 et TG2.",
  },
  {
    id: "technical_bac_e",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série E",
    shortCode: "E",
    reliability: "to_document",
  },
  {
    id: "technical_bac_f1",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série F1",
    shortCode: "F1",
    reliability: "to_document",
  },
  {
    id: "technical_bac_f2",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série F2",
    shortCode: "F2",
    reliability: "partial",
    note: "Matières repérées ; coefficients complets à confirmer.",
  },
  {
    id: "technical_bac_f3",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série F3",
    shortCode: "F3",
    reliability: "to_document",
  },
  {
    id: "technical_bac_f4",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série F4",
    shortCode: "F4",
    reliability: "to_document",
  },
  {
    id: "technical_bac_f7",
    educationType: "technical_secondary",
    diplomaCode: "BAC_TECH",
    diplomaLabel: "Baccalauréat technique",
    name: "Série F7",
    shortCode: "F7",
    reliability: "to_document",
  },

  {
    id: "vocational_cap_construction_metallique",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Construction métallique",
    shortCode: "CAP-CM",
    reliability: "documented",
  },
  {
    id: "vocational_cap_menuiserie_ebenisterie",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Menuiserie-ébénisterie",
    shortCode: "CAP-ME",
    reliability: "documented",
  },
  {
    id: "vocational_cap_maconnerie",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Maçonnerie",
    shortCode: "CAP-MAC",
    reliability: "documented",
  },
  {
    id: "vocational_cap_electricite_batiment",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Électricité bâtiment",
    shortCode: "CAP-EB",
    reliability: "documented",
  },
  {
    id: "vocational_cap_plomberie_sanitaire",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Plomberie sanitaire",
    shortCode: "CAP-PS",
    reliability: "documented",
  },
  {
    id: "vocational_cap_mecanique_generale",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Mécanique générale",
    shortCode: "CAP-MG",
    reliability: "to_document",
  },
  {
    id: "vocational_cap_chaudronnerie_soudure",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Chaudronnerie-soudure",
    shortCode: "CAP-CS",
    reliability: "to_document",
  },
  {
    id: "vocational_cap_maintenance_mecanique_agricole",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Maintenance mécanique agricole",
    shortCode: "CAP-MMA",
    reliability: "to_document",
  },
  {
    id: "vocational_cap_elevage",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Élevage",
    shortCode: "CAP-ELEV",
    reliability: "to_document",
  },
  {
    id: "vocational_cap_btp",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Bâtiment et travaux publics",
    shortCode: "CAP-BTP",
    reliability: "to_document",
  },
  {
    id: "vocational_cap_agroalimentaire_qualite",
    educationType: "vocational_training",
    diplomaCode: "CAP",
    diplomaLabel: "CAP",
    name: "Transformation et contrôle qualité en industrie agroalimentaire",
    shortCode: "CAP-TCQIA",
    reliability: "to_document",
  },
  {
    id: "vocational_bt_secretariat_bureautique",
    educationType: "vocational_training",
    diplomaCode: "BT",
    diplomaLabel: "Brevet de technicien (BT)",
    name: "Secrétariat bureautique",
    shortCode: "BT-SB",
    reliability: "documented",
  },
  {
    id: "vocational_bt_comptabilite",
    educationType: "vocational_training",
    diplomaCode: "BT",
    diplomaLabel: "Brevet de technicien (BT)",
    name: "Comptabilité",
    shortCode: "BT-COMPTA",
    reliability: "partial",
    note: "Plusieurs matières documentées ; au moins un coefficient public contradictoire reste à confirmer.",
  },
  {
    id: "vocational_bt_comptabilite_commerce",
    educationType: "vocational_training",
    diplomaCode: "BT",
    diplomaLabel: "Brevet de technicien (BT)",
    name: "Comptabilité-Commerce",
    shortCode: "BT-CC",
    reliability: "documented",
  },
  {
    id: "vocational_bt_transit_transport",
    educationType: "vocational_training",
    diplomaCode: "BT",
    diplomaLabel: "Brevet de technicien (BT)",
    name: "Transit-Transport",
    shortCode: "BT-TT",
    reliability: "to_document",
  },

  {
    id: "higher_bts_fcge",
    educationType: "higher_technical_short_cycle",
    diplomaCode: "BTS",
    diplomaLabel: "BTS",
    name: "Finance-Comptabilité et Gestion des Entreprises",
    shortCode: "BTS-FCGE",
    reliability: "documented",
    note: "Grille officielle historique disponible ; actualisation à vérifier avant application automatique.",
  },
  {
    id: "higher_bts_assistanat_direction",
    educationType: "higher_technical_short_cycle",
    diplomaCode: "BTS",
    diplomaLabel: "BTS",
    name: "Assistanat de Direction",
    shortCode: "BTS-AD",
    reliability: "partial",
  },
  {
    id: "higher_bts_gestion_commerciale",
    educationType: "higher_technical_short_cycle",
    diplomaCode: "BTS",
    diplomaLabel: "BTS",
    name: "Gestion Commerciale",
    shortCode: "BTS-GC",
    reliability: "documented",
  },
];

export type CustomFormation = {
  id: string;
  educationType: Exclude<EducationType, "general_secondary">;
  diplomaCode: string;
  diplomaLabel: string;
  name: string;
  shortCode: string;
  levels: string[];
  createdAt?: string | null;
};

export type EducationOrganizationSettings = {
  version: 1;
  configured: boolean;
  educationTypes: EducationType[];
  selectedCatalogFormationIds: string[];
  customFormations: CustomFormation[];
  legacyGeneralProtected: boolean;
  configuredAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export const RELIABILITY_LABELS: Record<FormationReliability, string> = {
  verified: "Référentiel vérifié",
  documented: "Configuration documentée",
  partial: "À vérifier",
  to_document: "Référentiel à compléter",
};

export function isEducationType(value: unknown): value is EducationType {
  return EDUCATION_TYPE_OPTIONS.some((item) => item.id === value);
}

export function getCatalogFormation(id: string) {
  return FORMATION_CATALOG.find((item) => item.id === id) || null;
}

export function getDefaultEducationOrganization(
  options: { hasExistingClasses: boolean } = { hasExistingClasses: false },
): EducationOrganizationSettings {
  const legacyGeneralProtected = options.hasExistingClasses;

  return {
    version: 1,
    configured: legacyGeneralProtected,
    educationTypes: legacyGeneralProtected ? ["general_secondary"] : [],
    selectedCatalogFormationIds: [],
    customFormations: [],
    legacyGeneralProtected,
    configuredAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}
