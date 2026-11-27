(function () {
  "use strict";

  var doc = document;
  var header = doc.querySelector(".site-header");
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

  var protoPopup = doc.getElementById("prototype-popup");
  if (protoPopup) {
    var protoKey = "ballena-proto-popup-v3";
    var protoDismissed = false;
    try {
      protoDismissed = window.sessionStorage.getItem(protoKey) === "1";
    } catch (error) {}

    function dismissProtoPopup() {
      try {
        window.sessionStorage.setItem(protoKey, "1");
      } catch (error) {}
      if (typeof protoPopup.close === "function") {
        protoPopup.close();
      } else {
        protoPopup.removeAttribute("open");
      }
    }

    if (!protoDismissed) {
      if (typeof protoPopup.showModal === "function") {
        protoPopup.showModal();
      } else {
        protoPopup.setAttribute("open", "");
      }
    }

    protoPopup.addEventListener("close", function () {
      try {
        window.sessionStorage.setItem(protoKey, "1");
      } catch (error) {}
    });

    doc.querySelectorAll("[data-proto-close]").forEach(function (button) {
      button.addEventListener("click", dismissProtoPopup);
    });

    var protoDetails = doc.getElementById("prototype-popup-details");
    if (protoDetails) {
      protoDetails.addEventListener("click", function (event) {
        var target = doc.querySelector(protoDetails.getAttribute("href"));
        event.preventDefault();
        dismissProtoPopup();
        if (target) {
          window.setTimeout(function () {
            target.scrollIntoView({ behavior: "instant", block: "start" });
          }, 250);
        }
      });
    }

    protoPopup.addEventListener("click", function (event) {
      if (event.target === protoPopup) dismissProtoPopup();
    });
  }

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

  // Store photo lightbox
  var lightbox = doc.getElementById("photo-lightbox");
  if (lightbox) {
    var lightboxImg = lightbox.querySelector(".photo-lightbox-img");
    var lightboxClose = lightbox.querySelector(".photo-lightbox-close");
    var zoomTriggers = doc.querySelectorAll(".photo-zoom");
    var lastPhotoTrigger = null;

    function handleLightboxKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePhotoLightbox();
      }
    }

    function closePhotoLightbox() {
      if (!lightbox.open) return;
      lightbox.close();
      doc.removeEventListener("keydown", handleLightboxKeydown);
      doc.body.style.overflow = "";
      if (lastPhotoTrigger) lastPhotoTrigger.focus({ preventScroll: true });
    }

    function openPhotoLightbox(trigger) {
      var figure = trigger.closest(".visit-photo");
      var source = figure ? figure.querySelector("img") : null;
      if (!source || !lightboxImg) return;
      lastPhotoTrigger = trigger;
      lightboxImg.src = source.currentSrc || source.src;
      lightboxImg.alt = source.alt || "";
      lightbox.showModal();
      doc.addEventListener("keydown", handleLightboxKeydown);
      doc.body.style.overflow = "hidden";
      if (lightboxClose) lightboxClose.focus({ preventScroll: true });
    }

    zoomTriggers.forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        openPhotoLightbox(trigger);
      });
    });

    if (lightboxClose) {
      lightboxClose.addEventListener("click", closePhotoLightbox);
    }

    lightbox.addEventListener("cancel", function (event) {
      event.preventDefault();
      closePhotoLightbox();
    });

    lightbox.addEventListener("close", function () {
      doc.body.style.overflow = "";
      if (lastPhotoTrigger) lastPhotoTrigger.focus({ preventScroll: true });
    });

    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) closePhotoLightbox();
    });
  }


})();
