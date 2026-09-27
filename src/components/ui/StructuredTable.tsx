/**
 * SportingSpy Structured Table Component
 * Designed for sports schedules, prize money distributions, telemetry, and records.
 * Adheres to tabular numbers and clean hairline dividers.
 */

import React from 'react';
import { StructuredTable as ITable } from '../../types';

interface StructuredTableProps {
  table: ITable;
  className?: string;
}

export const StructuredTable: React.FC<StructuredTableProps> = ({ table, className = '' }) => {
  return (
    <div className={`my-8 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800 ${className}`}>
      {table.title && (
        <div className="bg-stone-100/80 dark:bg-stone-900/80 px-4 py-3 border-b border-stone-200 dark:border-stone-800">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{table.title}</h4>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 dark:bg-stone-900/40 text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
            <tr>
              {table.headers.map((header, idx) => (
                <th key={idx} scope="col" className="px-4 py-3 whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800/60 bg-white dark:bg-stone-950/40">
            {table.rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="hover:bg-amber-50/40 dark:hover:bg-amber-950/20 transition-colors"
              >
                {row.map((cell, cellIdx) => {
                  // Determine if cell is numeric/currency/time
                  const isNumeric = /^[0-9€$£%:\-–.,+]+$/.test(cell.trim()) || /\d/.test(cell);
                  return (
                    <td
                      key={cellIdx}
                      className={`px-4 py-3 text-stone-800 dark:text-stone-200 ${
                        isNumeric ? 'tabular-nums' : ''
                      } ${cellIdx === 0 ? 'font-medium' : ''}`}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.caption && (
        <div className="bg-stone-50 dark:bg-stone-900/30 px-4 py-2 border-t border-stone-200 dark:border-stone-800 text-xs text-stone-500 italic">
          {table.caption}
        </div>
      )}
    </div>
  );
};
