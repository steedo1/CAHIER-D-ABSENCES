// src/components/ContactUsButton.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, Phone, MessageSquare, Copy, Check } from "lucide-react";

// Si tu as déjà un Button shadcn, on l’utilise. Sinon, on fournit un petit fallback.
let ExternalButton: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ExternalButton = require("@/components/ui/button").Button;
} catch {
  ExternalButton = (p: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      {...p}
      className={
        "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow " +
        (p.className ?? "")
      }
    />
  );
}
const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
  <ExternalButton {...props} />
);

/* ─────────────────────────────────────────────────────────────
   Mini Dialog (portal + overlay) — aucune dépendance externe
───────────────────────────────────────────────────────────── */
function LightDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Ferme avec ESC et clic sur l’overlay
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden"; // scroll lock
    // focus
    setTimeout(() => ref.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative mx-auto mt-20 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-4 shadow-lg outline-none"
      >
        <div className="mb-2">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Données de contact
───────────────────────────────────────────────────────────── */
const CONTACTS = {
  phones: [
    { label: "WhatsApp", value: "+2250748613990" },
    { label: "Appels", value: "+2250713023762/+2250546066243" },
  ],
  email: "moncahier.ci@gmail.com",
};

export default function ContactUsButton({ variant = "chip" }: { variant?: "chip" | "solid" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(text);
        setTimeout(() => setCopied(null), 1500);
      });
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className={
          variant === "chip"
            ? "rounded-full bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15 hover:ring-white/40"
            : undefined
        }
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        Nous contacter
      </Button>

      <LightDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nous contacter"
        description="Besoin d'aide ? Joignez-nous par téléphone ou email."
      >
        <div className="space-y-3">
          {CONTACTS.phones.map((p) => {
            const telHref = p.value.replace(/[^\d+]/g, ""); // conserve + et chiffres
            const wa = p.value.replace(/[^\d]/g, ""); // wa.me exige uniquement les chiffres
            return (
              <div key={p.value} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-slate-600" />
                  <div className="text-sm">
                    <div className="font-medium text-slate-800">{p.label}</div>
                    <a href={`tel:${telHref}`} className="text-emerald-700 hover:underline">
                      {p.value}
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a href={`tel:${telHref}`} className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">
                    Appeler
                  </a>
                  <a
                    href={`https://wa.me/${wa}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                  >
                    WhatsApp
                  </a>
                  <button
                    onClick={() => copy(p.value)}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                  >
                    {copied === p.value ? (
                      <>
                        <Check className="mr-1 inline h-3.5 w-3.5" />
                        Copié
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 inline h-3.5 w-3.5" />
                        Copier
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-slate-600" />
              <div className="text-sm">
                <div className="font-medium text-slate-800">Email</div>
                <a href={`mailto:${CONTACTS.email}`} className="text-emerald-700 hover:underline">
                  {CONTACTS.email}
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a href={`mailto:${CONTACTS.email}`} className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">
                Écrire
              </a>
              <button
                onClick={() => copy(CONTACTS.email)}
                className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
              >
                {copied === CONTACTS.email ? (
                  <>
                    <Check className="mr-1 inline h-3.5 w-3.5" />
                    Copié
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 inline h-3.5 w-3.5" />
                    Copier
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              onClick={() => setOpen(false)}
              className="rounded-xl border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Fermer
            </button>
          </div>
        </div>
      </LightDialog>
    </>
  );
}
