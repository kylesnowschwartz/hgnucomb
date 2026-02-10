/**
 * MetaPanel - Collapsible right-side panel for project-level widgets.
 *
 * Floats over the HexGrid with no layout impact. Slides in/out with a
 * persistent edge tab for toggling. Semi-transparent background lets the
 * grid bleed through; widget interiors use solid backgrounds for readability.
 *
 * Sections: Agent, Project, Events -- all independently collapsible.
 */

import { useUIStore } from '@features/controls/uiStore';
import { ProjectWidget } from '@features/project/ProjectWidget';
import { AgentDetailsWidget } from './AgentDetailsWidget';
import { CollapsibleSection } from './CollapsibleSection';
import { EventLog } from '@features/events/EventLog';
import './MetaPanel.css';

export function MetaPanel() {
  const isOpen = useUIStore((s) => s.metaPanelOpen);
  const toggle = useUIStore((s) => s.toggleMetaPanel);

  return (
    <>
      <button
        className={`meta-panel__tab ${isOpen ? 'meta-panel__tab--open' : ''}`}
        onClick={toggle}
        title={isOpen ? 'Close panel (m)' : 'Open panel (m)'}
      >
        <span className="meta-panel__tab-icon">
          {isOpen ? '\u203A' : '\u2039'}
        </span>
      </button>
      <div className={`meta-panel ${isOpen ? 'meta-panel--open' : ''}`}>
        <div className="meta-panel__content">
          <CollapsibleSection label="Agent" defaultOpen={true}>
            <AgentDetailsWidget />
          </CollapsibleSection>
          <CollapsibleSection label="Project" defaultOpen={true}>
            <ProjectWidget />
          </CollapsibleSection>
          <CollapsibleSection label="Events" defaultOpen={false}>
            <EventLog />
          </CollapsibleSection>
        </div>
      </div>
    </>
  );
}
