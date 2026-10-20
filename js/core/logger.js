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
