"use strict";
// IPC Server Component
// Copyright (c) 2017 Robert Dominy
// Released under the MIT License

/************************************************
	Internal request format:
	requests: {
		"rq3244": {
			callback: function,
			timer: setTimeout() result
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
		this.requests = {};
		this.logger = logger;
		this.requestTimeout = options.requestTimeout ? options.requestTimeout : 10*1000 ;
		this.userAgent = options.userAgent ? options.userAgent : "Node/IPCClient" + process.cwd();
		this.serialCounter = 0;
		this.autoReconnect = (typeof options.autoReconnect == 'undefined') ? 1000 : options.autoReconnect;
		var defaultTransform = (options.codeToErr) ? this.codeToErr.bind(this) : null;
		this.messageTransform = (options.messageTransform) ? options.messageTransform : defaultTransform;
		this.requestCount = 0;
	}
	
	codeToErr(msg) {
		var err = null;
		if (msg.code) {
			err = msg;
		}
		else if (msg.data && msg.data.code) {
			err = msg.data;
		}	
		return [err, msg.data];
	}

	expireRequests() {
		if (this.requestCount>0) {
			var now = Date.now();
			for (var id in this.requests) {
				if (this.requests[id].timestamp+this.requestTimeout < now) {
					var request = this.requests[id];
					this.logError('request_timeout', "IPCClient request expired", request);
					request.callback('request_timeout');
					this.deleteRequest(id);
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
			var err = null;
			var data = msg.data;
			if (this.messageTransform) {
				[err, data] = this.messageTransform(msg);
			}
			if (request) {
				this.deleteRequest(msg.ipcReqID);
				if (request.callback) {
					request.callback(err, data);
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
		if (this.requests[id].timer)
			clearTimeout(this.requests[id].timer);
		delete this.requests[id];
		this.requestCount--;
	}
	
	reconnect(err) {
		if (err && this.autoReconnect) {
			this.logDebug(5, "Auto reconnect in " + this.autoReconnect + " ms");
			setTimeout(this.connect.bind(this, this.reconnect.bind(this)), this.autoReconnect);
		}
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
			else {
				// The error occurred sometime after the initial connection, attempt to reconnect
				self.stream = null;
				self.reconnect(err);
			}
		});

		client.on('end', function() {
			self.logDebug(8,'server disconnected');
			for (let id in self.requests)
				self.deleteRequest(id);
		});

	}


	send(uri, data, callback=null) {
		if (this.stream) {
			var msg = {
				ipcReqID: this.nextID(),
				uri: uri,
				data: data,
				pid: process.pid,
				userAgent: this.userAgent
			};

			this.requests[msg.ipcReqID] = {
				callback: callback,
				timer: setTimeout(this.handleTimeout.bind(this), this.requestTimeout, msg.ipcReqID)
			};
			this.requestCount++;
			this.stream.write(msg);
		}
		else {
			this.logError('no_open_stream', 'No valid stream is open');
			callback('no_open_stream');
		}
	}

	handleTimeout(id){
		var request = this.requests[id];
		if (request){
			this.logError('request_timeout', "IPCClient request expired", request);
			request.callback('request_timeout');
			this.deleteRequest(id);
		}
	}

}

module.exports = IPCClient;
