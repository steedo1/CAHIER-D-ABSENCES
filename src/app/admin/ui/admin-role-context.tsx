"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "@/lib/auth/role";

export const AdminRoleContext = createContext<AppRole | null>(null);

export function useAdminRole() {
  return useContext(AdminRoleContext);
}
