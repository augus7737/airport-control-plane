export function createNodeShellInputQueueController(dependencies) {
  const {
    isWritable,
    getSessionId,
    sendInput,
    onSendSuccess = () => {},
    onError = () => {},
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = dependencies;

  let inputBuffer = "";
  let inputQueue = [];
  let inputFlushTimer = null;
  let inputInFlight = false;

  function clear() {
    if (inputFlushTimer) {
      clearTimeoutImpl(inputFlushTimer);
      inputFlushTimer = null;
    }

    inputBuffer = "";
    inputQueue = [];
    inputInFlight = false;
  }

  function flushBuffer() {
    if (!inputBuffer) {
      return;
    }

    inputQueue.push(inputBuffer);
    inputBuffer = "";
  }

  async function process() {
    if (inputInFlight || inputQueue.length === 0) {
      return;
    }

    if (!isWritable()) {
      clear();
      return;
    }

    const sessionId = getSessionId();
    if (!sessionId) {
      clear();
      return;
    }

    const payload = inputQueue.shift();
    if (!payload) {
      return;
    }

    inputInFlight = true;
    try {
      await sendInput(sessionId, payload);
      onSendSuccess();
    } catch (error) {
      clear();
      onError(error);
      return;
    } finally {
      inputInFlight = false;
    }

    if (inputQueue.length > 0) {
      void process();
    }
  }

  function queue(data, options = {}) {
    if (!data || !isWritable()) {
      return false;
    }

    if (options.immediate === true) {
      flushBuffer();
      inputQueue.push(data);
      void process();
      return true;
    }

    inputBuffer += data;
    if (inputFlushTimer) {
      clearTimeoutImpl(inputFlushTimer);
    }

    inputFlushTimer = setTimeoutImpl(() => {
      inputFlushTimer = null;
      flushBuffer();
      void process();
    }, 60);

    return true;
  }

  return {
    clear,
    queue,
  };
}
