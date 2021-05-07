"use strict";

const assert = require("assert"),
	fs = require("fs"),
	child_process = require('child_process'),
	IPCClient = require('../client'),
	Stubby = require('./lib/stubby.js'),
	createSizedMessage = require('./lib/sized-message.js'),
	PixlServer = require('pixl-server');

const SOCKET_PATH = "/var/tmp/node_ipc_unittest_server.sock";

var config = {
		"debug": true,
		"log_dir": "/var/tmp/",
		"log_filename": "ipc_unittest.log",
		"debug_level": 9,
		
		"IPCServer" : {
			"socket_path" : SOCKET_PATH
		}
};

function cleanup() {
	try { fs.unlinkSync(config.log_dir + config.log_filename) } 
	catch(e) {
		// Ignore
	}
}

class ClientSubclass extends IPCClient {
	constructor(path, logger, options) {
		super(path, logger, options);
		this.sendCount = 0;
	}
	
	
	send(uri, data, callback) {
		this.sendCount++;
		super.send(uri, data, callback);
	}
}

class ClientSubclassAsync extends IPCClient {
	constructor(path, logger, options) {
		super(path, logger, options);
		this.sendCount = 0;
	}
	
	
	send(uri, data) {
		this.sendCount++;
		return super.send(uri, data);
	}
}

function createServer(config, callback) {
	var server = new PixlServer({
			__name: 'IPCTestServer',
			__version: "0.1",
			
			config: config,
			
			components: [require('..')]
	});
	
	server.startup(function() {
		assert(server.IPCServer, "IPCServer member not found in server object");
		var stats = server.IPCServer.getStats();
		assert(stats);
		assert.equal(stats.connections, 0);
		assert.equal(stats.handlers, 2);
		setImmediate(function() {
			callback(null, server);
		});
	});
}




var clientStubby = new Stubby();

