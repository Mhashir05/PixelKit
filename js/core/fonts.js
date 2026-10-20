// System fonts only: nothing to download, so the Content Security Policy is not involved.
// Each stack ends with a generic family, so a missing font falls back to something readable.
export const FONTS = {
  impact: 'Impact, "Arial Black", sans-serif',
  arial: "Arial, Helvetica, sans-serif",
  georgia: "Georgia, serif",
  courier: '"Courier New", monospace',
};

// Dark text gets a light outline and light text gets a dark one, so it reads on any photo.
export function outlineColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000" : "#fff";
}
