const DATA_PATH = "/content/seed_en_cards.json";
const THUMBNAIL_PATH = "/content/featured_thumbnails.json";
const SITE_ORIGIN = "https://doompedia.elfeel.me";
const PACK_BASE_URL = `${SITE_ORIGIN}/packs`;
const STORAGE_KEY = "doompedia-web-state-v1";
const PAGE_SIZE = 10;

const defaultState = {
  saved: [],
  installedPacks: ["featured"],
  topic: "all",
  query: "",
  visibleCount: PAGE_SIZE,
  savedSort: "recent",
  settings: {
    theme: "system",
    textScale: 1,
    previews: true,
    reduceMotion: false,
    highContrast: false,
    discovery: "curated",
  },
};

const app = {
  articles: [],
  articleById: new Map(),
  thumbnails: new Map(),
  state: loadState(),
  route: "explore",
  observer: null,
  toastTimer: null,
};

const view = document.querySelector("#view");
const toast = document.querySelector("#toast");
const savedCount = document.querySelector("#saved-count");

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("hashchange", route);

async function init() {
  applySettings();
  try {
    const [cardsResponse, thumbnailsResponse] = await Promise.all([
      fetch(DATA_PATH),
      fetch(THUMBNAIL_PATH),
    ]);
    if (!cardsResponse.ok || !thumbnailsResponse.ok) {
      throw new Error("Starter content could not be loaded");
    }

    const [cards, thumbnailManifest] = await Promise.all([
      cardsResponse.json(),
      thumbnailsResponse.json(),
    ]);
    app.thumbnails = new Map(
      thumbnailManifest.articles.map((entry) => [Number(entry.page_id), entry]),
    );
    app.articles = cards
      .map((card, index) => ({
        ...card,
        page_id: Number(card.page_id),
        order: index,
        thumbnail: app.thumbnails.get(Number(card.page_id))?.filename
          ? `/media/featured/${app.thumbnails.get(Number(card.page_id)).filename}`
          : "",
      }))
      .filter((card) => card.thumbnail);
    app.articleById = new Map(app.articles.map((article) => [article.page_id, article]));
    app.state.saved = app.state.saved.filter((id) => app.articleById.has(Number(id))).map(Number);
    bindGlobalActions();
    route();
  } catch (error) {
    renderLoadError(error);
  }
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...defaultState,
      ...stored,
      settings: { ...defaultState.settings, ...(stored.settings || {}) },
      saved: Array.isArray(stored.saved) ? stored.saved : [],
      installedPacks: Array.isArray(stored.installedPacks)
        ? stored.installedPacks
        : defaultState.installedPacks,
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  const persisted = {
    saved: app.state.saved,
    installedPacks: app.state.installedPacks,
    savedSort: app.state.savedSort,
    settings: app.state.settings,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    showToast("Browser storage is unavailable; changes will reset after reload");
  }
  updateSavedCount();
}

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = app.state.settings.theme;
  root.dataset.reduceMotion = String(app.state.settings.reduceMotion);
  root.dataset.highContrast = String(app.state.settings.highContrast);
  root.style.setProperty("--text-scale", String(app.state.settings.textScale));
}

function route() {
  const routeName = location.hash.replace(/^#\//, "").split("/")[0] || "explore";
  app.route = ["explore", "saved", "packs", "settings", "about"].includes(routeName)
    ? routeName
    : "explore";
  setActiveNavigation();
  if (app.observer) app.observer.disconnect();

  const renderers = {
    explore: renderExplore,
    saved: renderSaved,
    packs: renderPacks,
    settings: renderSettings,
    about: renderAbout,
  };
  renderers[app.route]();
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: app.state.settings.reduceMotion ? "auto" : "smooth" });
}

function setActiveNavigation() {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === app.route);
  });
  updateSavedCount();
}

function updateSavedCount() {
  savedCount.textContent = String(app.state.saved.length);
}

