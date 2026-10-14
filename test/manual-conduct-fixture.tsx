import React from "react";
import { createRoot } from "react-dom/client";
import ConduitePage from "../src/app/admin/conduite/page";
import { AdminRoleContext } from "../src/app/admin/ui/admin-role-context";
import type { AppRole } from "../src/lib/auth/role";
declare global { interface Window { __manualFixtureRole?: AppRole } }
createRoot(document.getElementById("root")!).render(
  <AdminRoleContext.Provider value={window.__manualFixtureRole || null}><ConduitePage /></AdminRoleContext.Provider>,
);
