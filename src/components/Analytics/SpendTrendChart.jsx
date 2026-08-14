// src/components/Analytics/SpendTrendChart.jsx
// Grocery spend, month by month.
//
// A line, because the job is "which way is this going" rather than "compare
// these six things". Only the last point is labelled — a number on every dot
// stops being read.

import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartFrame from './ChartFrame';
import {
  AXIS_TICK,
  CHART_AXIS,
  CHART_GRID,
  CHART_SURFACE,
  SERIES_MONEY,
  TEXT_SECONDARY,
  TOOLTIP_STYLE,
  formatCurrency,
  formatCurrencyShort,
} from './chartTheme';

/**
 * Label only the final point, so the reader gets the current number without the
 * plot turning into a wall of digits.
 */
export const LastPointLabel = ({ x, y, value, index, lastIndex }) => {
  if (index !== lastIndex) return null;
  return (
    <text x={x} y={y - 12} textAnchor="end" fill={TEXT_SECONDARY} fontSize={12}>
      {formatCurrency(value)}
    </text>
  );
};

/**
 * SpendTrendChart
 *
 * @param {Array} months - rows from useShoppingAnalytics().monthlySpend
 */
const SpendTrendChart = ({ months = [] }) => {
  const lastIndex = months.length - 1;

  return (
    <ChartFrame
      title="Grocery spend by month"
      subtitle="From the prices recorded on your purchases"
      isEmpty={months.length === 0}
      emptyMessage="Record a price when you add an item and your spending trend appears here."
      tableColumns={['Month', 'Spend', 'Purchases']}
      tableRows={months.map((month) => [
        month.label,
        formatCurrency(month.spend),
        String(month.purchases),
      ])}
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={months} margin={{ top: 24, right: 24, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />
          <XAxis dataKey="label" tick={AXIS_TICK} stroke={CHART_AXIS} tickLine={false} />
          <YAxis
            tick={AXIS_TICK}
            stroke={CHART_AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCurrencyShort}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: CHART_AXIS, strokeWidth: 1 }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [formatCurrency(value), 'Spent']}
          />
          <Line
            type="monotone"
            dataKey="spend"
            stroke={SERIES_MONEY}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // 8px marker with a 2px surface ring, so points stay legible where
            // the line crosses a gridline or doubles back on itself.
            dot={{ r: 4, fill: SERIES_MONEY, stroke: CHART_SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES_MONEY, stroke: CHART_SURFACE, strokeWidth: 2 }}
            label={<LastPointLabel lastIndex={lastIndex} />}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
};

export default SpendTrendChart;
