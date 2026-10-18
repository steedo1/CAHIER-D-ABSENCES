import styles from "./FrancoArabicBulletin.module.css";
import { selectPrintablePrograms } from "@/lib/franco-arabic-print-layout";

/**
 * Pure A4 document views. Only render already-authorized data from server.
 * No fetch, client-side permission gate, note mutation or combined mean.
 * A two-program sheet is a LAYOUT choice, never a grading calculation.
 */
export type BulletinTrack = "french" | "arabic";
export type BulletinVariant = BulletinTrack | "combined" | "ordinary";

export type BulletinSchool = {
  name: string;
  code?: string | null;
  subtitle?: string | null;
  motto?: string | null;
  city?: string | null;
  logoUrl?: string | null;
};
export type BulletinStudent = {
  id: string;
  lastName: string;
  firstName: string;
  matricule?: string | null;
  birthDate?: string | null;
  photoUrl?: string | null;
};
export type BulletinSubject = {
  id: string;
  name: string;
  arabicName?: string | null;
  coefficient: number | null;
  average: number | null;
  denominator?: number;
  classAverage?: number | null;
  observation?: string | null;
  /** e.g. an excluded conduct discipline remains visible */
  includeInAverage?: boolean;
};
export type BulletinProgram = {
  track: BulletinTrack;
  cycle: string;
  level: string;
  className: string;
  year: string;
  period: string;
  denominator: number;
  ciPrimaryFrench?: boolean;
  subjects: BulletinSubject[];
  generalAverage: number | null;
  rank?: number | null;
  classSize?: number | null;
  absences?: string | null;
  lates?: string | null;
  appreciation?: string | null;
  directorName?: string | null;
};
export type BulletinDocument = {
  school: BulletinSchool;
  student: BulletinStudent;
  french?: BulletinProgram | null;
  arabic?: BulletinProgram | null;
  /** For preview only: never present demo results as official data. */
  sample?: boolean;
  /** Real results awaiting complete configuration/publication. */
  draft?: boolean;
};

const trackLabels: Record<BulletinTrack, string> = {
  french: "Enseignement français",
  arabic: "Enseignement arabe",
};

function number(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : "—";
}

function BrandMark({ ordinary }: { ordinary: boolean }) {
  return <div className={styles.brandMark} aria-hidden="true">
    {!ordinary && <span className={styles.brandMarkCrescent}>☾</span>}
    <span className={styles.brandMarkBook}>{ordinary ? "▤" : "✧"}</span>
  </div>;
}

function Head({ model, variant }: { model: BulletinDocument; variant: BulletinVariant }) {
  const kind = variant === "combined" ? "Bulletin des deux enseignements" : 
    variant === "ordinary" ? "Bulletin de notes" : variant === "french" ? "Bulletin de notes · Français" : "Bulletin de notes · Arabe";
  const first = variant === "arabic" ? model.arabic : (model.french || model.arabic);
  return <>
    <div className={styles.upperPattern} aria-hidden="true" />
    <header className={styles.header}>
      <div className={styles.republic}>République de Côte d’Ivoire
        <span>Union · Discipline · Travail</span>
      </div>
      <div className={styles.brandLine}>
        {model.school.logoUrl
          // An actual school-supplied logo, never a fabricated official stamp.
          ? <img className={styles.schoolLogo} alt="Logo de l’établissement" src={model.school.logoUrl} />
          : <BrandMark ordinary={variant === "ordinary"} />}
        <div className={styles.schoolIdentity}>
          <div className={styles.schoolName}>{model.school.name}</div>
          {model.school.subtitle && <div className={styles.schoolSubtitle}>{model.school.subtitle}</div>}
          {model.school.motto && <div className={styles.schoolMotto}>{model.school.motto}</div>}
        </div>
        <div className={styles.schoolCode}>
          <span>Établissement</span>
          <strong>{model.school.code || "—"}</strong>
        </div>
      </div>
      <div className={styles.documentHeading}>
        <div className={styles.documentTitle}>{kind}</div>
        <div className={styles.documentPeriod}>Année scolaire {first?.year || "—"} · {first?.period || "—"}</div>
      </div>
    </header>
  </>;
}

