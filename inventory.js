(function () {
  "use strict";

  var grid = document.getElementById("inv-grid");
  if (!grid) return;

  var lang = (document.documentElement.lang || "es").toLowerCase().indexOf("en") === 0 ? "en" : "es";
  var toolbarEl = document.getElementById("inv-toolbar");
  var searchEl = document.getElementById("inv-search");
  var sortEl = document.getElementById("inv-sort");
  var minEl = document.getElementById("inv-min");
  var maxEl = document.getElementById("inv-max");
  var clearEl = document.getElementById("inv-clear");
  var filtersEl = document.getElementById("inv-filters");
  var filtersRow = document.querySelector(".inv-filters-row");
  var countEl = document.getElementById("inv-count");
  var noteEl = document.getElementById("inv-note");
  var moreWrap = document.getElementById("inv-more-wrap");
  var moreBtn = document.getElementById("inv-more");
  var dialog = document.getElementById("inv-lightbox");
  var dialogImg = document.getElementById("inv-lightbox-img");
  var dialogClose = document.getElementById("inv-lightbox-close");
  var whatsapp = "50663132925";
  var PAGE_SIZE = 24;
  var previewLimit = parseInt(grid.getAttribute("data-preview"), 10);
  if (!previewLimit || previewLimit < 1) previewLimit = 0;

  var allItems = [];
  var state = { query: "", category: "all", sort: "relevance", min: null, max: null, shown: PAGE_SIZE };
  var searchTimer = null;
  var priceTimer = null;

  var COPY = {
    es: {
      all: "Todos",
      searchPlaceholder: "Buscar producto o código…",
      searchLabel: "Buscar en el inventario",
      showing: function (shown, total) { return "Mostrando " + shown + " de " + total; },
      empty: "Todavía no hay artículos publicados. Escribinos por WhatsApp y te contamos qué hay en tienda.",
      error: "No pudimos cargar el inventario. Igual podés consultar por WhatsApp.",
      sample: "Inventario de muestra",
      ask: "Consultar",
      askMessage: function (name) {
        return "Hola Ballena Outlet, me interesa " + name + ". ¿Está disponible?";
      },
      flyer: "Ver flyer",
      flyerAlt: function (name) { return "Flyer de " + name; },
      photoAlt: function (name) { return name + ", foto del producto"; },
      close: "Cerrar flyer",
      pending: "Foto pendiente",
      askPrice: "Consultar precio",
      qty: function (n) { return n + " disponibles"; },
      noResults: "No hay artículos que coincidan con esos filtros.",
      more: "Ver más",
      minLabel: "Precio mínimo en colones",
      maxLabel: "Precio máximo en colones",
      clear: "Limpiar filtros",
      foot: "¿No encontrás lo que buscás?",
      footLink: "Preguntá por WhatsApp",
      condition: {
        nuevo: "Nuevo",
        como_nuevo: "Como nuevo",
        usado: "Usado",
        para_partes: "Para partes"
      },
      categories: {
        electrodomesticos: "Electrodomésticos",
        hogar: "Hogar",
        mejoras_hogar: "Mejoras para el hogar",
        textiles: "Alfombras y textiles",
        juguetes: "Juguetes y niños",
        electronica: "Electrónica",
        belleza: "Belleza y cuidado personal",
        herramientas: "Herramientas y jardín",
        ropa: "Ropa y calzado",
        otros: "Otros"
      }
    },
    en: {
      all: "All",
      searchPlaceholder: "Search product or code…",
      searchLabel: "Search inventory",
      showing: function (shown, total) { return "Showing " + shown + " of " + total; },
      empty: "Nothing is listed right now. Message us on WhatsApp and we'll tell you what's in store.",
      error: "We couldn't load the inventory. You can still ask us on WhatsApp.",
      sample: "Sample inventory",
      ask: "Ask",
      askMessage: function (name) {
        return "Hi Ballena Outlet, I'm interested in " + name + ". Is it available?";
      },
      flyer: "View flyer",
      flyerAlt: function (name) { return name + " flyer"; },
      photoAlt: function (name) { return name + ", product photo"; },
      close: "Close flyer",
      pending: "Photo pending",
      askPrice: "Ask price",
      qty: function (n) { return n + " available"; },
      noResults: "No items match those filters.",
      more: "Load more",
      minLabel: "Minimum price in colones",
      maxLabel: "Maximum price in colones",
      clear: "Clear filters",
      foot: "Can't find what you're looking for?",
      footLink: "Ask on WhatsApp",
      condition: {
        nuevo: "New",
        como_nuevo: "Like new",
        usado: "Used",
        para_partes: "For parts"
      },
      categories: {
        electrodomesticos: "Appliances",
        hogar: "Home",
        mejoras_hogar: "Home improvement",
        textiles: "Rugs and textiles",
        juguetes: "Toys and kids",
        electronica: "Electronics",
        belleza: "Beauty and personal care",
        herramientas: "Tools and garden",
        ropa: "Clothing and shoes",
        otros: "Other"
      }
    }
  };

  var copy = COPY[lang];

  function categoryLabel(slug) {
    return copy.categories[slug] || slug;
  }

  function conditionLabel(slug) {
    return copy.condition[slug] || slug;
  }

  function itemName(item) {
    if (lang === "en") return item.name_en || item.name_es;
    return item.name_es;
  }

  function normalize(value) {
    var text = String(value || "").toLowerCase();
    if (text.normalize) {
      text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return text;
  }

  function money(value) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    var digits = String(Math.round(value));
    var grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, lang === "es" ? "." : ",");
    return "\u20a1" + grouped;
  }

  function safeImage(value) {
    if (typeof value !== "string" || !value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.indexOf("assets/") === 0) return value;
    return null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function waLink(message) {
    return "https://wa.me/" + whatsapp + "?text=" + encodeURIComponent(message);
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    var haystack = normalize([item.name_es, item.name_en, item.id, item.detail_es, item.detail_en].join(" "));
    return haystack.indexOf(query) !== -1;
  }

  function parsePriceInput(input) {
    if (!input) return null;
    var raw = input.value.trim();
    if (!raw) return null;
    var value = parseInt(raw, 10);
    if (!isFinite(value) || value < 0) return null;
    return value;
  }

  function sortItems(list) {
    if (state.sort === "relevance") return list;
    var sorted = list.slice();

    if (state.sort === "price_asc" || state.sort === "price_desc") {
      var direction = state.sort === "price_asc" ? 1 : -1;
      sorted.sort(function (a, b) {
        var priceA = typeof a.price_crc === "number" ? a.price_crc : null;
        var priceB = typeof b.price_crc === "number" ? b.price_crc : null;
        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return (priceA - priceB) * direction;
      });
    } else if (state.sort === "name_asc") {
      sorted.sort(function (a, b) {
        return itemName(a).localeCompare(itemName(b), lang);
      });
    } else if (state.sort === "qty_desc") {
      sorted.sort(function (a, b) {
        return (b.qty || 0) - (a.qty || 0);
      });
    } else if (state.sort === "id_desc") {
      sorted.sort(function (a, b) {
        return String(b.id).localeCompare(String(a.id));
      });
    }

    return sorted;
  }

  function previewSelection(limit) {
    var withImages = [];
    var rest = [];
    allItems.forEach(function (item) {
      var hasImage = safeImage(item.foto) || safeImage(item.flyer_es) || safeImage(item.flyer_en);
      (hasImage ? withImages : rest).push(item);
    });
    return withImages.concat(rest).slice(0, limit);
  }

  function visibleItems() {
    if (previewLimit) return previewSelection(previewLimit);
    var query = normalize(state.query).trim();
    var filtered = allItems.filter(function (item) {
      if (state.category !== "all" && item.category !== state.category) return false;
      if (state.min !== null || state.max !== null) {
        if (typeof item.price_crc !== "number") return false;
        if (state.min !== null && item.price_crc < state.min) return false;
        if (state.max !== null && item.price_crc > state.max) return false;
      }
      return matchesQuery(item, query);
    });
    return sortItems(filtered);
  }

  function makeCard(item) {
    var card = el("article", "inv-card");
    var name = itemName(item);
    var flyer = lang === "en" ? item.flyer_en || item.flyer_es : item.flyer_es || item.flyer_en;

    var media = el("div", "inv-media");
    var photo = safeImage(item.foto);
    var flyerSrc = safeImage(flyer);
    var cardImage = photo || flyerSrc;
    if (cardImage) {
      if (!photo) media.classList.add("inv-media--flyer");
      var img = el("img");
      img.src = cardImage;
      img.alt = photo ? copy.photoAlt(name) : copy.flyerAlt(name);
      img.loading = "lazy";
      img.decoding = "async";
      media.appendChild(img);
    } else {
      var placeholder = el("div", "inv-placeholder");
      placeholder.appendChild(el("span", "inv-placeholder-cat", categoryLabel(item.category)));
      placeholder.appendChild(el("span", "inv-placeholder-note", copy.pending));
      media.appendChild(placeholder);
    }
    if (item.condition) {
      media.appendChild(el("span", "inv-cond", conditionLabel(item.condition)));
    }
    card.appendChild(media);

    var body = el("div", "inv-body");
    body.appendChild(el("p", "inv-cat", categoryLabel(item.category)));

    var title = el("h3", "inv-name", name);
    title.title = name;
    body.appendChild(title);

    var detail = lang === "en" ? item.detail_en || item.detail_es : item.detail_es || item.detail_en;
    if (detail) body.appendChild(el("p", "inv-detail", detail));

    var foot = el("div", "inv-foot");
    var price = money(item.price_crc);
    foot.appendChild(el("p", "inv-price", price || copy.askPrice));
    if (item.qty > 1) foot.appendChild(el("p", "inv-qty", copy.qty(item.qty)));
    body.appendChild(foot);

    var actions = el("div", "inv-actions");
    var ask = el("a", "btn btn-wa btn-sm");
    ask.href = waLink(copy.askMessage(name));
    ask.target = "_blank";
    ask.rel = "noopener";
    ask.appendChild(el("span", null, copy.ask));
    actions.appendChild(ask);

    if (flyerSrc) {
      var flyerBtn = el("button", "btn btn-outline btn-sm inv-flyer-btn", copy.flyer);
      flyerBtn.type = "button";
      flyerBtn.addEventListener("click", function () {
        openFlyer(flyerSrc, copy.flyerAlt(name));
      });
      actions.appendChild(flyerBtn);
    }

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function openFlyer(src, alt) {
    if (!dialog || !dialogImg) {
      window.open(src, "_blank", "noopener");
      return;
    }
    dialogImg.src = src;
    dialogImg.alt = alt;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      window.open(src, "_blank", "noopener");
    }
  }

  function renderFilters() {
    if (!filtersEl) return;
    filtersEl.textContent = "";

    var seen = {};
    allItems.forEach(function (item) {
      seen[item.category] = true;
    });

    var order = Object.keys(copy.categories).filter(function (slug) {
      return seen[slug];
    });

    var options = [{ slug: "all", label: copy.all }].concat(
      order.map(function (slug) {
        return { slug: slug, label: categoryLabel(slug) };
      })
    );

    options.forEach(function (option) {
      var chip = el("button", "inv-chip", option.label);
      chip.type = "button";
      chip.setAttribute("aria-pressed", option.slug === state.category ? "true" : "false");
      chip.addEventListener("click", function () {
        state.category = option.slug;
        state.shown = PAGE_SIZE;
        Array.prototype.forEach.call(filtersEl.children, function (child) {
          child.setAttribute("aria-pressed", child === chip ? "true" : "false");
        });
        render();
      });
      filtersEl.appendChild(chip);
    });
  }

  function updateClear() {
    if (!clearEl) return;
    var active = state.query.trim() !== "" ||
      state.category !== "all" ||
      state.sort !== "relevance" ||
      state.min !== null ||
      state.max !== null;
    clearEl.hidden = !active;
  }

  function render() {
    var list = visibleItems();
    grid.textContent = "";

    if (!list.length) {
      grid.appendChild(el("p", "inv-empty", copy.noResults));
    } else {
      list.slice(0, state.shown).forEach(function (item) {
        grid.appendChild(makeCard(item));
      });
    }

    var total = previewLimit ? allItems.length : list.length;
    if (countEl) {
      countEl.textContent = copy.showing(Math.min(state.shown, list.length), total);
    }
    if (moreWrap) {
      moreWrap.hidden = previewLimit ? true : list.length <= state.shown;
    }
    updateClear();
  }

  function showNote(message) {
    if (!noteEl) return;
    noteEl.textContent = message;
    noteEl.hidden = false;
    if (toolbarEl) toolbarEl.hidden = true;
    if (filtersRow) filtersRow.hidden = true;
    if (moreWrap) moreWrap.hidden = true;
  }

  function setSampleBadge(isSample) {
    if (!toolbarEl || !isSample) return;
    toolbarEl.appendChild(el("span", "inv-sample", copy.sample));
  }

  function clearFilters() {
    state.query = "";
    state.category = "all";
    state.sort = "relevance";
    state.min = null;
    state.max = null;
    state.shown = PAGE_SIZE;

    if (searchEl) searchEl.value = "";
    if (sortEl) sortEl.value = "relevance";
    if (minEl) minEl.value = "";
    if (maxEl) maxEl.value = "";

    renderFilters();
    render();
  }

  if (searchEl) {
    searchEl.placeholder = copy.searchPlaceholder;
    searchEl.setAttribute("aria-label", copy.searchLabel);
    searchEl.addEventListener("input", function () {
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        state.query = searchEl.value;
        state.shown = PAGE_SIZE;
        render();
      }, 120);
    });
  }

  if (sortEl) {
    sortEl.addEventListener("change", function () {
      state.sort = sortEl.value;
      state.shown = PAGE_SIZE;
      render();
    });
  }

  function applyPriceFilter() {
    state.min = parsePriceInput(minEl);
    state.max = parsePriceInput(maxEl);
    state.shown = PAGE_SIZE;
    render();
  }

  if (minEl) {
    minEl.setAttribute("aria-label", copy.minLabel);
    minEl.addEventListener("input", function () {
      if (priceTimer) window.clearTimeout(priceTimer);
      priceTimer = window.setTimeout(applyPriceFilter, 250);
    });
  }

  if (maxEl) {
    maxEl.setAttribute("aria-label", copy.maxLabel);
    maxEl.addEventListener("input", function () {
      if (priceTimer) window.clearTimeout(priceTimer);
      priceTimer = window.setTimeout(applyPriceFilter, 250);
    });
  }

  if (clearEl) {
    clearEl.textContent = copy.clear;
    clearEl.addEventListener("click", clearFilters);
  }

  if (moreBtn) {
    moreBtn.textContent = copy.more;
    moreBtn.addEventListener("click", function () {
      state.shown += PAGE_SIZE;
      render();
    });
  }

  fetch("data/inventory.json", { cache: "no-store" })
    .then(function (response) {
      // A missing file means nothing has been published yet, not a broken page.
      if (response.status === 404) return { items: [] };
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (data) {
      allItems = Array.isArray(data.items) ? data.items : [];
      setSampleBadge(Boolean(data.sample));

      if (!allItems.length) {
        showNote(copy.empty);
        if (countEl) countEl.textContent = "";
        return;
      }

      if (previewLimit) state.shown = previewLimit;
      renderFilters();
      render();
    })
    .catch(function () {
      showNote(copy.error);
      if (countEl) countEl.textContent = "";
    });

  if (dialogClose && dialog) {
    dialogClose.addEventListener("click", function () {
      dialog.close();
    });
  }

  if (dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  }
})();
