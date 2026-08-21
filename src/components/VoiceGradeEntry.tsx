"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Mic,
  MicOff,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import {
  buildGradeContextPhrases,
  buildRosterContextPhrases,
  matchRosterStudent,
  parseSpokenGrade,
  type VoiceContextPhrase,
  type VoiceRosterItem,
  type VoiceStudentCandidate,
} from "@/lib/voice-grades";
import { CLOUD_ONLY_GRADE_WRITE_MESSAGE } from "@/lib/grade-write-capabilities";

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

type SpeechRecognitionPhraseLike = {
  phrase: string;
  boost: number;
};

type SpeechRecognitionPhraseCollectionLike = {
  push: (...items: SpeechRecognitionPhraseLike[]) => number;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  phrases?: SpeechRecognitionPhraseCollectionLike;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;
type SpeechRecognitionPhraseConstructorLike = new (
  phrase: string,
  boost?: number
) => SpeechRecognitionPhraseLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function getSpeechRecognitionPhraseConstructor(): SpeechRecognitionPhraseConstructorLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognitionPhrase?: SpeechRecognitionPhraseConstructorLike;
  };
  return speechWindow.SpeechRecognitionPhrase || null;
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
type FeedbackTone = "neutral" | "warning" | "error";

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

function pushContextPhrases(
  recognition: SpeechRecognitionLike,
  phrases: VoiceContextPhrase[],
  disabled: boolean
): boolean {
  if (disabled || !recognition.phrases || typeof recognition.phrases.push !== "function") {
    return false;
  }

  const Phrase = getSpeechRecognitionPhraseConstructor();
  if (!Phrase) return false;

  try {
    for (const item of phrases) {
      recognition.phrases.push(new Phrase(item.phrase, item.boost));
    }
    return phrases.length > 0;
  } catch {
    return false;
  }
}

