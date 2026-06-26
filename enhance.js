/* ============================================================================
   enhance.js — additive visual layer for MacroMax (locked to the Soft theme).
   Adds a tactile click ripple to .btn buttons. Touches no app logic or data.
   Safe to remove (delete this file + its <script> tag in index.html).
   ========================================================================== */
(function () {
  "use strict";

  function ripple(e) {
    var btn = e.target.closest("button.btn");
    if (!btn) return;
    if (btn.classList.contains("danger") || btn.classList.contains("ghost")) return;
    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.1;
    var span = document.createElement("span");
    span.className = "ripple";
    span.style.width = span.style.height = size + "px";
    span.style.left = (e.clientX - rect.left - size / 2) + "px";
    span.style.top = (e.clientY - rect.top - size / 2) + "px";
    span.style.color = btn.classList.contains("secondary") ? "var(--accent)" : "rgba(4, 18, 26, 0.45)";
    btn.appendChild(span);
    var done = function () { span.remove(); };
    span.addEventListener("animationend", done);
    setTimeout(done, 700); // fallback in case animationend never fires
  }

  function init() {
    document.body.addEventListener("pointerdown", ripple);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
