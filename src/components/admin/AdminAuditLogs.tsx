/**
 * SportingSpy Editorial Audit Trail Component
 * Provides complete accountability and event logging across sports, events, articles, and settings.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';

export const AdminAuditLogs: React.FC = () => {
  const { auditLogs } = useApp();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            System & Editorial Audit Logs
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Immutable chronological record of modifications, creations, and security events.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Timestamp</th>
              <th className="p-3">User</th>
              <th className="p-3">Action</th>
              <th className="p-3">Entity Type</th>
              <th className="p-3">Log Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800 font-mono">
            {auditLogs.map((log) => (
              <tr key={log.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                <td className="p-3 text-stone-500 tabular-nums whitespace-nowrap dark:text-stone-400">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="p-3 font-semibold text-stone-900 dark:text-stone-100 font-sans">
                  {log.userName}
                </td>
                <td className="p-3 text-amber-700 dark:text-amber-400 font-bold font-sans">
                  {log.action}
                </td>
                <td className="p-3 text-stone-600 dark:text-stone-400 font-sans">
                  {log.entityType}
                </td>
                <td className="p-3 text-stone-700 dark:text-stone-300 font-sans max-w-sm">
                  {log.details}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
