"use strict";
// IPC Server Component
// Copyright (c) 2017 Robert Dominy
// Released under the MIT License

const net = require('net'),
	fs = require('fs'),
	async = require('async'),
	Component = require("pixl-server/component"),
	PixlPerf = require('pixl-perf'),
	JSONStream = require('pixl-json-stream');

class IPCServer extends Component {
	constructor() {
		super();
		this.__name = "IPCServer";
		this.defaultConfig = {
			exit_timeout: 2000,
			log_stats_interval: 'minute',
			socket_chmod: '777',
			slow_threshold_ms: 20  // Threshold at which we count the response as slow in stats 
		};
		this.uriHandlers = [];
		this.unixServer = null;
		this.connections = new Set();
		this.streamPerf = new PixlPerf();
		this.streamPerf.begin();
 		this.intervalStats = this.newIntervalStats();
		this.lastCycleStats = this.newIntervalStats();  // Keep a full cycle of stats that can be fetched
		this.statsIntervalStart = Date.now();
		
		this.setDefaultHandler(this.noHandlerFound.bind(this));
	}
	
	newIntervalStats() {
		return {
			requests: 0,
			clientOpen: 0,
			clientClose: 0,
			maxConnections: 0,
			duration: 0,
			slowResponses: 0,
			streamBackpressure: 0
		};
	}
	
	cycleIntervalStats(duration) {
		this.streamPerf.end();
		let stats = this.streamPerf.metrics();
		this.intervalStats.streamBackpressure =  (stats.counters.json_stream_write_buffer) ? stats.counters.json_stream_write_buffer:0;
		
		this.lastCycleStats = Object.assign({}, this.intervalStats);
		this.lastCycleStats.duration = duration;
		this.intervalStats = this.newIntervalStats();
		this.streamPerf.reset();
		this.streamPerf.begin();
	}

	cleanup() {
		try { fs.unlinkSync(this.config.get("socket_path")); } catch(e) {
			// ignore
		}
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
			self.intervalStats.clientOpen++;
			self.intervalStats.maxConnections = Math.max(self.intervalStats.maxConnections, self.connections.size);
			
			connection.on('end', function() {
				self.connections.delete(this);
				self.intervalStats.clientClose++;
				self.logDebug(8,'client disconnected');
			});

			connection.on('error', function(err) {
				self.logError('client_socket_err','Unexpected socket error', err);
			});

			stream = new JSONStream( connection );

			stream.on('json', function(data) {
				// received data from child
				self.logDebug(9,"Data from client", data);
				self.intervalStats.requests++;
				self.handleIPCRequest(data, stream);
			} );

			stream.on('error', function(err) {
				self.logError('stream_err',"Got error from stream: ", err);
			} );
			
			stream.setPerf(self.streamPerf);
		});

		this.unixServer.on('error', function(err) {
			self.logError('ipc_server_err', JSON.stringify(err));
		});

		
		this.unixServer.listen(sock_path, function() {
			var chmod = self.config.get("socket_chmod");
			if (chmod && (chmod!='')) {
				fs.chmodSync(sock_path, chmod);
			}
			
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
			var ipcReqID = request.ipcReqID ? request.ipcReqID : null;
			stream.write({ipcReqID: ipcReqID, code: 'no_uri', message:'Missing required uri parameter from request'});
		}
		else {
			let startTime = Date.now();
			let self = this;
			
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
				
				let elapsed =  Date.now() - startTime;
				if (elapsed > self.config.get('slow_threshold_ms')) {
					self.intervalStats.slowResponses++;
				}
			});
		}

	}

	logIntervalStats() {
		var now = Date.now();
		this.cycleIntervalStats(now - this.statsIntervalStart);
		this.statsIntervalStart = now;
		this.logDebug(5, "IPCServer Stats", this.getStats());
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
		this.logDebug(5, "IPC Server startup");
		this.cleanup();
		this.createIPCServer();

		this.addURIHandler(/^\/ipcserver\/test\/echo/, "IPCServer", this.echoHandler.bind(this));
		this.addURIHandler(/^\/ipcserver\/test\/delay/, "IPCServer", this.delayHandler.bind(this));
		
		if (this.config.get("log_stats_interval")) {
			this.server.on(this.config.get("log_stats_interval"), this.logIntervalStats.bind(this));
		}
		
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
		var statsmerge = {
			connections: this.connections.size,
			handlers: this.uriHandlers.length
		};
		
		return Object.assign(statsmerge, this.lastCycleStats);
	}
}

module.exports = IPCServer;