function Identity({ model, context }: { model: BulletinDocument; context?: BulletinProgram | null }) {
  return <section className={styles.identity} aria-label="Identité de l’élève">
    <div className={styles.identityCol}>
      <div className={styles.sectionEyebrow}>Élève</div>
      <div className={styles.studentName}>{model.student.lastName} {model.student.firstName}</div>
      <div className={styles.meta}><span>Matricule</span><strong>{model.student.matricule || "—"}</strong></div>
      <div className={styles.meta}><span>Né(e) le</span><strong>{model.student.birthDate || "—"}</strong></div>
    </div>
    <div className={styles.identityCol}>
      <div className={styles.sectionEyebrow}>Scolarité</div>
      <div className={styles.meta}><span>Cycle</span><strong>{context?.cycle || "—"}</strong></div>
      <div className={styles.meta}><span>Niveau</span><strong>{context?.level || "—"}</strong></div>
      <div className={styles.meta}><span>Classe</span><strong>{context?.className || "—"}</strong></div>
    </div>
    <div className={styles.studentPhoto}>
      {model.student.photoUrl
        ? <img src={model.student.photoUrl} alt="Photographie de l’élève" />
        : <span>Photo</span>}
    </div>
  </section>;
}

function Heading({ track, compact, ordinary }: { track: BulletinTrack; compact: boolean; ordinary: boolean }) {
  return <div className={`${styles.panelHeading} ${track === "arabic" ? styles.arabicHeading : ""}`}>
    <div><span className={styles.panelKicker}>Résultats pédagogiques</span>
      <h2>{ordinary ? "Résultats scolaires" : trackLabels[track]}</h2></div>
    {!compact && <span className={styles.panelSymbol} aria-hidden="true">
      {track === "french" ? "✦" : "۞"}
    </span>}
  </div>;
}

function CourseTable({ program, compact }: { program: BulletinProgram; compact: boolean }) {
  // Only secondary-school report cards present disciplinary coefficients.
  const secondary = /^(secondaire|secondary)$/i.test(program.cycle.trim());
  return <table className={`${styles.marks} ${compact ? styles.compactMarks : ""}`}>
    <thead><tr>
      <th scope="col" className={styles.subjectColumn}>Discipline</th>
      {secondary && <th scope="col">Coef.</th>}
      <th scope="col">{program.ciPrimaryFrench ? "Notes" : `Moy. /${program.denominator}`}</th>
      {!compact && <th scope="col">Classe</th>}
      {!compact && <th scope="col">Observation</th>}
    </tr></thead>
    <tbody>
      {program.subjects.map(row => <tr key={row.id}>
        <td className={styles.subjectCell}>
          <span dir="auto">{row.name}</span>
          {row.arabicName && <small lang="ar" dir="rtl">{row.arabicName}</small>}
        </td>
        {secondary && <td>{number(row.coefficient, row.coefficient !== null && row.coefficient % 1 !== 0 ? 1 : 0)}</td>}
        <td className={styles.markCell}>{program.ciPrimaryFrench
          ? (row.average === null ? "" : `${number(row.average)}/${row.denominator || program.denominator}`)
          : number(row.average)}</td>
        {!compact && <td>{number(row.classAverage)}</td>}
        {!compact && <td className={styles.observation}>{row.observation || "—"}</td>}
      </tr>)}
    </tbody>
  </table>;
}

