/** Parent Connect uses device-cookie authentication, not the staff offline grant. */
export function isParentConnectRoute(pathname: string): boolean {
  return pathname === "/parents" || pathname.startsWith("/parents/");
}
