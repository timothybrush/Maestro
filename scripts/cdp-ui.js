#!/usr/bin/env node
/* Throwaway CDP UI driver: real mouse clicks + key chords + probes in one
 * session against the live Maestro dev page. Used to validate the FilePreview
 * Cmd+E toggle focus behavior.
 *
 * Step grammar (argv[2] = file, one step per line):
 *   click <x> <y>             real mouse click at viewport coords
 *   key <name> [meta|ctrl|alt|shift ...]
 *   wait <ms>
 *   eval <js-expression>      Runtime.evaluate; prints JSON result
 *   shot <path.png>
 */
const WebSocket = require('ws');
const fs = require('fs');

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:12345';

function modBits(mods) {
	let m = 0;
	for (const x of mods) {
		if (x === 'alt') m |= 1;
		if (x === 'ctrl') m |= 2;
		if (x === 'meta') m |= 4;
		if (x === 'shift') m |= 8;
	}
	return m;
}

async function main() {
	const file = process.argv[2];
	const steps = fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'));

	const res = await fetch(`${CDP_HTTP}/json/list`);
	const targets = await res.json();
	const page = targets.find((t) => t.type === 'page' && t.url.includes('17173'));
	if (!page) throw new Error('Maestro dev page not found');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
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
		}
	});
	await new Promise((r) => ws.on('open', r));
	await send('Page.enable', {});
	await send('Runtime.enable', {});
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	for (const step of steps) {
		const [cmd, ...rest] = step.split(' ');
		if (cmd === 'wait') {
			await sleep(parseInt(rest[0], 10));
		} else if (cmd === 'shot') {
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			fs.writeFileSync(rest[0], Buffer.from(shot.data, 'base64'));
			console.log('shot', rest[0]);
		} else if (cmd === 'click' || cmd === 'dblclick') {
			const x = parseInt(rest[0], 10);
			const y = parseInt(rest[1], 10);
			const clicks = cmd === 'dblclick' ? 2 : 1;
			for (let c = 1; c <= clicks; c++) {
				for (const type of ['mousePressed', 'mouseReleased']) {
					await send('Input.dispatchMouseEvent', {
						type,
						x,
						y,
						button: 'left',
						clickCount: c,
						buttons: type === 'mousePressed' ? 1 : 0,
					});
				}
			}
			console.log(cmd, x, y);
		} else if (cmd === 'key') {
			const name = rest[0];
			const mods = rest.slice(1);
			const modifiers = modBits(mods);
			const KEY_DEFS = {
				Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
				Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
			};
			const def = KEY_DEFS[name] || {
				key: name,
				code: 'Key' + name.toUpperCase(),
				keyCode: name.toUpperCase().charCodeAt(0),
			};
			await send('Input.dispatchKeyEvent', {
				type: 'keyDown',
				modifiers,
				key: def.key,
				code: def.code,
				windowsVirtualKeyCode: def.keyCode,
				nativeVirtualKeyCode: def.keyCode,
			});
			await send('Input.dispatchKeyEvent', {
				type: 'keyUp',
				modifiers,
				key: def.key,
				code: def.code,
				windowsVirtualKeyCode: def.keyCode,
				nativeVirtualKeyCode: def.keyCode,
			});
			console.log('key', name, mods.join('+'));
		} else if (cmd === 'eval') {
			const expr = rest.join(' ');
			const r = await send('Runtime.evaluate', {
				expression: expr,
				returnByValue: true,
			});
			console.log('eval =>', JSON.stringify(r.result.value));
		}
	}
	ws.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
