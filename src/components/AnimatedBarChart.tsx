import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  LabelList,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DataEntry } from "../types/index";
import { getColor } from "../utils/dataHelpers";

interface AnimatedBarChartProps {
  entries: DataEntry[];
  colorScheme: string[];
  valueLabel: string;
  maxValue: number;
}

interface CustomLabelProps {
  x?: number;
  y?: number;
  width?: number;
  value?: number | string;
}

function ValueLabel({ x = 0, y = 0, width = 0, value }: CustomLabelProps) {
  return (
    <text
      x={x + width + 8}
      y={y + 16}
      fill="#e5e7eb"
      fontSize={13}
      fontWeight={600}
    >
      {typeof value === "number" ? value.toFixed(1) : value}
    </text>
  );
}

export function AnimatedBarChart({
  entries,
  colorScheme,
  valueLabel,
  maxValue,
}: AnimatedBarChartProps) {
  const displayEntries = [...entries]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={displayEntries}
          margin={{ top: 8, right: 120, left: 8, bottom: 8 }}
          barCategoryGap="20%"
        >
          <XAxis
            type="number"
            domain={[0, maxValue]}
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            axisLine={{ stroke: "#374151" }}
            tickLine={false}
            label={{
              value: valueLabel,
              position: "insideBottom",
              offset: -4,
              fill: "#6b7280",
              fontSize: 11,
            }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ fill: "#e5e7eb", fontSize: 14, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            contentStyle={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              color: "#f9fafb",
            }}
            formatter={(val) => {
              const numVal = typeof val === "number" ? val : Number(val);
              return [`${isNaN(numVal) ? val : numVal.toFixed(2)}`, valueLabel];
            }}
          />
          <Bar
            dataKey="value"
            radius={[0, 6, 6, 0]}
            isAnimationActive={false}
          >
            {displayEntries.map((entry, index) => (
              <Cell
                key={`cell-${entry.name}`}
                fill={getColor(entry, colorScheme, index)}
              />
            ))}
            <LabelList content={<ValueLabel />} dataKey="value" position="right" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
