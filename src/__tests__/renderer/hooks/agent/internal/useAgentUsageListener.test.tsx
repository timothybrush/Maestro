import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentUsageListener } from '../../../../../renderer/hooks/agent/internal/useAgentUsageListener';
import { useSessionStore } from '../../../../../renderer/stores/sessionStore';
import { createMockSession } from '../../../../helpers/mockSession';
import type { BatchedUpdater } from '../../../../../renderer/hooks/agent/internal/types';

let handler: ((sessionId: string, usage: any) => void) | undefined;
const mockUnsubscribe = vi.fn();

const mockProcess = {
	onUsage: vi.fn((h: any) => {
		handler = h;
		return mockUnsubscribe;
	}),
};

function makeBatched(): BatchedUpdater {
	return {
		appendLog: vi.fn(),
		markDelivered: vi.fn(),
		markUnread: vi.fn(),
		updateUsage: vi.fn(),
		updateContextUsage: vi.fn(),
		updateCycleBytes: vi.fn(),
		updateCycleTokens: vi.fn(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	handler = undefined;
	useSessionStore.setState({
		sessions: [],
		groups: [],
		activeSessionId: '',
		initialLoadComplete: false,
		removedWorktreePaths: new Set(),
	});
	(window as any).maestro = { ...((window as any).maestro || {}), process: mockProcess };
});

describe('useAgentUsageListener', () => {
	it('routes usage updates and tracks cycle tokens', () => {
		const session = createMockSession({ id: 'sess-1', toolType: 'claude-code' });
		useSessionStore.setState({ sessions: [session] } as any);

		const batched = makeBatched();
		renderHook(() =>
			useAgentUsageListener({ batchedUpdater: batched, contextWarningYellowThreshold: 80 })
		);

		handler!('sess-1', {
			inputTokens: 100,
			outputTokens: 50,
			cacheReadInputTokens: 10,
			contextWindow: 200000,
			contextPercentage: 0.05,
		});

		expect(batched.updateUsage).toHaveBeenCalled();
		expect(batched.updateCycleTokens).toHaveBeenCalledWith('sess-1', 50);
	});

	it('skips when session is missing (orphan event)', () => {
		const batched = makeBatched();
		renderHook(() =>
			useAgentUsageListener({ batchedUpdater: batched, contextWarningYellowThreshold: 80 })
		);

		handler!('missing', { inputTokens: 0, outputTokens: 0, contextWindow: 0 });
		expect(batched.updateUsage).not.toHaveBeenCalled();
	});

	it('falls back to accumulated growth estimate when contextPercentage is null', () => {
		const session = createMockSession({
			id: 'sess-1',
			toolType: 'claude-code',
			contextUsage: 25,
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const batched = makeBatched();
		renderHook(() =>
			useAgentUsageListener({ batchedUpdater: batched, contextWarningYellowThreshold: 80 })
		);

		handler!('sess-1', {
			inputTokens: 100,
			outputTokens: 1000,
			cacheReadInputTokens: 0,
			contextWindow: 0,
			contextPercentage: null,
		});

		// contextUsage update should fire with a value <= maxEstimate (yellow - 5 = 75)
		const calls = (batched.updateContextUsage as any).mock.calls;
		const last = calls[calls.length - 1];
		expect(last?.[1]).toBeLessThanOrEqual(75);
	});
});
