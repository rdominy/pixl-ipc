const IPCClient = require('../client');
const async = require('async');

var config = require('./bench_config.json');
var results = {
	date: (new Date()).toString(),
	iterations: config.iterations,
	testRuns: []
};
var tempDir =  __dirname + "/temp";

function testPath(size) {
	return tempDir + "/msg" + size + ".json";
}

var testClient = new IPCClient(config.server.IPCServer.socket_path, null);
testClient.connect(function() {
	async.eachSeries(config.tests, function(size, eachCallback){
		var msg = require(testPath(size));
		var start = Date.now();

		async.times(config.iterations, function(n, done){
			testClient.send('/ipcserver/test/echo', msg, done);
		}, function(err) {
			results.testRuns.push({
				size: size,
				file: testPath(size),
				msg_duration: (Date.now()-start)/config.iterations
			});
			eachCallback();
		});
	}, function() {
		console.log(JSON.stringify(results));
		process.exit();
	});
});