import { Children } from 'react';

export default function FilterField({ label, children, className = '' }) {
  const control = Children.only(children);
  const caption = label || control.props['aria-label'] || 'Filter';
  const search = control.type === 'input' && (control.props.type === 'search' || control.props.placeholder);
  return <label className={`filter-field${search ? ' filter-field--search' : ''}${className ? ` ${className}` : ''}`}>
    <span>{caption}</span>{control}
  </label>;
}
