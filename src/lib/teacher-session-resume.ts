type ResumableSession = { id: string; session_state?: string };

export async function selectTeacherSessionToResume<T extends ResumableSession>(input: {
  localOpen: T | null;
  serverOpen: T | null;
  isFinalized: (sessionId: string) => Promise<boolean>;
}): Promise<T | null> {
  // Le démarrage local est plus récent que la dernière réponse API sauvegardée.
  // Une clôture durable ne doit jamais être annulée par ce vieux document.
  for (const candidate of [input.localOpen, input.serverOpen]) {
    if (!candidate?.id || candidate.session_state === "closed") continue;
    if (!(await input.isFinalized(candidate.id))) return candidate;
  }
  return null;
}
