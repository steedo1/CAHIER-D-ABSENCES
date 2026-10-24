/** The deadline belongs to the open session, never to the next selected course. */
export const ATTENDANCE_AUTO_CLOSE_DELAY_MS = 2 * 60_000;

type Session = {
  started_at: string;
  expected_minutes?: number | null;
  scheduled_end_at?: string | null;
  period_id?: string | null;
  manual_course?: boolean;
  hors_edt?: boolean;
};
type Period = { id: string | null; weekday: number; start_time: string; end_time: string };

function timeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match || +match[1] > 23 || +match[2] > 59) return NaN;
  return +match[1] * 60 + +match[2];
}

export function attendanceAutoCloseAt(
  session: Session | null,
  periodsByDay: Record<number, Period[]>,
  timezone: string,
): string | null {
  if (!session) return null;
  const start = Date.parse(session.started_at);
  if (!Number.isFinite(start)) return null;
  const exceptional = session.manual_course === true || session.hors_edt === true;
  let end = exceptional ? NaN : Date.parse(session.scheduled_end_at || "");
  if (!Number.isFinite(end) && !exceptional) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      });
      const local = (ms: number) => {
        const parts = formatter.formatToParts(new Date(ms));
        const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
        return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
      };
      const date = local(start);
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() || 7;
      const periods = periodsByDay[weekday] || (weekday === 7 ? periodsByDay[0] : []) || [];
      const minute = date.hour * 60 + date.minute;
      const period = session.period_id
        ? periods.find((p) => p.id === session.period_id)
        : periods.find((p) => timeMinutes(p.start_time) === minute);
      if (period) {
        const endMinute = timeMinutes(period.end_time);
        if (endMinute > timeMinutes(period.start_time)) {
          const wanted = Date.UTC(date.year, date.month - 1, date.day, Math.floor(endMinute / 60), endMinute % 60);
          let guess = start + (endMinute - minute) * 60_000 - date.second * 1_000;
          for (let i = 0; i < 3; i++) {
            const got = local(guess);
            const difference = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second) - wanted;
            if (!difference) break;
            guess -= difference;
          }
          end = guess;
        }
      }
    } catch {
      // An offline session can still carry its own immutable duration.
    }
  }
  if (!Number.isFinite(end)) {
    const minutes = session.expected_minutes;
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
    end = start + minutes * 60_000;
  }
  if (end <= start) return null;
  return new Date(end + ATTENDANCE_AUTO_CLOSE_DELAY_MS).toISOString();
}

/** Also checked on resume: mobile browsers may suspend timers while asleep. */
export function watchAttendanceAutoClose(input: {
  deadline: string;
  now(): number;
  ready(): boolean;
  close(deadline: string): Promise<void>;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  timers: Pick<Window, "setTimeout" | "clearTimeout">;
}) {
  const deadlineMs = Date.parse(input.deadline);
  if (!Number.isFinite(deadlineMs)) return () => {};
  let stopped = false;
  let running = false;
  let nextAttempt = -Infinity;
  let timer: number;
  const check = () => {
    if (stopped) return;
    input.timers.clearTimeout(timer);
    const now = input.now();
    if (!running && input.ready() && now >= deadlineMs && now >= nextAttempt) {
      running = true;
      nextAttempt = now + 15_000;
      void Promise.resolve().then(() => {
        if (!stopped) return input.close(input.deadline);
      }).catch(() => {
        // The finish flow reports storage/network errors; keep the session for retry.
      }).finally(() => {
        running = false;
        check();
      });
    }
    const remaining = now >= deadlineMs && (!input.ready() || running)
      ? 5_000
      : Math.max(deadlineMs - now, nextAttempt - now, 250);
    timer = input.timers.setTimeout(check, Math.min(5_000, remaining));
  };
  const events = ["focus", "pageshow", "online", "visibilitychange"] as const;
  for (const event of events) input.events.addEventListener(event, check);
  check();
  return () => {
    stopped = true;
    input.timers.clearTimeout(timer);
    for (const event of events) input.events.removeEventListener(event, check);
  };
}
