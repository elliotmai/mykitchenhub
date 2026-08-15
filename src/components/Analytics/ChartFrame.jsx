// src/components/Analytics/ChartFrame.jsx
// Title, subtitle, plot, and the table behind it.
//
// Every chart on the Analytics page ships an equivalent table. That is what
// makes the plot safe to draw at all: the numbers stay available to a screen
// reader, to anyone who can't separate the hues, and to anyone who just wants
// the figures. The SVG is hidden from assistive tech precisely because the
// table says the same thing better.

import React from 'react';
import { Card } from 'react-bootstrap';

/**
 * ChartFrame
 *
 * @param {string} title - what is plotted
 * @param {string} subtitle - the unit or window, e.g. "last 6 months"
 * @param {boolean} isEmpty - render `emptyMessage` instead of the plot
 * @param {string} emptyMessage - shown when there is nothing to draw
 * @param {Array<string>} tableColumns - header cells for the table view
 * @param {Array<Array<string|number>>} tableRows - body cells, already formatted
 * @param {React.ReactNode} children - the recharts tree
 */
const ChartFrame = ({
  title,
  subtitle = '',
  isEmpty = false,
  emptyMessage = 'Nothing to show yet.',
  tableColumns = [],
  tableRows = [],
  children,
}) => (
  <Card className="h-100 chart-frame">
    <Card.Body>
      <h2 className="chart-frame__title h6">{title}</h2>
      {subtitle ? <p className="chart-frame__subtitle">{subtitle}</p> : null}

      {isEmpty ? (
        <p className="chart-frame__empty">{emptyMessage}</p>
      ) : (
        <>
          <div className="chart-frame__plot" aria-hidden="true">
            {children}
          </div>

          {tableColumns.length > 0 ? (
            <details className="chart-frame__table">
              <summary>View as table</summary>
              <div className="chart-frame__table-scroll">
                <table>
                  <caption className="visually-hidden">{title}</caption>
                  <thead>
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={column} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Rows are keyed by position, not by their first cell: two
                        ingredients can share a display name, and a duplicate key
                        drops one of them from the table. */}
                    {tableRows.map((row, rowIndex) => (
                      <tr key={`${rowIndex}-${String(row[0])}`}>
                        <th scope="row">{row[0]}</th>
                        {row.slice(1).map((cell, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <td key={index}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}
    </Card.Body>
  </Card>
);

export default ChartFrame;
