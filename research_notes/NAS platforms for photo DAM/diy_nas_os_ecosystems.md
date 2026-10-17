# DIY/Open NAS OS App Ecosystems and APIs (Unraid, TrueNAS, OMV, HexOS, ZimaOS/CasaOS, Umbrel, Proxmox) — for an OSS Photo DAM

Research date: 2026-10-16. Version numbers are flagged where the sources are dated. Approx. 27 tool calls were used, so some sub-questions remain gaps. They are listed explicitly.

## Unraid: packaging (CA templates, .plg), listing/moderation, 7.x changes, official API, licensing

### Takeaway
A third-party app ships on Unraid as a Docker XML template, or as a `.plg` plugin for host-level extensions, hosted in the developer's own repo and submitted to Community Applications (CA). CA now has a web submission portal at ca.unraid.net with Validate/Scan steps, and plugins are always manually reviewed. Unraid 7.2 (Oct 29, 2025) builds an open-source GraphQL API into the OS (open-sourced Jan 2025). Its current capabilities are mostly status/monitoring, and Docker Compose, plugin SDK and container setup were still on the roadmap as "planned/TBD". Docker Compose is still not native. It comes through a community plugin (Compose Manager / Compose Manager Plus).

### Cited Findings
**CA templates / submission**
- CA submission is now done through a flow at `ca.unraid.net` `/submit/new`. You host a repository of template XML files, then run "Validate" and "Scan". Docker apps need a `<Repository>` tag pointing at a valid image. Plugins need a `<PluginURL>` pointing to a `.plg` manifest. The docs recommend one XML file per app and suggest starting from an official GitHub starter repo — [CA: Repository XML help](https://ca.unraid.net/submit/help/repository-xml)
- "Plugin submissions are always manually reviewed." `<Support>` and `<Project>` links help moderators verify provenance. The page does not clearly state that a forum support thread is mandatory — [CA: Repository XML help](https://ca.unraid.net/submit/help/repository-xml)
- XML field reference: `<Name>` and `<Repository>` are the minimum. `<Category>`, `<Icon>`, `<Overview>`, `<Project>`, `<Support>` and `<TemplateURL>` are recommended. The reference is generated from `server/appfeed/parsers/template-xml-field-spec.json` — [CA XML field reference](https://ca.unraid.net/submit/help/xml-field-reference)
- Historical norm (2019-era forum): CA is run by Squid, and "publishing a template means you have to support it", i.e. maintainers are expected to provide a support thread — [Unraid forum: how to submit new docker containers to CA](https://forums.unraid.net/topic/55503-how-to-submit-new-docker-containers-to-community-apps/). CA is still "supported by Squid" per a recent thread — [Unraid forum: duplicate applications](https://forums.unraid.net/topic/189631-duplicate-applications/)

**Plugins (.plg) and Compose**
- No current official `.plg` format reference was found on docs.unraid.net. A 2016 forum thread described the plugin docs as scattered — [Unraid forum: plugin system documentation](https://forums.unraid.net/topic/52623-plugin-system-documentation/). Community docs (mstrhakr) say files under `/boot/config/plugins/` persist across reboots while `/usr/local/emhttp/` lives in RAM. Settings use key="value" files read via `parse_plugin_cfg()` — [mstrhakr plugin docs](https://tomevault.io/tome/mstrhakr/plugin-docs)
- Docker Compose on Unraid comes through a community plugin. "Compose Manager Plus" (mstrhakr, forked from dcflachs/compose_plugin) is distributed as `compose.manager.plg` and installs the Docker Compose CLI plugin (v5 default) — [CA listing: Compose Manager Plus](https://ca.unraid.net/apps/compose-manager-plus-0wft8je0ra0zhy); [forum thread](https://forums.unraid.net/topic/197334-plugin-compose-manager-plus)

**Unraid 7.x changes**
- 7.0 (rc.1 Dec 2, 2024): native ZFS, Tailscale integration (per-container tailnet via Docker templates), VM clones/snapshots, optional array — [Unraid 7 rc.1 blog](https://unraid.net/blog/unraid-7-rc-1); [heise](https://heise.de/-10248012)
- 7.0.1: Tailscale is blocked for host-network and "Container"-network-type containers after a security issue — [Unraid 7.0.1 blog](https://unraid.net/blog/unraid-7-0-1)
- 7.2.0 (Oct 29, 2025): responsive WebGUI, built-in Unraid API, ZFS RAIDZ expansion, ext2/3/4/NTFS/exFAT support, optional SSO login. Theme Engine/Dark Theme/Dynamix Date Time plugins are auto-uninstalled as incompatible — [Unraid 7.2.0 blog](https://unraid.net/blog/unraid-7-2-0); [7.2.0 release notes](https://docs.unraid.net/unraid-os/release-notes/7.2.0/). The docs reference point releases up to 7.2.8 (not independently verified as the latest as of Oct 2026).

**Official Unraid API**
- GraphQL API. Built into the OS from 7.2 (Settings → Management Access → API). Auth via API keys, session cookies and SSO/OIDC. There is a GraphQL Sandbox for development. Pre-7.2 (6.12–7.1) systems need the Unraid Connect plugin. Installing the plugin on 7.2+ gives earlier access to newer API features — [Unraid API docs](https://docs.unraid.net/API/)
- Roadmap (page states): open-sourced January 2025 (completed), API v4.0.0 shipped array/Docker/share status monitoring, notifications and a permissions rewrite. Planned items: "Developer tools for plugins" (Q2 2025), "New Docker status design and container setup interface" (Q3 2025), "Docker Compose support" (TBD), "Plugin development tools (SDK and tooling)" (TBD). VMs are not mentioned — [Unraid API roadmap](https://docs.unraid.net/API/upcoming-features/). (Flag: the roadmap's quarter dates are now past. I could not confirm which shipped.)

**Licensing**
- Feb/Mar 2024 change: Starter $49 (up to 6 devices; originally announced as 4), Unleashed $109 (unlimited), Lifetime $249. Starter/Unleashed include 1 year of updates, then an optional $36/yr extension. Without it, you keep the license and stay on that minor version (patch releases within that minor still allowed). Legacy Basic/Plus/Pro keys are grandfathered but no longer sold — [Unraid blog: new pricing](https://unraid.net/blog/new-pricing); [Unraid licensing FAQ](https://docs.unraid.net/unraid-os/faq/licensing-faq); [ServeTheHome](https://www.servethehome.com/unraid-moves-to-annual-subscription-pricing-model/). Prices may have changed since 2024.

**Popularity**
- No official total user count was found. Proxies: 7.2.0-rc.1 had "over 5,000 installs in two weeks", and the 7.2.0 stable release thanked over 5,000 beta testers — [7.2.0-rc.1 blog](https://unraid.net/blog/unraid-7-2-0-rc-1); [7.2.0 blog](https://unraid.net/blog/unraid-7-2-0). A customer survey had more than 4,400 participants (undated) — [Unraid customer survey](https://unraid.net/blog/unraid-customer-survey-results)

### Inferences
- For a DAM, the lowest-friction Unraid path is a CA Docker XML template for a single container. For multi-container stacks (DB + ML worker), you would document the Compose Manager plugin route, as Immich and PhotoPrism already do. A `.plg` is only warranted for host integration and faces manual review.
- The Unraid API is not yet a good integration surface for a DAM. It is mostly read/status oriented. A DAM could use it for notifications or array-state awareness, but not for app lifecycle or share provisioning (share creation is only "under consideration").
- The 2024 licensing change mostly affects OS updates, not app availability. Users who lapse are pinned to a minor version, so template authors should expect a long tail of older Docker Engine versions. See the Immich healthcheck `start_interval` issue on 6.12.10 / Docker 24.0.9.

### Gaps
- Unraid total user/license counts; CA download/install counts for photo apps (CA shows per-app download counts in the UI, but I found no citable numbers).
- Whether the CA web portal replaced the forum-thread requirement entirely, and its launch date.
- An official `.plg` spec for Unraid 7.x; whether the planned plugin SDK/Docker-setup API items shipped by Oct 2026.
- The NVIDIA driver plugin specifics (I found no source in my searches).

## TrueNAS: Kubernetes→Docker apps, catalog contribution, custom YAML, 25.04/25.10/26→27 changes, API (REST→JSON-RPC), ZFS APIs, CORE status

### Takeaway
TrueNAS Community Edition (CORE and SCALE unified under that name in 25.04) runs apps as Docker Compose since 24.10 "Electric Eel". It has a Git-based catalog (github.com/truenas/apps) where third parties PR into the `community` train using Jinja-templated compose files, plus "custom app" YAML install. The REST API was deprecated in 25.04 and is removed in the release formerly called TrueNAS 26, renamed TrueNAS 27 at RC.1 (Oct 6, 2026; 27.0 GA targeted early Dec 2026). The only API is now versioned JSON-RPC 2.0 over WebSocket, and `auth.login_with_api_key` is deprecated in favor of `auth.login_ex`. The catalog explicitly excludes apps that interact with the TrueNAS host API, which matters for a DAM that wants to drive snapshots.

### Cited Findings
**Apps backend transition**
- 24.10 moved the apps backend from Kubernetes to Docker. Supported catalog apps auto-migrated when upgrading from 24.04 Dragonfish. Apps still on 24.04 after June 1 must be re-deployed after upgrading — [TrueNAS 24.10 release notes](https://www.truenas.com/docs/scale/24.10/gettingstarted/scalereleasenotes)
- 25.04 "unified both TrueNAS CORE and SCALE into the new Community Edition". 25.04 reached "over 130,000 systems". 25.10 Goldeye: BETA Aug 28, 2025, release Oct 2025. 25.10 added migration of apps between pools, experimental LXC containers under "Instances", and NVIDIA open kernel modules (driver 570.172.08) with RTX 50/Blackwell support, while "several older GTX GPUs" were dropped — [TrueNAS Goldeye 25.10 BETA blog](http://www.truenas.com/blog/truenas-goldeye-25-10-beta/)
- 25.10 WebUI improved the Docker YAML (custom app) pages — [TrueNAS 25.10 release notes](https://www.truenas.com/docs/scale/25.10/gettingstarted/scalereleasenotes/); [AlternativeTo summary](https://alternativeto.net/news/2025/10/truenas-25-10-launches-with-major-ui-refresh-nvme-of-gpu-acceleration-and-vm-ha)
- Legacy VMs created on the Instances screen in 25.04.0/25.04.1 are removed in 26/27 with no migration tool (containers migrate automatically) — [TrueNAS 26 deprecations](https://www.truenas.com/docs/scale/26/gettingstarted/deprecations/)

**Versioning: 26 → 27**
- The release tested as TrueNAS 26 was renamed TrueNAS 27 starting with RC.1 (Oct 6, 2026). It is "model year" naming with one major release per year. 27.0 is targeted for early December 2026. It uses Linux 6.18 and OpenZFS 2.4 — [TrueNAS blog: TrueNAS 27 is here](https://www.truenas.com/blog/truenas-27-is-here/); [Phoronix](https://phoronix.com/news/TrueNAS-27-RC.1-Release); [VirtualizationHowTo](https://www.virtualizationhowto.com/2026/10/truenas-27-rc1-is-here-5-changes-that-matter-for-home-labs/)
- api.truenas.com lists API versions v28.0.0 (Preview), v27.0.0 (Early) and v25.10.5 — [api.truenas.com](https://api.truenas.com/)

**Catalog contribution (github.com/truenas/apps)**
- Trains: `community` (92 apps), `charts`/stable (16) and `enterprise` (2) per the parity table, i.e. about 110 apps migrated from truenas/charts. Deprecation period: 3 months — [truenas/apps README](https://github.com/truenas/apps) (counts may be stale relative to the live catalog)
- New apps go only in the `community` train. Per-app files in `ix-dev/community/{app}/` are `app.yaml` (version starts at 1.0.0 and bumps every change), `ix_values.yaml` (image keys end in `image`), `questions.yaml` (UI form; ports must be catalog-unique, checked by `port_validation.py`), `README.md`, `templates/docker-compose.yaml` (Jinja2 calling a shared library) and `templates/test_values/*.yaml`. A generated `templates/library/` must be committed. They prefer ghcr over docker.io, and Renovate handles versioning — [truenas/apps CONTRIBUTIONS.md](https://raw.githubusercontent.com/truenas/apps/master/CONTRIBUTIONS.md)
- Storage defaults to `ix_volume` (TrueNAS-managed datasets), with `host_path` also offered. `run_as_context` is in app.yaml, and 568 (the apps user) is suggested "if it can run as any non-root user". A permissions init container is `tpl.deps.perms`. For GPU, copy plex/jellyfin patterns. Testing uses `ci.py --app X --train community --test-file basic-values.yaml` or devbox — [CONTRIBUTIONS.md](https://raw.githubusercontent.com/truenas/apps/master/CONTRIBUTIONS.md)
- Policy: meeting requirements "does not guarantee inclusion". TrueNAS can reject or unpublish at its sole discretion. Excluded are apps that risk data integrity, "interact with the TrueNAS host management layer or API", or exceed container boundaries — [CONTRIBUTIONS.md](https://raw.githubusercontent.com/truenas/apps/master/CONTRIBUTIONS.md)

**API**
- REST was deprecated in 25.04 and is removed in 26 (now 27). From 25.10.1 onward, alerts show when deprecated REST endpoints are hit. Replacement: versioned JSON-RPC 2.0 over WebSocket — [TrueNAS 26 deprecations](https://www.truenas.com/docs/scale/26/gettingstarted/deprecations/); [25.10 API docs](https://www.truenas.com/docs/scale/25.10/api/); [26.0.0-BETA.3 release notes](https://update-master.freenas.org/scale/TrueNAS-26-BETA/TrueNAS-26.0.0-BETA.3.release-notes.txt?download=1)
- `auth.login` and `auth.login_with_api_key` are deprecated in 26 with planned removal in 27(+). Use `auth.login_ex`. `API_KEY_PLAIN` and other non-SCRAM mechanisms remain supported. `pool.scrub.*` → `zpool.scrub.run` — [TrueNAS 26 deprecations](https://www.truenas.com/docs/scale/26/gettingstarted/deprecations/)
- Official client: truenas/api_client (Python, includes `midclt`). Full per-host docs are at `/api/docs/` — [api.truenas.com](https://api.truenas.com/)

**CORE**
- CORE 13.3 docs are labeled end-of-life Community release. Plugins/jails/VMs are "obsolete" and unsupported, and users are told to migrate to SCALE/CE for containers — [CORE 13.3 deprecations](https://www.truenas.com/docs/core/13.3/gettingstarted/deprecations); [CORE release notes](https://www.truenas.com/docs/core/corereleasenotes/)

**Popularity**
- iX claims: "over 15 million downloads" in 170+ countries (undated page) — [ixsystems.com](https://www.ixsystems.com/); ">1 million deployments" and 40% CAGR since 2021 (Feb 2025 press tour) — [VMblog](https://vmblog.com/archive/2025/02/05/truenas-emerges-as-cost-effective-alternative-in-era-of-rising-storage-costs.aspx); "104% increase in Community Edition adoption in 2024" — [iXsystems rebrand blog](https://www.ixsystems.com/blog/ixsystems-rebrands-as-truenas-to-reflect-market-momentum-in-enterprise-storage); 25.04 on ">130,000 systems" — [Goldeye BETA blog](http://www.truenas.com/blog/truenas-goldeye-25-10-beta/). These are vendor figures with inconsistent definitions.

### Inferences
- The REST removal in 27 means any DAM integration must use the WebSocket JSON-RPC client (Python `truenas/api_client` or a JS WebSocket client) and `auth.login_ex` with API keys. Any REST-based examples or blog posts are now obsolete.
- For dataset/snapshot management a DAM would call the middleware namespaces (e.g. `pool.dataset.*`, `pool.snapshot.*`, `filesystem.getacl/setacl`). I could not verify these method names against the 27 docs in this session, so confirm them at `/api/docs/`. Because the catalog bans apps that call the host API, such integration must be an opt-in external feature (user supplies an API key), not part of the catalog app itself.
- The NVIDIA open-kernel-module switch (25.10) drops Pascal/older GTX. This matters for users wanting CUDA ML on older cards.

### Gaps
- Exact middleware method names and ACL semantics (NFSv4 vs POSIX ACL presets, "Apps" dataset preset) in 27 docs.
- 27-specific app changes (e.g. whether Instances/LXC graduated; catalog changes). The 27 blog says the feature set "largely" matches the 26 betas.
- Whether the 25.04 "Fangtooth" Incus integration details changed further.

## OpenMediaVault: omv-extras, plugin development, compose plugin, RPC API

### Takeaway
OMV (current major: OMV 8 "Synchrony" on Debian 13, latest 8.5.10 on Oct 3, 2026) is Debian-package based. Plugins are .deb packages with declarative YAML UI manifests, a PHP RPC backend (omv-engined) and Salt-based config deployment. Third-party apps are effectively shipped as compose files run by the omv-extras `openmediavault-compose` plugin. The external API is the internal RPC layer (`omv-rpc` CLI / JSON-RPC over the web UI session), which is not a stable public API.

### Cited Findings
- OMV 8.5.10 released Oct 3, 2026 — [Wikipedia](https://en.wikipedia.org/wiki/OpenMediaVault). The OMV 8 "Synchrony" / Debian 13 claim is from a third-party guide — [corelab.tech](https://corelab.tech/setup-omv/)
- Architecture: nginx → FastCGI → `omv-engined` (PHP RPC daemon). Config lives in `config.xml`, with listeners in `/usr/share/openmediavault/engined/modules`. RPC calls are identified by service + method — [OMV docs: How does it work (7.x)](https://docs.openmediavault.org/en/7.x/_sources/development/howitworks.rst.txt)
- Plugins are declarative YAML manifests under `/usr/share/openmediavault/workbench` (component.d, dashboard.d, log.d, navigation.d, route.d), so no JS/TS is needed — [OMV docs: Plugin Development (7.x)](https://docs.openmediavault.org/en/7.x/development/plugins.html)
- Third-party MCP projects drive OMV via the `omv-rpc` CLI over SSH. One says OMV exposes about 50 RPC services with several hundred methods — [omv-mcp](https://glama.ai/mcp/servers/mbgroen/omv-mcp); [mcp-openmediavault](https://glama.ai/mcp/servers/fredriksknese/mcp-openmediavault)
- Compose plugin (OMV7 wiki): enable the Docker repo in omv-extras and install `openmediavault-compose`. It uses shared folders for appdata, data, backup_compose and docker, plus a `global.env` (PUID, PGID, TZ, paths). The wiki recommends a dedicated "appuser" (not in the docker group, not root/admin) and adding it to render/video groups for GPU. Intel GPU is mapped via `devices: /dev/dri`. It ships example compose files ("Add from example") and does scheduled rsync backups and per-container scheduled updates — [omv-extras wiki: Docker in OMV](https://wiki.omv-extras.org/doku.php?id=omv7:docker_in_omv). (Flag: OMV7 wiki page. An OMV8 equivalent was not verified.)
- PhotoPrism documents an OMV install: "PhotoPrism can be conveniently installed using the OpenMediaVault plugin". Updates are via Podman pull over SSH, and support is referred to the OMV community — [PhotoPrism docs: OpenMediaVault](https://docs.photoprism.app/getting-started/nas/openmediavault)

### Inferences
- The realistic distribution channel on OMV is (a) an upstream compose example contributed to the omv-extras compose plugin's example list, or (b) a dedicated omv-extras plugin like PhotoPrism's. The Docker-based PUID/PGID "appuser" pattern is the norm.
- There is no supported remote management API comparable to TrueNAS. Integration would mean SSH + `omv-rpc`, which is fragile.

### Gaps
- OMV8-specific compose plugin docs; Salt (`omv-salt`) and Debian packaging docs for plugins; who maintains the PhotoPrism OMV plugin (likely omv-extras/ryecoaaron, unverified).

## HexOS, ZimaOS/CasaOS, Umbrel (consumer-friendly options), and Proxmox

### Takeaway
HexOS is a curated UI layer on TrueNAS CE and was still in Early Access in mid-2026, with a slow pace. ZimaOS/CasaOS use plain Docker Compose with an `x-casaos` metadata block and support third-party app stores built to static hosting. Umbrel uses `umbrel-app.yml` + compose, with PR review into getumbrel/umbrel-apps plus community app stores.

### Cited Findings
**HexOS**
- Mid-2026: "Built around TrueNAS SCALE". Lifetime $199 during Early Access, $299 after. Its strongest area is curated app deployment (Plex/Jellyfin/Emby). Concerns: slow H1 2026 progress, delayed buddy backup — [NASCompares mid-2026](https://nascompares.com/2026/07/22/is-hexos-still-ok-checking-in-with-hexos-in-mid-2026/); [NASCompares: is HexOS in trouble](https://nascompares.com/news/is-hexos-in-trouble-mid-2026-update/)
- The Dec 2024 beta had only two curated apps: Plex and Immich — [NASCompares beta review](https://nascompares.com/2024/12/02/hexos-nas-software-review-of-the-beta/). In 2024 the developers said apps are curated and non-curated apps can be installed via the TrueNAS web UI — [NASCompares AMA](https://nascompares.com/2024/08/09/hexos-ama-user-questions-answered-truenas-partnership-online-licensing-buddy-backups/)

**ZimaOS / CasaOS**
- Apps are standard Compose plus a top-level `x-casaos` block with id, main, index, port_map, icon, title and category. A v2 third-party store has `store-config.json`, `supported-languages.json` and `Apps/<AppName>/docker-compose.yml`, built via `./scripts/build_dist.sh` or an IceWhaleTech GitHub Action into `dist/` for static hosting — [ZimaOS docs: Create an App Store from Scratch](https://www.zimaspace.com/docs/developer/app-store-create-from-scratch)
- Users can add a store URL under Developer Settings, or import a single custom compose. A raw GitHub repo is not a valid store, only the built output — [ZimaSpace community solution](https://shop.zimaspace.com/pages/zimaos-https-apps-custom-repository); [community store example](https://zff.dev/aegypius/app-store)

**Umbrel**
- Official store: fork getumbrel/umbrel-apps, add an app dir with `umbrel-app.yml` + Docker files, pass automated tests, then submit a PR for review (a 256x256 SVG icon is required, per an April 2026 forum reply). Community app stores (since 0.5.2) use `umbrel-app-store.yml` with an id prefix for all apps — [Umbrel 0.5.2 community app stores](https://community.umbrel.com/t/umbrel-0-5-2-is-here-with-community-app-stores-tor-access-toggle-search-in-app-store-and-more/9981); [Umbrel forum: verify apps](https://community.umbrel.com/t/verify-apps-in-the-app-store/24973.md); [community store template example](https://github.com/johnpc/umbrel-community-app-store)

**Proxmox**
- Not researched in this session (tool budget).

### Inferences
- ZimaOS and Umbrel both accept "compose + metadata". A DAM with a clean, single-file compose (app + DB + optional ML) can target both stores cheaply. HexOS inherits TrueNAS catalog apps, so a TrueNAS community-train app is the path to HexOS curation.
- Proxmox (general knowledge, unverified here): users typically run Docker inside an LXC or VM, or use community "Proxmox VE Helper-Scripts". There is no app store per se, so a DAM would rely on its standard Docker/compose docs.

### Gaps
- ZimaOS/CasaOS official store submission process (PR to IceWhaleTech/CasaOS-AppStore), GPU support in ZimaOS; HexOS current app list and whether Immich is still curated; Umbrel install counts; Proxmox helper-script status and LXC GPU passthrough.

## GPU passthrough to containers (Intel Quick Sync / NVIDIA)

### Takeaway
Intel iGPU passthrough via `/dev/dri` works on all Docker-based platforms (Unraid extra params/device mapping, OMV compose `devices:` + render/video groups, TrueNAS app GPU options). NVIDIA is plugin-driven on Unraid (community NVIDIA driver plugin, not verified here). TrueNAS bundles NVIDIA drivers but switched to open kernel modules in 25.10, dropping older GTX cards.

### Cited Findings
- Unraid Intel: add `--device=/dev/dri` in Extra Parameters or a device mapping. No go-file edits are needed on 6.9+. BIOS iGPU primary settings matter. Render node numbering can shift (use `/dev/dri/by-path`) — [FileFlows Unraid Intel guide](https://fileflows.com/docs/installation/unRAID/intel); [Unraid forum iGPU recap](https://forums.unraid.net/topic/155364-igpu-configuration-recap/)
- OMV: `/dev/dri` mapping plus render/video groups for the appuser — [omv-extras wiki](https://wiki.omv-extras.org/doku.php?id=omv7:docker_in_omv)
- TrueNAS 25.10: NVIDIA open kernel modules, driver 570.172.08, RTX 50 supported, several older GTX dropped — [Goldeye BETA blog](http://www.truenas.com/blog/truenas-goldeye-25-10-beta/). Catalog apps follow plex/jellyfin GPU patterns — [CONTRIBUTIONS.md](https://raw.githubusercontent.com/truenas/apps/master/CONTRIBUTIONS.md). A user reports issues with Intel iGPU passthrough to an app on TrueNAS — [TrueNAS forum](https://forums.truenas.com/t/intel-igpu-passthrough-not-working-for-app-arm/65649)

### Inferences
- A DAM should support VAAPI/QSV via `/dev/dri` as the baseline and treat NVIDIA/CUDA as optional. It should document GPU group membership (render/video) because PUID-based containers otherwise lack access.

### Gaps
- Unraid NVIDIA driver plugin details; ZimaOS/Umbrel/HexOS GPU support; Proxmox LXC GPU sharing.

## OSS photo app distribution on these platforms and friction

### Takeaway
Immich and PhotoPrism both have per-platform guides, but they are mostly community-maintained. On Unraid both upstreams recommend Compose Manager over CA single-container templates. On TrueNAS, Immich and PhotoPrism are catalog apps. Common friction is permissions and dataset presets on ZFS, multi-container dependencies (Postgres/Redis), and old Docker versions.

### Cited Findings
- Immich on TrueNAS: a community-train app, community-written docs that TrueNAS "doesn't validate or maintain". It covers CE 24.10.2.2+, needs 7 datasets (library, pgBackup, pgData, profile, thumbs, uploads, video), and recommends the "Apps" dataset preset for permissions — [TrueNAS docs: Immich](https://www.truenas.com/docs/truenasapps/communityapps/immich); [Immich docs: TrueNAS (community)](https://docs.immich.app/install/truenas)
- Immich on Unraid: the Compose Manager plugin is the "official" method. A CA template uses a community-made image Immich does not support (it needs separate Redis and PostgreSQL 14). Unraid 6.12.10's Docker 24.0.9 lacks healthcheck `start_interval` (needs Docker 25+) — [Immich docs: Unraid](https://docs.immich.app/install/unraid)
- PhotoPrism: Unraid docs recommend Compose Manager (Unraid 6.12+) and warn against SQLite in CA templates in favor of MariaDB — [PhotoPrism docs: Unraid](https://docs.photoprism.app/getting-started/nas/unraid/). TrueNAS Apps Market has a PhotoPrism deploy guide — [apps.truenas.com: PhotoPrism](https://apps.truenas.com/resources/deploy-photoprism). OMV plugin route — [PhotoPrism docs: OMV](https://docs.photoprism.app/getting-started/nas/openmediavault). An old CORE jail guide (Feb 2023) is now obsolete — [TrueNAS community](https://www.truenas.com/community/goto/post?id=738027)
- HexOS's first curated apps were Plex and Immich — [NASCompares beta review](https://nascompares.com/2024/12/02/hexos-nas-software-review-of-the-beta/)

### Inferences
- The pattern for successful photo apps is to ship one canonical compose file and let platform communities wrap it. The weakest experience is on Unraid, where CA templates are single-container and community images diverge from upstream.
- A new DAM could differentiate by offering an all-in-one image (embedded DB) for Unraid CA, and contributing directly to the truenas/apps community train with `ix_volume` + host_path for libraries, using the 568 apps user.

### Gaps
- Distribution of LibrePhotos, Photoview, PhotoStructure and digiKam on these platforms (not researched; digiKam is desktop software and typically not NAS-packaged).
- CA download counts for Immich/PhotoPrism templates; TrueNAS catalog install counts.
