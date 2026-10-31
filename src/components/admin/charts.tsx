"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 12, fill: "#8592A8" };

export function TrendChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="trend" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#20B6A5" stopOpacity={0.3} />
            <stop offset="1" stopColor="#20B6A5" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#E9EDF2" />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E9EDF2", fontSize: 13 }} formatter={(v) => [v, "Demandes"]} />
        <Area type="monotone" dataKey="count" stroke="#20B6A5" strokeWidth={2.5} fill="url(#trend)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HBarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={150} tick={{ ...axis, fill: "#4A5873" }} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: "#F7F8FA" }} contentStyle={{ borderRadius: 12, border: "1px solid #E9EDF2", fontSize: 13 }} formatter={(v) => [v, "Demandes"]} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16} label={{ position: "right", fontSize: 12, fill: "#101C35" }}>
          {data.map((d) => <Cell key={d.label} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
