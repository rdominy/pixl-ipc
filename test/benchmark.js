const fs = require('fs'),
	child_process = require('child_process'),
	PixlServer = require('pixl-server');

var config = require(__dirname + "/bench_config.json");
var tempDir =  __dirname + "/temp";
var tempFiles = [];

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

function cleanup() {
	tempFiles.forEach(function(file) {
		try {fs.unlinkSync(file)} catch(e) {} //ignore errors
	})
	
	try {fs.rmdirSync(tempDir)} catch(e) {} //ignore errors
}

function testPath(size) {
	return tempDir + "/msg" + size + ".json";
}

function createMsgFile(path, size) {
	var message = {};
	for (var i=0;i<size;i++) {
		message["key_"+i] = "GiveMe".padEnd(512,"Dataz"); // Only put 0.5K since message will be echoed back
	}
	fs.writeFileSync(path, JSON.stringify(message), "utf8");
}

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

// Identify the files we will create
config.tests.forEach(function(size) {
	tempFiles.push(testPath(size));
});

cleanup();
fs.mkdirSync(tempDir);

var server = new PixlServer({
		__name: 'IPCBenchmarkServer',
		__version: "0.1",
		
		config: config.server,
		components: [require('..')]
});

server.startup( function() {
		// Create test file(s)
	config.tests.forEach(function(size) {
		createMsgFile(testPath(size), size);
	});
	
	setImmediate(function(){
		// launch child & run test, gather metrics
		launchChildTest('node', [__dirname +'/bench_client.js'], function(result) {
			console.dir(JSON.parse(""+result));
	
			launchChildTest('php', [__dirname +'/bench_client.php'], function(result) {
				console.dir(JSON.parse(""+result));

				// When finished shutdown & cleanpup
				server.shutdown(function() {
					cleanup();
				});
			});
		});				


	});

} );