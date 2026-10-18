# Production content safety

The private controller discovers reviewed `main` commits after their required CI
runs succeed and owns code publication and deployment. Application workflows
carry no production release authority or duplicate release manifest. Code releases must
not copy, synchronize, prune, replace, or otherwise mutate the authoritative
production content tree. The private controller mounts that already-verified
tree read-only into the static runtime.

The immutable runtime image owns the logo and favicon routes. Those two brand
files are copied from `web/assets` during the image build and take precedence
over the read-only content mount, so brand-only releases do not mutate or
rearchive the authoritative tree.

Publish data locally first:

```bash
BASE_URL="https://doompedia.elfeel.me/packs/en-core-1m/v1" ./scripts/publish_pack.sh
```

Publishing locally only creates candidate content. Production content promotion
is a separate attended data operation: quiesce writers, create a
content-addressed archive and exact-tree manifest, restore it in isolation,
retain an independently verified off-host copy, and then promote a new
versioned tree. Never use `rsync --delete`, `aws s3 sync --delete`, or a code
deployment workflow against the authoritative tree.

`web/media/featured` contains the 500-image starter set and is included by the
first command. The generated set currently occupies about 110 MB. Android
stores only its manifest and caches viewed images locally.

The Compose files in this directory remain local build and runtime contracts;
they are not instructions for direct production mutation. Set
`DOOMPEDIA_CONTENT_DIR` to an existing, verified candidate tree for local use;
there is deliberately no repository-relative default. The runtime refuses to
create a missing host directory and mounts the selected tree read-only.

The Android defaults expect:

```text
https://doompedia.elfeel.me/packs/en-core-1m/v1/manifest.json
https://doompedia.elfeel.me/media/featured/<thumbnail-file>
```

Use the same path pattern for focused packs.
