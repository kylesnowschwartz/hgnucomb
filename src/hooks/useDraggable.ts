/**
 * Hook for making elements draggable via a drag handle.
 *
 * Usage:
 *   const { position, handleMouseDown, style } = useDraggable({ initialX: 20, initialY: 20 });
 *   <div style={style}>
 *     <div onMouseDown={handleMouseDown}>Drag handle</div>
 *   </div>
 */

import { useState, useCallback, useEffect, useRef, type CSSProperties, type MouseEvent } from 'react';

interface UseDraggableOptions {
  /** Initial X position (left) */
  initialX?: number;
  /** Initial Y position (top) */
  initialY?: number;
}

interface UseDraggableResult {
  /** Current position */
  position: { x: number; y: number };
  /** Attach to drag handle's onMouseDown */
  handleMouseDown: (e: MouseEvent) => void;
  /** Style object to apply to the draggable element */
  style: CSSProperties;
}

export function useDraggable(options: UseDraggableOptions = {}): UseDraggableResult {
  const { initialX = 0, initialY = 0 } = options;

  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;

    // Prevent text selection during drag
    e.preventDefault();

    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position.x, position.y]);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!isDragging.current) return;

      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;

      // Clamp to viewport bounds
      const clampedX = Math.max(0, Math.min(newX, window.innerWidth - 100));
      const clampedY = Math.max(0, Math.min(newY, window.innerHeight - 50));

      setPosition({ x: clampedX, y: clampedY });
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const style: CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    // Remove any bottom/right positioning - we use left/top now
    bottom: 'auto',
    right: 'auto',
  };

  return { position, handleMouseDown, style };
}