export default function VoiceGradeEntry<T extends VoiceRosterItem>({
  roster,
  evaluations,
  targetEvaluationId,
  onTargetEvaluationChange,
  onGrade,
  isOnline,
}: Props<T>) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [step, setStep] = useState<Step>("student");
  const [activeStudent, setActiveStudent] = useState<T | null>(null);
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<VoiceStudentCandidate<T>[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("neutral");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  const [lastEntry, setLastEntry] = useState<{ student: T; score: number } | null>(null);
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const contextBiasDisabledRef = useRef(false);
  const stepRef = useRef<Step>(step);
  const activeStudentRef = useRef<T | null>(activeStudent);
  const rosterRef = useRef<T[]>(roster);
  const evaluationsRef = useRef<VoiceGradeEvaluation[]>(evaluations);
  const targetEvaluationIdRef = useRef<string | null>(targetEvaluationId);
  const onGradeRef = useRef(onGrade);

  useEffect(() => setMounted(true), []);

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

  function clearRestartTimer() {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }

  function cancelCurrentRecognition() {
    clearRestartTimer();
    setListening(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;

    recognition.onstart = null;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;

    try {
      recognition.abort();
    } catch {
      try {
        recognition.stop();
      } catch {
        // La session était déjà terminée.
      }
    }
  }

  function setMessage(message: string | null, tone: FeedbackTone = "neutral") {
    setFeedback(message);
    setFeedbackTone(tone);
  }

  function chooseStudent(student: T, restartAfterChoice = true) {
    setAmbiguousCandidates([]);
    setActiveStudent(student);
    setStep("score");
    setLiveTranscript(null);
    setMessage(null);
    stepRef.current = "score";
    activeStudentRef.current = student;

    if (restartAfterChoice && sessionActiveRef.current && !recognitionRef.current) {
      scheduleNextRecognition(180);
    }
  }

  function resetToStudent(options?: { keepTranscript?: boolean; message?: string | null }) {
    setAmbiguousCandidates([]);
    setActiveStudent(null);
    setStep("student");
    setLiveTranscript(null);
    if (!options?.keepTranscript) setLastTranscript(null);
    setMessage(options?.message ?? null, options?.message ? "warning" : "neutral");
    stepRef.current = "student";
    activeStudentRef.current = null;
  }

  function processStudentTranscripts(transcripts: string[]) {
    let bestMatched: VoiceStudentCandidate<T> | null = null;
    let bestAmbiguous: VoiceStudentCandidate<T>[] = [];
    let bestSuggestions: VoiceStudentCandidate<T>[] = [];

    for (const transcript of transcripts) {
      const result = matchRosterStudent(transcript, rosterRef.current);
      if (result.status === "matched") {
        if (!bestMatched || result.candidate.score > bestMatched.score) {
          bestMatched = result.candidate;
        }
      } else if (result.status === "ambiguous") {
        if (
          !bestAmbiguous.length ||
          (result.candidates[0]?.score || 0) > (bestAmbiguous[0]?.score || 0)
        ) {
          bestAmbiguous = result.candidates;
        }
      } else if (
        result.candidates.length &&
        (!bestSuggestions.length ||
          (result.candidates[0]?.score || 0) > (bestSuggestions[0]?.score || 0))
      ) {
        bestSuggestions = result.candidates;
      }
    }

    if (bestMatched) {
      chooseStudent(bestMatched.student, false);
      return;
    }

    const candidates = bestAmbiguous.length ? bestAmbiguous : bestSuggestions;
    if (candidates.length) {
      setAmbiguousCandidates(candidates);
      setStep("ambiguous");
      setLiveTranscript(null);
      setMessage("Je veux vérifier le nom avant d’attribuer une note.", "warning");
      stepRef.current = "ambiguous";
      return;
    }

    setMessage("Nom non reconnu. Dites le nom et au moins un prénom.", "error");
  }

  function processScoreTranscripts(transcripts: string[]) {
    const evaluation = evaluationsRef.current.find(
      (ev) => ev.id === targetEvaluationIdRef.current
    );
    const student = activeStudentRef.current;

    if (!evaluation || !student) {
      resetToStudent({ message: "L’évaluation a changé. Dites de nouveau le nom de l’élève." });
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
      setMessage("Note non comprise. Dites par exemple « quatorze virgule cinq ».", "error");
      return;
    }

    if (score < 0 || score > evaluation.scale) {
      setMessage(
        `${formatScore(score)} est impossible sur ${evaluation.scale}. Répétez la note.`,
        "error"
      );
      return;
    }

    onGradeRef.current(evaluation.id, student.id, score);
    setLastEntry({ student, score });
    resetToStudent();
  }

  function processTranscripts(transcripts: string[]) {
    if (!transcripts.length) return;
    setLastTranscript(transcripts[0]);
    setLiveTranscript(null);

    if (stepRef.current === "ambiguous") return;
    if (stepRef.current === "score") {
      processScoreTranscripts(transcripts);
      return;
    }
    processStudentTranscripts(transcripts);
  }

  function scheduleNextRecognition(delay = 220) {
    clearRestartTimer();
    if (!sessionActiveRef.current || stepRef.current === "ambiguous") return;
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      startRecognitionCycle();
    }, delay);
  }

  function startRecognitionCycle() {
    if (!sessionActiveRef.current || stepRef.current === "ambiguous") return;
    if (recognitionRef.current) return;

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSupported(false);
      stopSession();
      setMessage("La reconnaissance vocale n’est pas disponible dans ce navigateur.", "error");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    const evaluation = evaluationsRef.current.find(
      (ev) => ev.id === targetEvaluationIdRef.current
    );
    const contextPhrases =
      stepRef.current === "score" && evaluation
        ? buildGradeContextPhrases(evaluation.scale)
        : buildRosterContextPhrases(rosterRef.current);

    pushContextPhrases(recognition, contextPhrases, contextBiasDisabledRef.current);

    recognition.onstart = () => {
      setListening(true);
      setLiveTranscript(null);
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternatives = transcriptAlternatives(result);
        if (alternatives[0]) setLiveTranscript(alternatives[0]);
        if (!result?.isFinal) continue;
        processTranscripts(alternatives);
        return;
      }
    };

    recognition.onerror = (event) => {
      const code = event?.error || "";

      if (code === "phrases-not-supported") {
        // Compatibilité : certains navigateurs exposent `phrases` mais leur
        // moteur courant ne l'accepte pas. On réessaie sans contextual biasing.
        contextBiasDisabledRef.current = true;
        setListening(false);
        return;
      }

      if (code === "not-allowed" || code === "service-not-allowed") {
        sessionActiveRef.current = false;
        setSessionActive(false);
        setListening(false);
        setMessage("Micro indisponible. Autorisez le microphone puis recommencez.", "error");
        return;
      }

      if (code === "network") {
        sessionActiveRef.current = false;
        setSessionActive(false);
        setListening(false);
        setMessage("La transcription vocale nécessite une connexion pour cette version.", "error");
        return;
      }

      if (code !== "no-speech" && code !== "aborted") {
        setMessage("Je n’ai pas bien entendu. Répétez simplement.", "warning");
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      setLiveTranscript(null);
      if (sessionActiveRef.current && stepRef.current !== "ambiguous") {
        scheduleNextRecognition(contextBiasDisabledRef.current ? 180 : 220);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      if (sessionActiveRef.current) scheduleNextRecognition(350);
    }
  }

  function startSession() {
    if (!canStart) return;
    cancelCurrentRecognition();
    resetToStudent();
    contextBiasDisabledRef.current = false;
    sessionActiveRef.current = true;
    setSessionActive(true);
    setMessage(null);
    window.setTimeout(startRecognitionCycle, 80);
  }

  function stopSession() {
    sessionActiveRef.current = false;
    setSessionActive(false);
    cancelCurrentRecognition();
  }

  function closeModal() {
    stopSession();
    resetToStudent();
    setOpen(false);
  }

  useEffect(() => {
    const Recognition = getSpeechRecognitionConstructor();
    setSupported(!!Recognition);
    return () => {
      sessionActiveRef.current = false;
      cancelCurrentRecognition();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!isOnline && sessionActiveRef.current) {
      stopSession();
      setMessage("Connexion perdue. La saisie classique reste disponible.", "warning");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    if (!targetEvaluationId) return;
    resetToStudent();
    if (sessionActiveRef.current) {
      cancelCurrentRecognition();
      scheduleNextRecognition(180);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetEvaluationId]);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mb-4 flex w-full items-center justify-between gap-4 rounded-2xl border border-indigo-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-sm">
          <Mic className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-bold text-slate-950 sm:text-lg">Saisie vocale des notes</div>
          <div className="mt-0.5 text-sm text-slate-600">Nom → élève → note</div>
        </div>
      </div>
      <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">
        Ouvrir
      </span>
    </button>
  );

  if (!mounted) return trigger;

  const modal = open
    ? createPortal(
        <div className="fixed inset-0 z-[120] bg-slate-950/70 backdrop-blur-sm sm:p-5">
          <div className="mx-auto flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(780px,calc(100dvh-2.5rem))] sm:rounded-[32px]">
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-7 sm:py-5">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white">
                <Mic className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-extrabold tracking-tight text-slate-950 sm:text-2xl">
                  Saisie vocale
                </h2>
                <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-500">
                  <span
                    className={[
                      "h-2.5 w-2.5 rounded-full",
                      sessionActive ? "bg-emerald-500" : "bg-slate-300",
                    ].join(" ")}
                  />
                  {sessionActive ? "Mode vocal actif" : "Prêt"}
                </div>
              </div>

              <label className="hidden min-w-[220px] sm:block">
                <span className="sr-only">Évaluation à remplir</span>
                <select
                  value={targetEvaluationId || ""}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                    onTargetEvaluationChange(event.target.value)
                  }
                  disabled={sessionActive}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-70"
                >
                  {!evaluations.length && <option value="">Aucune évaluation</option>}
                  {evaluations.map((ev) => (
                    <option key={ev.id} value={ev.id} disabled={ev.disabled}>
                      {ev.label} /{ev.scale}{ev.disabled ? " — indisponible" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={closeModal}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                aria-label="Fermer la saisie vocale"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:hidden">
              <select
                value={targetEvaluationId || ""}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                  onTargetEvaluationChange(event.target.value)
                }
                disabled={sessionActive}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none disabled:opacity-70"
              >
                {!evaluations.length && <option value="">Aucune évaluation</option>}
                {evaluations.map((ev) => (
                  <option key={ev.id} value={ev.id} disabled={ev.disabled}>
                    {ev.label} /{ev.scale}{ev.disabled ? " — indisponible" : ""}
                  </option>
                ))}
              </select>
            </div>

            <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
              {!supported || !isOnline || targetEvaluation?.disabled ? (
                <div className="m-auto w-full max-w-2xl rounded-3xl border border-amber-200 bg-amber-50 p-7 text-center sm:p-10">
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-100 text-amber-700">
                    <MicOff className="h-8 w-8" />
                  </div>
                  <h3 className="mt-5 text-2xl font-extrabold text-slate-950">
                    {!supported
                      ? "Reconnaissance vocale indisponible"
                      : !isOnline
                        ? "Connexion nécessaire pour la voix"
                        : "Évaluation non modifiable"}
                  </h3>
                  <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-700">
                    {!supported
                      ? "Utilisez Chrome ou Edge récent. La saisie classique des notes reste disponible."
                      : !isOnline
                        ? CLOUD_ONLY_GRADE_WRITE_MESSAGE
                        : targetEvaluation?.disabledReason || "Choisissez une autre évaluation."}
                  </p>
                </div>
              ) : step === "ambiguous" ? (
                <div className="m-auto w-full max-w-3xl">
                  <div className="text-center">
                    <div className="text-sm font-extrabold uppercase tracking-[0.18em] text-amber-600">
                      Vérification
                    </div>
                    <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                      Quel élève avez-vous dit ?
                    </h3>
                    {lastTranscript && (
                      <div className="mt-4 text-xl font-medium text-slate-500 sm:text-2xl">
                        Entendu : « {lastTranscript} »
                      </div>
                    )}
                  </div>

                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    {ambiguousCandidates.map(({ student }) => (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => chooseStudent(student)}
                        className="group flex min-h-[92px] items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50/60"
                      >
                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 group-hover:bg-indigo-600 group-hover:text-white">
                          <UserRound className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-lg font-extrabold leading-tight text-slate-950 sm:text-xl">
                            {student.full_name}
                          </div>
                          {student.matricule && (
                            <div className="mt-1 text-sm font-medium text-slate-500">
                              {student.matricule}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      resetToStudent();
                      if (sessionActiveRef.current) scheduleNextRecognition(120);
                    }}
                    className="mx-auto mt-6 flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-800 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-5 w-5" /> Répéter le nom
                  </button>
                </div>
              ) : (
                <div className="m-auto flex w-full max-w-3xl flex-col items-center text-center">
                  {step === "score" && activeStudent ? (
                    <>
                      <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-100 text-emerald-700 sm:h-24 sm:w-24">
                        <UserRound className="h-10 w-10 sm:h-12 sm:w-12" />
                      </div>
                      <div className="mt-5 text-sm font-extrabold uppercase tracking-[0.2em] text-emerald-600">
                        Élève reconnu
                      </div>
                      <h3 className="mt-2 max-w-3xl text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
                        {activeStudent.full_name}
                      </h3>
                      {activeStudent.matricule && (
                        <div className="mt-2 text-lg font-semibold text-slate-500">
                          {activeStudent.matricule}
                        </div>
                      )}
                      <div className="mt-7 rounded-3xl bg-indigo-50 px-7 py-5 sm:px-10">
                        <div className="text-2xl font-black text-indigo-950 sm:text-4xl">
                          Dites la note /{targetEvaluation?.scale ?? 20}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className={[
                          "relative grid h-28 w-28 place-items-center rounded-full transition sm:h-36 sm:w-36",
                          listening
                            ? "bg-indigo-600 text-white shadow-[0_0_0_14px_rgba(79,70,229,0.10)]"
                            : "bg-slate-100 text-slate-500",
                        ].join(" ")}
                      >
                        {listening && (
                          <span className="absolute inset-0 animate-ping rounded-full border-2 border-indigo-300 opacity-40" />
                        )}
                        <Mic className="relative h-12 w-12 sm:h-16 sm:w-16" />
                      </div>
                      <h3 className="mt-7 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
                        Dites le nom de l’élève
                      </h3>
                      <div className="mt-4 text-lg font-medium text-slate-500 sm:text-xl">
                        Exemple : N’Guessan Kouadio
                      </div>
                    </>
                  )}

                  {(liveTranscript || lastTranscript) && sessionActive && (
                    <div className="mt-7 max-w-2xl rounded-2xl bg-slate-100 px-5 py-3 text-lg font-semibold text-slate-700 sm:text-xl">
                      « {liveTranscript || lastTranscript} »
                    </div>
                  )}

                  {feedback && (
                    <div
                      className={[
                        "mt-6 max-w-2xl rounded-2xl border px-5 py-3 text-base font-bold sm:text-lg",
                        feedbackTone === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : feedbackTone === "warning"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-slate-50 text-slate-700",
                      ].join(" ")}
                    >
                      {feedback}
                    </div>
                  )}
                </div>
              )}
            </main>

            <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-7">
              {lastEntry && (
                <div className="mb-3 flex items-center justify-center gap-2 rounded-2xl bg-emerald-100 px-4 py-2.5 text-center text-sm font-bold text-emerald-900 sm:text-base">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  {lastEntry.student.full_name} : {formatScore(lastEntry.score)} /{targetEvaluation?.scale ?? 20}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3">
                {!sessionActive ? (
                  <button
                    type="button"
                    onClick={startSession}
                    disabled={!canStart}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-7 py-3 text-base font-extrabold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Mic className="h-5 w-5" /> Commencer
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopSession}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-7 py-3 text-base font-extrabold text-white shadow-sm hover:bg-slate-800"
                  >
                    <MicOff className="h-5 w-5" /> Arrêter
                  </button>
                )}

                {activeStudent && step === "score" && (
                  <button
                    type="button"
                    onClick={() => {
                      cancelCurrentRecognition();
                      resetToStudent();
                      if (sessionActiveRef.current) scheduleNextRecognition(120);
                    }}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-800 hover:bg-slate-100"
                  >
                    <RotateCcw className="h-5 w-5" /> Changer d’élève
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {trigger}
      {modal}
    </>
  );
}