function renderExplore() {
  const topics = getTopics();
  view.innerHTML = `
    <div class="explore-layout">
      <section aria-label="Article discovery">
        <div class="feed-toolbar">
          <div class="search-field ${app.state.query ? "has-value" : ""}">
            ${icon("search")}
            <input id="feed-search" type="search" placeholder="Search 500 articles" autocomplete="off" value="${escapeHtml(app.state.query)}" aria-label="Search articles" />
            <button class="search-clear" type="button" data-action="clear-search" aria-label="Clear search">${icon("x")}</button>
          </div>
          <div class="filter-row" aria-label="Topic filters">
            <button class="filter-chip ${app.state.topic === "all" ? "active" : ""}" type="button" data-topic="all">For you</button>
            ${topics.map((topic) => `<button class="filter-chip ${app.state.topic === topic ? "active" : ""}" type="button" data-topic="${escapeHtml(topic)}">${titleCase(topic)}</button>`).join("")}
          </div>
        </div>
        <div id="feed" class="feed"></div>
        <div id="feed-sentinel" class="feed-sentinel" aria-hidden="true"></div>
      </section>
      <aside class="discovery-rail" aria-label="Collection overview">
        <div class="rail-section">
          <h2>Starter collection</h2>
          <div class="rail-stat"><span>Curated articles</span><strong>${app.articles.length}</strong></div>
          <div class="rail-stat"><span>Saved locally</span><strong>${app.state.saved.length}</strong></div>
          <div class="rail-stat"><span>Image set</span><strong>108 MB</strong></div>
        </div>
        <div class="rail-section">
          <h2>Browse topics</h2>
          <div class="rail-topic-list">
            ${topics.slice(0, 8).map((topic) => `<button type="button" data-topic="${escapeHtml(topic)}">${titleCase(topic)}</button>`).join("")}
          </div>
        </div>
        <div class="rail-footer">
          Summaries and media are sourced from Wikipedia. Doompedia is not affiliated with the Wikimedia Foundation.
          <br /><a href="#/about">About this project</a>
        </div>
      </aside>
    </div>
  `;

  document.querySelector("#feed-search").addEventListener("input", onSearchInput);
  document.querySelectorAll("[data-topic]").forEach((button) => {
    button.addEventListener("click", () => {
      app.state.topic = button.dataset.topic;
      app.state.visibleCount = PAGE_SIZE;
      renderExplore();
    });
  });
  document.querySelector("[data-action='clear-search']").addEventListener("click", () => {
    app.state.query = "";
    app.state.visibleCount = PAGE_SIZE;
    renderExplore();
  });
  renderFeed();
}

function renderFeed() {
  if (app.observer) {
    app.observer.disconnect();
    app.observer = null;
  }

  const feed = document.querySelector("#feed");
  const filtered = filteredArticles();
  const visible = filtered.slice(0, app.state.visibleCount);
  if (!visible.length) {
    feed.innerHTML = `<div class="feed-empty">No articles match this search.</div>`;
    return;
  }

  feed.innerHTML = visible.map(articleCard).join("");
  bindArticleActions(feed);

  const sentinel = document.querySelector("#feed-sentinel");
  if (app.state.visibleCount < filtered.length) {
    app.observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        app.state.visibleCount += PAGE_SIZE;
        renderFeed();
      },
      { rootMargin: "500px 0px" },
    );
    app.observer.observe(sentinel);
  }
}

function filteredArticles() {
  const query = app.state.query.trim().toLocaleLowerCase();
  let articles = app.articles.filter((article) => {
    const topicMatch = app.state.topic === "all" || article.topic_key === app.state.topic;
    const queryMatch =
      !query ||
      article.title.toLocaleLowerCase().includes(query) ||
      article.summary.toLocaleLowerCase().includes(query);
    return topicMatch && queryMatch;
  });

  if (query) {
    articles = [...articles].sort((a, b) => {
      const aTitle = a.title.toLocaleLowerCase();
      const bTitle = b.title.toLocaleLowerCase();
      const score = (title) => (title === query ? 0 : title.startsWith(query) ? 1 : title.includes(query) ? 2 : 3);
      return score(aTitle) - score(bTitle) || a.order - b.order;
    });
  } else if (app.state.settings.discovery === "shuffle") {
    articles = [...articles].sort((a, b) => seededScore(a.page_id) - seededScore(b.page_id));
  }
  return articles;
}

