/**
 * ProjectWidget - Inline widget for selecting which project agents work in.
 *
 * Shows the current project path with an expandable section for recent projects
 * and a text input for entering new paths. Validates paths via WebSocket.
 *
 * Designed to live inside MetaPanel, not as a standalone positioned element.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useProjectStore } from './projectStore';
import { useTerminalStore } from '@features/terminal/terminalStore';
import './ProjectWidget.css';

/** Shorten a path for display: replace HOME with ~, show last 3 segments if long */
function shortenPath(path: string): string {
  let display = path;
  // Try common home patterns
  if (display.startsWith('/Users/')) {
    const parts = display.split('/');
    // /Users/name/... -> ~/...
    if (parts.length >= 3) {
      display = '~/' + parts.slice(3).join('/');
    }
  } else if (display.startsWith('/home/')) {
    const parts = display.split('/');
    if (parts.length >= 3) {
      display = '~/' + parts.slice(3).join('/');
    }
  }
  return display;
}

export function ProjectWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [validating, setValidating] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  const currentProject = useProjectStore((s) => s.currentProject);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const serverDefault = useProjectStore((s) => s.serverDefault);
  const setProject = useProjectStore((s) => s.setProject);
  const removeFromRecents = useProjectStore((s) => s.removeFromRecents);
  const cacheValidation = useProjectStore((s) => s.cacheValidation);
  const getValidation = useProjectStore((s) => s.getValidation);

  const bridge = useTerminalStore((s) => s.bridge);

  const effectivePath = currentProject ?? serverDefault;
  const validation = effectivePath ? getValidation(effectivePath) : undefined;

  // Focus input when section expands
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectProject = useCallback((path: string) => {
    setProject(path);
    setIsOpen(false);
    setInputValue('');
  }, [setProject]);

  const handleSubmit = useCallback(async () => {
    const path = inputValue.trim();
    if (!path || !bridge) return;

    setValidating(true);
    setInputError(null);
    try {
      const result = await bridge.validateProject(path);
      cacheValidation(result.resolvedPath, {
        exists: result.exists,
        isGitRepo: result.isGitRepo,
      });

      if (!result.exists) {
        setInputError(`Path not found: ${result.resolvedPath}`);
        return;
      }

      // Accept the path - warn in-band if not a git repo
      setProject(result.resolvedPath);
      setIsOpen(false);
      setInputValue('');
      setInputError(null);
    } catch (err) {
      setInputError('Validation failed (server unreachable?)');
      console.error('[ProjectWidget] Validation failed:', err);
    } finally {
      setValidating(false);
    }
  }, [inputValue, bridge, cacheValidation, setProject]);

  const handleRemove = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    removeFromRecents(path);
  }, [removeFromRecents]);

  const indicatorClass = validation
    ? validation.isGitRepo
      ? 'project-widget__indicator--git'
      : validation.exists
        ? 'project-widget__indicator--exists'
        : 'project-widget__indicator--unknown'
    : 'project-widget__indicator--unknown';

  return (
    <div className="project-widget" ref={widgetRef}>
      <button
        className="project-widget__trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`project-widget__indicator ${indicatorClass}`} />
        <span className={`project-widget__path ${!effectivePath ? 'project-widget__path--empty' : ''}`}>
          {effectivePath ? shortenPath(effectivePath) : 'No project selected'}
        </span>
        <span className={`project-widget__chevron ${isOpen ? 'project-widget__chevron--open' : ''}`}>
          &#9660;
        </span>
      </button>

      {isOpen && (
        <div className="project-widget__dropdown">
          <div className="project-widget__input-wrap">
            <input
              ref={inputRef}
              className={`project-widget__input ${inputError ? 'project-widget__input--error' : ''}`}
              type="text"
              placeholder="Enter project path..."
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setInputError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit();
                }
              }}
              disabled={validating}
            />
            {inputError && (
              <div className="project-widget__error">{inputError}</div>
            )}
          </div>

          <div className="project-widget__recents">
            {recentProjects.length === 0 && !serverDefault && (
              <div className="project-widget__empty">No recent projects</div>
            )}
            {serverDefault && !recentProjects.includes(serverDefault) && (
              <button
                className={`project-widget__recent-item ${!currentProject ? 'project-widget__recent-item--active' : ''}`}
                onClick={() => handleSelectProject(serverDefault)}
              >
                <span className="project-widget__indicator project-widget__indicator--git" />
                <span className="project-widget__recent-path">
                  {shortenPath(serverDefault)} (default)
                </span>
              </button>
            )}
            {recentProjects.map((path) => {
              const cached = getValidation(path);
              const dotClass = cached
                ? cached.isGitRepo
                  ? 'project-widget__indicator--git'
                  : 'project-widget__indicator--exists'
                : 'project-widget__indicator--unknown';

              return (
                <button
                  key={path}
                  className={`project-widget__recent-item ${path === currentProject ? 'project-widget__recent-item--active' : ''}`}
                  onClick={() => handleSelectProject(path)}
                >
                  <span className={`project-widget__indicator ${dotClass}`} />
                  <span className="project-widget__recent-path">{shortenPath(path)}</span>
                  <span
                    className="project-widget__recent-remove"
                    onClick={(e) => handleRemove(e, path)}
                    role="button"
                    tabIndex={-1}
                  >
                    x
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
