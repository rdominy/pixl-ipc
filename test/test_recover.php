<?php
require_once __DIR__ . "/../clients/PixlIPCClient.class.php";
require_once  __DIR__ . "/lib/Test.class.php";

const SOCKET_PATH = "/var/tmp/node_ipc_unittest_server.sock";

$test = new Test();

$test->newTest("test unexpected socket close", function() use ($test) {
	$ipc = new PixlIPCClient(SOCKET_PATH);
	$test->assert($ipc, 'No object returned from PixlIPCClient');
	$ipc->connect();
	$done = false;
	$gotException = false;
	while (!$done) {
		try {
			$msg = array('foo' => 19, 'bar' => true, 'msg' => 'hello');
			$result = $ipc->send('/ipcserver/test/echo', $msg);
			$test->assert($result, 'No message back from server');
			$test->assertEqual($result['foo'], $msg['foo']);
			$test->assertEqual($result['bar'], $msg['bar']);
			$test->assertEqual($result['msg'], $msg['msg']);
			if ($gotException) {
				// If we got one or more exceptions followed by a good response, our work is done
				$done = true;
			}
		}	catch (Exception $e) {
			$gotException = true;
		}

	} // end while

});

$test->run();

?>