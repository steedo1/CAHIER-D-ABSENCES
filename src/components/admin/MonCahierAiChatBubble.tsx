"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";

type AcademicYear = {
  code: string;
  label?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
};

type BootstrapResponse = {
  ok: boolean;
  error?: string;
  current_academic_year?: AcademicYear | null;
  academic_years?: AcademicYear[];
};

type StudentSignal = {
  student_id: string;
  full_name: string;
  general_avg_20?: number | null;
  p_success?: number | null;
};

type ClassSignal = {
  class_id: string;
  class_label: string;
  avg_success_probability?: number | null;
};

type SubjectSignal = {
  class_id: string;
  class_label: string;
  subject_id: string;
  subject_name: string;
  avg_score_20?: number | null;
};

type AiAnswer = {
  title: string;
  summary: string;
  confidence?: number;
  recommendations?: string[];
  students_to_follow?: StudentSignal[];
  classes_at_risk?: ClassSignal[];
  blocking_subjects?: SubjectSignal[];
};

type AssistantResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  answer?: AiAnswer;
};

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text?: string; answer?: AiAnswer; error?: boolean };

const QUICK_QUESTIONS = [
  "Quels élèves doivent être suivis en priorité ?",
  "Quelles classes sont les plus fragiles ?",
  "Résume-moi la situation pédagogique.",
];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayPlusMonths(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Math.round(Number(value) * 100)} %`;
}

function avg(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toFixed(1).replace(".", ",")}/20`;
}

function AnswerContent({ answer }: { answer: AiAnswer }) {
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
  const [examDate, setExamDate] = useState(todayPlusMonths(3));
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Bonjour. Pose-moi simplement ta question sur la situation pédagogique de l’établissement.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bootstrapAttemptedRef = useRef(false);

  useEffect(() => {
    if (!open || ready || loadingContext || bootstrapAttemptedRef.current) return;

    let cancelled = false;
    bootstrapAttemptedRef.current = true;
    setLoadingContext(true);

    void (async () => {
      try {
        const res = await fetch("/api/admin/mon-cahier-ia/bootstrap", {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as BootstrapResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Contexte IA indisponible.");
        }

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
        setExamDate(year.end_date ? String(year.end_date).slice(0, 10) : todayPlusMonths(3));
        setReady(true);
      } catch (error: any) {
        if (cancelled) return;
        setMessages((current) => [
          ...current,
          {
            id: makeId("context-error"),
            role: "assistant",
            text: error?.message || "Impossible de préparer Cahier IA.",
            error: true,
          },
        ]);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadingContext, open, ready]);

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, asking, open]);

  async function ask(rawQuestion?: string) {
    const q = String(rawQuestion ?? question).trim();
    if (!q || asking || !ready || !academicYear) return;

    setQuestion("");
    setMessages((current) => [
      ...current,
      { id: makeId("user"), role: "user", text: q },
    ]);
    setAsking(true);

    try {
      const res = await fetch("/api/admin/mon-cahier-ia/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          academic_year: academicYear,
          exam_date: examDate,
          class_id: null,
          level: null,
          core_completion_percent: 60,
        }),
      });

      const rawText = await res.text();
      let json: AssistantResponse | null = null;
      try {
        json = rawText ? (JSON.parse(rawText) as AssistantResponse) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json?.ok || !json.answer) {
        throw new Error(
          json?.message || json?.error || rawText.slice(0, 240) || "Réponse IA indisponible.",
        );
      }

      setMessages((current) => [
        ...current,
        { id: makeId("assistant"), role: "assistant", answer: json.answer },
      ]);
    } catch (error: any) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("assistant-error"),
          role: "assistant",
          text: error?.message || "Je n’ai pas pu répondre à cette question.",
          error: true,
        },
      ]);
    } finally {
      setAsking(false);
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
                      <AnswerContent answer={message.answer} />
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
                placeholder={loadingContext ? "Préparation…" : "Pose ta question…"}
                disabled={!ready || asking}
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-wait"
              />
              <button
                type="button"
                onClick={() => void ask()}
                disabled={!ready || asking || !question.trim()}
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
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
          {open ? <X className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        </span>
        <span>Cahier IA</span>
      </button>
    </div>
  );
}
