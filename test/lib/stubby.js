"use strict";
const assert = require('assert');

class Stubby {
	constructor() {
		this.reset();
		this.echo = false;
	}

	reset() {
		this.writeCount = 0;
		this.errorCount = 0;
		this.lastWrite = null;
		this.lastError = null;
		this.debugLog = '';
	}

	// Logger Stubs
	print(obj) {
		this.writeCount++;
		this.lastWrite = obj;
	}

	debug(level, message, details) {
		if (this.echo) {
			console.log("DEBUG[" + level + "]" + message);
			if (typeof details != "undefined") {
				console.log(details);
			}
		}
		this.debugLog += '[' + level + ']' + '[' + message + ']' + '[' + ((details) ? JSON.stringify(details) : '') + ']\n';
	}

	error(code, msg) {
		if (this.echo) {
			console.error("ERROR[" + code + "]" + msg);
		}
		this.lastError = {
			code: code,
			message: msg
		};
		this.errorCount++;
	}

	shouldLog() {
		return true;
	}

	set() {
	}
}
module.exports = Stubby;
