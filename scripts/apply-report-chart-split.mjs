import fs from "node:fs";

const path = "src/pages/Student/ReportView.tsx";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (before, after, marker) => {
  if (marker && source.includes(marker)) return;
  if (!source.includes(before)) {
    throw new Error(`ReportView target not found: ${before.slice(0, 100)}`);
  }
  source = source.replace(before, after);
};

replaceOnce(
  'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
  'import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";',
  "lazy, Suspense",
);

replaceOnce(
  `import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
`,
  `const RadarScoreChart = lazy(() =>
  import("@/components/student/ReportCharts").then((module) => ({
    default: module.RadarScoreChart,
  })),
);
const TrendScoreChart = lazy(() =>
  import("@/components/student/ReportCharts").then((module) => ({
    default: module.TrendScoreChart,
  })),
);
`,
  "const RadarScoreChart = lazy",
);

replaceOnce(
  `  const chartAxisColor = "#111827";
  const chartGridColor = "#d1d5db";
  const chartLineColor = "#2563eb";

`,
  "",
  "__chart_colors_removed__",
);

replaceOnce(
  `                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} outerRadius="76%">
                          <PolarGrid stroke={chartGridColor} />
                          <PolarAngleAxis
                            dataKey="subject"
                            tick={{ fontSize: isMobile ? 11 : 12, fill: chartAxisColor }}
                          />
                          <PolarRadiusAxis
                            domain={[0, 100]}
                            tick={{ fontSize: isMobile ? 10 : 11, fill: chartAxisColor }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Radar
                            name="나의점수"
                            dataKey="myScore"
                            stroke="#eab308"
                            fill="#eab308"
                            fillOpacity={0.14}
                            strokeWidth={3}
                          />
                          <Radar
                            name="전체평균"
                            dataKey="avgScore"
                            stroke="#6b7280"
                            fillOpacity={0}
                            strokeDasharray="8 6"
                            strokeWidth={2}
                          />
                          <Tooltip />
                        </RadarChart>
                      </ResponsiveContainer>`,
  `                      <Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center text-sm text-slate-500">
                            차트 불러오는 중...
                          </div>
                        }
                      >
                        <RadarScoreChart data={radarData} isMobile={isMobile} />
                      </Suspense>`,
  "<RadarScoreChart data={radarData}",
);

replaceOnce(
  `                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis
                        dataKey="examDateLabel"
                        tick={{ fontSize: isMobile ? 11 : 12, fill: chartAxisColor }}
                        angle={isMobile ? -18 : 0}
                        textAnchor={isMobile ? "end" : "middle"}
                        height={isMobile ? 44 : 32}
                        stroke={chartGridColor}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: isMobile ? 11 : 12, fill: chartAxisColor }}
                        stroke={chartGridColor}
                      />
                      <Tooltip
                        contentStyle={{
                          borderColor: chartGridColor,
                          backgroundColor: "#ffffff",
                          color: chartAxisColor,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke={chartLineColor}
                        strokeWidth={3}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>`,
  `                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        차트 불러오는 중...
                      </div>
                    }
                  >
                    <TrendScoreChart data={trendData} isMobile={isMobile} />
                  </Suspense>`,
  "<TrendScoreChart data={trendData}",
);

fs.writeFileSync(path, source);
console.log("Report chart split applied.");
