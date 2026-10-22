"""Build the bundled featured article and thumbnail starter pack."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import json
import mimetypes
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


API_URL = "https://en.wikipedia.org/w/api.php"
VITAL_ARTICLES_PAGE = "Wikipedia:Vital articles/Level/3"
VITAL_ARTICLES_FALLBACK_PAGE = "Wikipedia:Vital articles/Level/4"
VITAL_ARTICLES_DEEP_FALLBACK_PAGE = "Wikipedia:Vital articles/Level/5"
USER_AGENT = "Doompedia/0.1 (+https://github.com/elephancy/doompedia)"
MAX_THUMBNAIL_BYTES = 1_500_000
DOWNLOAD_INTERVAL_SECONDS = 0.4
_download_lock = threading.Lock()
_last_download_started = 0.0
SHOWCASE_TITLES = (
    "Earth",
    "Moon",
    "Solar System",
    "Milky Way",
    "Black hole",
    "Big Bang",
    "Dinosaur",
    "Human",
    "DNA",
    "Albert Einstein",
    "Marie Curie",
    "Isaac Newton",
    "Alan Turing",
    "William Shakespeare",
    "Ancient Egypt",
    "Roman Empire",
    "Ancient Greece",
    "Renaissance",
    "Industrial Revolution",
    "World War I",
    "World War II",
    "Cold War",
    "French Revolution",
    "Apollo 11",
    "Computer",
    "Artificial intelligence",
    "Climate change",
    "Amazon rainforest",
    "Mount Everest",
    "Pacific Ocean",
    "Antarctica",
    "Great Barrier Reef",
    "United States",
    "China",
    "India",
    "Brazil",
    "Japan",
    "New York City",
    "Paris",
    "London",
    "Photography",
    "Film",
    "Music",
)


@dataclass(frozen=True)
class FeaturedArticle:
    page_id: int
    title: str
    summary: str
    article_url: str
    image_title: str
    thumbnail_url: str


REMOTE_HOSTS = frozenset({"en.wikipedia.org", "upload.wikimedia.org"})


def checked_remote_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in REMOTE_HOSTS
            or parsed.port not in (None, 443) or parsed.username is not None
            or parsed.password is not None or parsed.fragment):
        raise ValueError("Only approved HTTPS Wikimedia endpoints are permitted")
    return url


class WikimediaRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_remote_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_remote(request: urllib.request.Request, timeout: int):
    checked_remote_url(request.full_url)
    return urllib.request.build_opener(WikimediaRedirect()).open(request, timeout=timeout)


def request_json(params: dict[str, Any], retries: int = 4) -> dict[str, Any]:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    for attempt in range(retries):
        try:
            with open_remote(request, timeout=30) as response:
                return json.load(response)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def page_links(page: str) -> list[dict[str, Any]]:
    payload = request_json(
        {
            "action": "parse",
            "format": "json",
            "formatversion": "2",
            "page": page,
            "prop": "links",
            "redirects": "1",
        }
    )
    return payload["parse"]["links"]


def vital_article_titles(page: str) -> list[str]:
    titles = {
        link["title"]
        for link in page_links(page)
        if link.get("ns") == 0 and link.get("title")
    }
    return sorted(
        titles,
        key=lambda title: hashlib.sha256(title.encode("utf-8")).digest(),
    )


def fallback_vital_titles(page: str) -> list[str]:
    level_match = re.search(r"/Level/(\d+)$", page)
    level = level_match.group(1) if level_match else ""
    subpages = {
        link["title"]
        for link in page_links(page)
        if link.get("ns") == 4
        and (
            link.get("title", "").startswith(f"Wikipedia:Vital articles/Level/{level}/")
            or link.get("title", "").startswith(f"Wikipedia:Vital articles/Level {level}/")
        )
    }
    titles: set[str] = set()
    for subpage in sorted(subpages):
        titles.update(vital_article_titles(subpage))
    return sorted(
        titles,
        key=lambda title: hashlib.sha256(title.encode("utf-8")).digest(),
    )


def unique_titles(*title_groups: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for group in title_groups:
        for title in group:
            normalized = title.casefold()
            if normalized in seen:
                continue
            seen.add(normalized)
            merged.append(title)
    return merged


def fetch_articles(titles: list[str], stop_after: int | None = None) -> list[FeaturedArticle]:
    articles: list[FeaturedArticle] = []
    for batch in chunks(titles, 40):
        payload = request_json(
            {
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "redirects": "1",
                "prop": "extracts|pageimages|info",
                "exintro": "1",
                "explaintext": "1",
                "exsentences": "3",
                "piprop": "thumbnail|name",
                "pithumbsize": "512",
                "pilicense": "free",
                "inprop": "url",
                "titles": "|".join(batch),
            }
        )
        for page in payload.get("query", {}).get("pages", []):
            thumbnail = page.get("thumbnail", {})
            if page.get("missing") or not thumbnail.get("source") or not page.get("pageimage"):
                continue
            summary = clean_text(page.get("extract", ""))
            if not summary:
                continue
            articles.append(
                FeaturedArticle(
                    page_id=int(page["pageid"]),
                    title=page["title"],
                    summary=summary,
                    article_url=page.get("canonicalurl")
                    or f"https://en.wikipedia.org/wiki/{urllib.parse.quote(page['title'].replace(' ', '_'))}",
                    image_title=page["pageimage"],
                    thumbnail_url=thumbnail["source"],
                )
            )
        if stop_after is not None and len(articles) >= stop_after:
            break
    return articles


def fetch_image_metadata(image_titles: list[str]) -> dict[str, dict[str, str]]:
    metadata: dict[str, dict[str, str]] = {}
    for batch in chunks(image_titles, 40):
        payload = request_json(
            {
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "prop": "imageinfo",
                "iiprop": "url|extmetadata",
                "iiurlwidth": "512",
                "titles": "|".join(f"File:{title}" for title in batch),
            }
        )
        for page in payload.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            ext = info.get("extmetadata", {})
            metadata[image_key(page.get("title", ""))] = {
                "original_url": info.get("descriptionurl", ""),
                "wikimedia_thumbnail_url": info.get("thumburl", ""),
                "license": metadata_value(ext, "LicenseShortName"),
                "license_url": metadata_value(ext, "LicenseUrl"),
                "artist": strip_html(metadata_value(ext, "Artist")),
                "credit": strip_html(metadata_value(ext, "Credit")),
            }
    return metadata


def metadata_value(metadata: dict[str, Any], key: str) -> str:
    value = metadata.get(key, {})
    return str(value.get("value", "")).strip() if isinstance(value, dict) else ""


def image_key(value: str) -> str:
    return value.removeprefix("File:").replace("_", " ").casefold().strip()


def strip_html(value: str) -> str:
    return clean_text(re.sub(r"<[^>]+>", " ", html.unescape(value)))


def clean_text(value: str) -> str:
    return " ".join(value.split()).strip()


def topic_for(title: str, summary: str) -> str:
    text = f"{title} {summary}".lower()
    topic_keywords = {
        "science": ("science", "physics", "chemistry", "mathematics", "biology", "scientist"),
        "technology": ("technology", "computer", "internet", "engineer", "invention"),
        "history": ("history", "empire", "war", "ancient", "revolution", "century"),
        "culture": ("artist", "writer", "music", "film", "literature", "painting", "philosopher"),
        "geography": ("country", "city", "river", "mountain", "ocean", "island"),
        "environment": ("climate", "ecosystem", "forest", "species", "environment"),
    }
    for topic, keywords in topic_keywords.items():
        if any(keyword in text for keyword in keywords):
            return topic
    return "general"


def extension_for(url: str, content_type: str) -> str:
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) or ""
    if guessed == ".jpe":
        guessed = ".jpg"
    if guessed in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return guessed
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"} else ".jpg"


def content_output_dir(output_assets: Path) -> Path:
    return output_assets if output_assets.name == "content" else output_assets / "content"


def download_thumbnail(article: FeaturedArticle, output_dir: Path) -> dict[str, Any]:
    existing = next(output_dir.glob(f"{article.page_id}-512.*"), None)
    if existing is not None and 0 < existing.stat().st_size <= MAX_THUMBNAIL_BYTES:
        body = existing.read_bytes()
        return {
            "filename": existing.name,
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "mime_type": mimetypes.guess_type(existing.name)[0] or "image/jpeg",
        }

    request = urllib.request.Request(
        article.thumbnail_url,
        headers={"Accept": "image/*", "User-Agent": USER_AGENT},
    )
    for attempt in range(6):
        try:
            wait_for_download_slot()
            with open_remote(request, timeout=45) as response:
                body = response.read(MAX_THUMBNAIL_BYTES + 1)
                content_type = response.headers.get("Content-Type", "image/jpeg")
            break
        except urllib.error.HTTPError as error:
            if error.code not in {429, 503} or attempt == 5:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else min(15 * (attempt + 1), 75)
            time.sleep(delay)
    else:
        raise RuntimeError(f"Could not download thumbnail for {article.title}")

    if len(body) > MAX_THUMBNAIL_BYTES:
        raise ValueError(f"Thumbnail exceeds 1.5 MB: {article.title}")
    if not content_type.startswith("image/"):
        raise ValueError(f"Unexpected thumbnail content type for {article.title}: {content_type}")

    extension = extension_for(article.thumbnail_url, content_type)
    filename = f"{article.page_id}-512{extension}"
    destination = output_dir / filename
    destination.write_bytes(body)
    return {
        "filename": filename,
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "mime_type": content_type.split(";", 1)[0],
    }


def wait_for_download_slot() -> None:
    global _last_download_started
    with _download_lock:
        elapsed = time.monotonic() - _last_download_started
        if elapsed < DOWNLOAD_INTERVAL_SECONDS:
            time.sleep(DOWNLOAD_INTERVAL_SECONDS - elapsed)
        _last_download_started = time.monotonic()


def build_pack(
    output_assets: Path,
    output_media: Path,
    output_web_content: Path | None,
    public_base_url: str,
    count: int,
) -> None:
    thumbnail_dir = output_media
    thumbnail_dir.mkdir(parents=True, exist_ok=True)

    primary_titles = vital_article_titles(VITAL_ARTICLES_PAGE)
    level_four_titles = fallback_vital_titles(VITAL_ARTICLES_FALLBACK_PAGE)
    level_five_titles = fallback_vital_titles(VITAL_ARTICLES_DEEP_FALLBACK_PAGE)
    candidate_target = max(count + 250, int(count * 1.35))
    all_titles = unique_titles(primary_titles, level_four_titles, level_five_titles)
    candidates = fetch_articles(all_titles, stop_after=candidate_target)[:candidate_target]
    if len(candidates) < count:
        raise RuntimeError(
            f"Only {len(candidates)} vital articles supplied free thumbnails "
            f"from {len(all_titles)} candidate titles"
        )

    image_metadata = fetch_image_metadata([article.image_title for article in candidates])
    candidates = [
        replace(
            article,
            thumbnail_url=image_metadata.get(image_key(article.image_title), {}).get("wikimedia_thumbnail_url")
            or article.thumbnail_url,
        )
        for article in candidates
    ]

    downloads: dict[int, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(download_thumbnail, article, thumbnail_dir): article
            for article in candidates
        }
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            article = futures[future]
            try:
                downloads[article.page_id] = future.result()
            except Exception as error:
                print(f"Skipped {article.title}: {error}")
            if completed % 25 == 0 or completed == len(candidates):
                print(f"Processed {completed}/{len(candidates)} thumbnail candidates")

    successful = [article for article in candidates if article.page_id in downloads]
    showcase_rank = {title.casefold(): index for index, title in enumerate(SHOWCASE_TITLES)}
    original_rank = {article.page_id: index for index, article in enumerate(successful)}
    selected = sorted(
        successful,
        key=lambda article: (
            showcase_rank.get(article.title.casefold(), len(SHOWCASE_TITLES)),
            original_rank[article.page_id],
        ),
    )[:count]
    if len(selected) < count:
        raise RuntimeError(f"Only {len(selected)} thumbnail downloads succeeded")

    selected_filenames = {downloads[article.page_id]["filename"] for article in selected}
    for path in thumbnail_dir.iterdir():
        if path.is_file() and path.name not in selected_filenames:
            path.unlink()

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    seed_rows: list[dict[str, Any]] = []
    manifest_rows: list[dict[str, Any]] = []
    for index, article in enumerate(selected):
        downloaded = downloads[article.page_id]
        image = image_metadata.get(image_key(article.image_title), {})
        seed_rows.append(
            {
                "page_id": article.page_id,
                "lang": "en",
                "title": article.title,
                "summary": article.summary,
                "wiki_url": article.article_url,
                "topic_key": topic_for(article.title, article.summary),
                "quality_score": round(1.0 - (index / max(count - 1, 1)) * 0.04, 6),
                "is_disambiguation": False,
                "source_rev_id": None,
                "updated_at": generated_at,
                "aliases": [],
            }
        )
        manifest_rows.append(
            {
                "page_id": article.page_id,
                "title": article.title,
                "article_url": article.article_url,
                "thumbnail_url": f"{public_base_url.rstrip('/')}/{downloaded['filename']}",
                "thumbnail_source_url": article.thumbnail_url,
                "image_title": article.image_title,
                **downloaded,
                **image,
            }
        )

    content_dir = content_output_dir(output_assets)
    content_dir.mkdir(parents=True, exist_ok=True)
    seed_path = content_dir / "seed_en_cards.json"
    manifest_path = content_dir / "featured_thumbnails.json"
    seed_path.write_text(json.dumps(seed_rows, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    manifest_path.write_text(
        json.dumps(
            {
                "version": 1,
                "count": count,
                "width": 512,
                "public_base_url": public_base_url.rstrip("/"),
                "generated_at": generated_at,
                "selection_source": (
                    f"{VITAL_ARTICLES_PAGE}; {VITAL_ARTICLES_FALLBACK_PAGE}; "
                    f"{VITAL_ARTICLES_DEEP_FALLBACK_PAGE}"
                ),
                "articles": manifest_rows,
            },
            indent=2,
            ensure_ascii=True,
        )
        + "\n",
        encoding="utf-8",
    )
    if output_web_content is not None:
        output_web_content.mkdir(parents=True, exist_ok=True)
        shutil.copy2(seed_path, output_web_content / seed_path.name)
        shutil.copy2(manifest_path, output_web_content / manifest_path.name)
    total_bytes = sum(row["bytes"] for row in manifest_rows)
    print(f"Wrote {count} articles and {total_bytes / 1024 / 1024:.1f} MB of thumbnails")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-assets",
        type=Path,
        required=True,
        help="Android app assets directory",
    )
    parser.add_argument(
        "--output-media",
        type=Path,
        required=True,
        help="Directory of thumbnail files to publish with the website",
    )
    parser.add_argument(
        "--output-web-content",
        type=Path,
        help="Optional web directory that receives copies of the generated JSON files",
    )
    parser.add_argument(
        "--public-base-url",
        default="https://doompedia.elfeel.me/media/featured",
        help="Public URL corresponding to --output-media",
    )
    parser.add_argument("--count", type=int, default=500)
    args = parser.parse_args()
    if not 1 <= args.count <= 50_000:
        parser.error("--count must be between 1 and 50000")
    build_pack(
        output_assets=args.output_assets.resolve(),
        output_media=args.output_media.resolve(),
        output_web_content=args.output_web_content.resolve() if args.output_web_content else None,
        public_base_url=args.public_base_url,
        count=args.count,
    )


if __name__ == "__main__":
    main()
