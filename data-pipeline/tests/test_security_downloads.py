from pathlib import Path
import urllib.request

import pytest
from defusedxml.common import EntitiesForbidden

from doompedia_pipeline import build_featured_starter as starter
from doompedia_pipeline.extract_dump import extract_dump


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "http://en.wikipedia.org/w/api.php",
    "https://en.wikipedia.org.evil.invalid/w/api.php",
    "https://user:password@en.wikipedia.org/w/api.php",
    "https://upload.wikimedia.org:8443/image.jpg", "https://127.0.0.1/image.jpg",
    "https://upload.wikimedia.org/image.jpg#fragment",
])
def test_remote_url_rejects_unapproved_targets(url: str) -> None:
    with pytest.raises(ValueError):
        starter.checked_remote_url(url)


@pytest.mark.parametrize("url", [
    "https://en.wikipedia.org/w/api.php?action=query&format=json",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/image.jpg",
])
def test_remote_url_accepts_existing_sources(url: str) -> None:
    assert starter.checked_remote_url(url) == url


def test_api_call_cannot_open_local_source(monkeypatch) -> None:
    monkeypatch.setattr(starter, "API_URL", "file:///not-read")
    monkeypatch.setattr(urllib.request, "build_opener", lambda *args: pytest.fail("opened invalid endpoint"))
    with pytest.raises(ValueError):
        starter.request_json({"action": "query"}, retries=1)


def test_thumbnail_cannot_open_local_source(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(starter, "wait_for_download_slot", lambda: None)
    monkeypatch.setattr(urllib.request, "build_opener", lambda *args: pytest.fail("opened invalid endpoint"))
    article = starter.FeaturedArticle(1, "Fixture", "Summary", "https://en.wikipedia.org/wiki/Fixture",
                                      "Fixture.jpg", "file:///not-read")
    with pytest.raises(ValueError):
        starter.download_thumbnail(article, tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_redirect_checks_destination_before_following() -> None:
    request = urllib.request.Request("https://en.wikipedia.org/w/api.php")
    with pytest.raises(ValueError):
        starter.WikimediaRedirect().redirect_request(request, None, 302, "Found", {}, "file:///not-read")


def test_dump_rejects_entity_expansion(tmp_path: Path) -> None:
    source = tmp_path / "entities.xml"
    source.write_text('<!DOCTYPE mediawiki [<!ENTITY fixture "harmless fixture">]><mediawiki>&fixture;</mediawiki>')
    with pytest.raises(EntitiesForbidden):
        extract_dump(source, tmp_path / "out.ndjson", "en", 100, 5, 320)
