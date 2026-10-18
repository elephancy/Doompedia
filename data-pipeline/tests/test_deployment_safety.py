from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_code_release_build_context_allows_only_brand_files_from_content_tree() -> None:
    dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")
    ignore_rules = [
        line.strip()
        for line in dockerignore.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    assert ignore_rules == [
        "**",
        "!deploy/",
        "!deploy/Dockerfile",
        "!deploy/Caddyfile",
        "!web/",
        "web/**",
        "!web/assets/",
        "!web/assets/elephant-logo.png",
        "!web/assets/favicon.ico",
    ]


def test_code_release_image_bakes_only_the_two_brand_assets() -> None:
    dockerfile = (ROOT / "deploy" / "Dockerfile").read_text(encoding="utf-8")
    instructions = [
        line.strip()
        for line in dockerfile.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    copy_or_add = [
        line.strip()
        for line in dockerfile.splitlines()
        if line.strip().upper().startswith(("COPY ", "ADD "))
    ]
    assert instructions == [
        "FROM caddy:2-alpine@sha256:"
        "5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648",
        "RUN setcap -r /usr/bin/caddy \\",
        "&& test -z \"$(getcap /usr/bin/caddy)\" \\",
        "&& addgroup -S -g 10001 doompedia \\",
        "&& adduser -S -D -H -u 10001 -G doompedia doompedia",
        "COPY deploy/Caddyfile /etc/caddy/Caddyfile",
        "COPY web/assets/elephant-logo.png web/assets/favicon.ico /brand/assets/",
        "USER doompedia",
    ]
    assert copy_or_add == [
        "COPY deploy/Caddyfile /etc/caddy/Caddyfile",
        "COPY web/assets/elephant-logo.png web/assets/favicon.ico /brand/assets/",
    ]
    assert [line for line in instructions if line.upper().startswith("RUN ")] == [
        "RUN setcap -r /usr/bin/caddy \\",
    ]
    assert "COPY web /srv" not in dockerfile


def test_local_runtime_contract_cannot_write_the_content_mount() -> None:
    compose = (ROOT / "deploy" / "docker-compose.prod.yml").read_text(
        encoding="utf-8"
    )
    assert "../web:/srv" not in compose
    assert compose.count("DOOMPEDIA_CONTENT_DIR:?") == 1
    assert compose.count("target: /srv") == 1
    assert compose.count("read_only: true") >= 2
    assert "create_host_path: false" in compose
    assert "cap_drop:" in compose
    assert "- ALL" in compose
    assert "no-new-privileges:true" in compose
    assert "/var/run/docker.sock" not in compose


def test_production_release_authority_is_absent_from_application_workflows() -> None:
    assert not (ROOT / ".github/workflows/deploy-production.yml").exists()
    assert not (ROOT / ".github/hetzner-release.json").exists()
    workflows = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ROOT / ".github/workflows").glob("*.y*ml"))
    )
    assert "HetznerReleaseGateway/" not in workflows
    assert "id-token: write" not in workflows
    assert "secrets: inherit" not in workflows


def test_no_workflow_can_reach_a_host_or_invoke_content_upload_tools() -> None:
    workflows = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ROOT / ".github" / "workflows").glob("*.yml"))
    )
    for forbidden in (
        "HETZNER_",
        "SSH_PRIVATE_KEY",
        "rsync ",
        "scp ",
        "ssh ",
        "deploy_pack_to_s3",
        "deploy_pack_to_r2",
        "publish_pack.sh",
    ):
        assert forbidden not in workflows


def test_pack_upload_and_documented_production_path_are_non_pruning() -> None:
    upload = (ROOT / "scripts" / "deploy_pack_to_s3.sh").read_text(encoding="utf-8")
    deployment = "\n".join(
        (ROOT / path).read_text(encoding="utf-8")
        for path in ("deploy/README.md", "docs/DEPLOYMENT.md")
    )
    env_example = (ROOT / "deploy" / ".env.example").read_text(encoding="utf-8")
    assert "--delete" not in upload
    assert "\nrsync " not in deployment
    assert "\nscp " not in deployment
    assert "\nssh " not in deployment
    assert "/opt/" not in deployment
    assert "/opt/" not in env_example
    assert "PUBLIC_CADDY_DIR" not in env_example
    assert "DOOMPEDIA_DOMAIN" not in env_example
    assert not (ROOT / "deploy" / "Caddyfile.public").exists()
