"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { History, Megaphone, MessageSquare, Send, Smartphone, Users } from "lucide-react";

type AudienceType = "parents" | "staff";
type Channel = "push" | "sms" | "push_sms";

type ClassItem = {
  id: string;
  label: string;
  level: string;
};

type MetaResponse = {
  ok: boolean;
  institution_name?: string | null;
  academic_year: string | null;
  channels: {
    push_enabled: boolean;
    sms_enabled: boolean;
    sms_premium_enabled: boolean;
    sms_provider: string | null;
    sms_sender_name: string | null;
  };
  classes: ClassItem[];
  levels: string[];
  error?: string;
};

type PreviewResponse = {
  ok: boolean;
  target_label?: string;
  academic_year?: string | null;
  student_count?: number;
  class_count?: number;
  summary?: {
    recipient_count: number;
    push_ready_count: number;
    sms_ready_count: number;
  };
  sample?: Array<{
    profile_id: string;
    display_name: string | null;
    recipient_type: string;
    has_push: boolean;
    has_sms_phone: boolean;
    related_student_count: number;
  }>;
  error?: string;
};

type Campaign = {
  id: string;
  audience_type: AudienceType;
  target_label: string | null;
  channel: Channel;
  title: string;
  body: string;
  status: string;
  recipient_count: number;
  push_queued_count: number;
  sms_queued_count: number;
  created_at: string;
  sent_at: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm", className)}>{children}</section>;
}

function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">{children}</label>;
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition",
        "placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
        props.className
      )}
    />
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
        props.className
      )}
    />
  );
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "min-h-[150px] w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition",
        "placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
        props.className
      )}
    />
  );
}

function Button({
  children,
  tone = "emerald",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" | "white" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60",
        tone === "emerald" && "bg-emerald-600 text-white hover:bg-emerald-700",
        tone === "slate" && "bg-slate-950 text-white hover:bg-slate-800",
        tone === "white" && "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50",
        className
      )}
    >
      {children}
    </button>
  );
}

