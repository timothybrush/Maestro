/**
 * Probe an SSH remote for `maestro-p` on its PATH.
 *
 * The result feeds {@link remoteMaestroPCache}, which two surfaces read:
 *   - `AgentConfigPanel` (via the `agents:getRemoteMaestroPAvailable` IPC)
 *     disables the TUI token-source option when maestro-p is absent;
 *   - `resolveClaudeSpawnMode` falls a remote TUI spawn back to API when it's
 *     known-absent, so a misconfigured agent runs `claude --print` instead of
 *     exiting 127 on a `maestro-p` that isn't there.
 *
 * The agent-readiness probe (`detectAgentsRemote`) calls {@link probeRemoteMaestroP}
 * to piggyback on its connection; the spawn surfaces call
 * {@link ensureRemoteMaestroPProbed} so the cache is warm even when no readiness
 * probe or config modal ran first (the cold-cache first-spawn case).
 */

import { buildSshCommand, RemoteCommandOptions } from '../utils/ssh-command-builder';
import { execFileNoThrow } from '../utils/execFile';
import { stripAnsi } from '../utils/stripAnsi';
import { logger } from '../utils/logger';
import type { SshRemoteConfig } from '../../shared/types';
import {
	setRemoteMaestroPAvailable,
	getRemoteMaestroPAvailable,
	isRemoteMaestroPProbeStale,
} from './remoteMaestroPCache';

const LOG_CONTEXT = 'ProbeRemoteMaestroP';
const SSH_TIMEOUT_MS = 10000;

/**
 * Run `command -v maestro-p` on the remote and cache the result keyed by the
 * remote id. Returns the availability, or `null` when the probe could not
 * determine it (connection error / timeout) so the cache stays "unknown" rather
 * than caching a false on a flaky network.
 */
export async function probeRemoteMaestroP(sshRemote: SshRemoteConfig): Promise<boolean | null> {
	const remoteOptions: RemoteCommandOptions = {
		command: 'command',
		args: ['-v', 'maestro-p'],
	};

	try {
		const sshCommand = await buildSshCommand(sshRemote, remoteOptions);
		const resultPromise = execFileNoThrow(sshCommand.command, sshCommand.args);
		const timeoutPromise = new Promise<{ exitCode: number; stdout: string; stderr: string }>(
			(_, reject) => {
				setTimeout(
					() => reject(new Error(`SSH connection timed out after ${SSH_TIMEOUT_MS / 1000}s`)),
					SSH_TIMEOUT_MS
				);
			}
		);
		const result = await Promise.race([resultPromise, timeoutPromise]);

		// A connection-level failure tells us nothing about maestro-p - leave it
		// unknown so we don't disable the TUI option on a flaky network.
		if (
			result.stderr &&
			(result.stderr.includes('Connection refused') ||
				result.stderr.includes('Connection timed out') ||
				result.stderr.includes('No route to host') ||
				result.stderr.includes('Could not resolve hostname') ||
				result.stderr.includes('Permission denied'))
		) {
			logger.warn(
				`SSH connection error probing maestro-p on ${sshRemote.host}: ${result.stderr.trim().split('\n')[0]}`,
				LOG_CONTEXT
			);
			return null;
		}

		const cleanedOutput = stripAnsi(result.stdout).trim();
		const available = result.exitCode === 0 && cleanedOutput.length > 0;
		setRemoteMaestroPAvailable(sshRemote.id, available);
		logger.info(
			`maestro-p ${available ? `found on remote at: ${cleanedOutput.split('\n')[0]}` : 'not found on remote'} (${sshRemote.host})`,
			LOG_CONTEXT
		);
		return available;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.warn(
			`Failed to probe maestro-p on remote ${sshRemote.host}: ${errorMessage}`,
			LOG_CONTEXT
		);
		return null;
	}
}

/**
 * Ensure the remote maestro-p availability is cached and fresh before a spawn
 * reads it. Returns the cached value untouched when still fresh; otherwise runs
 * a probe and returns its result. Used at the spawn surfaces (desktop turn, Cue,
 * group chat) so the resolver's TUI->API backstop fires on the very first spawn,
 * before any readiness probe or config modal warmed the cache.
 */
export async function ensureRemoteMaestroPProbed(
	sshRemote: SshRemoteConfig
): Promise<boolean | undefined> {
	if (!isRemoteMaestroPProbeStale(sshRemote.id)) {
		return getRemoteMaestroPAvailable(sshRemote.id);
	}
	const probed = await probeRemoteMaestroP(sshRemote);
	// A null probe (couldn't determine) leaves the cache unknown; reflect that.
	return probed ?? getRemoteMaestroPAvailable(sshRemote.id);
}
