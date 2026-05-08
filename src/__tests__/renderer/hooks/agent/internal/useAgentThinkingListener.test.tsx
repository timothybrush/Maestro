import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentThinkingListener } from '../../../../../renderer/hooks/agent/internal/useAgentThinkingListener';
import { useSessionStore } from '../../../../../renderer/stores/sessionStore';
import { createMockSession } from '../../../../helpers/mockSession';
import { createMockAITab } from '../../../../helpers/mockTab';

let handler: ((sessionId: string, content: string) => void) | undefined;
const mockUnsubscribe = vi.fn();

const mockProcess = {
	onThinkingChunk: vi.fn((h: any) => {
		handler = h;
		return mockUnsubscribe;
	}),
};

let originalRaf: typeof requestAnimationFrame;
let originalCancelRaf: typeof cancelAnimationFrame;
let scheduled: Array<() => void> = [];

beforeEach(() => {
	vi.clearAllMocks();
	handler = undefined;
	scheduled = [];
	originalRaf = global.requestAnimationFrame;
	originalCancelRaf = global.cancelAnimationFrame;
	global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
		scheduled.push(() => cb(performance.now()));
		return scheduled.length;
	}) as any;
	global.cancelAnimationFrame = vi.fn() as any;

	useSessionStore.setState({
		sessions: [],
		groups: [],
		activeSessionId: '',
		initialLoadComplete: false,
		removedWorktreePaths: new Set(),
	});
	(window as any).maestro = { ...((window as any).maestro || {}), process: mockProcess };
});

afterEach(() => {
	global.requestAnimationFrame = originalRaf;
	global.cancelAnimationFrame = originalCancelRaf;
});

function flushRaf() {
	const queued = scheduled.slice();
	scheduled = [];
	queued.forEach((cb) => cb());
}

describe('useAgentThinkingListener', () => {
	it('subscribes once and unsubscribes on unmount', () => {
		const { unmount } = renderHook(() => useAgentThinkingListener());
		expect(mockProcess.onThinkingChunk).toHaveBeenCalledTimes(1);
		unmount();
		expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it('appends a thinking log on first chunk and merges on subsequent chunks (RAF-batched)', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentThinkingListener());
		handler!('sess-1-ai-tab-1', 'hello ');
		handler!('sess-1-ai-tab-1', 'world');

		// Before flush — no log yet.
		expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toHaveLength(0);

		flushRaf();

		const tabAfter = useSessionStore.getState().sessions[0].aiTabs[0];
		expect(tabAfter.logs).toHaveLength(1);
		expect(tabAfter.logs[0].source).toBe('thinking');
		expect(tabAfter.logs[0].text).toBe('hello world');
	});

	it('skips when tab.showThinking is off', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'off' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentThinkingListener());
		handler!('sess-1-ai-tab-1', 'should not render');
		flushRaf();

		expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toHaveLength(0);
	});

	it('cancels pending RAF on unmount', () => {
		renderHook(() => useAgentThinkingListener()).unmount();
		expect(global.cancelAnimationFrame).not.toHaveBeenCalled();

		const { unmount } = renderHook(() => useAgentThinkingListener());
		handler!('sess-1-ai-tab-1', 'data');
		// RAF is scheduled internally; unmount should cancel it.
		unmount();
		expect(global.cancelAnimationFrame).toHaveBeenCalled();
	});

	it('ignores non-AI session ids', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentThinkingListener());
		handler!('sess-1-terminal', 'data');
		flushRaf();

		expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toHaveLength(0);
	});
});
