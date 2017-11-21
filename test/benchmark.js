const fs = require('fs'),
	child_process = require('child_process'),
	PixlServer = require('pixl-server');

var config = require(__dirname + "/bench_config.json");


function launchChildTest(cmd, args, callback) {
	var child = child_process.spawn(cmd, args, {stdio: ['pipe', 'pipe', 'pipe']});

	var gotCompletion = false;
	var results = null;
	child.stdout.on('data', function (data) {
		results = data;
	});

	child.stderr.on('data', function (data) {
		console.log(`stderr: ${data}`);
	});

	child.on('error', function (data) {
		console.log(`stderr: ${data}`);
	});
	
	child.on('close', function (code) {
		console.log(`child process exited with code ${code}`);
		callback(results);
	});
}


var server = new PixlServer({
		__name: 'IPCBenchmarkServer',
		__version: "0.1",
		
		config: config.server,
		components: [require('..')]
});

server.startup( function() {

	setImmediate(function(){
		// launch child & run test, gather metrics
		launchChildTest('node', [__dirname +'/bench_client.js'], function(result) {
			console.dir(JSON.parse(""+result));
	
			launchChildTest('php', [__dirname +'/bench_client.php'], function(result) {
				console.dir(JSON.parse(""+result));

				// When finished shutdown & cleanpup
				server.shutdown(function() {
					process.exit();
				});
			});
		});				


	});

} );