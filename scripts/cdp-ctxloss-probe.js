#!/usr/bin/env node
/* Throwaway: instrumented WebGL-context-loss probe for issue #1073 fix validation.
 * Attaches a Runtime console listener, forces a context loss on the terminal canvas,
 * then polls canvas count + collects console logs for a few seconds.
 * Prints: console lines mentioning WebGL/renderer, and canvas-count timeline.
 */
const WebSocket = require('ws');
const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:12345';

async function main() {
	const res = await fetch(`${CDP_HTTP}/json/list`);
	const targets = await res.json();
	const page = targets.find((t) => t.type === 'page' && t.url.includes('17173'));
	if (!page) throw new Error('Maestro page not found');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
	const consoleLines = [];
	const send = (method, params) =>
		new Promise((resolve, reject) => {
			const msgId = ++id;
			pending.set(msgId, { resolve, reject });
			ws.send(JSON.stringify({ id: msgId, method, params }));
		});
	ws.on('message', (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(JSON.stringify(msg.error)));
			else resolve(msg.result);
			return;
		}
		if (msg.method === 'Runtime.consoleAPICalled') {
			const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
			if (/webgl|renderer|context/i.test(text)) consoleLines.push(`[${msg.params.type}] ${text}`);
		}
	});
	await new Promise((r) => ws.on('open', r));
	await send('Runtime.enable', {});

	const countExpr = `document.querySelectorAll('canvas').length`;
	const evalVal = async (expr) => {
		const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
		return r.result.value;
	};

	const timeline = [];
	timeline.push(`t=0   canvases=${await evalVal(countExpr)}`);

	// Force the loss
	const lost = await evalVal(`(() => {
		let n=0;
		for (const c of document.querySelectorAll('canvas')) {
			const gl=c.getContext('webgl2')||c.getContext('webgl');
			if(gl){const e=gl.getExtension('WEBGL_lose_context'); if(e){e.loseContext(); n++;}}
		}
		return n;
	})()`);
	timeline.push(`loss fired on ${lost} context(s)`);

	for (const ms of [150, 400, 800, 1500, 2500]) {
		await new Promise((r) => setTimeout(r, ms === 150 ? 150 : ms - 150));
		timeline.push(`t=${ms} canvases=${await evalVal(countExpr)}`);
	}

	console.log('=== CONSOLE (webgl/renderer/context) ===');
	console.log(consoleLines.length ? consoleLines.join('\n') : '(none captured)');
	console.log('=== CANVAS TIMELINE ===');
	console.log(timeline.join('\n'));
	ws.close();
}
main().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
