export type OfflinePreparationRole = "teacher" | "class-device" | "admin" | "parent";

export type OfflinePreparationState =
  | "idle"
  | "checking"
  | "preparing_core"
  | "ready"
  | "ready_local"
  | "retry_wait"
  | "error";

export type OfflinePreparationTrigger =
  | "initial"
  | "focus"
  | "online"
  | "visibility"
  | "periodic"
  | "service_worker"
  | "retry"
  | "manual"
  | "context_change";

export type OfflinePreparationDecision<T> = {
  state: "ready" | "ready_local" | "prepare_core" | "error";
  readiness: T | null;
  message?: string | null;
};

export type OfflinePreparationSnapshot<T> = {
  role: OfflinePreparationRole;
  state: OfflinePreparationState;
  trigger: OfflinePreparationTrigger | null;
  readiness: T | null;
  progress: string;
  error: string | null;
  started_at: number | null;
  updated_at: number;
  next_retry_at: number | null;
  failure_count: number;
  preparation_performed: boolean;
};

export type OfflinePreparationRunResult<T> = {
  attempted: boolean;
  prepared: boolean;
  snapshot: OfflinePreparationSnapshot<T>;
};

type OperationContext = {
  trigger: OfflinePreparationTrigger;
  signal: AbortSignal;
};

type PrepareContext = OperationContext & {
  onProgress(message: string): void;
};

type MachineOptions<T> = {
  check(role: OfflinePreparationRole, context: OperationContext): Promise<OfflinePreparationDecision<T>>;
  prepare(role: OfflinePreparationRole, context: PrepareContext): Promise<T>;
  classifyPrepared?(role: OfflinePreparationRole, readiness: T, context: OperationContext): Promise<OfflinePreparationDecision<T>>;
  onState?(snapshot: OfflinePreparationSnapshot<T>): void;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  timeoutMs?: number;
  minimumCheckIntervalMs?: number;
  retryDelaysMs?: number[];
};

type Runtime<T> = {
  snapshot: OfflinePreparationSnapshot<T>;
  inFlight: Promise<OfflinePreparationRunResult<T>> | null;
  lastCheckAt: number | null;
};

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 300_000];
const AUTOMATIC_TRIGGERS = new Set<OfflinePreparationTrigger>([
  "initial", "focus", "online", "visibility", "periodic", "service_worker", "context_change",
]);

function messageOf(cause: unknown) {
  return cause instanceof Error && cause.message
    ? cause.message
    : String(cause || "La préparation hors ligne a échoué.");
}

function initialSnapshot<T>(role: OfflinePreparationRole, at: number): OfflinePreparationSnapshot<T> {
  return {
    role,
    state: "idle",
    trigger: null,
    readiness: null,
    progress: "",
    error: null,
    started_at: null,
    updated_at: at,
    next_retry_at: null,
    failure_count: 0,
    preparation_performed: false,
  };
}

