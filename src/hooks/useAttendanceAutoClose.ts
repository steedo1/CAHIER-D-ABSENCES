"use client";

import { useEffect, useRef } from "react";
import { watchAttendanceAutoClose } from "@/lib/attendance-auto-close";

export function useAttendanceAutoClose(input: {
  sessionId: string | null;
  deadline: string | null;
  ready: boolean;
  now(): string;
  close(deadline: string): Promise<void>;
}) {
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!input.sessionId || !input.deadline) return;
    const sessionId = input.sessionId;
    return watchAttendanceAutoClose({
      deadline: input.deadline,
      now: () => Date.parse(latest.current.now()),
      ready: () => latest.current.sessionId === sessionId && latest.current.ready,
      close: (deadline) => latest.current.close(deadline),
      events: window,
      timers: window,
    });
  }, [input.sessionId, input.deadline]);
}