function ChoiceCard({
  active,
  title,
  subtitle,
  onClick,
  disabled = false,
}: {
  active: boolean;
  title: string;
  subtitle?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "rounded-3xl border p-4 text-left transition",
        active ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <div className="text-sm font-black text-slate-950">{title}</div>
      {subtitle ? <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500">{subtitle}</div> : null}
    </button>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function channelLabel(channel: Channel) {
  if (channel === "push_sms") return "Push + SMS";
  if (channel === "sms") return "SMS";
  return "Push";
}

export default function AdminCommunicationPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [audienceType, setAudienceType] = useState<AudienceType>("parents");
  const [parentTargetType, setParentTargetType] = useState<"all" | "cycle" | "level" | "class">("cycle");
  const [cycle, setCycle] = useState<"first_cycle" | "second_cycle">("first_cycle");
  const [level, setLevel] = useState("6e");
  const [classId, setClassId] = useState("");
  const [staffTargetType, setStaffTargetType] = useState<"staff_all" | "teachers" | "head_teachers">("staff_all");
  const [channel, setChannel] = useState<Channel>("push");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const automaticSignature = meta?.institution_name ? `— ${meta.institution_name}` : "— Mon Cahier";

  const levels = useMemo(() => {
    const list = meta?.levels?.length ? meta.levels : ["6e", "5e", "4e", "3e", "2nde", "1re", "Terminale"];
    return Array.from(new Set(list));
  }, [meta?.levels]);

  const classesForSelect = useMemo(() => meta?.classes || [], [meta?.classes]);

  const selectedTarget = useMemo(() => {
    if (audienceType === "staff") {
      return { target_type: staffTargetType, target_value: null as string | null };
    }

    if (parentTargetType === "cycle") return { target_type: "cycle", target_value: cycle };
    if (parentTargetType === "level") return { target_type: "level", target_value: level };
    if (parentTargetType === "class") return { target_type: "class", target_value: classId };
    return { target_type: "all", target_value: null as string | null };
  }, [audienceType, staffTargetType, parentTargetType, cycle, level, classId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [metaRes, historyRes] = await Promise.all([
          fetch("/api/admin/communication/meta", { cache: "no-store" }),
          fetch("/api/admin/communication/campaigns", { cache: "no-store" }),
        ]);

        const metaJson = (await metaRes.json().catch(() => null)) as MetaResponse | null;
        const historyJson = await historyRes.json().catch(() => null);

        if (cancelled) return;

        if (!metaJson?.ok) {
          setError(metaJson?.error || "Impossible de charger le module Communication.");
          setMeta(null);
        } else {
          setMeta(metaJson);
          const firstClass = metaJson.classes?.[0]?.id || "";
          if (!classId && firstClass) setClassId(firstClass);
          if (!level && metaJson.levels?.[0]) setLevel(metaJson.levels[0]);
        }

        setCampaigns(Array.isArray(historyJson?.items) ? historyJson.items : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Erreur de chargement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPreview(null);
    setSuccess(null);
    setError(null);
  }, [audienceType, parentTargetType, cycle, level, classId, staffTargetType, channel]);

  useEffect(() => {
    if (!meta) return;
    if (!meta.channels.sms_enabled && channel !== "push") setChannel("push");
  }, [meta, channel]);

  async function refreshHistory() {
    const res = await fetch("/api/admin/communication/campaigns", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    setCampaigns(Array.isArray(json?.items) ? json.items : []);
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/communication/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience_type: audienceType,
          target_type: selectedTarget.target_type,
          target_value: selectedTarget.target_value,
        }),
      });

      const json = (await res.json().catch(() => null)) as PreviewResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Aperçu impossible.");
      }

      setPreview(json);
    } catch (e: any) {
      setError(e?.message || "Erreur aperçu.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      if (!title.trim() || !body.trim()) throw new Error("Renseigne le titre et le message.");
      if (audienceType === "parents" && parentTargetType === "class" && !classId) {
        throw new Error("Choisis une classe avant l’envoi.");
      }

      const res = await fetch("/api/admin/communication/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience_type: audienceType,
          target_type: selectedTarget.target_type,
          target_value: selectedTarget.target_value,
          channel,
          title,
          body,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Envoi impossible.");
      }

      setSuccess(
        `Message mis en file pour ${json.summary?.recipient_count ?? 0} destinataire(s) — push: ${json.queued?.push ?? 0}, SMS: ${json.queued?.sms ?? 0}.`
      );
      setPreview(null);
      setTitle("");
      setBody("");
      await refreshHistory();
    } catch (e: any) {
      setError(e?.message || "Erreur envoi.");
    } finally {
      setBusy(false);
    }
  }

  const smsEnabled = meta?.channels.sms_enabled === true;
  const channelHelp = smsEnabled
    ? "Le SMS est disponible pour cet établissement."
    : "SMS masqué/désactivé : aucun opérateur SMS premium n’est configuré pour cet établissement.";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-100 ring-1 ring-white/15">
              <Megaphone className="h-3.5 w-3.5" /> Communication
            </div>
            <h1 className="mt-4 text-2xl font-black tracking-tight md:text-4xl">Messages ciblés</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-200">
              Envoyer une information aux parents selon le cycle, le niveau ou la classe, ou au personnel avec une cible simple. Les messages sont signés automatiquement au nom de l’établissement.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/15">
              <div className="text-2xl font-black">{meta?.academic_year || "—"}</div>
              <div className="mt-1 text-xs font-semibold text-slate-300">Année active</div>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/15">
              <div className="text-2xl font-black">{meta?.classes?.length ?? 0}</div>
              <div className="mt-1 text-xs font-semibold text-slate-300">Classes</div>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/15">
              <div className="text-2xl font-black">{smsEnabled ? "SMS" : "Push"}</div>
              <div className="mt-1 text-xs font-semibold text-slate-300">Canal disponible</div>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <Card>
          <div className="animate-pulse space-y-3">
            <div className="h-6 w-64 rounded-xl bg-slate-200" />
            <div className="h-24 rounded-2xl bg-slate-100" />
          </div>
        </Card>
      ) : null}

      {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-800">{error}</div> : null}
      {success ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-800">{success}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">Nouveau message</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Choisis la cible, le canal, puis vérifie l’aperçu avant l’envoi.</p>
              </div>
              <MessageSquare className="h-6 w-6 text-emerald-600" />
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                active={audienceType === "parents"}
                title="Parents"
                subtitle="Tous, cycle, niveau ou classe."
                onClick={() => setAudienceType("parents")}
              />
              <ChoiceCard
                active={audienceType === "staff"}
                title="Personnel"
                subtitle="Tout le personnel, enseignants ou professeurs principaux."
                onClick={() => setAudienceType("staff")}
              />
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-black text-slate-950">Ciblage</h3>

            {audienceType === "parents" ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <ChoiceCard active={parentTargetType === "all"} title="Tous les parents" onClick={() => setParentTargetType("all")} />
                  <ChoiceCard active={parentTargetType === "cycle"} title="Selon le cycle" onClick={() => setParentTargetType("cycle")} />
                  <ChoiceCard active={parentTargetType === "level"} title="Selon le niveau" onClick={() => setParentTargetType("level")} />
                  <ChoiceCard active={parentTargetType === "class"} title="Selon la classe" onClick={() => setParentTargetType("class")} />
                </div>

                {parentTargetType === "cycle" ? (
                  <div>
                    <Label>Cycle</Label>
                    <Select value={cycle} onChange={(e) => setCycle(e.target.value as "first_cycle" | "second_cycle")}>
                      <option value="first_cycle">Premier cycle — 6e, 5e, 4e, 3e</option>
                      <option value="second_cycle">Second cycle — 2nde, 1re, Terminale</option>
                    </Select>
                  </div>
                ) : null}

                {parentTargetType === "level" ? (
                  <div>
                    <Label>Niveau</Label>
                    <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                      {levels.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </Select>
                  </div>
                ) : null}

                {parentTargetType === "class" ? (
                  <div>
                    <Label>Classe</Label>
                    <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                      <option value="">Choisir une classe</option>
                      {classesForSelect.map((cls) => (
                        <option key={cls.id} value={cls.id}>{cls.label} — {cls.level}</option>
                      ))}
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <ChoiceCard
                  active={staffTargetType === "staff_all"}
                  title="Tout le personnel"
                  subtitle="Administration, enseignants et personnels rattachés."
                  onClick={() => setStaffTargetType("staff_all")}
                />
                <ChoiceCard
                  active={staffTargetType === "teachers"}
                  title="Enseignants uniquement"
                  subtitle="Tous les comptes enseignants."
                  onClick={() => setStaffTargetType("teachers")}
                />
                <ChoiceCard
                  active={staffTargetType === "head_teachers"}
                  title="Professeurs principaux"
                  subtitle="D’après les classes de l’année active."
                  onClick={() => setStaffTargetType("head_teachers")}
                />
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-slate-950">Canal d’envoi</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">{channelHelp}</p>
              </div>
              <Smartphone className="h-5 w-5 text-slate-500" />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <ChoiceCard active={channel === "push"} title="Push" subtitle="Canal standard Mon Cahier." onClick={() => setChannel("push")} />
              <ChoiceCard active={channel === "sms"} title="SMS" subtitle="Disponible si opérateur configuré." disabled={!smsEnabled} onClick={() => setChannel("sms")} />
              <ChoiceCard active={channel === "push_sms"} title="Push + SMS" subtitle="Double canal si SMS actif." disabled={!smsEnabled} onClick={() => setChannel("push_sms")} />
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-black text-slate-950">Contenu du message</h3>
            <div className="mt-4 space-y-4">
              <div>
                <Label>Titre</Label>
                <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Réunion des parents d’élèves" />
              </div>
              <div>
                <Label>Message</Label>
                <Textarea value={body} maxLength={900} onChange={(e) => setBody(e.target.value)} placeholder="Rédige le message à envoyer..." />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                    Signature automatique : <span className="text-slate-950">{automaticSignature}</span>
                  </div>
                  <div className="text-right text-xs font-bold text-slate-400">{body.length}/900</div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button type="button" tone="white" onClick={handlePreview} disabled={busy}>
                <Users className="h-4 w-4" /> Aperçu destinataires
              </Button>
              <Button type="button" onClick={handleSend} disabled={busy || !title.trim() || !body.trim()}>
                <Send className="h-4 w-4" /> Envoyer
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-24">
            <h3 className="text-base font-black text-slate-950">Aperçu avant envoi</h3>
            {!preview ? (
              <p className="mt-3 text-sm leading-7 text-slate-500">Clique sur “Aperçu destinataires” pour vérifier le nombre de personnes concernées avant l’envoi.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Cible</div>
                  <div className="mt-1 text-lg font-black text-slate-950">{preview.target_label}</div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-3xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-100">
                    <div className="text-xl font-black text-emerald-700">{preview.summary?.recipient_count ?? 0}</div>
                    <div className="mt-1 text-[11px] font-bold text-emerald-800">Destinataires</div>
                  </div>
                  <div className="rounded-3xl bg-sky-50 p-4 text-center ring-1 ring-sky-100">
                    <div className="text-xl font-black text-sky-700">{preview.summary?.push_ready_count ?? 0}</div>
                    <div className="mt-1 text-[11px] font-bold text-sky-800">Push prêts</div>
                  </div>
                  <div className="rounded-3xl bg-amber-50 p-4 text-center ring-1 ring-amber-100">
                    <div className="text-xl font-black text-amber-700">{preview.summary?.sms_ready_count ?? 0}</div>
                    <div className="mt-1 text-[11px] font-bold text-amber-800">SMS prêts</div>
                  </div>
                </div>

                {audienceType === "parents" ? (
                  <div className="rounded-3xl bg-white p-4 ring-1 ring-slate-200">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs font-bold text-slate-400">Classes</div>
                        <div className="font-black text-slate-950">{preview.class_count ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-400">Élèves concernés</div>
                        <div className="font-black text-slate-950">{preview.student_count ?? 0}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {(preview.sample || []).map((item) => (
                    <div key={item.profile_id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-900">{item.display_name || "Destinataire"}</div>
                        <div className="text-xs font-medium text-slate-500">{item.related_student_count ? `${item.related_student_count} élève(s) lié(s)` : item.recipient_type}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <span className={cx("rounded-full px-2 py-1 text-[10px] font-black", item.has_push ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-400")}>Push</span>
                        <span className={cx("rounded-full px-2 py-1 text-[10px] font-black", item.has_sms_phone ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400")}>SMS</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Historique des campagnes</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Les derniers messages envoyés ou mis en file.</p>
          </div>
          <History className="h-5 w-5 text-slate-500" />
        </div>

        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
          <div className="hidden grid-cols-[1.1fr_1fr_0.7fr_0.6fr_0.8fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500 md:grid">
            <div>Message</div>
            <div>Cible</div>
            <div>Canal</div>
            <div>Dest.</div>
            <div>Date</div>
          </div>

          {campaigns.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm font-medium text-slate-500">Aucune campagne pour le moment.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {campaigns.map((item) => (
                <div key={item.id} className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.1fr_1fr_0.7fr_0.6fr_0.8fr] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-black text-slate-950">{item.title}</div>
                    <div className="mt-1 line-clamp-1 text-xs font-medium text-slate-500">{item.body}</div>
                  </div>
                  <div className="font-bold text-slate-700">{item.target_label || "—"}</div>
                  <div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{channelLabel(item.channel)}</span>
                  </div>
                  <div className="font-black text-slate-950">{item.recipient_count}</div>
                  <div className="text-xs font-bold text-slate-500">{formatDate(item.sent_at || item.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