export function createOfflinePreparationMachine<T>(options: MachineOptions<T>) {
  const now = options.now || Date.now;
  const setTimeoutFn = options.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = options.clearTimeout || globalThis.clearTimeout;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const minimumCheckIntervalMs = Math.max(0, options.minimumCheckIntervalMs ?? 15_000);
  const retryDelays = options.retryDelaysMs?.length
    ? options.retryDelaysMs.map((value) => Math.max(0, value))
    : DEFAULT_RETRY_DELAYS_MS;
  const runtimes = new Map<OfflinePreparationRole, Runtime<T>>();
  const listeners = new Set<(snapshot: OfflinePreparationSnapshot<T>) => void>();

  function runtimeFor(role: OfflinePreparationRole) {
    let runtime = runtimes.get(role);
    if (!runtime) {
      runtime = { snapshot: initialSnapshot<T>(role, now()), inFlight: null, lastCheckAt: null };
      runtimes.set(role, runtime);
    }
    return runtime;
  }

  function publish(runtime: Runtime<T>, patch: Partial<OfflinePreparationSnapshot<T>>) {
    runtime.snapshot = { ...runtime.snapshot, ...patch, updated_at: now() };
    options.onState?.(runtime.snapshot);
    listeners.forEach((listener) => listener(runtime.snapshot));
    return runtime.snapshot;
  }

  function skipped(runtime: Runtime<T>): Promise<OfflinePreparationRunResult<T>> {
    return Promise.resolve({ attempted: false, prepared: false, snapshot: runtime.snapshot });
  }

  function run(
    role: OfflinePreparationRole,
    input: { trigger: OfflinePreparationTrigger },
  ): Promise<OfflinePreparationRunResult<T>> {
    const runtime = runtimeFor(role);
    if (runtime.inFlight) return runtime.inFlight;

    const current = now();
    const manual = input.trigger === "manual";
    if (!manual && runtime.snapshot.state === "error") return skipped(runtime);
    if (
      !manual &&
      runtime.snapshot.state === "retry_wait" &&
      runtime.snapshot.next_retry_at !== null &&
      current < runtime.snapshot.next_retry_at
    ) return skipped(runtime);
    if (
      !manual &&
      input.trigger !== "retry" &&
      AUTOMATIC_TRIGGERS.has(input.trigger) &&
      runtime.lastCheckAt !== null &&
      current - runtime.lastCheckAt < minimumCheckIntervalMs
    ) return skipped(runtime);

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeoutFn> | null = null;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeoutFn(() => {
        const error = new Error("La préparation hors ligne a dépassé son délai maximal.");
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    const workflow = (async (): Promise<OfflinePreparationRunResult<T>> => {
      let prepared = false;
      publish(runtime, {
        state: "checking",
        trigger: input.trigger,
        progress: "Vérification des données essentielles…",
        error: null,
        started_at: now(),
        next_retry_at: null,
        preparation_performed: false,
      });
      runtime.lastCheckAt = now();

      try {
        let decision = await Promise.race([
          options.check(role, { trigger: input.trigger, signal: controller.signal }),
          deadline,
        ]);

        if (decision.state === "prepare_core") {
          publish(runtime, {
            state: "preparing_core",
            readiness: decision.readiness,
            progress: decision.message || "Préparation de l’appel hors ligne…",
          });
          const readiness = await Promise.race([
            options.prepare(role, {
              trigger: input.trigger,
              signal: controller.signal,
              onProgress: (progress) => publish(runtime, { progress }),
            }),
            deadline,
          ]);
          prepared = true;
          decision = options.classifyPrepared
            ? await Promise.race([
                options.classifyPrepared(role, readiness, { trigger: input.trigger, signal: controller.signal }),
                deadline,
              ])
            : { state: "ready", readiness };
        }

        if (decision.state === "prepare_core") {
          throw new Error(
            "La préparation du noyau d’appel n’a pas produit un état final.",
          );
        }

        if (decision.state === "error") {
          const snapshot = publish(runtime, {
            state: "error",
            readiness: decision.readiness,
            progress: "",
            error: decision.message || "La préparation hors ligne nécessite une vérification.",
            started_at: null,
            next_retry_at: null,
            preparation_performed: prepared,
          });
          return { attempted: true, prepared, snapshot };
        }

        const snapshot = publish(runtime, {
          state: decision.state,
          readiness: decision.readiness,
          progress: "",
          error: null,
          started_at: null,
          next_retry_at: null,
          failure_count: 0,
          preparation_performed: prepared,
        });
        return { attempted: true, prepared, snapshot };
      } catch (cause) {
        const failureCount = runtime.snapshot.failure_count + 1;
        const delay = retryDelays[Math.min(failureCount - 1, retryDelays.length - 1)];
        const snapshot = publish(runtime, {
          state: "retry_wait",
          progress: "",
          error: messageOf(cause),
          started_at: null,
          next_retry_at: now() + delay,
          failure_count: failureCount,
          preparation_performed: prepared,
        });
        return { attempted: true, prepared, snapshot };
      } finally {
        if (timeout !== null) clearTimeoutFn(timeout);
      }
    })();

    runtime.inFlight = workflow.finally(() => {
      runtime.inFlight = null;
    });
    return runtime.inFlight;
  }

  return {
    run,
    getSnapshot(role: OfflinePreparationRole) {
      return runtimeFor(role).snapshot;
    },
    subscribe(listener: (snapshot: OfflinePreparationSnapshot<T>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset(role: OfflinePreparationRole) {
      const runtime = runtimeFor(role);
      runtime.snapshot = initialSnapshot<T>(role, now());
      runtime.lastCheckAt = null;
      options.onState?.(runtime.snapshot);
      listeners.forEach((listener) => listener(runtime.snapshot));
    },
  };
}
