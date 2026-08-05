import { describe, expect, it } from "vitest";
import { startPerformanceTrace } from "./performanceMonitoring";

describe("performanceMonitoring", () => {
  it("계측이 비활성화된 테스트 환경에서도 안전하게 종료된다", () => {
    const measurement = startPerformanceTrace("test_trace", { source: "unit" });

    expect(() => {
      measurement.stop({ status: "success", metrics: { item_count: 1 } });
      measurement.stop({ status: "error" });
    }).not.toThrow();
  });
});
