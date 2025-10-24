import { cookies } from "next/headers";

export async function assertCsrf(req: Request) {
  const cookieStore = await cookies();
  const cookie = cookieStore.get("csrf_token")?.value;
  const header = req.headers.get("x-csrf-token") || "";
  if (!cookie || !header || cookie !== header) {
    const e: any = new Error("bad_csrf");
    e.status = 403;
    throw e;
  }
}
