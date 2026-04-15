export function createNodeShellPollingController(dependencies) {
  const {
    getSessionId,
    getSessionStatus,
    getSnapshot,
    isContextActive,
    loadSession,
    onError = () => {},
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = dependencies;

  let pollTimer = null;
  let pollInFlight = false;
  let pollStableTicks = 0;
  let pollSnapshot = "";

  function resetTracker() {
    pollStableTicks = 0;
    pollSnapshot = "";
  }

  function recordActivity() {
    const nextSnapshot = getSnapshot();

    if (!nextSnapshot) {
      resetTracker();
      return false;
    }

    if (nextSnapshot === pollSnapshot) {
      pollStableTicks += 1;
      return false;
    }

    pollSnapshot = nextSnapshot;
    pollStableTicks = 0;
    return true;
  }

  function nextDelay() {
    if (getSessionStatus() === "starting") {
      return 350;
    }

    return 900;
  }

  function shouldContinue() {
    const status = getSessionStatus();

    if (status === "starting") {
      return true;
    }

    if (status !== "open") {
      return false;
    }

    return pollStableTicks < 3;
  }

  function clear() {
    if (pollTimer) {
      clearTimeoutImpl(pollTimer);
      pollTimer = null;
    }
    pollInFlight = false;
  }

  function schedule(delay = 1200, options = {}) {
    clear();

    if (!isContextActive() || !getSessionId()) {
      return;
    }

    if (options.resetTracker === true) {
      resetTracker();
    }

    const run = async () => {
      if (pollInFlight) {
        pollTimer = setTimeoutImpl(run, nextDelay());
        return;
      }

      const activeSessionId = getSessionId();
      if (!activeSessionId) {
        clear();
        return;
      }

      pollInFlight = true;
      try {
        await loadSession(activeSessionId);
      } catch (error) {
        onError(error);
        clear();
        return;
      } finally {
        pollInFlight = false;
      }

      if (isContextActive() && activeSessionId === getSessionId() && shouldContinue()) {
        pollTimer = setTimeoutImpl(run, nextDelay());
      } else {
        pollTimer = null;
      }
    };

    pollTimer = setTimeoutImpl(run, delay);
  }

  return {
    clear,
    recordActivity,
    resetTracker,
    schedule,
  };
}
