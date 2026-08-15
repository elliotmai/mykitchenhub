// src/components/Analytics/StoreChart.jsx
// Where the money goes.
//
// One series again — total spend per store — so the bars all wear the same hue
// and length does all the comparing.

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
  CHART_AXIS,
  CHART_GRID,
  MAX_BAR_SIZE,
  SERIES_COUNT,
  TEXT_SECONDARY,
  TOOLTIP_STYLE,
  formatCurrency,
  formatCurrencyShort,
} from './chartTheme';
import { truncateName } from './TopItemsChart';

/**
 * The tooltip names the store in full, however far the axis shortened it — two
 * branches of one chain shorten to something very similar.
 */
export const tooltipStoreName = (_label, payload) => payload?.[0]?.payload?.store ?? '';

/**
 * StoreChart
 *
 * @param {Array} stores - rows from useShoppingAnalytics().stores
 */
const StoreChart = ({ stores = [] }) => {
  const data = stores.map((store) => ({
    store: store.store,
    short: truncateName(store.store, 16),
    spend: store.spend,
  }));

  return (
    <ChartFrame
      title="Spend by store"
      subtitle="Total recorded across every purchase"
      isEmpty={data.length === 0}
      emptyMessage="Note the store when you add an item to compare where your money goes."
      tableColumns={['Store', 'Spend', 'Purchases', 'Average price']}
      tableRows={stores.map((store) => [
        store.store,
        formatCurrency(store.spend),
        String(store.purchases),
        formatCurrency(store.averagePrice),
      ])}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeWidth={1} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            stroke={CHART_AXIS}
            tickLine={false}
            tickFormatter={formatCurrencyShort}
          />
          <YAxis
            type="category"
            dataKey="short"
            width={96}
            tick={AXIS_TICK}
            stroke={CHART_AXIS}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: CHART_GRID }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [formatCurrency(value), 'Spent']}
            labelFormatter={tooltipStoreName}
          />
          <Bar
            dataKey="spend"
            fill={SERIES_COUNT}
            maxBarSize={MAX_BAR_SIZE}
            radius={BAR_RADIUS}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="spend"
              position="right"
              formatter={formatCurrency}
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

export default StoreChart;
