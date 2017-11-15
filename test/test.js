const assert = require("assert"),
	fs = require("fs"),
	child_process = require('child_process'),
	IPCClient = require('../client'),
	async = require('async'),
	Stubby = require('./lib/stubby.js'),
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
	try { fs.unlinkSync(config.log_dir + config.log_filename) } catch(e) {}
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

// https://github.com/uxitten/polyfill/blob/master/string.polyfill.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/repeat
if (!String.prototype.padEnd) {
	String.prototype.padEnd = function padEnd(targetLength,padString) {
			targetLength = targetLength>>0; //floor if number or convert non-number to 0;
			padString = String(padString || ' ');
			if (this.length > targetLength) {
					return String(this);
			}
			else {
					targetLength = targetLength-this.length;
					if (targetLength > padString.length) {
							padString += padString.repeat(targetLength/padString.length); //append to original to ensure we are longer than needed
					}
					return String(this) + padString.slice(0,targetLength);
			}
	};
}

function createSizedMessage(size) {
	var message = {};
	for (var i=0;i<size;i++) {
		message["key_"+i] = "GiveMe".padEnd(1024,"Dataz");
	}
	return message;
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
				client.send('/myapi/test', {message:"foo"}, function(err, result) {
					assert(err);
					assert.equal(clientStubby.errorCount, 2);
					done();
				});
			});
		})
		it('responds with error when no connection present', function(done) {
			clientStubby.reset();
			var client = new IPCClient(SOCKET_PATH, clientStubby);
			client.send('/myapi/test', {message:"foo"}, function(err, result) {
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
			testClient = new IPCClient(SOCKET_PATH, clientStubby);
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
			var shortClient = new IPCClient(SOCKET_PATH, clientStubby, {requestTimeout: 100, expirationFrequency: 100});
			shortClient.connect(function(err) {
				assert(!err);
				assert.equal(clientStubby.errorCount, 0);
				shortClient.send('/ipcserver/test/delay',  {delay:1000}, function(err, result) {
					assert.equal(err, 'request_timeout');
					assert.equal(clientStubby.errorCount, 1);
					done();
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
				client.send('/ipcserver/no_such_thing',  {foo:10}, function(err, result) {
					assert(err);
					assert.equal(err.code, 'no_handler_found');
					assert(err.message);
					done();
				});
			})
			it('sends an echo message with non-zero result code', function(done) {
				client.send('/ipcserver/test/echo', {code: "testErr", message:"foo",echo:true,bar:9}, function(err, result) {
					assert(err);
					assert.equal(err.code, "testErr");
					assert.equal(err.message, "foo");
					done();
				});				
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
			server.shutdown(function() {
				cleanup();
				done();
			});
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
	})
})