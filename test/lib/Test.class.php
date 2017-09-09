<?php

ob_implicit_flush(true);

class Test {
	protected $tests  = null;
	
	public function __construct() {
		$this->tests = array();
	}
	
	public function assert($test, $msg='') {
		if (!$test) {
			if ($msg=='') {
				$msg = "Failed asserting $test is true";
			}
			throw new Exception($msg);
		}
	}

	public function assertEqual($actual, $expected, $msg='') {
		if ($actual != $expected) {
			if ($msg=='') {
				$msg = "Failed assert $actual == $expected";
			}
			throw new Exception($msg);
		}
	}
	
	public function expectException($func) {
		$gotException = false;
		$result = null;
		try {
			$result = $func();
		}
		catch (Exception $e) {
			$gotException = true;
		}
		
		if (!$gotException) {
			throw new Exception("Expected exception not thrown");
		}
		return $result;
	}

	
	public function newTest($what, $func) {
		$this->tests[] = array('what'=>$what, 'func' => $func);
	}
	
	public function run() {
		$results = array();
		$passedCount = 0;
		$failedCount = 0;
		
		foreach($this->tests as $test) {
			$result = array('what' => $test['what'], 'passed' => true);
			try {
				$test['func']();
				$passedCount++;
			}
			catch (Exception $e) {
				$result['passed'] = false;
				$result['error'] = $e->getMessage();
				$result['trace'] = json_encode($e->getTrace());
				$failedCount++;
			}
			$results[] = $result;
			
		}
	
		$testSuite = array('passed' => $passedCount, 'failed' => $failedCount, 'tests' => $results);
		print(json_encode($testSuite));		
	}
}
?>