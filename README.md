**STATUS:** Beta

This module provides interprocess communication (IPC) using unix domain sockets to provide fast local communication between processes that avoid touching the network stack.  It is built as a component of [pixl-server](http://www.npmjs.com/package/pixl-server), a lightweight framework for building node.js daemon applications.

* JSON messages over UNIX domain sockets
* Protocol is language agnostic
* PHP and Node.js client classes provided

# Usage

# Creating a Simple Server
~~~~javascript
var PixlServer = require('pixl-server');

var server = new PixlServer({
		
		__name: 'MyIPCServer',
		__version: "0.1",
		
		config: {
				"log_dir": "/var/tmp",
				"log_filename": "my_ipc_test.log",
				"debug_level": 9,
				
				"IPCServer" : {
					"socket_path" : "/var/tmp/my_ipc_server.sock"
				}
		},
		
		components: [require('pixl-ipc')]
		
});

server.startup( function() {
		console.log("Main startup");
		
		server.IPCServer.addURIHandler(/^\/myapi\/test/, "IPCServer", function(request, callback) {
			callback({"hello":"thanks for your message"});
		});
} );
~~~~


# Making Request from a Client
~~~~javascript
const IPCClient = require('pixl-ipc/client');

var testClient = new IPCClient("/var/tmp/my_ipc_server.sock");
testClient.connect(function() {
	testClient.send('/myapi/test', {"welcome":42}, function(err, data) {
		console.log(err, data);
	});
	
	testClient.send('/ipcserver/test/echo', {"ping":"me"}, function(err, data) {
		console.log(err, data);
	});
});
~~~~

# Server
## Config
Name|Type|Description
----|----|-----------
socket_path|string|Path where the socket file will be created -- must be same in client
exit_timeout|integer|When shutting down and waiting for client connections to close, this will force an exit when the timeout is exceeded (default 2000ms)

## Methods
### addURIHandler(uriPattern, name, callback)
Name|Type|Description
----|----|-----------
uriPattern|string or regex|Identifies the type of messages the handler should receive by matching the URI request pattern
name|string|The name to associate with the handler (for logging)
callback|function|The method to call when a message is received

This method registers callback handler to process incoming requests matching the specified URI pattern.  When the handler is called it is passed the request object and response callback.

The *request* contains:
Name|Type|Description
----|----|-----------
uri|string|URI passed from client
data|json object|The data from the client
pid|integer|The process ID of the client (Not yet implemented)

~~~~javascript
myHandler(request, callback) {
	console.dir(request);
	callback({thanks: "a lot"});
}
~~~~

### getStats()
Returns various statistics about the IPC server.

## Built-in Message Handlers
### /ipcserver/test/echo
You can pass in any arbitrary object and the server will echo back the message in the response

### /ipcserver/test/delay
Name|Type|Description
----|----|-----------
delay|integer|The time in milliseconds to delay before sending a response back

This sets a delay response to the caller and sends back {delay: N}.


# Node.js Client

## Methods
### constructor(socket_path [,logger, options])
Name|Type|Description
----|----|-----------
socket_path|string|Path where the socket file will be created -- must be same in client
logger|PixlLogger|Instance of a PixlLogger object if you want logging (optional)
options|json object|Override settings such as request timeout

~~~~javascript
// options with current defaults, times are in milliseconds
{
	requestTimeout : 10*1000, // How long to wait before timing out the request
	expirationFrequency : 5*1000 // How frequently to check outstanding messages to see if they are stale
}

~~~~

Creates the client object and overrides default options if provide.  


### connect(callback)
Name|Type|Description
----|----|-----------
callback|function|The function to call once the client is connected to the server

Opens a socket connection to the server.  Callback is invoked with an error object or null if there was no error.

### send(uri, message, callback)
Name|Type|Description
----|----|-----------
uri|string|The server URI being requested
message|json object|The data to send to the IPC server
callback|function|When the server sends a response, this callback will be invoked with (err, data)

Sends an asynchronous JSON request to the IPC Server and gets the response back in the callback.

# PHP Client
PixlIPCClient provides an API for sending socket messages to the IPC server.  Unlike the Node client, it is a blocking, synchronous model.

**Sample**
~~~~javascript
require_once "PixlIPCClient.class.php";

$ipc = new PixlIPCClient("/tmp/node_ipc_server.sock");
$ipc->connect();
$msg = array("hello"=>"there");
$result = $ipc->send('/ipcserver/test/echo', $msg);
print($msg)
~~~~
 
## Methods
### constructor(socket_path [, options])
Name|Type|Description
----|----|-----------
socket_path|string|Path where the socket file will be created -- must be same in client
options|hash array|Override settings such as request timeout

~~~~javascript
// options with current defaults, times are in milliseconds
array(
	'requestTimeout' => 500, // How long to wait before timing out the request
	'connectTimeout' => 500 // How long to wait before timing out the connection
)
~~~~

Creates the client object and overrides default options if provide.  

### connect()
Opens a socket connection to the server.  Throws exception if there was an error.

### send(uri, message)
Name|Type|Description
----|----|-----------
uri|string|The server URI being requested
message|hash array|The data to send to the IPC server

Sends a JSON request to the IPC Server and returns the response. Throws exception if there was an error.

# Performance Notes
In testing on a local ancient laptop, performance is sub-millisecond for message sizes under about 20K.

Msg Size|Time (ms)
--------|---------
1K | 0.13
5K | 0.19
10K | 0.36
20K | 0.64
100K | 3.35

 