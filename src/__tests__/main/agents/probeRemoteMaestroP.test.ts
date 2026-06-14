import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SSH plumbing so the probe never touches a real network.
const execFileNoThrow = vi.fn();
vi.mock('../../../main/utils/execFile', () => ({
	execFileNoThrow: (...args: unknown[]) => execFileNoThrow(...args),
}));
vi.mock('../../../main/utils/ssh-command-builder', () => ({
	buildSshCommand: vi
		.fn()
		.mockResolvedValue({ command: 'ssh', args: ['host', 'command -v maestro-p'] }),
}));

import {
	probeRemoteMaestroP,
	ensureRemoteMaestroPProbed,
} from '../../../main/agents/probeRemoteMaestroP';
import {
	getRemoteMaestroPAvailable,
	__clearRemoteMaestroPCache,
} from '../../../main/agents/remoteMaestroPCache';
import type { SshRemoteConfig } from '../../../shared/types';

const remote: SshRemoteConfig = {
	id: 'remote-1',
	name: 'Test',
	host: 'example.com',
	port: 22,
	username: '',
	privateKeyPath: '',
	enabled: true,
};

describe('probeRemoteMaestroP', () => {
	beforeEach(() => {
		__clearRemoteMaestroPCache();
		execFileNoThrow.mockReset();
	});

	it('caches true when maestro-p is found (exit 0 with a path)', async () => {
		execFileNoThrow.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/maestro-p\n', stderr: '' });
		const r = await probeRemoteMaestroP(remote);
		expect(r).toBe(true);
		expect(getRemoteMaestroPAvailable('remote-1')).toBe(true);
	});

	it('caches false when maestro-p is absent (non-zero / empty output)', async () => {
		execFileNoThrow.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });
		const r = await probeRemoteMaestroP(remote);
		expect(r).toBe(false);
		expect(getRemoteMaestroPAvailable('remote-1')).toBe(false);
	});

	it('returns null and leaves the cache unknown on a connection error', async () => {
		execFileNoThrow.mockResolvedValue({
			exitCode: 255,
			stdout: '',
			stderr: 'ssh: connect to host example.com port 22: Connection refused',
		});
		const r = await probeRemoteMaestroP(remote);
		expect(r).toBeNull();
		expect(getRemoteMaestroPAvailable('remote-1')).toBeUndefined();
	});
});

describe('ensureRemoteMaestroPProbed', () => {
	beforeEach(() => {
		__clearRemoteMaestroPCache();
		execFileNoThrow.mockReset();
	});

	it('probes once on a cold cache, then serves the cached result without re-probing', async () => {
		execFileNoThrow.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });
		const first = await ensureRemoteMaestroPProbed(remote);
		expect(first).toBe(false);
		expect(execFileNoThrow).toHaveBeenCalledTimes(1);

		// Fresh cache: no second probe.
		const second = await ensureRemoteMaestroPProbed(remote);
		expect(second).toBe(false);
		expect(execFileNoThrow).toHaveBeenCalledTimes(1);
	});
});
