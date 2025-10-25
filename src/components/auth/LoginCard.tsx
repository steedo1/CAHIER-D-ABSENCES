// src/components/auth/LoginCard.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { normalizePhone } from "@/lib/phone";
import { Mail, Phone as PhoneIcon, Lock, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";

type Props = { redirectTo?: string; compactHeader?: boolean };

// --- Helpers hoistés (stables) ---
function Field({
  children, label, hint,
}: { children: React.ReactNode; label: string; hint?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-600">{label}</label>
        {hint}
      </div>
      {children}
    </div>
  );
}
function InputWrap({
  children, IconLeft,
}: { children: React.ReactNode; IconLeft?: React.ComponentType<React.SVGProps<SVGSVGElement>> }) {
  return (
    <div className="relative">
      {IconLeft ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 grid w-9 place-items-center text-slate-400">
          <IconLeft className="h-4 w-4" />
        </span>
      ) : null}
      <div className={IconLeft ? "pl-9" : ""}>{children}</div>
    </div>
  );
}

export default function LoginCard({ redirectTo = "/redirect", compactHeader }: Props) {
  const { session, loading } = useAuth();
  const router = useRouter();

  // Client Supabase (navigateur uniquement)
  const supRef = useRef<SupabaseClient | null>(null);
  useEffect(() => {
    supRef.current = getSupabaseBrowserClient();
  }, []);

  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [pwdEmail, setPwdEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pwdPhone, setPwdPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPwdEmail, setShowPwdEmail] = useState(false);
  const [showPwdPhone, setShowPwdPhone] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [capsEmail, setCapsEmail] = useState(false);
  const [capsPhone, setCapsPhone] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // Redirection si déjà connecté
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (session && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace(redirectTo);
    }
  }, [session, router, redirectTo]);

  // Focus initial selon l’onglet
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "email") emailRef.current?.focus();
      else phoneRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);

    const supabase = supRef.current ?? getSupabaseBrowserClient();

    try {
      if (mode === "email") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pwdEmail });
        if (error) throw new Error(error.message || "Identifiants invalides.");
      } else {
        const phoneNorm = normalizePhone(phone) || "";
        if (!phoneNorm) throw new Error("Numéro de téléphone invalide.");
        const { error } = await supabase.auth.signInWithPassword({ phone: phoneNorm, password: pwdPhone });
        if (error) throw new Error(error.message || "Identifiants invalides.");
      }
    } catch (authErr: any) {
      setSubmitting(false);
      setErr(authErr?.message || "Échec de la connexion.");
      return;
    }

    // Sync cookies SSR (tolérant)
    try {
      const { data } = await supabase.auth.getSession();
      const at = data.session?.access_token;
      const rt = data.session?.refresh_token;
      if (typeof at === "string" && typeof rt === "string") {
        fetch("/api/auth/sync", {
          method: "POST",
          headers: new Headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ access_token: at, refresh_token: rt }),
        }).catch(() => {});
      }
    } catch {}

    setSubmitting(false);
    router.replace(redirectTo);
  }

  // Pas de disabled sur inputs (perte de focus) → readOnly uniquement pendant submit
  const disableButtons = submitting;
  const readOnlyInputs = submitting;

  return (
    <div className="overflow-hidden rounded-2xl border bg-white/95 shadow-xl shadow-blue-100/60 backdrop-blur">
      {!compactHeader && (
        <div className="border-b bg-blue-950 text-white">
          <div className="px-6 pb-4 pt-6">
            <h2 className="text-xl font-semibold tracking-tight">Connexion à votre espace</h2>
            <p className="mt-1 text-sm text-white/80">Utilisez les identifiants fournis par votre établissement.</p>
          </div>
        </div>
      )}

      {loading && <div className="px-6 pt-3 text-xs text-slate-500" aria-live="polite">Initialisation de la session…</div>}

      <div className="px-6 pt-4">
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm shadow-sm">
          <button
            type="button"
            onClick={() => setMode("email")}
            disabled={disableButtons}
            className={["inline-flex items-center gap-2 rounded-full px-3 py-2 transition",
              mode === "email" ? "bg-white font-medium text-blue-700 shadow-sm" : "text-slate-600 hover:bg-white"].join(" ")}
          >
            <Mail className="h-4 w-4" /> Email
          </button>
          <button
            type="button"
            onClick={() => setMode("phone")}
            disabled={disableButtons}
            className={["inline-flex items-center gap-2 rounded-full px-3 py-2 transition",
              mode === "phone" ? "bg-white font-medium text-blue-700 shadow-sm" : "text-slate-600 hover:bg-white"].join(" ")}
          >
            <PhoneIcon className="h-4 w-4" /> Téléphone
          </button>
        </div>
      </div>

      <form noValidate onSubmit={onSubmit} className="space-y-4 px-6 py-6">
        {mode === "email" ? (
          <>
            <Field label="Email">
              <InputWrap IconLeft={Mail}>
                <input
                  ref={emailRef}
                  id="login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20"
                  placeholder="nom@ecole.ci"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  autoFocus
                  readOnly={readOnlyInputs}
                />
              </InputWrap>
            </Field>

            <Field
              label="Mot de passe"
              hint={
                <div className="flex items-center gap-3">
                  {capsEmail && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Verr. Maj activée
                    </span>
                  )}
                  <button type="button" onClick={() => setForgotOpen(true)} className="text-xs text-slate-500 underline-offset-2 hover:underline" disabled={disableButtons}>
                    Mot de passe oublié ?
                  </button>
                </div>
              }
            >
              <InputWrap IconLeft={Lock}>
                <div className="relative">
                  <input
                    id="login-password-email"
                    name="password"
                    type={showPwdEmail ? "text" : "password"}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20"
                    placeholder="••••••••"
                    value={pwdEmail}
                    onChange={(e) => setPwdEmail(e.target.value)}
                    onKeyUp={(e) => setCapsEmail(e.getModifierState?.("CapsLock") ?? false)}
                    required
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    readOnly={readOnlyInputs}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => setShowPwdEmail((v) => !v)}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-500 hover:text-slate-700"
                    aria-label={showPwdEmail ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showPwdEmail ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </InputWrap>
            </Field>
          </>
        ) : (
          <>
            <Field label="Téléphone">
              <InputWrap IconLeft={PhoneIcon}>
                <input
                  ref={phoneRef}
                  id="login-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20"
                  placeholder="Ex. 07 08 09 10"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoComplete="tel"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  autoFocus
                  readOnly={readOnlyInputs}
                />
              </InputWrap>
            </Field>

            <Field
              label="Mot de passe"
              hint={
                <div className="flex items-center gap-3">
                  {capsPhone && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Verr. Maj activée
                    </span>
                  )}
                  <button type="button" onClick={() => setForgotOpen(true)} className="text-xs text-slate-500 underline-offset-2 hover:underline" disabled={disableButtons}>
                    Mot de passe oublié ?
                  </button>
                </div>
              }
            >
              <InputWrap IconLeft={Lock}>
                <div className="relative">
                  <input
                    id="login-password-phone"
                    name="password"
                    type={showPwdPhone ? "text" : "password"}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20"
                    placeholder="••••••••"
                    value={pwdPhone}
                    onChange={(e) => setPwdPhone(e.target.value)}
                    onKeyUp={(e) => setCapsPhone(e.getModifierState?.("CapsLock") ?? false)}
                    required
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    readOnly={readOnlyInputs}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => setShowPwdPhone((v) => !v)}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-500 hover:text-slate-700"
                    aria-label={showPwdPhone ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showPwdPhone ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </InputWrap>
            </Field>
          </>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" aria-live="polite">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={disableButtons || (mode === "email" ? !(email && pwdEmail) : !(phone && pwdPhone))}
          className="group relative w-full overflow-hidden rounded-xl bg-blue-700 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-50"
        >
          <span className="inline-flex items-center justify-center gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Connexion…" : "Se connecter"}
          </span>
        </button>

        <div className="pt-1 text-center text-xs text-slate-500">
          Besoin d’aide ? Contactez l’administrateur de votre établissement.
        </div>
      </form>

      {forgotOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="bg-slate-50 px-5 py-3">
              <div className="flex items-center gap-2 text-slate-800">
                <Lock className="h-4 w-4" />
                <div className="text-sm font-semibold">Mot de passe oublié ?</div>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-700">
                Pour réinitialiser votre mot de passe, merci de <b>contacter l’administration de votre établissement</b>. Elle vous communiquera de nouveaux identifiants.
              </p>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setForgotOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  J’ai compris
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


