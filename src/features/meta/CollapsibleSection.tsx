/**
 * CollapsibleSection - Clickable header that toggles child content visibility.
 *
 * Used in MetaPanel to make Agent, Project, and Events sections independently
 * collapsible. Local state only -- no store needed.
 */

import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  label: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  label,
  defaultOpen = true,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="meta-panel__section">
      <button
        className="meta-panel__section-label meta-panel__section-label--clickable"
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <span className="meta-panel__section-chevron">
          {isOpen ? '\u25BE' : '\u25B8'}
        </span>
        <span>{label}</span>
        {badge && <span className="meta-panel__section-badge">{badge}</span>}
      </button>
      {isOpen && children}
    </div>
  );
}
