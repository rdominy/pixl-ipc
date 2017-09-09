<?php

/**************************************************************************
 *
 * Class PixlIPCClient
 * This class provides a mechanism for using Unix sockets to communicate 
 * with a pixl-ipc server using JSON messages.
 *
 *  Copyright (c) 2017 Robert Dominy
 *  Released under the MIT License
 *
**************************************************************************/

class PixlIPCClient {
	const E_SOCKET_CONNECT = 5001;
	const E_BAD_REQUEST_TYPE = 5002;
	const E_SOCKET_WRITE = 5003;
	const E_BAD_RESPONSE = 5004;
	const E_SERVER_CLOSE = 5005;
	
	protected $socketPath = "";
	protected $fp = null;
	protected $connectTimeout_s = 0.5; // 500ms
	protected $streamTimeout_s = 0;
	protected $streamTimeout_uS = 500000; // 500ms
	protected $serialCounter = 0;

	public function __construct($socketPath, $options=null) {
		$this->socketPath = $socketPath;
		
		// Pass incoming times in milliseconds for consistency
		if ($options && isset($options['connectTimeout'])) {
			$this->connectTimeout_s = $options['connectTimeout']/1000.0;
		}
		
		if ($options && isset($options['requestTimeout'])) {
			$timeout = $options['requestTimeout'];
			$this->streamTimeout_s = floor($timeout/1000.0);
			$this->streamTimeout_uS = floor(($timeout-$this->streamTimeout_s*1000)*1000);
		}
	}
	
	public function __destruct() {
		if ($this->fp) {
			@stream_socket_shutdown($this->fp , STREAM_SHUT_RDWR);
		}
	}
	
	protected function nextID() {
		return "rq" . $this->serialCounter++;
	}
	
	protected function readMessage() {
		$response = null;
		stream_set_timeout($this->fp, $this->streamTimeout_s, $this->streamTimeout_uS);
		
		$read = @fgets($this->fp);  
		if ($read) {
			$response = json_decode($read, true);
			if (!$response) {
				throw new Exception('Could not json_decode response, details:' . json_last_error(), self::E_BAD_RESPONSE);
			}
		}
		else {
			$metaData = stream_get_meta_data($this->fp);
			if ($metaData['timed_out']) {
				$response = false;
				// when we time out a remote request, later we may get the response and need to discard it
			}
			else if ($metaData['eof']) {
				// Socket was closed on the other side, go ahead and close here too
				@stream_socket_shutdown($this->fp , STREAM_SHUT_RDWR);
				$this->fp = null;
				throw new Exception('Server closed the connection', self::E_SERVER_CLOSE);
			}
		}
		return $response;		
	}
	
	public function connect() {
		$this->fp = @stream_socket_client("unix://" . $this->socketPath, $errno, $errstr, $this->connectTimeout_s);
		if (!$this->fp) {
			throw new Exception("PixlIPCClient.connect(): stream_socket_client() failed: reason: $errno, $errstr", self::E_SOCKET_CONNECT);
		}
	}
	
	public function send($uri, &$request) {
		$requestStr = '';
		$ipcReqID = $this->nextID();

		if (!is_string($request) && (is_array($request) || is_object($request))) {
			$msg = array(
				'uri' => $uri,
				'ipcReqID' => $ipcReqID,
				'data' => $request
			);
			
			$requestStr = json_encode($msg);
		}
		else {
			throw new Exception("Request must be an object or associative array", self::E_BAD_REQUEST_TYPE);
		}
		
		$write_res = @fwrite($this->fp, $requestStr);
		if ($write_res != strlen($requestStr)) {
			throw new Exception("Socket write error, did not write expected number of bytes $write_res vs. " . strlen($requestStr), self::E_SOCKET_WRITE);
		}
		
		// For speed of not having to copy strings just to append a return, send the return separately
		@fwrite($this->fp, "\n");

		$response = null;
		
		while ($response === null) {
			$response = $this->readMessage();
			
			if ($response && ($response['ipcReqID'] != $ipcReqID)) {
				// Got wrong response which should only be the case for timed out message: discard and get the next one
				$response = null;
			}
		}
		return ($response) ? $response['data'] : $response;
	}
}

?>