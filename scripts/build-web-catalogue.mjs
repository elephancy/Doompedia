import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  if (!args[index]?.startsWith("--") || !args[index + 1]) {
    throw new Error("Expected --origin and --out values.");
  }
  options.set(args[index], args[index + 1]);
}
for (const key of ["--origin", "--out"]) {
  if (!options.get(key)) throw new Error(`Missing ${key}.`);
}

const origin = new URL(options.get("--origin"));
const isLocal = origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
if (
  (origin.protocol !== "https:" && !(origin.protocol === "http:" && isLocal)) ||
  origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
) throw new Error("Origin must be an HTTPS origin, or a loopback HTTP origin for local tests.");

async function readVerifiedSource(path) {
  const url = new URL(path, origin);
  const response = await fetch(url, {
    redirect: "error",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  const etag = response.headers.get("etag");
  if (!response.ok || !etag) throw new Error(`Source unavailable or missing ETag: ${path}`);
  const data = await response.json();
  const head = await fetch(url, {
    method: "HEAD",
    redirect: "error",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!head.ok || head.headers.get("etag") !== etag) {
    throw new Error(`Source changed during capture: ${path}`);
  }
  return { data, etag };
}

const [cardSource, thumbnailSource] = await Promise.all([
  readVerifiedSource("/content/seed_en_cards.json"),
  readVerifiedSource("/content/featured_thumbnails.json"),
]);
for (const [path, expected] of [
  ["/content/seed_en_cards.json", cardSource.etag],
  ["/content/featured_thumbnails.json", thumbnailSource.etag],
]) {
  const response = await fetch(new URL(path, origin), {
    method: "HEAD",
    redirect: "error",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || response.headers.get("etag") !== expected) {
    throw new Error(`Source changed while the catalog was captured: ${path}`);
  }
}
const cards = cardSource.data;
const manifest = thumbnailSource.data;
if (!Array.isArray(cards) || !Array.isArray(manifest.articles)) {
  throw new Error("Expected a card array and a thumbnail manifest with an articles array.");
}
if (manifest.count !== manifest.articles.length) {
  throw new Error("Thumbnail manifest count does not match its entries.");
}
const thumbnails = new Map(manifest.articles.map((entry) => [Number(entry.page_id), entry]));
const featuredImageBytes = manifest.articles.reduce((total, entry) => {
  const bytes = Number(entry.bytes);
  return total + (Number.isFinite(bytes) && bytes > 0 ? bytes : 0);
}, 0);
const articles = [];
for (const [order, card] of cards.entries()) {
  const pageId = Number(card.page_id);
  const entry = thumbnails.get(pageId);
  if (!entry?.filename) throw new Error(`Missing thumbnail for card at position ${order}.`);
  if (
    !Number.isSafeInteger(pageId) ||
    typeof entry.filename !== "string" ||
    [card.title, card.summary, card.wiki_url, card.topic_key].some((value) => typeof value !== "string")
  ) throw new Error(`Unsupported card or thumbnail at position ${order}.`);
  articles.push({
    page_id: pageId,
    title: card.title,
    summary: card.summary,
    wiki_url: card.wiki_url,
    topic_key: card.topic_key,
    thumbnail: `/media/featured/${entry.filename}`,
    order,
  });
}
const catalogue = {
  version: 1,
  sources: {
    cardsETag: cardSource.etag,
    thumbnailsETag: thumbnailSource.etag,
  },
  count: articles.length,
  featuredImageBytes,
  articles,
};
writeFileSync(options.get("--out"), JSON.stringify(catalogue), { flag: "wx" });
console.log(`Wrote ${articles.length} searchable articles to ${options.get("--out")}.`);
