import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { PRODUCTION_PERMISSIONS, PRODUCTION_ROLE } from "@/lib/production-nexa";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";
import { ACCOUNT_FIELDS, EVENT_FIELDS, isUuid, productionFailure, productionJson, readProductionAccount } from "@/lib/server/production-nexa";
import { cardJson, requireCardOrigin } from "@/lib/server/school-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const access = await requireSuperAdminAccess(); if ("error" in access) return access.error;
    const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 50_000) return cardJson({ error: "page_invalide" }, 400);
    const view = req.nextUrl.searchParams.get("view");
    if (view === "history") {
      const account = req.nextUrl.searchParams.get("account");
      let query = access.srv.from("nexa_production_audit")
        .select(`${EVENT_FIELDS},institution_id,academic_year`).order("created_at", { ascending: false }).order("id");
      if (account) {
        if (!isUuid(account)) return cardJson({ error: "compte_invalide" }, 400);
        query = query.or(`actor_id.eq.${account},subject_id.eq.${account}`);
      }
      const result = await query.range(offset, offset + 49);
      if (result.error) throw Error("journal_indisponible");
      return cardJson({ history: result.data, nextOffset: result.data.length === 50 ? offset + 50 : null });
    }
    const [accounts, schools] = await Promise.all([
      access.srv.from("nexa_production_accounts").select(ACCOUNT_FIELDS).order("email").order("user_id").range(offset, offset + 499),
      access.srv.from("institutions").select("id,name,code").order("name").order("id").range(offset, offset + 499),
    ]);
    if (accounts.error || schools.error) throw Error("comptes_ou_etablissements_indisponibles");
    return cardJson({ accounts: accounts.data, schools: schools.data,
      nextOffset: Math.max(accounts.data.length, schools.data.length) === 500 ? offset + 500 : null });
  } catch (error) { return productionFailure(error); }
}

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const access = await requireSuperAdminAccess(); if ("error" in access) return access.error;
    const body = await productionJson(req);
    const create = body.action === "create";
    const permissions = body.permissions;
    const institutions = body.institutionIds;
    if ((!create && body.action !== "update") || !Array.isArray(permissions) ||
      !permissions.every(value => PRODUCTION_PERMISSIONS.includes(value)) ||
      !Array.isArray(institutions) || institutions.length > 100 || !institutions.every(isUuid) || typeof body.allSchools !== "boolean" ||
      !["active", "disabled", "revoked"].includes(String(body.status))) return cardJson({ error: "autorisations_invalides" }, 400);
    if (permissions.some(value => value !== "cards.read") && !permissions.includes("cards.read")) {
      return cardJson({ error: "la_lecture_est_requise_pour_les_autres_autorisations" }, 400);
    }
    const institutionIds = body.allSchools ? [] : [...new Set(institutions)];
    if (institutionIds.length) {
      const result = await access.srv.from("institutions").select("id").in("id", institutionIds);
      if (result.error) throw Error("verification_etablissements_indisponible");
      if (result.data.length !== institutionIds.length) return cardJson({ error: "etablissement_invalide" }, 400);
    }
    const record = { permissions: [...new Set(permissions)], all_schools: body.allSchools, institution_ids: institutionIds,
      status: String(body.status), actor_id: access.user.id };
    if (!create) {
      if (!isUuid(body.userId) || !Number.isInteger(body.revision)) return cardJson({ error: "compte_invalide" }, 400);
      const lookup = await readProductionAccount(access.srv, body.userId);
      if (lookup.error) throw Error("compte_indisponible");
      if (!lookup.data || lookup.data.status === "revoked" || lookup.data.revision !== body.revision) {
        return cardJson({ error: "compte_revoque_ou_modifie_recharger" }, 409);
      }
      const result = await access.srv.from("nexa_production_accounts").update({ ...record, revision: lookup.data.revision + 1 })
        .eq("user_id", body.userId).eq("revision", body.revision).select(ACCOUNT_FIELDS).maybeSingle();
      if (result.error) throw Error("mise_a_jour_compte_indisponible");
      return result.data ? cardJson({ account: result.data }) : cardJson({ error: "compte_modifie_recharger" }, 409);
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || record.status === "revoked") {
      return cardJson({ error: "adresse_ou_statut_invalide" }, 400);
    }
    const password = randomBytes(24).toString("base64url") + "!Aa7";
    const created = await access.srv.auth.admin.createUser({ email, password, email_confirm: true, role: PRODUCTION_ROLE });
    if (created.error || !created.data.user) {
      const code = created.error?.code;
      if (code === "email_exists" || code === "user_already_exists") return cardJson({ error: "adresse_deja_utilisee" }, 409);
      throw Error("creation_du_compte_auth_indisponible");
    }
    const user = created.data.user;
    if (user.role !== PRODUCTION_ROLE) {
      await access.srv.auth.admin.deleteUser(user.id);
      throw Error("role_auth_production_non_attribue");
    }
    const result = await access.srv.from("nexa_production_accounts").insert({ ...record, user_id: user.id, email })
      .select(ACCOUNT_FIELDS).single();
    if (result.error || !result.data) {
      const check = await readProductionAccount(access.srv, user.id);
      if (check.data) return cardJson({ account: check.data, password }, 201);
      if (!check.error) await access.srv.auth.admin.deleteUser(user.id);
      throw Error("creation_du_compte_production_indisponible");
    }
    return cardJson({ account: result.data, password }, 201);
  } catch (error) { return productionFailure(error); }
}
