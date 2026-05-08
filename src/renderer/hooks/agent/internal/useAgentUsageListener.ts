/**
 * useAgentUsageListener — registers `window.maestro.process.onUsage`
 *
 * Updates per-tab and per-session usage stats via the batched updater.
 * Estimates context-window % using `estimateContextUsage`; falls back to
 * `estimateAccumulatedGrowth` when the agent does not report
 * `contextPercentage` directly.
 */

import { useEffect } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { parseSessionId } from '../../../utils/sessionIdParser';
import {
	estimateContextUsage,
	estimateAccumulatedGrowth,
	DEFAULT_CONTEXT_WINDOWS,
} from '../../../utils/contextUsage';
import type { BatchedUpdater } from './types';

export interface UseAgentUsageListenerDeps {
	batchedUpdater: BatchedUpdater;
	contextWarningYellowThreshold: number;
}

export function useAgentUsageListener(deps: UseAgentUsageListenerDeps): void {
	useEffect(() => {
		const getSessions = () => useSessionStore.getState().sessions;

		const unsubscribe = window.maestro.process.onUsage((sessionId: string, usageStats) => {
			const parsed = parseSessionId(sessionId);
			const { actualSessionId, tabId, baseSessionId } = parsed;

			const sessionForUsage = getSessions().find((s) => s.id === baseSessionId);
			if (!sessionForUsage) return;

			const agentToolType = sessionForUsage.toolType;
			const contextPercentage = estimateContextUsage(usageStats, agentToolType);

			deps.batchedUpdater.updateUsage(actualSessionId, tabId, usageStats);
			deps.batchedUpdater.updateUsage(actualSessionId, null, usageStats);

			if (contextPercentage !== null) {
				deps.batchedUpdater.updateContextUsage(actualSessionId, contextPercentage);
			} else {
				const currentUsage = sessionForUsage.contextUsage ?? 0;
				if (currentUsage > 0) {
					const effectiveWindow =
						usageStats.contextWindow > 0
							? usageStats.contextWindow
							: agentToolType
								? (DEFAULT_CONTEXT_WINDOWS[
										agentToolType as keyof typeof DEFAULT_CONTEXT_WINDOWS
									] ?? 0)
								: 0;
					const estimated = estimateAccumulatedGrowth(
						currentUsage,
						usageStats.outputTokens,
						usageStats.cacheReadInputTokens || 0,
						effectiveWindow
					);
					const yellowThreshold = deps.contextWarningYellowThreshold;
					const maxEstimate = yellowThreshold - 5;
					deps.batchedUpdater.updateContextUsage(
						actualSessionId,
						Math.min(estimated, maxEstimate)
					);
				}
			}
			deps.batchedUpdater.updateCycleTokens(actualSessionId, usageStats.outputTokens);
		});

		return () => {
			unsubscribe();
		};
	}, [deps.batchedUpdater, deps.contextWarningYellowThreshold]);
}
