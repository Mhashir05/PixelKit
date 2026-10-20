import { logger } from "../core/logger.js";

// Fade-up reveal. The hidden state is added here, so without JS the content stays visible.
export function revealOnScroll(selector) {
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      logger.info("revealed", entry.target.querySelector("h2, h3")?.textContent.replace(/^\d+/, ""));
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.15 });
  for (const el of document.querySelectorAll(selector)) {
    el.classList.add("reveal");
    observer.observe(el);
  }
}