function articleCard(article) {
  const isSaved = app.state.saved.includes(article.page_id);
  const imageUrl = app.state.settings.previews ? article.thumbnail : "/assets/elephant-logo.png";
  return `
    <article class="article-card" data-article-id="${article.page_id}">
      <button class="article-media ${app.state.settings.previews ? "" : "no-preview"}" type="button" data-action="open-article" aria-label="Open ${escapeHtml(article.title)}">
        <img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" />
        <span class="topic-label">${escapeHtml(titleCase(article.topic_key))}</span>
      </button>
      <div class="article-content">
        <h2>${escapeHtml(article.title)}</h2>
        <p>${escapeHtml(article.summary)}</p>
      </div>
      <div class="article-actions">
        <button class="icon-button ${isSaved ? "saved" : ""}" type="button" data-action="toggle-save" aria-label="${isSaved ? "Remove from saved" : "Save article"}">${icon("bookmark")}</button>
        <button class="icon-button" type="button" data-action="share" aria-label="Share article">${icon("share")}</button>
        <button class="read-button" type="button" data-action="open-article">Read summary ${icon("chevron")}</button>
      </div>
    </article>
  `;
}

function onSearchInput(event) {
  app.state.query = event.target.value;
  app.state.visibleCount = PAGE_SIZE;
  const field = event.target.closest(".search-field");
  field.classList.toggle("has-value", Boolean(app.state.query));
  renderFeed();
}

function renderSaved() {
  const savedArticles = app.state.saved
    .map((id) => app.articleById.get(id))
    .filter(Boolean);
  const sorted =
    app.state.savedSort === "title"
      ? [...savedArticles].sort((a, b) => a.title.localeCompare(b.title))
      : savedArticles;

  view.innerHTML = `
    ${viewHeader("Saved", `${savedArticles.length} article${savedArticles.length === 1 ? "" : "s"} kept in this browser`, "Your library")}
    <div class="content-page">
      ${
        savedArticles.length
          ? `
            <div class="saved-toolbar">
              <div class="segmented-control" aria-label="Saved article sorting">
                <button type="button" data-sort="recent" class="${app.state.savedSort === "recent" ? "active" : ""}">Recently saved</button>
                <button type="button" data-sort="title" class="${app.state.savedSort === "title" ? "active" : ""}">Title</button>
              </div>
              <button class="text-button danger-button" type="button" data-action="clear-saved">${icon("trash")} Clear saved</button>
            </div>
            <div class="saved-grid">
              ${sorted.map(savedCard).join("")}
            </div>
          `
          : emptyState("bookmark", "Nothing saved yet", "Save an article from Explore and it will appear here.", "Browse articles", "#/explore")
      }
    </div>
  `;

  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      app.state.savedSort = button.dataset.sort;
      saveState();
      renderSaved();
    });
  });
  document.querySelector("[data-action='clear-saved']")?.addEventListener("click", clearSaved);
  bindArticleActions(view);
}

function savedCard(article) {
  const imageUrl = app.state.settings.previews ? article.thumbnail : "/assets/elephant-logo.png";
  return `
    <article class="saved-card" data-article-id="${article.page_id}">
      <button class="saved-image" type="button" data-action="open-article" aria-label="Open ${escapeHtml(article.title)}">
        <img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" />
      </button>
      <div class="saved-card-body">
        <h2>${escapeHtml(article.title)}</h2>
        <div class="saved-card-footer">
          <span>${escapeHtml(article.topic_key)}</span>
          <button class="icon-button saved" type="button" data-action="toggle-save" aria-label="Remove from saved">${icon("bookmark")}</button>
        </div>
      </div>
    </article>
  `;
}

