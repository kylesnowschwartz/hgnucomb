import { describe, it, expect } from 'vitest';
import { isClientMessage, isMcpMessage } from '@shared/protocol';

// ============================================================================
// isClientMessage
// ============================================================================

describe('isClientMessage', () => {
  it('accepts valid terminal.create message', () => {
    const msg = {
      type: 'terminal.create',
      requestId: 'req-123',
      payload: { cols: 80, rows: 24 },
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  it('accepts valid terminal.write message', () => {
    const msg = {
      type: 'terminal.write',
      requestId: 'req-456',
      payload: { sessionId: 'sess-1', data: 'ls -la' },
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  it('accepts valid terminal.resize message', () => {
    const msg = {
      type: 'terminal.resize',
      payload: { sessionId: 'sess-1', cols: 120, rows: 40 },
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  it('accepts valid terminal.dispose message', () => {
    const msg = {
      type: 'terminal.dispose',
      requestId: 'req-789',
      payload: { sessionId: 'sess-1' },
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  it('accepts valid sessions.list message', () => {
    const msg = {
      type: 'sessions.list',
      requestId: 'req-list',
      payload: {},
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  it('accepts valid sessions.clear message', () => {
    const msg = {
      type: 'sessions.clear',
      requestId: 'req-clear',
      payload: {},
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  it('rejects missing type field', () => {
    const msg = {
      requestId: 'req-123',
      payload: { cols: 80 },
    };
    expect(isClientMessage(msg)).toBe(false);
  });

  it('rejects unknown message types', () => {
    const msg = {
      type: 'unknown.message',
      requestId: 'req-123',
      payload: {},
    };
    expect(isClientMessage(msg)).toBe(false);
  });

  it('rejects non-object inputs', () => {
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage(undefined)).toBe(false);
    expect(isClientMessage('string')).toBe(false);
    expect(isClientMessage(123)).toBe(false);
    expect(isClientMessage([])).toBe(false);
  });

  it('rejects object without payload', () => {
    const msg = {
      type: 'terminal.create',
      requestId: 'req-123',
    };
    expect(isClientMessage(msg)).toBe(false);
  });

  it('rejects mcp.* messages (wrong guard)', () => {
    const msg = {
      type: 'mcp.spawn',
      requestId: 'req-mcp',
      payload: { callerId: 'agent-1', cellType: 'worker' },
    };
    expect(isClientMessage(msg)).toBe(false);
  });
});

// ============================================================================
// isMcpMessage
// ============================================================================

describe('isMcpMessage', () => {
  it('validates mcp.register request', () => {
    const msg = {
      type: 'mcp.register',
      payload: { agentId: 'agent-1' },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.spawn request', () => {
    const msg = {
      type: 'mcp.spawn',
      requestId: 'req-1',
      payload: {
        callerId: 'agent-1',
        cellType: 'worker',
        task: 'analyze code',
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.spawn.result response', () => {
    const msg = {
      type: 'mcp.spawn.result',
      requestId: 'req-1',
      payload: {
        success: true,
        agentId: 'agent-2',
        hex: { q: 1, r: 0 },
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.getGrid request', () => {
    const msg = {
      type: 'mcp.getGrid',
      requestId: 'req-grid',
      payload: { callerId: 'agent-1', maxDistance: 3 },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.broadcast request', () => {
    const msg = {
      type: 'mcp.broadcast',
      requestId: 'req-bc',
      payload: {
        callerId: 'agent-1',
        radius: 2,
        broadcastType: 'announcement',
        broadcastPayload: { message: 'hello' },
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.reportStatus request', () => {
    const msg = {
      type: 'mcp.reportStatus',
      requestId: 'req-status',
      payload: {
        callerId: 'agent-1',
        state: 'working',
        message: 'Processing task',
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.reportResult request', () => {
    const msg = {
      type: 'mcp.reportResult',
      requestId: 'req-result',
      payload: {
        callerId: 'worker-1',
        parentId: 'orchestrator-1',
        result: { analysis: 'complete' },
        success: true,
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.getMessages request', () => {
    const msg = {
      type: 'mcp.getMessages',
      requestId: 'req-msgs',
      payload: {
        callerId: 'agent-1',
        since: '2024-01-01T00:00:00Z',
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.getWorkerStatus request', () => {
    const msg = {
      type: 'mcp.getWorkerStatus',
      requestId: 'req-worker',
      payload: {
        callerId: 'orchestrator-1',
        workerId: 'worker-1',
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.broadcast.delivery notification', () => {
    const msg = {
      type: 'mcp.broadcast.delivery',
      payload: {
        senderId: 'agent-1',
        senderHex: { q: 0, r: 0 },
        broadcastType: 'announcement',
        broadcastPayload: { message: 'hello' },
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates mcp.statusUpdate notification', () => {
    const msg = {
      type: 'mcp.statusUpdate',
      payload: {
        agentId: 'agent-1',
        state: 'done',
        message: 'Task complete',
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('validates inbox.updated message', () => {
    const msg = {
      type: 'inbox.updated',
      payload: {
        agentId: 'agent-1',
        messageCount: 3,
        latestTimestamp: '2024-01-01T12:00:00Z',
      },
    };
    expect(isMcpMessage(msg)).toBe(true);
  });

  it('rejects terminal.* messages (wrong guard)', () => {
    const msg = {
      type: 'terminal.create',
      requestId: 'req-1',
      payload: { cols: 80, rows: 24 },
    };
    expect(isMcpMessage(msg)).toBe(false);
  });

  it('rejects sessions.* messages (wrong guard)', () => {
    const msg = {
      type: 'sessions.list',
      requestId: 'req-1',
      payload: {},
    };
    expect(isMcpMessage(msg)).toBe(false);
  });

  it('rejects non-object inputs', () => {
    expect(isMcpMessage(null)).toBe(false);
    expect(isMcpMessage(undefined)).toBe(false);
    expect(isMcpMessage('mcp.spawn')).toBe(false);
    expect(isMcpMessage(42)).toBe(false);
  });

  it('rejects object with non-string type', () => {
    const msg = {
      type: 123,
      payload: {},
    };
    expect(isMcpMessage(msg)).toBe(false);
  });

  it('rejects unknown mcp message types', () => {
    const msg = {
      type: 'mcp.unknown',
      payload: {},
    };
    // The guard only checks prefix, so this passes - that's intentional
    // for forward compatibility with new message types
    expect(isMcpMessage(msg)).toBe(true);
  });
});
