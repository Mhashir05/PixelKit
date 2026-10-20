// Small helpers shared by every tool that exports or downloads a file.

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Starts a download in the browser. The temporary URL is released one second later.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "My photo (1).PNG" becomes "My_photo_1_": no extension, only letters, digits, "_" and "-", at most 40 characters.
export function cleanFileName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "image";
}