function renderPacks() {
  const packs = [
    {
      id: "featured",
      title: "Featured starter",
      description: "500 visual articles selected from Wikipedia's Vital Articles.",
      size: "108 MB media",
      count: "500 articles",
      href: `${SITE_ORIGIN}/content/featured_thumbnails.json`,
    },
    {
      id: "en-core-1m",
      title: "English Core",
      description: "Broad offline summary coverage for everyday discovery.",
      size: "Up to 600 MB",
      count: "1,000,000 articles",
      href: `${PACK_BASE_URL}/en-core-1m/v1/manifest.json`,
    },
    {
      id: "en-science-250k",
      title: "Science and technology",
      description: "Focused coverage across science, computing, and engineering.",
      size: "Pack size varies",
      count: "Focused collection",
      href: `${PACK_BASE_URL}/en-science-250k/v1/manifest.json`,
    },
    {
      id: "en-history-250k",
      title: "History and society",
      description: "People, places, events, government, and culture.",
      size: "Pack size varies",
      count: "Focused collection",
      href: `${PACK_BASE_URL}/en-history-250k/v1/manifest.json`,
    },
    {
      id: "en-all-summaries",
      title: "English all summaries",
      description: "Largest English summary pack for broad offline lookup.",
      size: "Large install",
      count: "All extracted summaries",
      href: `${PACK_BASE_URL}/en-all-summaries/v1/manifest.json`,
    },
  ];

  view.innerHTML = `
    ${viewHeader("Packs", "Choose the collections available to this browser.", "Offline data")}
    <div class="content-page">
      <div class="pack-list">
        ${packs.map(packRow).join("")}
      </div>
    </div>
  `;

  document.querySelectorAll("[data-action='toggle-pack']").forEach((button) => {
    button.addEventListener("click", () => togglePack(button.dataset.packId));
  });
}

function packRow(pack, index) {
  const installed = app.state.installedPacks.includes(pack.id);
  return `
    <article class="pack-row">
      <div class="pack-icon">${icon(index === 0 ? "sparkles" : "download")}</div>
      <div class="pack-copy">
        <h2>${escapeHtml(pack.title)}</h2>
        <p>${escapeHtml(pack.description)}</p>
        <div class="pack-meta"><span>${escapeHtml(pack.count)}</span><span>${escapeHtml(pack.size)}</span></div>
      </div>
      <div class="pack-actions">
        ${
          installed
            ? `<span class="installed-label">${icon("check")} Available</span>`
            : `<button class="primary-button" type="button" data-action="toggle-pack" data-pack-id="${pack.id}">${icon("download")} Add</button>`
        }
        <a class="icon-button" href="${pack.href}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(pack.title)} manifest">${icon("external")}</a>
      </div>
    </article>
  `;
}

function togglePack(packId) {
  if (!app.state.installedPacks.includes(packId)) {
    app.state.installedPacks.push(packId);
    saveState();
    showToast("Pack added to this browser");
    renderPacks();
  }
}

function renderSettings() {
  const settings = app.state.settings;
  view.innerHTML = `
    ${viewHeader("Settings", "", "Preferences")}
    <div class="content-page settings-form">
      <section class="settings-group">
        <h2>Discovery</h2>
        ${selectRow("Feed order", "discovery", [
          ["curated", "Curated"],
          ["shuffle", "Shuffle"],
        ], settings.discovery)}
        ${switchRow("Article images", "previews", settings.previews)}
      </section>
      <section class="settings-group">
        <h2>Appearance</h2>
        ${selectRow("Theme", "theme", [
          ["system", "System"],
          ["light", "Light"],
          ["dark", "Dark"],
        ], settings.theme)}
        <div class="setting-row">
          <div><label for="text-scale">Text size</label></div>
          <div class="range-control">
            <span>A</span>
            <input id="text-scale" data-setting="textScale" type="range" min="0.9" max="1.15" step="0.05" value="${settings.textScale}" />
            <strong>A</strong>
          </div>
        </div>
        ${switchRow("Reduce motion", "reduceMotion", settings.reduceMotion)}
        ${switchRow("High contrast", "highContrast", settings.highContrast)}
      </section>
      <section class="settings-group">
        <h2>Storage</h2>
        <div class="setting-row">
          <div><span>Saved articles</span><small>${app.state.saved.length} stored in this browser</small></div>
          <button class="quiet-button danger-button" type="button" data-action="clear-saved">Clear</button>
        </div>
      </section>
    </div>
  `;

  document.querySelectorAll("[data-setting]").forEach((control) => {
    control.addEventListener("change", onSettingChange);
    if (control.type === "range") control.addEventListener("input", onSettingChange);
  });
  document.querySelector("[data-action='clear-saved']").addEventListener("click", clearSaved);
}

