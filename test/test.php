<?php
require_once __DIR__ . "/../clients/PixlIPCClient.class.php";
require_once  __DIR__ . "/lib/Test.class.php";

const SOCKET_PATH = "/var/tmp/node_ipc_unittest_server.sock";

function createSizedMessage($size) {
	$message = array();
	for ($i=0;$i<$size;$i++) {
		$message["key_" . $i] = str_pad("GiveMe",  1024, "Dataz");
	}
	return $message;
}

$test = new Test();

$test->newTest("throw exception on bad socket path", function() use ($test) {
	$ipc = new PixlIPCClient('/nosuch/socket.sock');
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	
	$test->expectException(function() use ($ipc) {
		$ipc->connect();
	});
});

$test->newTest("throw exception if no connection", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	// Don't connect: $ipc->connect();
	$msg = array('foo' => 19, 'bar' => true, 'msg' => 'hello');
	
	$test->expectException(function() use ($ipc) {
		$result = $ipc->send('/ipcserver/test/echo', $msg);
	});	
});

$test->newTest("send an echo message", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = array('foo' => 19, 'bar' => true, 'msg' => 'hello');
	$result = $ipc->send('/ipcserver/test/echo', $msg);
	$test->assert($result, 'No message back from server');
	$test->assertEqual($result['foo'], $msg['foo']);
	$test->assertEqual($result['bar'], $msg['bar']);
	$test->assertEqual($result['msg'], $msg['msg']);
});

$test->newTest("send a 1MB echo message", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = createSizedMessage(1024);
	$result = $ipc->send('/ipcserver/test/echo', $msg);
	$test->assert($result, 'No message back from server');
	$resultAsStr = json_encode($result);
	$test->assert(strlen(json_encode($result))>= 1024*1024, 'Return message not 1MB');
});

$test->newTest("send a delay message", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = array('delay' => 10);
	$result = $ipc->send('/ipcserver/test/delay', $msg);
	$test->assert($result, 'No message back from server');
	$test->assertEqual($result['delay'], 10);
});

$test->newTest("send a message that times out", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH, array('requestTimeout'=>100));
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = array('delay' => 1000);
	$result = $ipc->send('/ipcserver/test/delay', $msg);
	$test->assertEqual($result, false, "Message should be false on timeout");
});

$test->newTest("send an unknown message to server", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = array('foo' => 10);
	$result = $ipc->send('/ipcserver/no_such_thing', $msg);
	$test->assert($result, 'No message back from server');
	$test->assertEqual($result['code'], 'no_handler_found');
	$test->assert($result['message']);
});

$test->newTest("send a message with default userAgent", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = array('message' => 'foo', 'uaTest' => '^PHP/PixlIPCClient.+');
	$result = $ipc->send('/myapi/test', $msg);
	$test->assert($result, 'No message back from server');
	$test->assertEqual($result['hello'], 'thanks');
});

$test->newTest("send a message with default userAgent", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH, array('userAgent'=>'phpTestAgent'));
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$msg = array('message' => 'foo', 'uaTest' => '^phpTestAgent$');
	$result = $ipc->send('/myapi/test', $msg);
	$test->assert($result, 'No message back from server');
	$test->assertEqual($result['hello'], 'thanks');
});

$test->run();

?>