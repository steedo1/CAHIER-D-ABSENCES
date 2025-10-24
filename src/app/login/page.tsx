// src/app/login/page.tsx
import LoginCard from "@/components/auth/LoginCard";

type Search = {
  redirectTo?: string;
  from?: string;
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: Search;
}) {
  const redirectTo =
    (typeof searchParams?.redirectTo === "string" && searchParams.redirectTo) ||
    "/redirect";
  const fromLogout = searchParams?.from === "logout";

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        {fromLogout && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            Vous Ãªtes bien dÃ©connectÃ©Â·e. Connectez-vous pour continuer.
          </div>
        )}
        <LoginCard redirectTo={redirectTo} />
      </div>
    </main>
  );
}
