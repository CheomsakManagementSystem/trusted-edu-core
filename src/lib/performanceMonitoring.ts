type TraceStatus = "success" | "partial" | "error" | "cancelled";

type TraceValue = string | number | boolean | null | undefined;

type TraceStopOptions = {
  status?: TraceStatus;
  metrics?: Record<string, number>;
  attributes?: Record<string, TraceValue>;
};

export type PerformanceTrace = {
  stop: (options?: TraceStopOptions) => void;
};

type PerformanceModule = typeof import("firebase/performance");

type PerformanceContext = {
  performance: ReturnType<PerformanceModule["getPerformance"]>;
  trace: PerformanceModule["trace"];
};

const enabled = import.meta.env.VITE_PERFORMANCE_ENABLED === "true";
const buildLabel = import.meta.env.VITE_PERFORMANCE_BUILD_LABEL?.trim() || "unlabeled";
let contextPromise: Promise<PerformanceContext | null> | null = null;

export const detectPerformanceEnvironment = (userAgent: string) => {
  const isNaver = /NAVER|naver\(inapp/i.test(userAgent);
  const isWhale = /Whale/i.test(userAgent);
  const isIos = /iP(?:hone|ad|od)/i.test(userAgent);
  const iosMajor = userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)[._]/i)?.[1];
  const isIosWebView = isIos
    && /AppleWebKit/i.test(userAgent)
    && !/(?:Safari|CriOS|FxiOS|EdgiOS|OPiOS|Whale)/i.test(userAgent);

  const browserFamily = isNaver
    ? "naver"
    : isWhale
      ? "whale"
      : /Edg(?:e|A|iOS)?\//i.test(userAgent)
        ? "edge"
        : /(?:Chrome|CriOS)\//i.test(userAgent)
          ? "chrome"
          : /(?:Firefox|FxiOS)\//i.test(userAgent)
            ? "firefox"
            : /Safari\//i.test(userAgent)
              ? "safari"
              : "other";

  return {
    browser_family: browserFamily,
    browser_context: isNaver ? "naver_in_app" : isIosWebView ? "ios_webview" : "browser",
    ios_major: iosMajor ?? "none",
  };
};

const getPerformanceEnvironment = () =>
  typeof navigator === "undefined"
    ? { browser_family: "server", browser_context: "server", ios_major: "none" }
    : detectPerformanceEnvironment(navigator.userAgent);

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
): PerformanceTrace => {
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
              ...getPerformanceEnvironment(),
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

export const stopPerformanceTraceAfterPaint = (
  measurement: PerformanceTrace,
  options: TraceStopOptions = {},
): void => {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    measurement.stop(options);
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => measurement.stop(options));
  });
};
