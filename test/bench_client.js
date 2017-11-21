const IPCClient = require('../client'),
	async = require('async'),
	createSizedMessage = require('./lib/sized-message.js');

var config = require('./bench_config.json');
var results = {
	date: (new Date()).toString(),
	iterations: config.iterations,
	testRuns: []
};

var testClient = new IPCClient(config.server.IPCServer.socket_path, null);
testClient.connect(function() {
	async.eachSeries(config.tests, function(size, eachCallback){
		var msg = createSizedMessage(size);
		var start = Date.now();

		async.times(config.iterations, function(n, done){
			testClient.send('/ipcserver/test/echo', msg, done);
		}, function(err) {
			results.testRuns.push({
				size: size,
				msg_duration: (Date.now()-start)/config.iterations
			});
			eachCallback();
		});
	}, function() {
		console.log(JSON.stringify(results));
		process.exit();
	});
});