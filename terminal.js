const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

module.exports = Terminal;

const defaultOpts = {
	enter: '\n',
	escape: '\x1b',
	backspace: '\x7f',
	del: '\x1b[3~'
};

Terminal.prototype = new EventEmitter();

function Terminal(el, opts) {
	EventEmitter.call(this);

	const self = this;

	opts = _.defaults({}, opts, defaultOpts);

	const darkColors = 'black darkred green olive darkblue purple teal silver'.split(/\s/g);
	const colors = 'black red lime yellow blue magenta cyan white'.split(/\s/g);
	const brightColors = 'gray lightcoral greenyellow khaki dodgerblue violet chartreuse white'.split(/\s/g);

	let cur = null;
	let blk = null;

	const defaultStyle = {
		fg: 7,
		bg: 0,
		bold: false,
		faint: false,
		standout: false,
		underline: false,
		blink: false,
		reverse: false,
		invisible: false
	};

	const style = {};

	let active = false;
	let enabled = false;

	let cursorEl;

	const grid = [];

	const input_buffer = [];
	let input_timer = null;

	const render_block_size = 400;
	const render_block_interval = 5;

	el.classList.add('termjs');

	el.addEventListener('focus', terminalFocus);
	el.addEventListener('blur', terminalFocus);
	el.addEventListener('keypress', terminalKeyPress);

	el.addEventListener('keydown', terminalKeyState);
	el.addEventListener('keyup', terminalKeyState);

	reset();

	this.reset = reset;
	this.clear = clear;
	this.write = write;
	this.enable = enable;
	this.disable = disable;
	this.writeLine = writeLine;
	return;

	function reset() {
		resetStyle();
		clear();
	}

	function encodeKey(key, ctrl) {
		if (ctrl) {
			if (key.match(/^[A-Za-z]$/)) {
				return String.fromCharCode(1 + key.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0));
			}
			switch (key) {
			case '[': return '\x1b';
			default:
				console.log('Unknown key: C-' + key);
				return null;
			}
		}
		if (key.length === 1) {
			return key;
		}
		switch (key) {
		case 'Escape': return opts.escape;
		case 'ArrowUp': return '\x1bOA';
		case 'ArrowDown': return '\x1bOB';
		case 'ArrowRight': return '\x1bOC';
		case 'ArrowLeft': return '\x1bOD';
		case 'Backspace': return opts.backspace;
		case 'Enter': return opts.enter;
		case 'Tab': return '\t';
		case 'Home': return '\x1b[1~';
		case 'Insert': return '\x1b[2~';
		case 'Delete': return opts.del;
		case 'End': return '\x1b[4~';
		case 'PageUp': return '\x1b[5~';
		case 'PageDown': return '\x1b[6~';
		default:
			console.log('Unknown key: ' + key);
			return null;
		}
	}

	function enable() {
		enabled = true;
		el.tabIndex = 0;
		updateCursor();
	}

	function disable() {
		enabled = false;
		el.tabIndex = -1;
		updateCursor();
	}

	function terminalKeyPress(e) {
		if (!enabled) {
			return false;
		}
		// console.log(e);
		if (e.altKey) {
			return false;
		}
		const key = encodeKey(e.key, e.ctrlKey);
		if (key === null) {
			return false;
		}
		self.emit('input', key);
		e.preventDefault();
		return true;
	}

	function terminalKeyState(e) {
		// return false;
		// if (!enabled) {
		// 	return false;
		// }
		// const key = encodeKey(e.key, e.ctrlKey);
		// if (key === null) {
		// 	return false;
		// }
		// #<{(| TODO: Chrome workarounds |)}>#
		// return true;
	}

	function terminalFocus(e) {
		active = e.type === 'focus';
		el.classList[active ? 'add' : 'remove']('active');
	}

	function createCursor() {
		if (cursorEl) {
			return;
		}
		cursorEl = document.createElement('span');
		cursorEl.classList.add('cursor');
		el.appendChild(cursorEl);
	}

	function updateCursor() {
		blk = blk || { x: cursorEl.offsetWidth, y: cursorEl.offsetHeight };
		cursorEl.style.left = blk.x * cur.x + 'px';
		cursorEl.style.top = blk.y * cur.y + 'px';
		cursorEl.scrollIntoView();
	}

	function clear() {
		cursorEl = null;
		el.innerHTML = '';
		grid.length = 0;
		createCursor();
		locate(0, 0);
		updateCursor();
	}

	function getLine(y, needed) {
		if (grid.length <= y) {
			if (needed) {
				grid.length = y + 1;
			} else {
				return null;
			}
		}
		const line = grid[y];
		if (line) {
			return line;
		}
		if (needed) {
			return (grid[y] = []);
		} else {
			return null;
		}
	}

	function setGrid(x, y, cell) {
		const line = getLine(y, true);
		if (line.length <= x) {
			line.length = x + 1;
		}
		if (line[x]) {
			deleteCell(line[x]);
		}
		line[x] = cell;
	}

	function getGrid(x, y) {
		const line = getLine(y, false);
		return line && line[x] || null;
	}

	function clearGrid(x, y) {
		const cell = getGrid(x, y);
		if (cell) {
			grid[y][x] = null;
			deleteCell(cell);
		}
	}

	function clearLineFrom(x, y, count) {
		const line = getLine(y);
		if (!line) {
			return;
		}
		const dead = line.splice(x, count || line.length);
		dead.forEach(cell => deleteCell(cell));
		if (line.length > x) {
			reflowLine(y, line);
		}
	}

	function clearScreenDown() {
		for (let y = cur.y; y < grid.length; y++) {
			clearLineFrom(0, y);
		}
		grid.splice(cur.y);
	}

	function clearLineRight() {
		clearLineFrom(cur.x, cur.y);
	}

	function clearLineLeft() {
		clearLineFrom(0, cur.y, cur.x);
	}

	function deleteRight(count) {
		clearLineFrom(cur.x, cur.y, count);
	}

	function deleteChars(count) {
		clearLineFrom(cur.x, cur.y, count);
	}

	function deleteCell(cell) {
		if (cell) {
			el.removeChild(cell);
		}
	}

	function addChar(c) {
		if (c === '\x1b') {
			c = '\u241b';
		}
		const css = [];
		const bgColors = colors;
		const fgColors = style.standout ? brightColors : style.faint ? darkColors : colors;
		const effBg = bgColors[style.reverse ? style.fg : style.bg];
		const effFg = style.invisible ? effBg : fgColors[style.reverse ? style.bg : style.fg];
		css.push('color: ' + effFg);
		css.push('background: ' + effBg);
		if (style.bold) {
			css.push('font-weight: bold');
		}
		if (style.underline) {
			css.push('text-decoration: underline');
		}
		if (style.blink) {
			css.push('animation: terminal-blink 1s linear infinite');
		}
		css.push('position: absolute');
		const ce = document.createElement('span');
		ce.style = css.join('; ');
		positionCell(cur.x, cur.y, ce);
		ce.innerHTML = c;
		el.appendChild(ce);
		setGrid(cur.x, cur.y, ce);
		move(1, 0);
	}

	function positionCell(x, y, cell) {
		if (!cell) {
			return;
		}
		cell.style.left = x * blk.x + 'px';
		cell.style.top = y * blk.y + 'px';
	}

	function reflowLine(y, line) {
		line.forEach((cell, x) => positionCell(x, y, cell));
	}

	function backspace() {
		if (cur.x === 0) {
			return;
		}
		clearLineFrom(cur.x - 1, cur.y, 1);
		move(-1, 0);
	}

	function insertSpace(count) {
		const line = getLine(cur.y, true);
		if (line.length <= cur.x) {
			line.length = cur.x + 1;
		}
		/* Some browsers don't support Array(length) constructor */
		const space = [];
		space.length = count;
		line.splice(cur.x, 0, ...space);
		reflowLine(cur.y, line);
	}

	function resetStyle() {
		_.assign(style, defaultStyle);
	}

	function colorCode(n) {
		switch (n) {
		case 0: return resetStyle();
		case 1: style.bold = true; return;
		case 2: style.faint = true; return;
		case 3: style.standout = true; return;
		case 4: style.underline = true; return;
		case 5: style.blink = true; return;
		case 7: style.reverse = true; return;
		case 8: style.invisible = true; return;
		case 10: style.invisible = true; return;
		case 22: style.bold = false; style.faint = false; return;
		case 23: style.standout = false; return;
		case 24: style.underline = false; return;
		case 25: style.blink = false; return;
		case 27: style.reverse = false; return;
		case 39: n = 37; break;
		case 49: n = 40; break;
		}
		if (n >= 30 && n < 38) {
			style.fg = n - 30;
			return;
		}
		if (n >= 40 && n < 48) {
			style.bg = n - 40;
			return;
		}
		if (n >= 90 && n < 98) {
			style.fg = n - 90;
			return;
		}
		if (n >= 100 && n < 108) {
			style.bg = n - 100;
			return;
		}
	}

	function locate(x, y) {
		cur = { x, y };
	}

	function move(dx, dy) {
		const x = cur.x + dx;
		const y = cur.y + dy;
		locate(x >= 0 ? x : 0, y >= 0 ? y : 0);
	}

	function bell() {
		self.emit('bell');
	}

	function addStr(s) {
		s.split('').forEach(c => addChar(c));
	}

	function writeSymbol(m) {
		if (m === '\x07') {
			return bell();
		}
		if (m === '\r') {
			return locate(0, cur.y);
		}
		if (m === '\n') {
			return move(0, 1);
		}
		if (m === '\t') {
			return move(((cur.x + 8) & ~7) - cur.x, 0);
		}
		if (m === '\x08') {
			return move(-1, 0);
		}
		if (m.length === 1) {
			return addChar(m);
		}
		const title = m.match(/^\x1b\]0;([^\x07]*)\x07$/);
		if (title) {
			return self.emit('title', title[1]);
		}
		const ansi = m.match(/^\x1b\[\??(\d*(?:;\d*)*)?([a-zA-Z])$/);
		if (ansi) {
			const char = ansi[2];
			const num = (ansi[1] || '').split(/;/g).map(s => +(s || 0));
			switch (ansi[2]) {
			case 'm': return num.length ? num.forEach(colorCode) : colorCode(0);
			case 'H': return locate(num.length >= 2 ? num[1] : 0, num.length >= 1 ? num[0] : 0);
			case 'g': return; /* Clear tab(s) */
			case 'c': return; /* Identify terminal */
			case 'd': return; /* ??? sl */
			case 'l': return; /* set mode */
			case 'h': return; /* reset mode */
			case 'r': return; /* restore mode */
			case 's': return; /* store mode */
			}
		}
		const ansi2 = m.match(/^\x1b\[\??(\d*)([a-zA-Z@])$/);
		if (ansi2) {
			const num = /^\d+$/.test(ansi2[1]) ? ansi2[1] : 1;
			const num0 = /^\d+$/.test(ansi2[1]) ? ansi2[1] : 0;
			switch (ansi2[2]) {
			case 'J': return clearScreenDown(), num === 2 && locate(0, 0);
			case 'K': return num === 2 ? clearLineLeft() : clearLineRight();
			case 'A': return move(0, -num);
			case 'B': return move(0, num);
			case 'C': return move(num, 0);
			case 'D': return move(-num, 0);
			case 'G': return move(-cur.x, 0);
			case 'P': return deleteChars(num);
			case '@': return insertSpace(num);
			}
		}
		const ansi3 = m.match(/^\x1b([a-zA-Z])$/);
		if (ansi3) {
			switch (ansi3[1]) {
			case 'D': return el.scrollTop -= blk.y;
			case 'M': return el.scrollTop += blk.y;
			case 'H': return; /* Set tab */
			}
		}
		const ansi4 = m.match(/^\x1b\(([a-zA-Z])$/);
		if (ansi4) {
			switch (ansi4[1]) {
			case '0': return;
			case 'A': return;
			case 'B': return;
			}
		}
		const ansi5 = m.match(/^\x1b\)([a-zA-Z])$/);
		if (ansi5) {
			switch (ansi5[1]) {
			case '0': return;
			case 'A': return;
			case 'B': return;
			}
		}
		if (m === '\x1b]R') {
			return reset();
		}
		return addStr(m);
	}

	function write(str) {
		if (!str) {
			return;
		}
		/* First section of regex based on regex found in ansi-regex module */
		const rx = /[\u001b\u009b][[()#;?]*([0-9]{1,4}(;[0-9]{0,4})*)?(O[a-z]|[0-9A-Za-z=><@])|\x1b\]0;[^\x07]*\x07|\x08|.|[\n\r\t]/g;
		let n = 0;
		let match;
		while ((match = rx.exec(str))) {
			if (match.index > n) {
				console.warn('Ignored data:', str.substr(n, match.index - n));
			}
			n = match.index + match[0].length;
			input_buffer.push(match[0]);
		}
		asyncRenderInput();
	}

	function asyncRenderInput() {
		if (input_timer) {
			return;
		}
		/* Don't use setInterval, we want a fixed delay between runs */
		input_timer = setTimeout(renderInputBlock, render_block_interval);
	}

	function renderInputBlock() {
		if (input_buffer.length === 0) {
			input_timer = null;
			updateCursor();
			return;
		}
		const chunk = input_buffer.splice(0, render_block_size);
		chunk.forEach(writeSymbol);
		input_timer = setTimeout(renderInputBlock, render_block_interval);
	}

	function writeLine(s) {
		write((cur.x > 0 ? '\r\n' : '') + s + '\r\n');
	}

}
