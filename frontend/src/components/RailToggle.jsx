import { CaretLeft, CaretRight } from '@phosphor-icons/react';

export default function RailToggle({ side, open, label, onToggle }) {
  const Caret = (side === 'left') === open ? CaretLeft : CaretRight;
  const action = `${open ? 'Collapse' : 'Expand'} ${label}`;
  return <button type="button" className="rail-toggle" aria-expanded={open}
    aria-label={action} title={action} onClick={onToggle}>
    <Caret size={16} aria-hidden="true" />
  </button>;
}
