/**
 * useRemoteMaestroPAvailable.ts
 *
 * Resolve whether `maestro-p` is on the PATH of an SSH remote, so the Claude
 * Token Source selector can disable the TUI option (and default to API) when the
 * remote can't run it. The main process probes the remote (`command -v
 * maestro-p`) and caches the result; this hook fetches it on demand.
 *
 *   - `true`      maestro-p present on the remote
 *   - `false`     known-absent (disable the TUI option)
 *   - `undefined` unknown: not an SSH remote, still probing, or unreachable
 */

import { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';

/**
 * @param sshRemoteId The SSH remote id to probe, or null/undefined to skip
 *                    (local agent, or SSH not yet configured).
 */
export function useRemoteMaestroPAvailable(
	sshRemoteId: string | null | undefined
): boolean | undefined {
	const [available, setAvailable] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		if (!sshRemoteId) {
			setAvailable(undefined);
			return;
		}
		let stale = false;
		// Reset to "unknown" while the new remote is probed so a stale answer from
		// a previously-selected remote never leaks into the gating.
		setAvailable(undefined);
		void window.maestro.agents
			.getRemoteMaestroPAvailable(sshRemoteId)
			.then((result) => {
				if (!stale) {
					setAvailable(result ?? undefined);
				}
			})
			.catch((error: unknown) => {
				logger.error('Failed to probe remote maestro-p availability', undefined, error);
				if (!stale) {
					setAvailable(undefined);
				}
			});
		return () => {
			stale = true;
		};
	}, [sshRemoteId]);

	return available;
}
