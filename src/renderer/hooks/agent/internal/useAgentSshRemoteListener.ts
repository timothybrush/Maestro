/**
 * useAgentSshRemoteListener — registers `window.maestro.process.onSshRemote`
 *
 * Stamps `sshRemote` info on the session. When a new remote attaches and the
 * session is not yet flagged as a git repo, fires an async `gitService.isRepo`
 * probe; if the probe succeeds, branches/tags are fetched against the remote
 * and the session's git refs are updated.
 *
 * Skips no-op renders when the same remote is already attached.
 */

import { useEffect } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { REGEX_AI_TAB } from '../../../utils/sessionIdParser';
import { gitService } from '../../../services/git';
import { logger } from '../../../utils/logger';

export function useAgentSshRemoteListener(): void {
	useEffect(() => {
		const setSessions = useSessionStore.getState().setSessions;
		const getSessions = () => useSessionStore.getState().sessions;

		const unsubscribe = window.maestro.process.onSshRemote?.(
			(sessionId: string, sshRemote: { id: string; name: string; host: string } | null) => {
				let actualSessionId: string;
				const aiTabMatch = sessionId.match(REGEX_AI_TAB);
				if (aiTabMatch) {
					actualSessionId = aiTabMatch[1];
				} else if (sessionId.endsWith('-ai') || sessionId.endsWith('-terminal')) {
					actualSessionId = sessionId.replace(/-ai$|-terminal$/, '');
				} else {
					actualSessionId = sessionId;
				}

				if (!getSessions().some((s) => s.id === actualSessionId)) return;

				setSessions((prev) =>
					prev.map((s) => {
						if (s.id !== actualSessionId) return s;
						const currentRemoteId = s.sshRemote?.id;
						const newRemoteId = sshRemote?.id;
						if (currentRemoteId === newRemoteId) return s;
						return {
							...s,
							sshRemote: sshRemote ?? undefined,
							sshRemoteId: sshRemote?.id,
						};
					})
				);

				if (sshRemote?.id) {
					const session = getSessions().find((s) => s.id === actualSessionId);
					if (session && !session.isGitRepo) {
						const remoteCwd = session.sessionSshRemoteConfig?.workingDirOverride || session.cwd;
						void (async () => {
							try {
								const isGitRepo = await gitService.isRepo(remoteCwd, sshRemote.id);
								if (isGitRepo) {
									const [gitBranches, gitTags] = await Promise.all([
										gitService.getBranches(remoteCwd, sshRemote.id),
										gitService.getTags(remoteCwd, sshRemote.id),
									]);
									const gitRefsCacheTime = Date.now();

									setSessions((prev) =>
										prev.map((s) => {
											if (s.id !== actualSessionId) return s;
											if (s.isGitRepo) return s;
											return {
												...s,
												isGitRepo: true,
												gitBranches,
												gitTags,
												gitRefsCacheTime,
											};
										})
									);
								}
							} catch (err) {
								logger.error(
									`[SSH] Failed to check git repo status for ${actualSessionId}:`,
									undefined,
									err
								);
							}
						})();
					}
				}
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, []);
}
