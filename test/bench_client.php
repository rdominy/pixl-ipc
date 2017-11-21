<?php
require_once __DIR__ . "/../clients/PixlIPCClient.class.php";
require_once  __DIR__ . "/lib/Test.class.php";

$config = json_decode(file_get_contents(__DIR__ . "/bench_config.json"), true);

$results = array('date' => date(DATE_RFC850), 'iterations' => $config['iterations'], 'testRuns' => array());

$ipc = new PixlIPCClient($config['server']['IPCServer']['socket_path']);
$ipc->connect();

foreach($config['tests'] as $testSize) {
	$msg = Test::createSizedMessage($testSize);
	$start = microtime(true);
	
	for ($i=0;$i<$config['iterations'];$i++) {
		$result = $ipc->send('/ipcserver/test/echo', $msg);
	}
	
	$duration = (microtime(true)*1000 - $start*1000)/$config['iterations'];
	$results['testRuns'][] = array('size'=>$testSize, 'msg_duration' => $duration);
}

ob_implicit_flush(true);

print(json_encode($results));

?>