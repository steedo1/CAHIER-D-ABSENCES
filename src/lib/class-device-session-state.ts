export type RestorableClassDeviceOpen = {
  id: string;
  class_id: string;
  subject_id?: string | null;
  started_at?: string | null;
};

export type ClassDeviceCompletionMarker = {
  session_id: string;
  class_id: string;
  subject_id?: string | null;
  started_at?: string | null;
  ended_at: string;
};

function normalized(value: unknown) {
  return String(value || "").trim();
}

function sameInstant(left: unknown, right: unknown) {
  const leftMs = Date.parse(normalized(left));
  const rightMs = Date.parse(normalized(right));
  return (
    Number.isFinite(leftMs) &&
    Number.isFinite(rightMs) &&
    Math.abs(leftMs - rightMs) <= 60_000
  );
}

export function completionSuppressesRemoteOpen(input: {
  completion?: ClassDeviceCompletionMarker | null;
  serverOpen?: RestorableClassDeviceOpen | null;
  resolvedCompletionServerId?: string | null;
}) {
  const completion = input.completion;
  const serverOpen = input.serverOpen;
  if (!completion || !serverOpen) return false;
  if (normalized(completion.class_id) !== normalized(serverOpen.class_id)) {
    return false;
  }

  const completedIds = new Set(
    [completion.session_id, input.resolvedCompletionServerId]
      .map(normalized)
      .filter(Boolean),
  );
  if (completedIds.has(normalized(serverOpen.id))) return true;

  const completionSubject = normalized(completion.subject_id);
  const openSubject = normalized(serverOpen.subject_id);
  return Boolean(
    completionSubject &&
      openSubject &&
      completionSubject === openSubject &&
      sameInstant(completion.started_at, serverOpen.started_at),
  );
}

export function chooseRestorableClassDeviceOpen<T extends RestorableClassDeviceOpen>(
  input: {
    localOpen?: T | null;
    serverOpen?: T | null;
    completion?: ClassDeviceCompletionMarker | null;
    resolvedCompletionServerId?: string | null;
  },
): T | null {
  if (input.localOpen) return input.localOpen;
  if (
    completionSuppressesRemoteOpen({
      completion: input.completion,
      serverOpen: input.serverOpen,
      resolvedCompletionServerId: input.resolvedCompletionServerId,
    })
  ) {
    return null;
  }
  return input.serverOpen || null;
}

export async function runClassDeviceSingleFlight<T>(
  lock: { current: boolean },
  task: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.current) return undefined;
  lock.current = true;
  try {
    return await task();
  } finally {
    lock.current = false;
  }
}
