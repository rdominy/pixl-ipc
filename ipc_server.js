"use strict";
// IPC Server Component
// Copyright (c) 2017 Robert Dominy
// Released under the MIT License


// TODO: add user-agent in clients

const net = require('net'),
	fs = require('fs'),
	async = require('async'),
	Component = require("pixl-server/component"),
	JSONStream = require('pixl-json-stream');

class IPCServer extends Component {
	constructor() {
		super();
		this.__name = "IPCServer";
		this.defaultConfig = {
			exit_timeout: 2000
		};
		this.uriHandlers = [];
		this.unixServer = null;
		this.connections = new Set();

		this.setDefaultHandler(this.noHandlerFound.bind(this));
	}

	cleanup() {
		try { fs.unlinkSync(this.config.get("socket_path")); } catch(e) {}
	}

	closeConnections() {
		this.connections.forEach(function(connection) {
			connection.unref();
			connection.end();
		});
		this.connections.clear();
	}

	createIPCServer() {
		var self = this;
		var sock_path = this.config.get("socket_path");

		this.unixServer = net.createServer(function(connection) {
			var stream = null;
			
			self.logDebug(8,'client connected');
			self.connections.add(connection);

			connection.on('end', function() {
				self.connections.delete(this);
				self.logDebug(8,'client disconnected');
			});

			connection.on('error', function(err) {
				self.logError('client_socket_err','Unexpected socket error', err);
			});

			stream = new JSONStream( connection );

			stream.on('json', function(data) {
				// received data from child
				self.logDebug(9,"Data from client", data);
				self.handleIPCRequest(data, stream);
			} );

			stream.on('error', function(err) {
				self.logError('stream_err',"Got error from stream: ", err);
			} );
		});

		this.unixServer.on('error', function(err) {
			self.logError('ipc_server_err', JSON.stringify(err));
		});

		this.unixServer.listen(sock_path, function() {
			self.logDebug(5,"IPCServer Listening on:", sock_path);
		});
	}

	noHandlerFound(request, callback) {
		this.logError('no_handler_found', 'No handler found for request', request);
		callback({code: 'no_handler_found', message: 'No handler found for ' + request.uri});
	}

	handleIPCRequest(request, stream) {
		if (!request.uri) {
			this.logError('no_uri', 'Request missing uri', request);
			stream.write({code: 'no_uri', message:'Missing required uri parameter from request'});
		}
		else {
			var handler = this.uriHandlers.find(function(item) {
				return item.regexp.test(request.uri);
			});
			if (!handler) {
				handler = this.defaultHandler;
			}
			

			this.logDebug(7, "Request " + request.uri + " handled by:" + handler.name);
			handler.callback(request, function(data) {
				// Preserve ID in response so the client can match to request
				var response = {
					ipcReqID: request.ipcReqID ? request.ipcReqID : null,
					data: data
				};
				
				stream.write(response);
			});
		}

	}

	echoHandler(request, callback) {
		callback(request.data);
	}

	delayHandler(request, callback) {
		if (request.data.delay) {
			setTimeout(function() {
				callback({delay: request.data.delay});
			}, request.data.delay);
		}
		else {
			callback({delay: 0});
		}
	}

	//
	// Component overrides
	//

	startup(callback) {
		this.logDebug(5,"IPC Server startup");
		this.cleanup();
		this.createIPCServer();

		this.addURIHandler(/^\/ipcserver\/test\/echo/, "IPCServer", this.echoHandler.bind(this))
		this.addURIHandler(/^\/ipcserver\/test\/delay/, "IPCServer", this.delayHandler.bind(this))
		callback();
	}

	shutdown(callback) {
		var self = this;
		var exitTimeout = this.config.get("exit_timeout");
		this.logDebug(5,"IPC Server shutdown, with timeout set to: " + exitTimeout);
		
		if (this.unixServer) {
			this.closeConnections();
			this.unixServer.unref();
			
			// Try to gracefully close the server, but bail if it gets stuck on a connection 
			var timeoutClose = async.timeout(this.unixServer.close.bind(this.unixServer), exitTimeout);
			timeoutClose(function(err) {
				if (err) {
					self.logError('ipc_server_close', err);
				}
				self.cleanup();
				callback();
			});
		}
		else {
			this.cleanup();
			callback();
		}
	}

	//
	// Public methods
	//

	addURIHandler(uri, name, callbackHandler) {
		if (typeof(uri) == 'string') {
			uri = new RegExp("^" + uri + "$");
		}

		this.uriHandlers.push({
			regexp: uri,
			name: name,
			callback: callbackHandler
		});
	}

	setDefaultHandler(callbackHandler) {
		this.defaultHandler = {
			regexp: null,
			name: 'DefaultHandler',
			callback: callbackHandler
		}
	}
	
	getStats() {
		return {
			connections: this.connections.size,
			handlers: this.uriHandlers.length
		};
	}
}

module.exports = IPCServer;
