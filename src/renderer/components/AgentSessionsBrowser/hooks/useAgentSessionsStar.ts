import { useState, useCallback } from 'react';
import type { Session } from '../../../types';

interface UseAgentSessionsStarArgs {
	activeSession: Session | undefined;
	agentId: string;
	onUpdateTab?: (
		agentSessionId: string,
		updates: { name?: string | null; starred?: boolean }
	) => void;
}

export function useAgentSessionsStar({
	activeSession,
	agentId,
	onUpdateTab,
}: UseAgentSessionsStarArgs): {
	starredSessions: Set<string>;
	setStarredSessions: React.Dispatch<React.SetStateAction<Set<string>>>;
	toggleStar: (sessionId: string, e: React.MouseEvent) => Promise<void>;
} {
	const [starredSessions, setStarredSessions] = useState<Set<string>>(new Set());

	const toggleStar = useCallback(
		async (sessionId: string, e: React.MouseEvent) => {
			e.stopPropagation();

			const newStarred = new Set(starredSessions);
			const isNowStarred = !newStarred.has(sessionId);
			if (isNowStarred) {
				newStarred.add(sessionId);
			} else {
				newStarred.delete(sessionId);
			}
			setStarredSessions(newStarred);

			if (activeSession?.projectRoot) {
				if (agentId === 'claude-code') {
					await window.maestro.claude.updateSessionStarred(
						activeSession.projectRoot,
						sessionId,
						isNowStarred
					);
				} else {
					await window.maestro.agentSessions.setSessionStarred(
						agentId,
						activeSession.projectRoot,
						sessionId,
						isNowStarred
					);
				}
			}

			onUpdateTab?.(sessionId, { starred: isNowStarred });
		},
		[starredSessions, activeSession?.projectRoot, agentId, onUpdateTab]
	);

	return { starredSessions, setStarredSessions, toggleStar };
}
