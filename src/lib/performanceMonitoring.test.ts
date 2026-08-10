import { describe, expect, it } from "vitest";
import { startPerformanceTrace, stopPerformanceTraceAfterPaint } from "./performanceMonitoring";

describe("performanceMonitoring", () => {
  it("계측이 비활성화된 테스트 환경에서도 안전하게 종료된다", () => {
    const measurement = startPerformanceTrace("test_trace", { source: "unit" });

    expect(() => {
      measurement.stop({ status: "success", metrics: { item_count: 1 } });
      measurement.stop({ status: "error" });
    }).not.toThrow();
  });

  it("화면 반영 후 종료 요청도 계측 비활성 환경에서 안전하다", () => {
    const measurement = startPerformanceTrace("paint_trace");

    expect(() => {
      stopPerformanceTraceAfterPaint(measurement, { metrics: { rendered_count: 1 } });
    }).not.toThrow();
  });
});