function Summary({ program, compact, ordinary }: { program: BulletinProgram; compact: boolean; ordinary: boolean }) {
  const score = number(program.generalAverage);
  const graded = program.ciPrimaryFrench
    ? program.subjects.filter(row => row.average !== null && row.denominator != null)
    : [];
  const totalPoints = graded.reduce((sum, row) => sum + row.average!, 0);
  const totalBarèmes = graded.reduce((sum, row) => sum + row.denominator!, 0);
  const rank = program.rank != null && program.classSize != null
    ? `${program.rank} / ${program.classSize}` : "—";
  return <div className={`${styles.summary} ${compact ? styles.compactSummary : ""}`}>
    {program.ciPrimaryFrench && <div className={styles.summaryMetric}>
      <span>Total des compositions</span>
      <strong>{totalBarèmes > 0 ? `${number(totalPoints)}/${totalBarèmes}` : "—"}</strong>
    </div>}
    <div className={styles.summaryMetric}>
      <span>{ordinary ? "Moyenne générale" : `Moyenne ${program.track === "arabic" ? "arabe" : "française"}`}</span>
      <strong>{score}<small> / {program.denominator}</small></strong>
    </div>
    <div className={styles.summaryMetric}><span>Rang</span><strong>{rank}</strong></div>
    {!compact && <div className={styles.summaryMetric}>
      <span>Absences / Retards</span><strong className={styles.miniMetric}>
        {program.absences || "—"} / {program.lates || "—"}
      </strong>
    </div>}
  </div>;
}

function Signature({ name, title }: { name?: string | null; title: string }) {
  return <div className={styles.signBox}>
    <span>{title}</span><div className={styles.signLine}/><strong>{name || "Nom et visa"}</strong>
  </div>;
}

function Panel({ program, compact, ordinary }: { program: BulletinProgram; compact: boolean; ordinary: boolean }) {
  return <section className={`${styles.program} ${program.track === "arabic" ? styles.arabicProgram : ""}`}>
    <Heading track={program.track} compact={compact} ordinary={ordinary}/>
    <CourseTable program={program} compact={compact}/>
    <Summary program={program} compact={compact} ordinary={ordinary}/>
    <div className={styles.appreciation}>
      <span>Appréciation générale</span>
      <p>{program.appreciation || "—"}</p>
    </div>
  </section>;
}

function Footer({ model, programs, ordinary }: {
  model: BulletinDocument; programs: BulletinProgram[]; ordinary: boolean;
}) {
  return <footer className={styles.footer}>
    <div className={styles.signatures}>
      {programs.map(p => <Signature
        key={p.track}
        name={p.directorName}
        title={ordinary ? "Direction de l’établissement" : (p.track === "french" ? "Directeur de l’enseignement français" : "Directeur de l’enseignement arabe")}
      />)}
      <div className={styles.stampBox}>
        <span>Cachet de l’établissement</span><div className={styles.stampSpace}/>
        <strong>{model.school.city || "Lieu"} · Signature / cachet</strong>
      </div>
    </div>
    <div className={styles.footerLine}>
      <span>Mon Cahier · Document scolaire</span>
      {model.sample && <strong>MAQUETTE · DONNÉES FICTIVES</strong>}
      {model.draft && <strong>BROUILLON · NON VALIDÉ</strong>}
      <span>Édition A4</span>
    </div>
  </footer>;
}

/** Reusable presentational document: no warning banner and NO combined average. */
export default function FrancoArabicBulletin({
  model, variant, printRoot = false,
}: {
  model: BulletinDocument;
  variant: BulletinVariant;
  printRoot?: boolean;
}) {
  const programs = selectPrintablePrograms(model, variant);
  // A combined A4 document is only the juxtaposition of two subject reports.
  // The policy helper returns no "global average" and never merges results.
  if (!programs) return <p role="alert">Bulletin indisponible : données des enseignements incomplètes.</p>;

  const compact = variant === "combined";
  const context = programs[0];
  return <article className={`${styles.page} ${printRoot ? "fa-report-print-root" : ""} ${compact ? styles.combinedPage : ""} ${variant === "ordinary" ? styles.ordinaryPage : ""}`}
    aria-label={`Bulletin ${variant}`}>
    <Head model={model} variant={variant}/>
    <div className={styles.body}>
      {model.sample && <div className={styles.sampleTag}>MAQUETTE · DONNÉES FICTIVES</div>}
      {model.draft && <div className={styles.sampleTag} role="status">BROUILLON · NON VALIDÉ</div>}
      <Identity model={model} context={context}/>
      <div className={`${styles.panels} ${compact ? styles.twoPanels : ""}`}>
        {programs.map(p=><Panel key={p.track} program={p} compact={compact} ordinary={variant === "ordinary"}/>)}
      </div>
      <Footer model={model} programs={programs} ordinary={variant === "ordinary"}/>
    </div>
  </article>;
}
