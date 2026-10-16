"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { buildConversationHistory, fetchAiJson, referenceDateForAcademicYear } from "@/lib/mon-cahier-ai/client";
import type { AiDataQuality, MonCahierAiAnswer } from "@/lib/mon-cahier-ai/core";

type AcademicYear = {
  code: string;
  label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
};

type BootstrapResponse = {
  ok: boolean;
  error?: string;
  current_academic_year?: AcademicYear | null;
  academic_years?: AcademicYear[];
};

type AiAnswer = Pick<MonCahierAiAnswer, "title" | "summary"> & Partial<MonCahierAiAnswer>;

type AssistantResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  answer?: AiAnswer;
  context_meta?: { data_quality?: AiDataQuality };
};

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text?: string; answer?: AiAnswer; quality?: AiDataQuality; error?: boolean };

const QUICK_QUESTIONS = [
  "Combien d’élèves compte l’établissement ?",
  "Quels enseignants interviennent dans mes classes ?",
  "Quels élèves doivent être suivis en priorité ?",
  "Quelles classes sont les plus fragiles ?",
  "Résume-moi la situation pédagogique.",
];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Math.round(Number(value) * 100)} %`;
}

function avg(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toFixed(1).replace(".", ",")}/20`;
}

function AnswerContent({ answer, quality }: { answer: AiAnswer; quality?: AiDataQuality }) {
  const students = (answer.students_to_follow || []).slice(0, 5);
  const classes = (answer.classes_at_risk || []).slice(0, 4);
  const subjects = (answer.blocking_subjects || []).slice(0, 4);
  const recommendations = (answer.recommendations || []).slice(0, 4);

  return (
    <div className="space-y-3">
      <div>
        <div className="font-black text-slate-900">{answer.title}</div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">
          {answer.summary}
        </p>
      </div>

      {answer.quick_stats ? (
        <div className="space-y-2" aria-label="Statistiques demandées">
          {answer.quick_stats.cards.map((card) => (
            <div key={card.key} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-xs text-slate-600">{card.label}</div>
              <div className="text-lg font-black text-slate-900">{card.value}</div>
              {card.details ? <p className="text-xs text-slate-600">{card.details}</p> : null}
            </div>
          ))}
          {answer.quick_stats.breakdown?.map((item) => (
            <p key={item.label} className="text-sm text-slate-700">
              {item.label} : <strong>{item.value}</strong>{item.details ? ` — ${item.details}` : ""}
            </p>
          ))}
        </div>
      ) : null}

      {answer.council_note ? (
        <details open>
          <summary className="cursor-pointer text-xs font-black text-slate-700">Note pour le conseil</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-700">{answer.council_note}</p>
        </details>
      ) : null}

      {answer.remediation_plan?.length ? (
        <div>
          <div className="text-xs font-black text-slate-700">Plan de remédiation</div>
          <ol className="mt-2 list-decimal space-y-2 pl-4 text-sm text-slate-700">
            {answer.remediation_plan.map((item, index) => <li key={index}>{item}</li>)}
          </ol>
        </div>
      ) : null}

      {students.length > 0 ? (
        <div>
          <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
            Élèves à suivre
          </div>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {students.map((student) => {
              const details = [avg(student.general_avg_20), pct(student.p_success)]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={student.student_id}>
                  • {student.full_name}{details ? ` — ${details}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {classes.length > 0 ? (
        <div>
          <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
            Classes à surveiller
          </div>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {classes.map((item) => (
              <li key={item.class_id}>
                • {item.class_label}
                {pct(item.avg_success_probability)
                  ? ` — réussite estimée ${pct(item.avg_success_probability)}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {subjects.length > 0 ? (
        <div>
          <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
            Matières à surveiller
          </div>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {subjects.map((item) => (
              <li key={`${item.class_id}-${item.subject_id}`}>
                • {item.subject_name} · {item.class_label}
                {avg(item.avg_score_20) ? ` — ${avg(item.avg_score_20)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <div>
          <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
            Pistes proposées
          </div>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {recommendations.map((item, index) => (
              <li key={`${index}-${item.slice(0, 20)}`}>• {item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {quality && quality.status !== "ok" ? (
        <p role="status" className="rounded-xl bg-amber-50 p-2 text-xs leading-5 text-amber-900">
          {quality.summary}
        </p>
      ) : null}
    </div>
  );
}

export default function MonCahierAiChatBubble() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [asking, setAsking] = useState(false);
  const [academicYear, setAcademicYear] = useState("");
  const [academicYearLabel, setAcademicYearLabel] = useState("");
  const [examDate, setExamDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contextError, setContextError] = useState<string | null>(null);
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Bonjour ! Je suis Cahier IA. Comment puis-je t’aider aujourd’hui ?",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const questionRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || ready) return;

    let cancelled = false;
    const controller = new AbortController();
    setLoadingContext(true);
    setContextError(null);

    void (async () => {
      try {
        const json = await fetchAiJson<BootstrapResponse>("/api/admin/mon-cahier-ia/bootstrap", {
          signal: controller.signal,
        });

        if (cancelled) return;
        const year =
          json.current_academic_year ||
          json.academic_years?.find((item) => item.is_current) ||
          json.academic_years?.[0] ||
          null;

        if (!year?.code) {
          throw new Error("Aucune année scolaire active n’est configurée.");
        }

        setAcademicYear(year.code);
        setAcademicYearLabel(year.label || year.code);
        setExamDate(referenceDateForAcademicYear(year));
        setReady(true);
      } catch (error: unknown) {
        if (cancelled) return;
        setContextError(error instanceof Error ? error.message : "Impossible de préparer Cahier IA.");
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, ready, preparationAttempt]);

  useEffect(() => () => { questionRequestRef.current?.abort(); }, []);

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, asking, open]);

  async function ask(rawQuestion?: string) {
    const q = String(rawQuestion ?? question).trim();
    if (!q || questionRequestRef.current || !ready || !academicYear || !examDate) return;

    const controller = new AbortController();
    questionRequestRef.current = controller;

    setQuestion("");
    setMessages((current) => [
      ...current,
      { id: makeId("user"), role: "user", text: q },
    ]);
    setAsking(true);

    try {
      const json = await fetchAiJson<AssistantResponse>("/api/admin/mon-cahier-ia/chat", {
        method: "POST",
        signal: controller.signal,
        timeoutMs: 120_000,
        timeoutMessage: "La réponse prend trop de temps. Réessaie dans un instant.",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          messages: buildConversationHistory(messages, q),
          academic_year: academicYear,
          exam_date: examDate,
          class_id: null,
          level: null,
        }),
      });

      if (!json.answer || typeof json.answer.title !== "string" || typeof json.answer.summary !== "string") {
        throw new Error("Réponse IA indisponible. Réessaie dans un instant.");
      }
      if (controller.signal.aborted) return;

      setMessages((current) => [
        ...current,
        { id: makeId("assistant"), role: "assistant", answer: json.answer, quality: json.context_meta?.data_quality },
      ]);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setQuestion(q);
      setMessages((current) => [
        ...current,
        {
          id: makeId("assistant-error"),
          role: "assistant",
          text: error instanceof Error ? error.message : "Je n’ai pas pu répondre à cette question.",
          error: true,
        },
      ]);
    } finally {
      questionRequestRef.current = null;
      if (!controller.signal.aborted) setAsking(false);
    }
  }

  return (
    <div className="fixed bottom-20 right-4 z-[70] md:bottom-6 md:right-6">
      {open ? (
        <section
          className="mb-3 flex h-[min(68vh,610px)] w-[min(calc(100vw-2rem),400px)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
          aria-label="Discussion avec Cahier IA"
        >
          <header className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/20">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black">Cahier IA</div>
                <div className="truncate text-[11px] text-slate-400">
                  {academicYearLabel || "Assistant pédagogique"}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Fermer Cahier IA"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[86%] rounded-2xl rounded-br-md bg-blue-950 px-3.5 py-2.5 text-sm leading-5 text-white shadow-sm">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-start">
                  <div
                    className={[
                      "max-w-[92%] rounded-2xl rounded-bl-md border bg-white px-3.5 py-3 shadow-sm",
                      message.error ? "border-rose-200" : "border-slate-200",
                    ].join(" ")}
                  >
                    {message.answer ? (
                      <AnswerContent answer={message.answer} quality={message.quality} />
                    ) : (
                      <p
                        className={[
                          "whitespace-pre-wrap text-sm leading-5",
                          message.error ? "text-rose-700" : "text-slate-700",
                        ].join(" ")}
                      >
                        {message.text}
                      </p>
                    )}
                  </div>
                </div>
              ),
            )}

            {asking ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyse en cours…
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 bg-white p-3">
            {contextError ? (
              <div role="alert" className="mb-2 rounded-xl bg-rose-50 p-2.5 text-sm text-rose-800">
                <p>{contextError}</p>
                <button type="button" onClick={() => setPreparationAttempt((value) => value + 1)}
                  className="mt-2 font-bold underline" disabled={loadingContext}>
                  Réessayer la préparation
                </button>
              </div>
            ) : null}

            {messages.length === 1 ? (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                {QUICK_QUESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void ask(item)}
                    disabled={!ready || asking}
                    className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50"
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            {ready ? (
              <label className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                Date de référence
                <input type="date" aria-label="Date de référence" value={examDate}
                  disabled={asking} onChange={(event) => setExamDate(event.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-slate-700" />
              </label>
            ) : null}

            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                rows={2}
                aria-label="Question pour Cahier IA"
                maxLength={2000}
                placeholder={loadingContext ? "Préparation…" : "Pose ta question…"}
                disabled={!ready || asking}
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-wait"
              />
              <button
                type="button"
                onClick={() => void ask()}
                disabled={!ready || asking || !question.trim() || !examDate}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                aria-label="Envoyer la question"
              >
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] leading-4 text-slate-400">
              <Sparkles className="h-3 w-3" />
              Aide à la décision : l’administration garde la validation finale.
            </div>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ml-auto flex h-14 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-black text-white shadow-xl ring-1 ring-slate-800 transition hover:-translate-y-0.5 hover:bg-blue-950"
        aria-label={open ? "Fermer Cahier IA" : "Ouvrir Cahier IA"}
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
          {open ? <X className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        </span>
        <span>Cahier IA</span>
      </button>
    </div>
  );
}
