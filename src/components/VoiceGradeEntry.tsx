"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Mic, MicOff, RotateCcw, UserRound } from "lucide-react";
import {
  matchRosterStudent,
  parseSpokenGrade,
  type VoiceRosterItem,
  type VoiceStudentCandidate,
} from "@/lib/voice-grades";

type VoiceGradeEvaluation = {
  id: string;
  label: string;
  scale: number;
  disabled?: boolean;
  disabledReason?: string | null;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

type Props<T extends VoiceRosterItem> = {
  roster: T[];
  evaluations: VoiceGradeEvaluation[];
  targetEvaluationId: string | null;
  onTargetEvaluationChange: (evaluationId: string) => void;
  onGrade: (evaluationId: string, studentId: string, value: number) => void;
  isOnline: boolean;
};

type Step = "student" | "score" | "ambiguous";

function formatScore(value: number) {
  return String(value).replace(".", ",");
}

function transcriptAlternatives(result: SpeechRecognitionResultLike): string[] {
  const transcripts: string[] = [];
  for (let i = 0; i < result.length; i += 1) {
    const transcript = result[i]?.transcript?.trim();
    if (transcript && !transcripts.includes(transcript)) transcripts.push(transcript);
  }
  return transcripts;
}

export default function VoiceGradeEntry<T extends VoiceRosterItem>({
  roster,
  evaluations,
  targetEvaluationId,
  onTargetEvaluationChange,
  onGrade,
  isOnline,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [step, setStep] = useState<Step>("student");
  const [activeStudent, setActiveStudent] = useState<T | null>(null);
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<VoiceStudentCandidate<T>[]>([]);
  const [status, setStatus] = useState("Prêt. Dites le nom d’un élève.");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastEntry, setLastEntry] = useState<{ student: T; score: number } | null>(null);
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const keepListeningRef = useRef(false);
  const restartingRef = useRef(false);
  const stepRef = useRef<Step>(step);
  const activeStudentRef = useRef<T | null>(activeStudent);
  const rosterRef = useRef<T[]>(roster);
  const evaluationsRef = useRef<VoiceGradeEvaluation[]>(evaluations);
  const targetEvaluationIdRef = useRef<string | null>(targetEvaluationId);
  const onGradeRef = useRef(onGrade);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    activeStudentRef.current = activeStudent;
  }, [activeStudent]);

  useEffect(() => {
    rosterRef.current = roster;
  }, [roster]);

  useEffect(() => {
    evaluationsRef.current = evaluations;
  }, [evaluations]);

  useEffect(() => {
    targetEvaluationIdRef.current = targetEvaluationId;
  }, [targetEvaluationId]);

  useEffect(() => {
    onGradeRef.current = onGrade;
  }, [onGrade]);

  const targetEvaluation = useMemo(
    () => evaluations.find((ev) => ev.id === targetEvaluationId) || null,
    [evaluations, targetEvaluationId]
  );

  const canStart =
    supported &&
    isOnline &&
    roster.length > 0 &&
    !!targetEvaluation &&
    !targetEvaluation.disabled;

  function stopRecognition() {
    keepListeningRef.current = false;
    restartingRef.current = false;
    setListening(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Rien à faire : le navigateur avait déjà arrêté l'écoute.
      }
    }
  }

  function chooseStudent(student: T) {
    setAmbiguousCandidates([]);
    setActiveStudent(student);
    setStep("score");
    setStatus(`${student.full_name} reconnu. Dites maintenant sa note.`);
    stepRef.current = "score";
    activeStudentRef.current = student;
  }

  function resetToStudent(message = "Dites le nom de l’élève suivant.") {
    setAmbiguousCandidates([]);
    setActiveStudent(null);
    setStep("student");
    setStatus(message);
    stepRef.current = "student";
    activeStudentRef.current = null;
  }

  function processStudentTranscripts(transcripts: string[]) {
    let bestMatched: VoiceStudentCandidate<T> | null = null;
    let bestAmbiguous: VoiceStudentCandidate<T>[] = [];

    for (const transcript of transcripts) {
      const result = matchRosterStudent(transcript, rosterRef.current);
      if (result.status === "matched") {
        if (!bestMatched || result.candidate.score > bestMatched.score) {
          bestMatched = result.candidate;
        }
      } else if (result.status === "ambiguous") {
        if (!bestAmbiguous.length || (result.candidates[0]?.score || 0) > (bestAmbiguous[0]?.score || 0)) {
          bestAmbiguous = result.candidates;
        }
      }
    }

    if (bestMatched) {
      chooseStudent(bestMatched.student);
      return;
    }

    if (bestAmbiguous.length) {
      setAmbiguousCandidates(bestAmbiguous);
      setStep("ambiguous");
      stepRef.current = "ambiguous";
      setStatus("Plusieurs élèves correspondent. Touchez le bon nom pour continuer.");
      return;
    }

    setStatus("Nom non reconnu. Répétez le nom et le prénom de l’élève.");
  }

  function processScoreTranscripts(transcripts: string[]) {
    const evaluation = evaluationsRef.current.find(
      (ev) => ev.id === targetEvaluationIdRef.current
    );
    const student = activeStudentRef.current;

    if (!evaluation || !student) {
      resetToStudent("La cible a changé. Dites de nouveau le nom de l’élève.");
      return;
    }

    let score: number | null = null;
    for (const transcript of transcripts) {
      const parsed = parseSpokenGrade(transcript);
      if (parsed != null) {
        score = parsed;
        break;
      }
    }

    if (score == null) {
      setStatus(`Note non comprise. Dites par exemple « 14 » ou « 14 virgule 5 ».`);
      return;
    }

    if (score < 0 || score > evaluation.scale) {
      setStatus(
        `La note ${formatScore(score)} dépasse l’échelle /${evaluation.scale}. Répétez la note.`
      );
      return;
    }

    onGradeRef.current(evaluation.id, student.id, score);
    setLastEntry({ student, score });
    resetToStudent(
      `${formatScore(score)} /${evaluation.scale} attribué à ${student.full_name}. Dites le nom suivant.`
    );
  }

  function processTranscripts(transcripts: string[]) {
    if (!transcripts.length) return;
    setLastTranscript(transcripts[0]);

    if (stepRef.current === "ambiguous") return;
    if (stepRef.current === "score") {
      processScoreTranscripts(transcripts);
      return;
    }
    processStudentTranscripts(transcripts);
  }

  function startRecognition() {
    if (!canStart) return;

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSupported(false);
      setStatus("La saisie vocale n’est pas disponible dans ce navigateur.");
      return;
    }

    stopRecognition();
    keepListeningRef.current = true;
    setListening(true);
    setStatus(
      stepRef.current === "score" && activeStudentRef.current
        ? `Dites la note de ${activeStudentRef.current.full_name}.`
        : "J’écoute… dites le nom d’un élève."
    );

    const recognition = new Recognition();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        processTranscripts(transcriptAlternatives(result));
      }
    };

    recognition.onerror = (event) => {
      const code = event?.error || "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        keepListeningRef.current = false;
        setListening(false);
        setStatus("Accès au microphone refusé. Autorisez le micro puis réessayez.");
        return;
      }
      if (code === "network") {
        keepListeningRef.current = false;
        setListening(false);
        setStatus("La transcription vocale est indisponible sans connexion pour cette V1.");
        return;
      }
      if (code !== "no-speech" && code !== "aborted") {
        setStatus("Je n’ai pas bien entendu. Vous pouvez répéter.");
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!keepListeningRef.current || restartingRef.current) {
        if (!keepListeningRef.current) setListening(false);
        return;
      }

      // Chrome/Edge peuvent clore une session continue après un silence.
      // On relance discrètement tant que le professeur n'a pas appuyé sur Arrêter.
      restartingRef.current = true;
      window.setTimeout(() => {
        restartingRef.current = false;
        if (keepListeningRef.current) startRecognition();
      }, 250);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      keepListeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setStatus("Impossible de démarrer le microphone. Réessayez.");
    }
  }

  useEffect(() => {
    const Recognition = getSpeechRecognitionConstructor();
    setSupported(!!Recognition);
    return () => stopRecognition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOnline && listening) {
      stopRecognition();
      setStatus("Connexion perdue : la saisie manuelle reste disponible.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    if (!targetEvaluationId) return;
    resetToStudent("Évaluation sélectionnée. Dites le nom d’un élève.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetEvaluationId]);

  return (
    <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-600 p-2 text-white shadow-sm">
            <Mic className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">Saisie vocale des notes</div>
            <div className="text-xs text-slate-600">
              Dites le nom → vérifiez l’élève affiché → dites la note. Les copies peuvent rester dans n’importe quel ordre.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (open) stopRecognition();
            setOpen((value) => !value);
          }}
          className="inline-flex items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {open ? "Réduire" : "Utiliser"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-indigo-100 pt-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_1fr] md:items-end">
            <label className="space-y-1 text-xs font-medium text-slate-700">
              Évaluation à remplir
              <select
                value={targetEvaluationId || ""}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                  onTargetEvaluationChange(event.target.value)
                }
                disabled={listening}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 disabled:bg-slate-100"
              >
                {!evaluations.length && <option value="">Aucune évaluation</option>}
                {evaluations.map((ev) => (
                  <option key={ev.id} value={ev.id} disabled={ev.disabled}>
                    {ev.label} /{ev.scale}{ev.disabled ? " — indisponible" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              {!listening ? (
                <button
                  type="button"
                  onClick={startRecognition}
                  disabled={!canStart}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Mic className="h-4 w-4" /> Commencer la dictée
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecognition}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800"
                >
                  <MicOff className="h-4 w-4" /> Arrêter
                </button>
              )}

              {(activeStudent || step === "ambiguous") && (
                <button
                  type="button"
                  onClick={() => resetToStudent("Dites de nouveau le nom de l’élève.")}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" /> Changer d’élève
                </button>
              )}
            </div>
          </div>

          {!supported && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Ce navigateur ne fournit pas la reconnaissance vocale nécessaire. La saisie classique reste disponible.
            </div>
          )}
          {supported && !isOnline && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Cette première version de la transcription vocale nécessite Internet. Les notes restent saisissables et enregistrables hors ligne avec le système actuel.
            </div>
          )}
          {targetEvaluation?.disabled && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {targetEvaluation.disabledReason || "Cette évaluation n’est pas modifiable."}
            </div>
          )}

          <div
            className={[
              "rounded-xl border px-4 py-3",
              listening
                ? "border-indigo-300 bg-white shadow-sm"
                : "border-slate-200 bg-white/70",
            ].join(" ")}
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {listening ? (
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-600" />
                </span>
              ) : (
                <span className="inline-flex h-3 w-3 rounded-full bg-slate-300" />
              )}
              {step === "score" && activeStudent ? "Dites la note" : step === "ambiguous" ? "Confirmation nécessaire" : "Dites le nom"}
            </div>
            <div className="mt-1 text-sm text-slate-700">{status}</div>
            {lastTranscript && (
              <div className="mt-1 text-[11px] text-slate-500">Entendu : « {lastTranscript} »</div>
            )}
          </div>

          {activeStudent && step === "score" && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="rounded-full bg-emerald-600 p-2 text-white">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-emerald-950">{activeStudent.full_name}</div>
                <div className="text-xs text-emerald-800">
                  {activeStudent.matricule ? `Matricule ${activeStudent.matricule} • ` : ""}
                  dites maintenant la note /{targetEvaluation?.scale ?? 20}
                </div>
              </div>
            </div>
          )}

          {step === "ambiguous" && ambiguousCandidates.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 text-sm font-semibold text-amber-900">Quel élève vouliez-vous dire ?</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {ambiguousCandidates.map(({ student }) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => chooseStudent(student)}
                    className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-amber-100"
                  >
                    {student.full_name}
                    {student.matricule && (
                      <span className="ml-1 text-xs font-normal text-slate-500">({student.matricule})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {lastEntry && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Dernière saisie : {lastEntry.student.full_name} — {formatScore(lastEntry.score)}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Sécurité : la dictée remplit seulement le tableau en cours. Rien n’est publié automatiquement ; utilisez ensuite le bouton « Enregistrer » habituel.
          </p>
        </div>
      )}
    </div>
  );
}