describe('PixlIPC', function() {
	describe('Node client error conditions', function() {
		it('responds with error on a bad socket', function(done) {
			clientStubby.reset();
			var client = new IPCClient('/tmp/nosuch_server_unittest.sock', clientStubby);
			client.connect(function(err) {
				assert(err);
				assert.equal(clientStubby.errorCount, 1);
				client.send('/myapi/test', {message:"foo"}, function(err, _result) {
					assert(err);
					assert.equal(clientStubby.errorCount, 2);
					done();
				});
			});
		})
		it('responds with error when no connection present', function(done) {
			clientStubby.reset();
			var client = new IPCClient(SOCKET_PATH, clientStubby);
			client.send('/myapi/test', {message:"foo"}, function(err, _result) {
				assert(err);
				assert.equal(clientStubby.errorCount, 1);
				done();
			});
		})
	})
	
	
	
	describe('IPC Server with node client', function() {
		var server = null;
		var handlerCallCount = 0;
		var testClient = null;

		before('create server', function(done) {
			clientStubby.reset();
			this.timeout(5000);
			createServer(config, function(err, serverObj) {
				assert(!err);
				assert(serverObj);
				server = serverObj;
				done();
			});
		})
		after('shutdown server', function(done) {
			server.shutdown(function() {
				cleanup();
				if (testClient) {
					testClient.close(done);
				}
				else
					done();
			});
		})
		it('registers a handler', function(done) {
			server.IPCServer.addURIHandler(/^\/myapi\/test/, "IPCServer", function(request, callback) {
				assert(request);
				assert(request.data);
				assert.equal(request.data.message, "foo");
				assert.equal(request.pid, process.pid);
				assert(request.data.uaTest);
				var userAgentRegex = new RegExp(request.data.uaTest);
				assert(userAgentRegex.test(request.userAgent), "unexpected userAgent:" + request.userAgent);
				handlerCallCount++;
				callback({"hello":"thanks"});
			});
			var stats = server.IPCServer.getStats();
			assert.equal(stats.handlers, 3);
			done();
		})
		it('client connects', function(done) {
			testClient = new IPCClient(SOCKET_PATH, clientStubby, {logStatsInterval: 100});
			testClient.connect(function(err) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				done();
			});
		})
		it('sends message to test handler', function(done) {
			testClient.send('/myapi/test', {message:"foo", uaTest:"^Node/IPCClient.+"}, function(err, result) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				assert(result);
				assert(result.hello);
				assert.equal(result.hello, "thanks");
				assert.equal(handlerCallCount, 1);
				done();
			});
		})			
		it('sends an echo message to server', function(done) {
			testClient.send('/ipcserver/test/echo', {message:"foo",echo:true,bar:9}, function(err, result) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				assert(result);
				assert(result.message);
				assert.equal(result.message, "foo");
				assert.equal(result.echo, true);
				assert.equal(result.bar, 9);
				done();
			});				
		})
		it('sends a 1MB echo message to server', function(done) {
			testClient.send('/ipcserver/test/echo',  createSizedMessage(1024), function(err, result) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				assert(result);
				assert(JSON.stringify(result).length >= 1024*1024);
				done();
			});				
		})
		it('sends a delay message to server', function(done) {
			testClient.send('/ipcserver/test/delay',  {delay:10}, function(err, result) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				assert(result);
				assert.equal(result.delay, 10);
				done();
			});				
		})
		it('generate a message that times out', function(done) {
			clientStubby.reset();
			var shortClient = new IPCClient(SOCKET_PATH, clientStubby, {requestTimeout: 100, expireRequest: 1000});
			shortClient.connect(function(err) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				shortClient.send('/ipcserver/test/delay',  {delay:500}, function(err, _result) {
					assert.equal(err, 'request_timeout');
					// Allow time for the request to come back and make sure we don't report 2 errors
					setTimeout(function() {
						assert.equal(clientStubby.errorCount, 1);
						assert(clientStubby.lastError.message.indexOf('/ipcserver/test/delay')>0);
						assert.equal(shortClient.requestCount, 0);
						done();					
					}, 1000);

				});				
			});
		})
		it('sends an unknown message to server', function(done) {
			testClient.send('/ipcserver/no_such_thing',  {foo:10}, function(err, result) {
				assert(!err);
				assert(result);
				assert.equal(result.code, 'no_handler_found');
				assert(result.message);
				done();
			});
		})
		it('passes custom userAgent', function(done) {
			clientStubby.reset();
			var uaClient = new IPCClient(SOCKET_PATH, clientStubby, {userAgent:"shortClient"});
			uaClient.connect(function(err) {
				assert.ifError(err);
				uaClient.send('/myapi/test', {message:"foo", uaTest:"^shortClient$"}, function(err, result) {
					assert(!err);
					assert.equal(clientStubby.errorCount, 0);
					assert(result);
					assert(result.hello);
					assert.equal(result.hello, "thanks");
					assert.equal(handlerCallCount, 2);
					done();
				});
			});
		})			
		it('cycle stats and fetch them', function() {
			server.IPCServer.logIntervalStats();
			var stats = server.IPCServer.getStats();
			assert(stats);
			assert.equal(stats.connections, 3);
			assert.equal(stats.handlers, 3);
			assert(stats.duration > 0);
			assert.equal(stats.clientOpen, 3);
			assert.equal(stats.clientClose, 0);
			assert(stats.requests > 5);
			assert(stats.slowResponses > 0);
		})
		it('cycle client stats and check log', function() {
			testClient.logStats();
			assert(clientStubby.debugLog.indexOf("PixlIPC Stats")>0);
		})
		it('works with async/await', async function() {
			let asyncClient = new IPCClient(SOCKET_PATH, clientStubby, {logStatsInterval: 100, codeToErr: true});
			await asyncClient.connect();
			let result = await asyncClient.send('/ipcserver/test/echo', {message:"foo",echo:true,bar:9});
			assert.equal(clientStubby.errorCount, 0);
			assert(result);
			assert(result.message);
			assert.equal(result.message, "foo");
			assert.equal(result.echo, true);
			assert.equal(result.bar, 9);
			try {
				await asyncClient.send('/ipcserver/no_such_thing',  {foo:10});
				assert(false, 'Expected exception');
			}
			catch (e) {
				// Expected
			}
			await asyncClient.close();
		})
		
		it('works with subclass', function(done) {
			let subclient = new ClientSubclass(SOCKET_PATH, clientStubby, {logStatsInterval: 100, codeToErr: true});
			subclient.connect(function(err) {
				assert.ifError(err);
				subclient.send('/ipcserver/test/echo', {message:"foo",echo:true,bar:9}, function(err, result) {
					assert.ifError(err);
					assert.equal(subclient.sendCount, 1);
					assert.equal(clientStubby.errorCount, 0);
					assert(result);
					assert(result.message);
					assert.equal(result.message, "foo");
					assert.equal(result.echo, true);
					assert.equal(result.bar, 9);
					subclient.close(done);
				});
			});
		})
		
		it('works with async subclass', async function() {
			let asyncClient = new ClientSubclassAsync(SOCKET_PATH, clientStubby, {logStatsInterval: 100, codeToErr: true});
			await asyncClient.connect();
			let result = await asyncClient.send('/ipcserver/test/echo', {message:"foo",echo:true,bar:9});
			assert.equal(asyncClient.sendCount, 1);
			assert.equal(clientStubby.errorCount, 0);
			assert(result);
			assert(result.message);
			assert.equal(result.message, "foo");
			assert.equal(result.echo, true);
			assert.equal(result.bar, 9);
			try {
				await asyncClient.send('/ipcserver/no_such_thing',  {foo:10});
				assert(false, 'Expected exception');
			}
			catch (e) {
				// Expected
			}
			await asyncClient.close();
		})
		describe('Client with codeToErr option set', function() {
			var client = null;
			before('client connects', function(done) {
				clientStubby.reset();
				client = new IPCClient(SOCKET_PATH, clientStubby, {codeToErr: true});
				client.connect(function(err) {
					assert(!err);
					assert.equal(clientStubby.errorCount, 0);
					done();
				});
			})
			it('sends an echo message to server', function(done) {
				client.send('/ipcserver/test/echo', {message:"foo",echo:true,bar:9}, function(err, result) {
					assert(!err);
					assert.equal(clientStubby.errorCount, 0);
					assert(result);
					assert(result.message);
					assert.equal(result.message, "foo");
					assert.equal(result.echo, true);
					assert.equal(result.bar, 9);
					done();
				});				
			})
			it('sends an unknown message to server', function(done) {
				client.send('/ipcserver/no_such_thing',  {foo:10}, function(err, _result) {
					assert(err);
					assert.equal(err.code, 'no_handler_found');
					assert(err.message);
					done();
				});
			})
			it('sends an echo message with non-zero result code', function(done) {
				client.send('/ipcserver/test/echo', {code: "testErr", message:"foo",echo:true,bar:9}, function(err, _result) {
					assert(err);
					assert.equal(err.code, "testErr");
					assert.equal(err.message, "foo");
					done();
				});				
			})
			describe('node client using messageTransform', function() {
				var testClientOpt = null;
				before('client connects', function(done) {
					clientStubby.reset();
					var options = {
						messageTransform: function(msg) {
							var data = null;
							var err = null;
							if (msg.data.message == "err") {
								err = {code:1, message:"transform error"};
							}
							else {
								data = {message: msg.data.message + msg.data.message}
							}
							return [err, data];
						}
					}
					testClientOpt = new IPCClient(SOCKET_PATH, clientStubby, options);
					testClientOpt.connect(function(err) {
						assert(!err);
						assert.equal(clientStubby.errorCount, 0);
						done();
					});
				})
				it('sends an echo message to server', function(done) {
					testClientOpt.send('/ipcserver/test/echo', {message:"foo",echo:true,bar:9}, function(err, result) {
						assert(!err);
						assert.equal(clientStubby.errorCount, 0);
						assert(result);
						assert(result.message);
						assert.equal(result.message, "foofoo");
						assert.equal(typeof result.echo, "undefined");
						assert.equal(typeof result.bar, "undefined");
						done();
					});				
				})
				it('transforms echo message to error', function(done) {
					testClientOpt.send('/ipcserver/test/echo', {message:"err",echo:true,bar:9}, function(err, result) {
						assert(err);
						assert.equal(err.code, 1);
						assert.equal(err.message, "transform error");
						assert(!result);
						done();
					});				
				})
			})
		})
	})
	
	describe('IPC Server with php client', function() {
		var server = null;
		var child = null;
		var gFinished = false;

		before('create server', function(done) {
			clientStubby.reset();
			this.timeout(5000);
			createServer(config, function(err, serverObj) {
				assert(!err);
				assert(serverObj);
				server = serverObj;
				done();
			});
		})
		after('shutdown server', function(done) {
			this.timeout(5000);
			if (child) {
				child.kill();
			}
			if (server) {
				server.shutdown(function() {
					cleanup();
					done();
				});				
			}

		})
		it('server registers a handler to check request params', function(done) {
			server.IPCServer.addURIHandler(/^\/myapi\/test/, "IPCServer", function(request, callback) {
				assert(request);
				assert(request.data);
				assert.equal(request.data.message, "foo");
				assert(request.pid);
				assert(request.data.uaTest);
				var userAgentRegex = new RegExp(request.data.uaTest);
				assert(userAgentRegex.test(request.userAgent), "unexpected userAgent:" + request.userAgent);
				callback({"hello":"thanks"});
			});
			done();
		})
		it('registers a close handler', function(done) {
			server.IPCServer.addURIHandler(/^\/test\/close/, "IPCServer", function(request, callback) {
				assert(request);
				assert(request.data);
				assert(request.data.delay);
				callback({"hello":"thanks"});
				setTimeout(server.IPCServer.closeConnections.bind(server.IPCServer),request.data.delay);
			});
			done();
		})
		it('runs the PHP test suite without error', function(done) {
			this.timeout(10000);
			child = child_process.spawn(
				'php', [__dirname +'/test.php'],
				{ stdio: ['pipe', 'pipe', 'pipe'] }
				);

			assert(child);

			child.stdout.on('data', function (data) {
				gFinished = true;
				assert(data, 'Empty response from PHP child');
				data = '' + data; // force to string
				assert(data.length>0, data);
				data = data.trim();
				// Expect JSON results
				assert.equal(data.indexOf("{"), 0, data);
				var results = JSON.parse(data);
				assert(results && (results.failed==0), data);
				done();
			});

			child.stderr.on('data', function (data) {
				console.log(`stderr: ${data}`);
			});

			child.on('close', function (code) {
				assert(gFinished, `child process exited with code ${code}`);
				child = null;
			});
		})
		it('php recovers from a server stop/start', function(done) {
			this.timeout(10000);
			child = child_process.spawn(
				'php', [__dirname +'/test_recover.php'],
				{ stdio: ['pipe', 'pipe', 'pipe'] }
				);

			assert(child);

			child.stdout.on('data', function (data) {
				gFinished = true;
				assert(data, 'Empty response from PHP child');
				data = '' + data; // force to string
				assert(data.length>0, data);
				data = data.trim();
				// Expect JSON results
				assert.equal(data.indexOf("{"), 0, data);
				var results = JSON.parse(data);
				assert(results && (results.failed==0), data);
				done();
			});

			child.stderr.on('data', function (data) {
				console.log(`stderr: ${data}`);
			});

			child.on('close', function (code) {
				assert(gFinished, `child process exited with code ${code}`);
				child = null;
			});
			
			setTimeout(function() {
				server.shutdown(function() {
					server = null;
					setTimeout(function() {
						createServer(config, function(err, serverObj) {
							assert(!err);
							assert(serverObj);
							server = serverObj;
						});
					}, 500);
				});
			}, 500);
		})
	})
})