function selectRow(label, key, options, value) {
  return `
    <div class="setting-row">
      <label for="setting-${key}">${label}</label>
      <select id="setting-${key}" data-setting="${key}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${value === optionValue ? "selected" : ""}>${optionLabel}</option>`).join("")}
      </select>
    </div>
  `;
}

function switchRow(label, key, checked) {
  return `
    <div class="setting-row">
      <label for="setting-${key}">${label}</label>
      <label class="switch">
        <input id="setting-${key}" data-setting="${key}" type="checkbox" ${checked ? "checked" : ""} />
        <span aria-hidden="true"></span>
      </label>
    </div>
  `;
}

function onSettingChange(event) {
  const control = event.target;
  const key = control.dataset.setting;
  const value =
    control.type === "checkbox"
      ? control.checked
      : control.type === "range"
        ? Number(control.value)
        : control.value;
  app.state.settings[key] = value;
  saveState();
  applySettings();
}

function renderAbout() {
  view.innerHTML = `
    ${viewHeader("About", "Project details and data sources.", "Doompedia")}
    <div class="content-page about-layout">
      <div class="about-copy">
        <h2>Wikipedia discovery without the browser tab spiral.</h2>
        <p>Doompedia turns short Wikipedia summaries into a visual feed that can be searched, saved, and packaged for offline use. The project includes this browser experience, a native Android app, and a data pipeline for building downloadable collections.</p>
        <p>The starter collection uses 500 freely licensed lead images and article summaries selected from Wikipedia's Vital Articles lists. Larger packs contain text summaries and fetch images separately so storage remains predictable.</p>
        <p>Doompedia is an independent project and is not affiliated with or endorsed by the Wikimedia Foundation.</p>
      </div>
      <aside>
        <div class="project-facts">
          <div class="project-fact"><span>Starter collection</span><strong>500 articles</strong></div>
          <div class="project-fact"><span>Hosted thumbnails</span><strong>108 MB</strong></div>
          <div class="project-fact"><span>Core pack target</span><strong>1M summaries</strong></div>
          <div class="project-fact"><span>License records</span><strong>Included</strong></div>
        </div>
        <div class="project-links">
          <a href="https://github.com/elephancy/doompedia" target="_blank" rel="noreferrer">Project source ${icon("external")}</a>
          <a href="/content/featured_thumbnails.json" target="_blank" rel="noreferrer">Image attribution ${icon("external")}</a>
        </div>
      </aside>
    </div>
  `;
}

function bindGlobalActions() {
  document.querySelector("[data-action='open-search']").addEventListener("click", () => {
    location.hash = "#/explore";
    requestAnimationFrame(() => document.querySelector("#feed-search")?.focus());
  });
}

function bindArticleActions(container) {
  container.querySelectorAll("[data-article-id]").forEach((articleElement) => {
    const article = app.articleById.get(Number(articleElement.dataset.articleId));
    articleElement.querySelectorAll("[data-action='open-article']").forEach((button) => {
      button.addEventListener("click", () => openArticle(article));
    });
    articleElement.querySelector("[data-action='toggle-save']")?.addEventListener("click", () => {
      toggleSave(article.page_id);
    });
    articleElement.querySelector("[data-action='share']")?.addEventListener("click", () => {
      shareArticle(article);
    });
  });
}

function openArticle(article) {
  const root = document.querySelector("#dialog-root");
  const isSaved = app.state.saved.includes(article.page_id);
  const imageUrl = app.state.settings.previews ? article.thumbnail : "/assets/elephant-logo.png";
  root.innerHTML = `
    <dialog>
      <article class="article-dialog" data-article-id="${article.page_id}">
        <div class="dialog-image">
          <img src="${escapeHtml(imageUrl)}" alt="" />
          <button class="icon-button dialog-close" type="button" data-action="close-dialog" aria-label="Close">${icon("x")}</button>
        </div>
        <div class="dialog-copy">
          <span class="eyebrow">${escapeHtml(titleCase(article.topic_key))}</span>
          <h2>${escapeHtml(article.title)}</h2>
          <p class="dialog-summary">${escapeHtml(article.summary)}</p>
          <div class="dialog-actions">
            <button class="quiet-button ${isSaved ? "active" : ""}" type="button" data-action="dialog-save">${icon("bookmark")} ${isSaved ? "Saved" : "Save"}</button>
            <a class="primary-button" href="${escapeHtml(article.wiki_url)}" target="_blank" rel="noreferrer">Read on Wikipedia ${icon("external")}</a>
          </div>
        </div>
      </article>
    </dialog>
  `;
  const dialog = root.querySelector("dialog");
  dialog.querySelector("[data-action='close-dialog']").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-action='dialog-save']").addEventListener("click", (event) => {
    toggleSave(article.page_id, false);
    const saved = app.state.saved.includes(article.page_id);
    event.currentTarget.classList.toggle("active", saved);
    event.currentTarget.innerHTML = `${icon("bookmark")} ${saved ? "Saved" : "Save"}`;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    root.innerHTML = "";
    if (app.route === "saved") renderSaved();
    if (app.route === "explore") renderFeed();
  });
  dialog.showModal();
}

function toggleSave(articleId, rerender = true) {
  const index = app.state.saved.indexOf(articleId);
  if (index >= 0) {
    app.state.saved.splice(index, 1);
    showToast("Removed from saved");
  } else {
    app.state.saved.unshift(articleId);
    showToast("Saved to your library");
  }
  saveState();
  if (rerender) {
    if (app.route === "saved") renderSaved();
    if (app.route === "explore") renderFeed();
  }
}

function clearSaved() {
  if (!app.state.saved.length) {
    showToast("There are no saved articles");
    return;
  }
  app.state.saved = [];
  saveState();
  showToast("Saved articles cleared");
  if (app.route === "saved") renderSaved();
  if (app.route === "settings") renderSettings();
}

async function shareArticle(article) {
  const data = {
    title: article.title,
    text: article.summary,
    url: article.wiki_url,
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
    } else {
      await navigator.clipboard.writeText(article.wiki_url);
      showToast("Wikipedia link copied");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Could not share this article");
  }
}

function showToast(message) {
  clearTimeout(app.toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  app.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function viewHeader(title, description, eyebrow) {
  return `
    <header class="view-header">
      <div>
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
    </header>
  `;
}

function emptyState(iconName, title, description, actionLabel, href) {
  return `
    <div class="empty-state">
      <div class="empty-state-inner">
        <div class="empty-state-icon">${icon(iconName)}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        <a class="primary-button" href="${href}">${escapeHtml(actionLabel)}</a>
      </div>
    </div>
  `;
}

function renderLoadError(error) {
  view.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-inner">
        <div class="empty-state-icon">${icon("info")}</div>
        <h2>Content unavailable</h2>
        <p>${escapeHtml(error.message || "The starter collection could not be loaded.")}</p>
        <button class="primary-button" type="button" onclick="location.reload()">${icon("refresh")} Try again</button>
      </div>
    </div>
  `;
}

function getTopics() {
  const counts = new Map();
  app.articles.forEach((article) => {
    counts.set(article.topic_key, (counts.get(article.topic_key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic);
}

function seededScore(pageId) {
  const day = Math.floor(Date.now() / 86_400_000);
  let value = (pageId ^ day) * 2654435761;
  value ^= value >>> 16;
  return value >>> 0;
}

function titleCase(value) {
  return String(value || "general")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}
