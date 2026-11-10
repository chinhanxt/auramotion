"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartSeries = { key: string; label: string; color: string };

// Biểu đồ đường (vùng mờ) nền tối.
export function LineChart({
  data,
  xKey,
  series,
  height = 240,
  format = (v: number) => v.toLocaleString("vi-VN"),
}: {
  data: Record<string, string | number>[];
  xKey: string;
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
}) {
  return (
    <div style={{ height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#8b8b96" }} stroke="transparent" tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5c5c66" }} stroke="transparent" tickLine={false} width={44} tickFormatter={(v) => format(Number(v))} />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,.15)" }}
            contentStyle={{ background: "#16161b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, fontSize: 12, color: "#f5f5f7" }}
            labelStyle={{ color: "#8b8b96", marginBottom: 4 }}
            formatter={(value) => format(Number(value))}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#g-${s.key})`}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
              animationDuration={700}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
