import { useCallback, useState } from 'react';
import { logger } from '../../../utils/logger';

export interface UseProcessKillResult {
	isKilling: boolean;
	kill: (processSessionId: string, cueRunId?: string) => Promise<void>;
}

// Owns the kill IPC dispatch.
// - Routes to window.maestro.cue.stopRun(cueRunId) when a Cue run ID is supplied.
// - Falls back to window.maestro.process.kill(processSessionId) for everything else.
// - Calls refresh() after dispatch (success OR failure) so the UI reflects reality.
//
// onSettled fires after the kill resolves so the shell can clear its kill-confirm state
// regardless of which branch executed (success or thrown error).
export function useProcessKill(
	refresh: () => Promise<void>,
	onSettled?: () => void
): UseProcessKillResult {
	const [isKilling, setIsKilling] = useState(false);

	const kill = useCallback(
		async (processSessionId: string, cueRunId?: string) => {
			setIsKilling(true);
			try {
				if (cueRunId) {
					await window.maestro.cue.stopRun(cueRunId);
				} else {
					await window.maestro.process.kill(processSessionId);
				}
				await refresh();
			} catch (error) {
				logger.error('Failed to kill process:', undefined, error);
			} finally {
				setIsKilling(false);
				onSettled?.();
			}
		},
		[refresh, onSettled]
	);

	return { isKilling, kill };
}
