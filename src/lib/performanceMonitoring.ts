type TraceStatus = "success" | "partial" | "error" | "cancelled";

type TraceValue = string | number | boolean | null | undefined;

type TraceStopOptions = {
  status?: TraceStatus;
  metrics?: Record<string, number>;
  attributes?: Record<string, TraceValue>;
};

type PerformanceModule = typeof import("firebase/performance");

type PerformanceContext = {
  performance: ReturnType<PerformanceModule["getPerformance"]>;
  trace: PerformanceModule["trace"];
};

const enabled = import.meta.env.VITE_PERFORMANCE_ENABLED === "true";
const buildLabel = import.meta.env.VITE_PERFORMANCE_BUILD_LABEL?.trim() || "unlabeled";
let contextPromise: Promise<PerformanceContext | null> | null = null;

const toAttributes = (values: Record<string, TraceValue>) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key.slice(0, 40), String(value).slice(0, 100)]),
  );

const toMetrics = (values: Record<string, number> = {}) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => [key.slice(0, 100), Math.round(value)]),
  );

const loadPerformanceContext = async (): Promise<PerformanceContext | null> => {
  if (!enabled || typeof window === "undefined") {
    return null;
  }

  if (!contextPromise) {
    contextPromise = Promise.all([
      import("firebase/app"),
      import("firebase/performance"),
    ])
      .then(([firebaseApp, performanceModule]) => {
        const app = firebaseApp.getApps()[0];
        if (!app) {
          return null;
        }

        return {
          performance: performanceModule.getPerformance(app),
          trace: performanceModule.trace,
        };
      })
      .catch(() => null);
  }

  return contextPromise;
};

export const initializePerformanceMonitoring = (): void => {
  void loadPerformanceContext();
};

export const startPerformanceTrace = (
  name: string,
  attributes: Record<string, TraceValue> = {},
) => {
  const startedAt = Date.now();
  let stopped = false;

  return {
    stop: (options: TraceStopOptions = {}): void => {
      if (stopped) {
        return;
      }
      stopped = true;

      const duration = Math.max(0, Date.now() - startedAt);
      void loadPerformanceContext().then((context) => {
        if (!context) {
          return;
        }

        try {
          const measurement = context.trace(context.performance, name);
          measurement.record(startedAt, duration, {
            attributes: toAttributes({
              build: buildLabel,
              ...attributes,
              ...options.attributes,
              status: options.status ?? "success",
            }),
            metrics: toMetrics(options.metrics),
          });
        } catch {
          // 계측 실패가 기존 사용자 흐름에 영향을 주지 않도록 무시한다.
        }
      });
    },
  };
};
