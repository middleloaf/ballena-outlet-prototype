(function () {
  "use strict";

  var doc = document;
  var header = doc.querySelector(".site-header");
  var prototypeBar = doc.querySelector(".prototype-bar");
  var navToggle = doc.querySelector(".nav-toggle");
  var mobilePanel = doc.getElementById("mobile-panel");
  var mobileClose = doc.querySelector(".mobile-close");
  var mobileLinks = mobilePanel ? mobilePanel.querySelectorAll(".mobile-nav a") : [];
  var lastFocus = null;
  var menuFocusTimer = null;

  function setHeaderState() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  function syncPrototypeHeight() {
    if (!prototypeBar) return;
    doc.documentElement.style.setProperty("--proto-h", prototypeBar.getBoundingClientRect().height + "px");
  }

  syncPrototypeHeight();
  window.addEventListener("resize", syncPrototypeHeight, { passive: true });
  window.addEventListener("load", syncPrototypeHeight);
  if ("ResizeObserver" in window && prototypeBar) {
    new ResizeObserver(syncPrototypeHeight).observe(prototypeBar);
  }

  setHeaderState();
  window.addEventListener("scroll", setHeaderState, { passive: true });

  function openMenu() {
    if (!mobilePanel) return;
    lastFocus = doc.activeElement;
    mobilePanel.classList.add("is-open");
    mobilePanel.setAttribute("aria-hidden", "false");
    if (navToggle) {
      navToggle.setAttribute("aria-expanded", "true");
      navToggle.setAttribute("aria-label", navToggle.getAttribute("data-label-close") || "Cerrar menú");
    }
    doc.body.style.overflow = "hidden";
    if (mobileClose) {
      // The panel becomes visible on the next style pass; focus after it.
      void mobilePanel.offsetWidth;
      if (menuFocusTimer) window.clearTimeout(menuFocusTimer);
      menuFocusTimer = window.setTimeout(function () {
        if (mobilePanel.classList.contains("is-open")) {
          mobileClose.focus({ preventScroll: true });
        }
      }, 60);
    }
  }

  function closeMenu() {
    if (!mobilePanel) return;
    if (menuFocusTimer) {
      window.clearTimeout(menuFocusTimer);
      menuFocusTimer = null;
    }
    mobilePanel.classList.remove("is-open");
    mobilePanel.setAttribute("aria-hidden", "true");
    if (navToggle) {
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.setAttribute("aria-label", navToggle.getAttribute("data-label-open") || "Abrir menú");
    }
    doc.body.style.overflow = "";
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  if (navToggle) {
    navToggle.addEventListener("click", function () {
      if (mobilePanel && mobilePanel.classList.contains("is-open")) {
        closeMenu();
      } else {
        openMenu();
      }
    });
  }

  if (mobileClose) mobileClose.addEventListener("click", closeMenu);

  mobileLinks.forEach(function (link) {
    link.addEventListener("click", closeMenu);
  });

  doc.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && mobilePanel && mobilePanel.classList.contains("is-open")) {
      closeMenu();
    }
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 1120 && mobilePanel && mobilePanel.classList.contains("is-open")) {
      closeMenu();
    }
  });

  var year = doc.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // Reveal sections/cards as they enter the viewport.
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealItems = Array.prototype.slice.call(doc.querySelectorAll(".reveal"));

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach(function (item) {
      item.classList.add("is-visible");
    });
  } else {
    var groups = new Map();
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var parent = entry.target.parentElement;
          var count = groups.get(parent) || 0;
          groups.set(parent, count + 1);
          entry.target.style.transitionDelay = Math.min(count * 65, 260) + "ms";
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );

    revealItems.forEach(function (item) {
      observer.observe(item);
    });
  }

  // Third-party embeds (especially TikTok) inject iframes without titles.
  function labelFeedIframes() {
    var isEnglish = doc.documentElement.lang === "en";
    doc.querySelectorAll(".feed-frame iframe").forEach(function (frame) {
      if (!frame.getAttribute("title")) {
        frame.setAttribute(
          "title",
          isEnglish ? "Latest TikTok videos from Ballena Outlet" : "Últimos videos de TikTok de Ballena Outlet"
        );
      }
      frame.setAttribute("loading", "lazy");
    });
  }

  labelFeedIframes();

  if ("MutationObserver" in window) {
    var feedObserver = new MutationObserver(labelFeedIframes);
    doc.querySelectorAll(".feed-frame").forEach(function (frame) {
      feedObserver.observe(frame, { childList: true, subtree: true });
    });
  }

  // Keep only one FAQ item open at a time.
  var faqItems = Array.prototype.slice.call(doc.querySelectorAll(".faq-item"));
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });
})();
