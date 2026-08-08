import {
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

const AXIS_COLOR = "#111827";
const GRID_COLOR = "#d1d5db";

export type RadarScoreDatum = {
  subject: string;
  myScore: number;
  avgScore: number;
};

export type TrendScoreDatum = {
  examDateLabel: string;
  score: number | null;
  reportId: string;
};

export const RadarScoreChart = ({
  data,
  isMobile,
}: {
  data: RadarScoreDatum[];
  isMobile: boolean;
}) => (
  <ResponsiveContainer width="100%" height="100%">
    <RadarChart data={data} outerRadius="76%">
      <PolarGrid stroke={GRID_COLOR} />
      <PolarAngleAxis
        dataKey="subject"
        tick={{ fontSize: isMobile ? 11 : 12, fill: AXIS_COLOR }}
      />
      <PolarRadiusAxis
        domain={[0, 100]}
        tick={{ fontSize: isMobile ? 10 : 11, fill: AXIS_COLOR }}
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
  </ResponsiveContainer>
);

export const TrendScoreChart = ({
  data,
  isMobile,
}: {
  data: TrendScoreDatum[];
  isMobile: boolean;
}) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
      <XAxis
        dataKey="examDateLabel"
        tick={{ fontSize: isMobile ? 11 : 12, fill: AXIS_COLOR }}
        angle={isMobile ? -18 : 0}
        textAnchor={isMobile ? "end" : "middle"}
        height={isMobile ? 44 : 32}
        stroke={GRID_COLOR}
      />
      <YAxis
        domain={[0, 100]}
        tick={{ fontSize: isMobile ? 11 : 12, fill: AXIS_COLOR }}
        stroke={GRID_COLOR}
      />
      <Tooltip
        contentStyle={{
          borderColor: GRID_COLOR,
          backgroundColor: "#ffffff",
          color: AXIS_COLOR,
        }}
      />
      <Line
        type="monotone"
        dataKey="score"
        stroke="#2563eb"
        strokeWidth={3}
        dot={{ r: 4 }}
        activeDot={{ r: 6 }}
      />
    </LineChart>
  </ResponsiveContainer>
);
