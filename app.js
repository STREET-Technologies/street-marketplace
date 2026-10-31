// Discovery question: how should commerce and local discovery share a desktop?
// Three independent page compositions share fictional data and temporary state.
import {
  shops,
  products,
  areas,
  money,
  filterProducts,
  addToBag,
  bagTotal,
  bagCount,
} from "./model.mjs";
// Temporary mount boundary for the approved PoC; all state belongs to this mount.
export function mountMarketplace(root) {
  const listeners = new AbortController();
  const listen = (target, event, handler) =>
    target.addEventListener(event, handler, { signal: listeners.signal });
  const variants = ["hybrid", "shop", "local"];
  const variantNames = {
    hybrid: "The best of both",
    shop: "Shopping first",
    local: "The local explorer",
  };
  const descriptions = {
    hybrid: "Editorial discovery + a shoppable edit",
    shop: "Persistent filters + a denser product catalogue",
    local: "Neighbourhood guide + shop-by-shop browsing",
  };
  const params = new URLSearchParams(location.search);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    variant: variants.includes(params.get("variant"))
      ? params.get("variant")
      : "hybrid",
    page: "discover",
    area: 0,
    category: "All",
    query: "",
    shop: "",
    sort: "edit",
    bag: [],
    selected: null,
    size: "",
    pending: null,
    heroPaused: reducedMotion.matches,
  };
  const app = root.querySelector("#app");
  const modal = root.querySelector("#modal");
  let focusBeforeModal;
  let cleanupHeroVideo = () => {};
  let updateHeroPlayback = () => {};
  const icons = {
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    heart:
      '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    bag: '<path d="M5 7h14l2 14H3L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    play: '<path d="m9 5 11 7-11 7V5Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  };
  const icon = (name, cls = "") =>
    `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const area = () => areas[state.area];
  const shopName = (id) => shops.find((s) => s.id === id).name;
  function header() {
    return `<div class="proof-strip"><span>Staging foundation · Sample shops & products · No live orders</span></div>
  <header class="header frame"><button class="wordmark" data-action="home" aria-label="Street home">STREET</button><span class="header-divider"></span><button class="location-button" data-action="location">${icon("pin")}<span><small>Exploring</small><b>${area().name}, ${area().postcode} <span aria-hidden="true">⌄</span></b></span></button>
  <form id="search-form" class="search-form" role="search"><label class="sr-only" for="search">Search products or shops</label>${icon("search")}<input id="search" name="q" value="${escape(state.query)}" placeholder="Find your next good find"><button type="submit" aria-label="Search">↵</button></form>
  <a class="header-action" href="/account">Account</a><a class="header-action" href="/saved" aria-label="Saved items">${icon("heart")}<span>Saved</span></a><button class="header-action" data-action="bag" aria-label="Shopping bag">${icon("bag")}<span>Bag</span><span class="count">${bagCount(state.bag)}</span></button></header>
  <div class="nav-line"><nav class="frame nav" aria-label="Main navigation"><div>${[
    ["discover", "Discover"],
    ["catalogue", "Shop all"],
    ["neighbourhoods", "Neighbourhoods"],
  ]
    .map(
      ([key, label]) =>
        `<button data-action="nav" data-value="${key}" class="${state.page === key ? "active" : ""}" ${state.page === key ? 'aria-current="page"' : ""}>${label}</button>`,
    )
    .join("")}</div></nav></div>`;
  }
  function productCard(p) {
    return `<article class="product-card"><div class="product-image"><button class="image-link" data-action="product" data-value="${p.id}" aria-label="View ${p.name}"><img src="/assets/${p.image}" alt="${p.name}" loading="lazy"></button></div><div class="product-info"><div><button data-action="product" data-value="${p.id}">${p.name}</button><b>${money(p.price)}</b></div><span class="product-shop">${shopName(p.shop)}</span><small>${p.colour} · ${p.category}</small></div></article>`;
  }
  function productSection(limit = 4, title = "Good finds, close by.") {
    return `<section class="section"><div class="section-heading"><div><h2>${title}</h2></div><button class="text-link" data-action="nav" data-value="catalogue">Shop the edit ${icon("arrow")}</button></div><div class="product-grid">${products.slice(0, limit).map(productCard).join("")}</div></section>`;
  }
  function areaCards() {
    return `<div class="area-grid">${areas.map((a, i) => `<button class="area-card" aria-label="Explore ${a.name}" data-action="area-story" data-value="${i}"><img src="/assets/${a.image}" alt="A view of ${a.name}" loading="lazy"><div><h3>${a.name}</h3><span class="area-description">${a.line}</span>${icon("arrow")}</div></button>`).join("")}</div>`;
  }
  function shopCards() {
    return `<div class="shop-list">${shops.map((s) => `<button class="shop-card" aria-label="Shop ${s.name}" data-action="shop" data-value="${s.id}"><img src="/assets/${s.image}" alt="Illustrative neighbourhood photography" loading="lazy"><div><h3>${s.name}</h3><span class="shop-category">${s.category}</span><p>${s.note}</p><span class="text-link">Explore the shop ${icon("arrow")}</span></div></button>`).join("")}</div>`;
  }
  function Hybrid() {
    return `<section class="hybrid-hero hybrid-hero--editorial"><div class="hero-copy"><h1>Your high <br>street. <br><span>A little closer.</span></h1><p>The shops you love. The ones you’re yet to find.<br>A whole neighbourhood, at your fingertips.</p><div class="hero-actions"><button class="primary" data-action="nav" data-value="catalogue">Find your next good thing ${icon("arrow")}</button><button class="text-link" data-action="nav" data-value="neighbourhoods">Take a look around</button></div></div><div class="hero-photo hero-editorial"><img src="/assets/product-editorial-poster.jpg" alt="A green dress from the illustrative fashion editorial" width="1280" height="720" fetchpriority="high" decoding="async"><video id="hero-video" muted loop playsinline preload="none" poster="/assets/product-editorial-poster.jpg" aria-label="Illustrative fashion, footwear, jewellery and fragrance editorial"><source src="/assets/product-editorial.mp4" type="video/mp4"></video><button class="video-control" data-action="hero-playback" aria-controls="hero-video">${icon(state.heroPaused ? "play" : "pause")}<span>${state.heroPaused ? "Play" : "Pause"} video</span></button></div></section>
  ${productSection()}
  <section class="section"><div class="section-heading"><div><h2>Every street has a story.</h2></div><span class="muted">Pick a neighbourhood. See what you find.</span></div>${areaCards()}</section><section class="section"><div class="section-heading"><div><h2>Meet your next favourite.</h2></div><span class="sample-note">Illustrative shops for this concept</span></div>${shopCards()}</section>`;
  }
  function categories(vertical = false) {
    return `<div class="categories ${vertical ? "vertical" : ""}" aria-label="Product categories">${["All", "Clothing", "Footwear", "Accessories", "Home", "Jewellery"].map((c) => `<button data-action="category" data-value="${c}" aria-pressed="${state.category === c}" class="${state.category === c ? "selected" : ""}">${c}${vertical ? "<span>↗</span>" : ""}</button>`).join("")}</div>`;
  }
  function catalogueContent(sidebar = false) {
    const result = filterProducts({
      query: state.query,
      category: state.category,
      shop: state.shop,
      sort: state.sort,
    });
    const title = state.shop
      ? shopName(state.shop)
      : state.query
        ? `Finds for “${escape(state.query)}”`
        : "A good place to find it.";
    return `<section class="catalogue"><div class="catalogue-intro"><h1>${title}</h1><p>${state.shop ? "An illustrative shop collection. All prices and availability are sample data." : "A few things to catch your eye. From the streets around you."}</p></div><div class="catalogue-layout ${sidebar ? "with-sidebar" : ""}">${sidebar ? `<aside class="filter-sidebar"><h2 class="filter-title">Categories</h2>${categories(true)}<div class="aside-note">${icon("pin")}<h3>Made for around here.</h3><p>Exploring ${area().name}. Change neighbourhood to try another view.</p><button class="text-link" data-action="location">Change area ↗</button></div></aside>` : ""}<div>${!sidebar ? categories() : ""}<div class="results-bar"><span>${result.length} sample finds ${state.shop || state.query || state.category !== "All" ? '<button class="text-link" data-action="reset">Clear filters ×</button>' : ""}</span><label>Sort by <select id="sort"><option value="edit" ${state.sort === "edit" ? "selected" : ""}>Street edit</option><option value="low" ${state.sort === "low" ? "selected" : ""}>Price: low to high</option><option value="high" ${state.sort === "high" ? "selected" : ""}>Price: high to low</option></select></label></div><div class="product-grid ${sidebar ? "three" : ""}">${result.length ? result.map(productCard).join("") : `<div class="empty"><h2>No finds this time.</h2><p>Try another search or clear the filters.</p><button class="primary" data-action="reset">Explore all products ${icon("arrow")}</button></div>`}</div></div></div></section>`;
  }
  function ShopFirst() {
    return `<div class="shop-feature"><div><h2>Less searching.<br>More finding.</h2><button class="text-link" data-action="nav" data-value="neighbourhoods">Or take a neighbourhood detour ${icon("arrow")}</button></div><img src="/assets/${area().image}" alt="${area().name} high street"></div>${catalogueContent(true)}`;
  }
  function LocalExplorer() {
    return `<section class="local-hero"><div class="local-photo"><img src="/assets/${area().image}" alt="Shops along ${area().name}"></div><div class="local-copy"><h1>${area().headline.map(escape).join(" <br>")}</h1><p>${area().intro}</p><button class="primary" data-action="scroll-shops">Meet the shops ${icon("arrow")}</button><button class="text-link" data-action="location">Explore another neighbourhood ↗</button></div></section><section class="section" id="shops"><div class="section-heading"><div><h2>Step inside.</h2></div><span class="sample-note">3 fictional shops · For exploration only</span></div>${shopCards()}</section>${productSection(4, "Found around the corner.")}<section class="section"><div class="section-heading"><h2>Keep wandering.</h2></div>${areaCards()}</section>`;
  }
  function neighbourhoods() {
    return `<section class="section neighbourhood-intro"><h1>Where shall<br>we wander?</h1><p>Different streets. Different discoveries. Find your corner of London.</p>${areaCards()}</section>`;
  }
  function switcher() {
    return `<aside class="prototype-switcher" aria-label="Prototype layout switcher"><div class="switcher-label"><span class="prototype-dot"></span><b>Compare layouts</b></div><button data-action="cycle" data-value="-1" aria-label="Previous concept">←</button><div class="variant-summary"><strong>${String(variants.indexOf(state.variant) + 1).padStart(2, "0")} / ${variantNames[state.variant]}</strong><small>${descriptions[state.variant]}</small></div><button data-action="cycle" data-value="1" aria-label="Next concept">→</button><button class="switcher-info" data-action="about" aria-label="About this prototype">?</button></aside>`;
  }
  function render() {
    cleanupHeroVideo();
    let content;
    if (state.page === "catalogue")
      content = catalogueContent(state.variant === "shop");
    else if (state.page === "neighbourhoods") content = neighbourhoods();
    else if (state.page === "area") content = LocalExplorer();
    else
      content =
        state.variant === "hybrid"
          ? Hybrid()
          : state.variant === "shop"
            ? ShopFirst()
            : LocalExplorer();
    app.innerHTML = `${header()}<main id="main" class="frame" tabindex="-1">${content}</main><footer class="frame footer"><span class="footer-brand">STREET</span><div>Your high street. Delivered.<small>Discovery prototype · Fictional shops, illustrative products, sample pricing.<br>Neighbourhood photos are illustrative; no retailer partnerships implied.</small></div><button class="text-link" data-action="about">About this concept ${icon("arrow")}</button></footer>${switcher()}`;
    setupHeroVideo();
  }
  function setupHeroVideo() {
    cleanupHeroVideo = () => {};
    updateHeroPlayback = () => {};
    const video = root.querySelector("#hero-video");
    if (!video) return;
    const button = root.querySelector('[data-action="hero-playback"]');
    const bounds = video.getBoundingClientRect();
    let visible = bounds.bottom > 0 && bounds.top < window.innerHeight;
    let disposed = false;
    let failed = false;
    const updateButton = () => {
      const action = state.heroPaused ? "Play" : "Pause";
      button.innerHTML = `${icon(state.heroPaused ? "play" : "pause")}<span>${action} video</span>`;
      button.setAttribute("aria-label", `${action} editorial video`);
    };
    const refresh = () => {
      if (disposed || failed) return;
      updateButton();
      if (state.heroPaused || !visible || document.hidden) video.pause();
      else {
        video.play().catch(() => {
          if (disposed || !visible || document.hidden || state.heroPaused)
            return;
          state.heroPaused = true;
          updateButton();
        });
      }
    };
    video.muted = true;
    video.addEventListener(
      "error",
      () => {
        failed = true;
        video.hidden = true;
        button.hidden = true;
      },
      true,
    );
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        refresh();
      },
      { threshold: 0.05 },
    );
    observer.observe(video);
    listen(document, "visibilitychange", refresh);
    updateHeroPlayback = refresh;
    cleanupHeroVideo = () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      video.pause();
    };
    refresh();
  }
  listen(reducedMotion, "change", () => {
    if (reducedMotion.matches) state.heroPaused = true;
    updateHeroPlayback();
  });
  function closeModal() {
    modal.close();
    modal.innerHTML = "";
    focusBeforeModal?.focus();
  }
  function showModal(content, drawer = false) {
    if (!modal.open) focusBeforeModal = document.activeElement;
    modal.className = drawer ? "drawer" : "";
    modal.innerHTML = `<button class="modal-close" data-action="close" aria-label="Close dialog">${icon("close")}</button>${content}`;
    modal.setAttribute("aria-labelledby", "dialog-title");
    if (!modal.open) modal.showModal();
  }
  function productModal(id) {
    state.selected = id;
    const p = products.find((p) => p.id === id);
    state.size = p.sizes.length === 1 ? p.sizes[0] : "";
    showModal(
      `<div class="product-detail"><img src="/assets/${p.image}" alt="${p.name}"><div class="detail-copy"><h2 id="dialog-title">${p.name}</h2><p class="product-shop">${shopName(p.shop)} · Concept shop</p><p class="detail-price">${money(p.price)}</p><p>${p.description}</p><span class="detail-label">Colour: ${p.colour}</span><fieldset><legend>Choose a size</legend><div class="sizes">${p.sizes.map((s) => `<button data-action="size" data-value="${s}" aria-pressed="${state.size === s}" class="${state.size === s ? "selected" : ""}">${s}</button>`).join("")}</div></fieldset><p id="size-error" class="inline-error" role="status"></p><button class="primary wide" data-action="add">Add to bag ${icon("bag")}</button><button class="text-link detail-shop" data-action="shop" data-value="${p.shop}">See more from this shop ${icon("arrow")}</button><div class="detail-note">${icon("pin")}<span>Exploring ${area().name}<small>Sample product, price and sizes. Delivery eligibility would be checked against your address.</small></span></div></div></div>`,
    );
  }
  function locationModal() {
    showModal(
      `<div class="simple-modal"><h2 id="dialog-title">Pick your neighbourhood.</h2><p>Try a different corner of London. This changes the discovery view; the sample catalogue stays the same.</p><div class="location-choices">${areas.map((a, i) => `<button data-action="location-select" data-value="${i}"><img src="/assets/${a.image}" alt=""><span><b>${a.name}</b><small>London · ${a.postcode}</small></span><span>${state.area === i ? "Selected ✓" : "↗"}</span></button>`).join("")}</div><small class="muted">Concept areas only. No address or location is collected.</small></div>`,
    );
  }
  function bagModal() {
    showModal(
      `<div class="bag-content"><h2 id="dialog-title">In the bag. <span>${bagCount(state.bag)}</span></h2>${
        state.bag.length
          ? `<p class="muted">From ${shopName(state.bag[0].shop)}</p><div class="bag-items">${state.bag
              .map((item, i) => {
                const p = products.find((p) => p.id === item.id);
                return `<article class="bag-item"><img src="/assets/${p.image}" alt="${p.name}"><div><h3>${p.name}</h3><p>${item.size} · ${p.colour}</p><div class="quantity"><button data-action="quantity" data-value="${i}" data-delta="-1" aria-label="Decrease quantity of ${p.name}">−</button><span>${item.quantity}</span><button data-action="quantity" data-value="${i}" data-delta="1" aria-label="Increase quantity of ${p.name}">+</button></div><button class="remove" data-action="remove" data-value="${i}">Remove</button></div><b>${money(p.price * item.quantity)}</b></article>`;
              })
              .join(
                "",
              )}</div><div class="bag-summary"><div><b>Subtotal</b><b>${money(bagTotal(state.bag))}</b></div><p>Delivery & any fees would be confirmed at checkout.</p><button class="primary wide" data-action="checkout">Preview checkout ${icon("arrow")}</button><small>Demo only · Nothing will be ordered or charged.</small></div>`
          : `<div class="empty">${icon("bag")}<h3>Something good belongs here.</h3><p>Find a little something from your high street.</p><button class="primary" data-action="browse">Explore the edit ${icon("arrow")}</button></div>`
      }</div>`,
      true,
    );
  }
  function aboutModal() {
    showModal(
      `<div class="simple-modal"><h2 id="dialog-title">Same Street.<br>Another way in.</h2><p>A discovery prototype exploring how shopping and neighbourhood stories can work together on desktop.</p><div class="concept-list">${variants.map((v, i) => `<button data-action="variant" data-value="${v}"><b>0${i + 1} / ${variantNames[v]}</b><span>${descriptions[v]} ↗</span></button>`).join("")}</div><p>Try searching, saving products, exploring a shop, choosing a size and building a bag. A bag stays with one shop, as in the mobile app.</p><small class="muted">All shops are fictional. Product photography is illustrative. No login, payment, live inventory or orders. State resets when you reload.</small></div>`,
    );
  }
  function navigate(page) {
    state.page = page;
    state.query = "";
    state.category = "All";
    state.shop = "";
    closeModal();
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function changeVariant(v) {
    state.variant = v;
    state.page = "discover";
    state.query = "";
    state.category = "All";
    state.shop = "";
    const url = new URL(location.href);
    url.searchParams.set("variant", v);
    history.replaceState(null, "", url);
    closeModal();
    render();
    window.scrollTo(0, 0);
  }
  let toastTimer;
  function toast(message) {
    const el = root.querySelector("#toast");
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 2600);
  }
  function finishAdd(replace = false) {
    const result = addToBag(state.bag, state.selected, state.size, replace);
    if (result.conflict) {
      state.pending = { id: state.selected, size: state.size };
      showModal(
        `<div class="simple-modal"><h2 id="dialog-title">Start a new bag?</h2><p>Your bag has finds from ${shopName(state.bag[0].shop)}. To add this item from ${shopName(products.find((p) => p.id === state.selected).shop)}, you’ll need to replace the current bag.</p><button class="primary wide" data-action="replace-bag">Replace bag & add item</button><button class="secondary wide" data-action="keep-bag">Keep my current bag</button></div>`,
      );
      return;
    }
    state.bag = result.bag;
    render();
    bagModal();
    toast("Added to your bag");
  }
  listen(document, "click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const value = button.dataset.value;
    switch (button.dataset.action) {
      case "hero-playback":
        state.heroPaused = !state.heroPaused;
        updateHeroPlayback();
        break;
      case "home":
        navigate("discover");
        break;
      case "nav":
        navigate(value);
        break;
      case "browse":
        navigate("catalogue");
        break;
      case "product":
        productModal(value);
        break;
      case "close":
        closeModal();
        break;
      case "location":
        locationModal();
        break;
      case "location-select":
        state.area = Number(value);
        closeModal();
        render();
        toast(`Now exploring ${area().name}`);
        break;
      case "area-story":
        state.area = Number(value);
        navigate("area");
        break;
      case "bag":
        bagModal();
        break;
      case "shop":
        navigate("catalogue");
        state.shop = value;
        render();
        break;
      case "category":
        state.category = value;
        if (state.page === "discover" && state.variant !== "shop")
          state.page = "catalogue";
        render();
        break;
      case "reset":
        state.query = "";
        state.category = "All";
        state.shop = "";
        render();
        break;
      case "size":
        state.size = value;
        modal.querySelectorAll('[data-action="size"]').forEach((b) => {
          b.classList.toggle("selected", b.dataset.value === value);
          b.setAttribute("aria-pressed", String(b.dataset.value === value));
        });
        root.querySelector("#size-error").textContent = "";
        break;
      case "add":
        if (!state.size) {
          root.querySelector("#size-error").textContent =
            "Choose a size to add this to your bag.";
          return;
        }
        finishAdd();
        break;
      case "replace-bag":
        state.selected = state.pending.id;
        state.size = state.pending.size;
        finishAdd(true);
        break;
      case "keep-bag":
        bagModal();
        break;
      case "remove":
        state.bag.splice(Number(value), 1);
        render();
        bagModal();
        break;
      case "quantity":
        state.bag[Number(value)].quantity += Number(button.dataset.delta);
        state.bag = state.bag.filter((i) => i.quantity > 0);
        render();
        bagModal();
        break;
      case "checkout":
        showModal(
          `<div class="simple-modal"><h2 id="dialog-title">Your next step<br>would be checkout.</h2><p>${bagCount(state.bag)} item(s) from ${shopName(state.bag[0].shop)} · Subtotal ${money(bagTotal(state.bag))}.</p><p>A real web checkout would confirm your delivery address, shop availability, current pricing, delivery fees and payment before placing an order.</p><div class="checkout-note">This is a prototype. No order has been created and no payment has been taken.</div><button class="primary wide" data-action="bag">Back to your bag ${icon("bag")}</button></div>`,
        );
        break;
      case "cycle":
        changeVariant(
          variants[
            (variants.indexOf(state.variant) +
              Number(value) +
              variants.length) %
              variants.length
          ],
        );
        break;
      case "variant":
        changeVariant(value);
        break;
      case "about":
        aboutModal();
        break;
      case "scroll-shops":
        root.querySelector("#shops").scrollIntoView({ behavior: "smooth" });
        break;
    }
  });
  listen(document, "submit", (e) => {
    if (e.target.id !== "search-form") return;
    e.preventDefault();
    state.query = new FormData(e.target).get("q").trim();
    state.page = "catalogue";
    state.category = "All";
    state.shop = "";
    render();
    window.scrollTo(0, 0);
  });
  listen(document, "change", (e) => {
    if (e.target.id === "sort") {
      state.sort = e.target.value;
      render();
    }
  });
  listen(document, "keydown", (e) => {
    if (
      modal.open ||
      e.target.closest('input,textarea,select,[contenteditable="true"]') ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey
    )
      return;
    if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      changeVariant(
        variants[
          (variants.indexOf(state.variant) +
            (e.key === "ArrowLeft" ? -1 : 1) +
            variants.length) %
            variants.length
        ],
      );
    }
  });
  listen(modal, "click", (e) => {
    if (e.target === modal) {
      const r = modal.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closeModal();
    }
  });
  listen(modal, "cancel", (e) => {
    e.preventDefault();
    closeModal();
  });
  render();

  return () => {
    listeners.abort();
    cleanupHeroVideo();
    clearTimeout(toastTimer);
    if (modal.open) modal.close();
    app.replaceChildren();
    modal.replaceChildren();
  };
}
