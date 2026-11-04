# Doompedia

Offline-first discovery app with 1M Wikipedia summary cards, native Android and iOS clients, and a shared data/ranking specification.

Explore the public web app at [doompedia.elfeel.me](https://doompedia.elfeel.me/).

## Product summary
- The browser demo loads the starter collection over the network; marking a pack in the web interface does not download it.
- Hosted pack files can be served from a normal HTTPS static host such as Caddy on Hetzner.
- The curated starter feed uses freely licensed Wikipedia thumbnails
  hosted with the website and cached locally instead of inflating the APK or
  core article packs.
- Optional online mode can fetch live summaries without downloading a pack first (with local caching).
- Card tap opens the full article via Wikipedia universal link (Wikipedia app if installed, otherwise browser).
- No account system and no cloud sync.
- Deterministic adaptive ranking with explicit controls and transparent explanations.
- Manifest-driven pack updates with delta-first fallback to full shard refresh.
- Manual update checks from the Packs tab (auto update polling is disabled by design).
- Attribution/legal surface is integrated in the Settings tab.

## Compact web catalog

The web client can use an optional `web/content/featured_catalogue.json` projection to avoid downloading the full thumbnail-attribution manifest on startup. The original card file and complete attribution manifest remain available. Build the projection directly from the exact published card and thumbnail files:

```sh
node scripts/build-web-catalogue.mjs --origin https://doompedia.elfeel.me --out path/to/featured_catalogue.json
```

The generator fetches both source files, verifies their ETags during and after capture, and refuses to generate a projection when cards lack thumbnails or the manifest count is inconsistent. Validate the projected count and fields before publishing it alongside the matching source versions. The client checks both ETags before using it and falls back to the original files if the projection is missing, invalid or stale. This check cannot make a multi-file update atomic: publish matching files atomically and avoid in-place updates while clients are loading. Changes to the hosted corpus require regenerating the projection; never replace the hosted data with an older checkout's starter files.

## Repository layout
- `docs/` product and technical decisions.
- `web/` static public site for the project and hosted pack links.
- `deploy/` Hetzner/Caddy static hosting notes.
- `shared-spec/` shared schema + ranking + manifest contracts.
- `data-pipeline/` pack build and delta tooling.
- `android-app/` Kotlin + Jetpack Compose implementation.
- `ios-app/` Swift + SwiftUI implementation.

## Locked defaults
- `1,000,000` cards from English Wikipedia main namespace (`ns=0`).
- Disambiguation pages excluded from feed but retained for search routing.
- Title-only search in MVP (exact/prefix/alias + small typo tolerance).
- Personalization default: `LOW` with `OFF`, `LOW`, `MEDIUM`, `HIGH` options.
- Chunked pack install with resumable shard download and checksum validation.
- Default transport compression is `none`, with optional `gzip` pipeline output (supported by both Android and iOS runtimes).

## Offline behavior
- Works offline for feed, bookmarks, history, settings, and title search.
- Opening full article requires connection unless external app/browser already has cached content.

## Build note
This implementation is intentionally structured for thesis-grade reproducibility and clarity:
- deterministic ranking config,
- shared manifest/schema contracts,
- explicit acceptance budgets in docs.

## Build real 1M data pack
Use `scripts/build_en_1m_pack.sh` to generate a real `en-core-1m` pack from Wikimedia dumps:
- downloads `enwiki-latest-page.sql.gz` and `enwiki-latest-page_props.sql.gz`,
- builds 1,000,000 title+description+URL card records,
- emits shard pack + manifest under `data/out/en-1m/pack-v1/`.

To build an "all available EN summaries" pack (very large), use:
- `scripts/build_en_all_pack.sh`

To build additional real focused packs from the current core source:
- `scripts/build_en_focus_packs.sh` (creates `en-history-250k` and `en-science-250k`)

To build real thematic split packs from an existing large source manifest:
- `scripts/build_en_thematic_packs.sh` (creates `en-stem-500k`, `en-history-politics-500k`, `en-biography-500k`, `en-geography-500k`, `en-culture-500k`)

## Publish/deploy pack
- Prepare hosted pack layout: `scripts/publish_pack.sh`
- Default deploy target: static files on Hetzner behind Caddy (`deploy/README.md`).
- Optional S3-compatible deploy helpers remain available: `scripts/deploy_pack_to_s3.sh`, `scripts/deploy_pack_to_r2.sh`.
- See full guide: `docs/DEPLOYMENT.md`

## iOS builds from Windows
- Native iOS compilation still requires macOS.
- This repo includes CI at `.github/workflows/ios-build.yml` to build unsigned simulator artifacts on GitHub-hosted macOS.
- For device-installable builds, use `.github/workflows/ios-signed-ipa.yml` (manual trigger).
- Required GitHub repo secrets for signed IPA:
  - `IOS_P12_BASE64`
  - `IOS_P12_PASSWORD`
  - `IOS_PROVISIONING_PROFILE_BASE64`
  - `IOS_TEAM_ID`
  - Optional: `IOS_BUNDLE_ID` (defaults to `com.feelbachelor.doompedia.ios`)
  - Optional: `IOS_CODE_SIGN_IDENTITY` (defaults to `Apple Distribution`)
- From Windows, trigger the workflow in GitHub Actions and download the `doompedia-ios-signed` artifact (`.ipa`).

## Release readiness
- Full release checklist: `docs/RELEASE_CHECKLIST.md`
- Local data build result snapshot: `docs/DATASET_BUILD_RESULT.md`
