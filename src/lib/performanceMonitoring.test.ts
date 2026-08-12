import { describe, expect, it } from "vitest";
import {
  detectPerformanceEnvironment,
  startPerformanceTrace,
  stopPerformanceTraceAfterPaint,
} from "./performanceMonitoring";

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

  it("네이버 앱과 Safari를 개인정보 없이 구분한다", () => {
    expect(detectPerformanceEnvironment(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 NAVER(inapp; search; 2000)",
    )).toEqual({
      browser_family: "naver",
      browser_context: "naver_in_app",
      ios_major: "17",
    });

    expect(detectPerformanceEnvironment(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    )).toEqual({
      browser_family: "safari",
      browser_context: "browser",
      ios_major: "none",
    });
  });
});
