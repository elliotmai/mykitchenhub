// src/components/Analytics/FrequentItemsTable.jsx
// The regulars, with what they cost and where they were cheapest.
//
// A table rather than a chart: four columns of mixed units (a count, two prices
// and a store name) is exactly the case the form heuristic sends to a table.

import React from 'react';
import { Card } from 'react-bootstrap';
import { formatCurrency, formatPurchases } from './chartTheme';

/**
 * FrequentItemsTable
 *
 * @param {Array} items - rows from useShoppingAnalytics().frequentItems
 */
const FrequentItemsTable = ({ items = [] }) => (
  <Card className="h-100 frequent-items">
    <Card.Body>
      <h2 className="chart-frame__title h6">Your regulars</h2>
      <p className="chart-frame__subtitle">
        What you buy most, what it usually costs, and where it was cheapest
      </p>

      {items.length === 0 ? (
        <p className="chart-frame__empty">
          Nothing tracked yet — add items to your inventory and this fills in.
        </p>
      ) : (
        <div className="frequent-items__scroll">
          <table className="frequent-items__table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Bought</th>
                <th scope="col">Average price</th>
                <th scope="col">Cheapest at</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <th scope="row">{item.name}</th>
                  <td>{formatPurchases(item.purchases)}</td>
                  <td>{formatCurrency(item.averagePrice)}</td>
                  <td>
                    {item.bestStore ? (
                      <>
                        {item.bestStore}
                        <span className="frequent-items__best-price">
                          {formatCurrency(item.bestPrice)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">No store recorded</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card.Body>
  </Card>
);

export default FrequentItemsTable;
