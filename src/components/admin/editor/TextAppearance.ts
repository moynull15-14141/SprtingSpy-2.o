import { Mark, mergeAttributes } from '@tiptap/core';
import styles from '../../editorial/TextAppearance.module.css';

/** Constrained styles survive JSON and editor copy/paste without arbitrary CSS. */
export const TextAppearance = Mark.create({
  name: 'textAppearance',
  addAttributes: () => ({
    size: { default: 'default', parseHTML: el => el.getAttribute('data-size') || 'default', renderHTML: a => ({ 'data-size': a.size }) },
    color: { default: 'default', parseHTML: el => el.getAttribute('data-color') || 'default', renderHTML: a => ({ 'data-color': a.color }) },
  }),
  parseHTML: () => [{ tag: 'span[data-text-appearance]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-text-appearance': '', class: styles.textAppearance }), 0],
});
