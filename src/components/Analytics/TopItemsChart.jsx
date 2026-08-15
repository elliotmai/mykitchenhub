// src/components/Analytics/TopItemsChart.jsx
// What gets bought most often.
//
// Horizontal bars because ingredient names are long, and one series because the
// bars are one measure — so there is no legend to read and no colour to decode.

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartFrame from './ChartFrame';
import {
  AXIS_TICK,
  BAR_RADIUS,
  CHART_GRID,
  CHART_AXIS,
  MAX_BAR_SIZE,
  SERIES_COUNT,
  TEXT_SECONDARY,
  TOOLTIP_STYLE,
  formatCurrency,
  formatPurchases,
} from './chartTheme';

/** Long ingredient names get an ellipsis rather than eating the plot width. */
export const truncateName = (name, max = 18) =>
  typeof name === 'string' && name.length > max ? `${name.slice(0, max - 1)}…` : (name ?? '');

/**
 * TopItemsChart
 *
 * @param {Array} items - rows from useShoppingAnalytics().frequentItems
 */
const TopItemsChart = ({ items = [] }) => {
  const data = items.map((item) => ({
    name: item.name,
    short: truncateName(item.name),
    purchases: item.purchases,
  }));

  return (
    <ChartFrame
      title="Bought most often"
      subtitle="Times each ingredient has been purchased"
      isEmpty={data.length === 0}
      emptyMessage="Add a few items to your inventory and your regulars will show up here."
      tableColumns={['Item', 'Purchases', 'Average price']}
      tableRows={items.map((item) => [
        item.name,
        formatPurchases(item.purchases),
        formatCurrency(item.averagePrice),
      ])}
    >
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34 + 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeWidth={1} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={AXIS_TICK}
            stroke={CHART_AXIS}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="short"
            width={104}
            tick={AXIS_TICK}
            stroke={CHART_AXIS}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: CHART_GRID }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [formatPurchases(value), 'Purchased']}
            labelFormatter={(_label, payload) => payload?.[0]?.payload?.name ?? ''}
          />
          <Bar
            dataKey="purchases"
            fill={SERIES_COUNT}
            maxBarSize={MAX_BAR_SIZE}
            radius={BAR_RADIUS}
            isAnimationActive={false}
          >
            {/* Value at the tip — the axis carries everything else. */}
            <LabelList
              dataKey="purchases"
              position="right"
              fill={TEXT_SECONDARY}
              fontSize={12}
              offset={8}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
};

export default TopItemsChart;
