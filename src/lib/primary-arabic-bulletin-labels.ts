/**
 * Arabic display names for the existing EPC primary subjects.
 * Presentation only: never creates, renames, or rewrites a database subject.
 * Verify local pedagogical terminology with the Arabic teaching director.
 */
const SUBJECT_ARABIC: Record<string, string> = {
  "apprentissage des lettres": "تعلم الحروف",
  "lecture": "القراءة",
  "lecture du coran": "قراءة القرآن الكريم",
  "mémorisation du coran": "حفظ القرآن الكريم",
  "règles de lecture du coran (tajwid)": "أحكام التجويد",
  "interprétation du coran (tafsir)": "تفسير القرآن الكريم",
  "écriture et dictée": "الكتابة والإملاء",
  "écriture": "الكتابة",
  "dictée": "الإملاء",
  "expression orale": "التعبير الشفهي",
  "grammaire arabe": "قواعد اللغة العربية",
  "conjugaison arabe": "تصريف الأفعال",
  "poème": "المحفوظات",
  "chant": "الأناشيد",
  "dessin": "الرسم",
  "coran (poème) et écriture": "القرآن الكريم والمحفوظات والكتابة",
  "coran (règles de jurisprudence) et écriture": "القرآن الكريم وأحكام الفقه والكتابة",
  "coran (révision des poèmes mémorisés) et écriture": "القرآن الكريم ومراجعة المحفوظات والكتابة",
  "coran": "القرآن الكريم",
  "psalmodie du coran": "ترتيل القرآن الكريم",
  "traduction du coran": "ترجمة معاني القرآن الكريم",
  "hadith (tradition prophétique)": "الحديث النبوي",
  "jurisprudence et croyance (al-muslim as-saghîr)": "الفقه والعقيدة (المسلم الصغير)",
  "leçons élémentaires": "الدروس الأساسية",
  "biographie du prophète (saw)": "السيرة النبوية",
  "jurisprudence islamique (fiqh)": "الفقه الإسلامي",
  "jurisprudence (fiqh)": "الفقه الإسلامي",
  "croyance (tawhid)": "العقيدة (التوحيد)",
  "unicité divine (tawhîd)": "التوحيد",
  "mathématiques": "الرياضيات",
  "chants et dessin": "الأناشيد والرسم",
  "dessin et chants": "الرسم والأناشيد",
};

export function primaryArabicSubjectLabel(name: string): string | null {
  return SUBJECT_ARABIC[name.normalize("NFKC").trim().toLocaleLowerCase("fr")] || null;
}

export const EPC_PRIMARY_ARABIC_SUBJECT_COUNT = Object.keys(SUBJECT_ARABIC).length;
