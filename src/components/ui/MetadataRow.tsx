/**
 * SportingSpy Metadata Row
 * Enforces Zero-Pill discipline: unboxed clean text with subtle typographic separators.
 */

import React from 'react';

interface MetadataItem {
  label?: string;
  value: React.ReactNode;
  isEmphasized?: boolean;
}

interface MetadataRowProps {
  items: (MetadataItem | string | number | null | undefined)[];
  separator?: string;
  className?: string;
  size?: 'xs' | 'sm' | 'base';
}

export const MetadataRow: React.FC<MetadataRowProps> = ({
  items,
  separator = '·',
  className = '',
  size = 'xs',
}) => {
  const filteredItems = items.filter(
    (item): item is MetadataItem | string | number => item !== null && item !== undefined && item !== ''
  );

  const sizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    base: 'text-base',
  };

  return (
    <div
      className={`flex items-center flex-wrap gap-x-2 gap-y-1 font-medium text-stone-500 dark:text-stone-400 ${sizeClasses[size]} ${className}`}
    >
      {filteredItems.map((item, index) => {
        const isObject = typeof item === 'object';
        const label = isObject ? item.label : undefined;
        const value = isObject ? item.value : item;
        const isEmphasized = isObject ? item.isEmphasized : false;

        return (
          <React.Fragment key={index}>
            <span
              className={`inline-flex items-center gap-1 ${
                isEmphasized ? 'text-amber-700 dark:text-amber-400 font-semibold' : ''
              }`}
            >
              {label && <span className="text-stone-400 dark:text-stone-500 font-normal">{label}:</span>}
              <span className="tabular-nums">{value}</span>
            </span>
            {index < filteredItems.length - 1 && (
              <span className="text-stone-300 dark:text-stone-600 select-none" aria-hidden="true">
                {separator}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
