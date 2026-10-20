// Shared logger. Log short messages and metadata only, never base64 or image contents.
const PREFIX = "[PixelKit]";

export const logger = {
  info: (msg, data) => console.info(PREFIX, msg, data ?? ""),
  group: (label, fn) => {
    console.group(`${PREFIX} ${label}`);
    try { fn(); } finally { console.groupEnd(); }
  },
  error: (msg, err) => console.error(PREFIX, msg, err ?? ""),
};

const pauseTimers = {}; // one timer per key

// Logs once the user pauses for 400 ms, so a slider drag or typing gives one log line, not one per step.
// getData returns what to log, or nothing to skip the log. It runs when the timer fires, so it sees the latest state.
export function logAfterPause(key, message, getData) {
  clearTimeout(pauseTimers[key]);
  pauseTimers[key] = setTimeout(() => {
    const data = getData();
    if (data) logger.info(message, data);
  }, 400);
}
