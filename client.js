"use strict";
// IPC Server Component
// Copyright (c) 2017 Robert Dominy
// Released under the MIT License

/************************************************
	Internal request format:
	requests: {
		"rq3244": {
			callback: function,
			timestamp: 19134242535	
		}
	}
************************************************/

var net = require('net'),
	EventEmitter = require('events'),
	JSONStream = require('pixl-json-stream');

class IPCClient extends EventEmitter {
	constructor(path, logger=null, options={}) {
		super();
		this.path = path;
		this.stream = null;
		this.timer = null;
		this.requests = {};
		this.logger = logger;
		this.requestTimeout = options.requestTimeout ? options.requestTimeout : 10*1000 ;
		this.serialCounter = 0;
		this.expirationFrequency = options.expirationFrequency ? options.expirationFrequency : 5*1000;
		this.requestCount = 0; 
	}

	expireRequests() {
		if (this.requestCount>0) {
			var now = Date.now();
			for (var id in this.requests) {
				if (this.requests[id].timestamp+this.requestTimeout < now) {
					var request = this.requests[id];
					this.logError('request_timeout', "IPCClient request expired", request);
					request.callback('request_timeout');
					this.delete(id);
				}
			}
		}
	}

	logDebug(level, message, data='') {
		if (this.logger) {
			this.logger.debug(level, message, data);
		}
	}

	logError(code, message, data) {
		if (this.logger) {
			this.logger.error(code, message, data);
		}
	}

	handleIPCRequest(msg) {
		if (msg && msg.ipcReqID) {
			var request = this.requests[msg.ipcReqID];
			if (request) {
				this.deleteRequest(msg.ipcReqID);
				if (request.callback) {
					request.callback(null, msg.data);
				}
			}
			else {
				this.logError('ipc_req_not_found', 'Could not find request ID' + msg.ipcReqID + ' in request list', msg);
			}
		}
		else {
			// Emit unhandled messages sent from server in case client wants to handle
			this.emit('data', msg);
			this.logDebug(8, 'Server message with no request ID', msg);
		}
	}

	nextID() {
		return "rq" + this.serialCounter++;
	}

	deleteRequest(id) {
		delete this.requests[id];
		this.requestCount--;
	}

	//
	// Public Methods
	//

	connect(callback) {
		var self = this;
		var callbackHandled = false;

		var client = net.createConnection(this.path, function(arg) {
			self.logDebug(8, "connection created", arg);

			self.stream = new JSONStream( client );

			self.stream.on('json', function(data) {
				// received data from server
				//self.logDebug(9,"Got data from server: ", data);

				self.handleIPCRequest(data);
			} );

			self.stream.on('error', function(err) {
				self.logError('stream_err',"Got error from stream: ", err);
			} );
			
			self.timer = setInterval(self.expireRequests.bind(self), self.expirationFrequency);

			callbackHandled = true;
			callback();
		});
		
		client.on('error', function(err) {
			self.logError('ipc_socket_err','Unexpected socket error', err);
			
			// This error handler will get invoked on the initial createConnection 
			// for a bad socket path, so need to handle the callback
			if (!callbackHandled) {
				callbackHandled = true;
				callback('ipc_socket_err');
			}
		});

		client.on('end', function() {
			self.logDebug(8,'server disconnected');
			if (self.timer) {
				clearInterval(self.timer);
				self.timer = null;
			}
		});

	}

	send(uri, data, callback=null) {
		if (this.stream) {
			var msg = {
				ipcReqID: this.nextID(),
				uri: uri,
				data: data,
				pid: process.pid
			};

			this.requests[msg.ipcReqID] = {
				callback: callback,
				timestamp: Date.now()
			};
			this.requestCount++;
			this.stream.write(msg);
		}
		else {
			this.logError('no_open_stream', 'No valid stream is open');
			callback('no_open_stream');
		}
	}

}

module.exports = IPCClient;
