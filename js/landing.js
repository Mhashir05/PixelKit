import { logger } from "./core/logger.js";
import { revealOnScroll } from "./ui/animations.js";

const PIXEL_COLS = 25; // 25x20 keeps the 5:4 shape of the sample image
const PIXEL_ROWS = 20;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let sliderLogTimer;

function makeTag(side, text) {
  const tag = document.createElement("span");
  tag.className = `compare__tag compare__tag--${side}`;
  tag.textContent = text;
  tag.setAttribute("aria-hidden", "true");
  return tag;
}

// Builds the before/after slider on top of the plain <img>. Without JS the sharp image just shows.
async function initCompare() {
  const frame = document.querySelector(".compare");
  const img = frame?.querySelector("img");
  if (!img) return;

  try {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = PIXEL_COLS;
    canvas.height = PIXEL_ROWS;
    canvas.className = "compare__pixels";
    canvas.setAttribute("aria-hidden", "true");
    canvas.getContext("2d").drawImage(img, 0, 0, PIXEL_COLS, PIXEL_ROWS);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 100;
    slider.value = 50;
    slider.setAttribute("aria-label", "Compare pixelated and sharp sample image");

    const divider = document.createElement("div");
    divider.className = "compare__divider";
    divider.setAttribute("aria-hidden", "true");

    frame.append(canvas, slider, divider, makeTag("before", "Before"), makeTag("after", "After"));
    slider.addEventListener("input", () => {
      frame.classList.remove("is-intro");
      frame.style.setProperty("--split", `${slider.value}%`);
      // Log once the user pauses, not on every pixel of a drag.
      clearTimeout(sliderLogTimer);
      sliderLogTimer = setTimeout(() => logger.info("hero slider moved", { value: Number(slider.value) }), 400);
    });

    // Intro: start fully pixelated, then sweep to the middle.
    if (!reducedMotion) {
      frame.classList.add("is-intro");
      frame.style.setProperty("--split", "100%");
      requestAnimationFrame(() => requestAnimationFrame(() => frame.style.setProperty("--split", "50%")));
    }
    logger.info("hero compare ready");
  } catch (err) {
    logger.error("hero compare failed, showing plain image", err);
  }
}

logger.group("landing loaded", () => {
  logger.info("page", "index.html");
  logger.info("prefers-reduced-motion", reducedMotion ? "on" : "off");
});
document.querySelector(".btn--primary")?.addEventListener("click", () => logger.info("Start as Guest clicked"));
initCompare();
revealOnScroll(".features__head, .module");
