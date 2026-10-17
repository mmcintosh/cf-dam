# Commercial Appliance NAS Vendor Developer Ecosystems and APIs (Synology, QNAP, Asustor, TerraMaster, UGREEN, WD My Cloud)

Research date: 2026-10-16. Scope: what an open-source photo DAM project needs in order to ship a native package or integrate through an API on commercial NAS platforms. Many vendor documents are old (QNAP API PDFs date from 2013-2016, and the Synology developer guide is versioned DSM 7.2.2). I flag dates wherever I found them. I found no primary source covering DSM 7.3-specific package-developer changes.

## Q1. Native package formats, toolchains, signing and runtime restrictions

### Takeaway
Every vendor has its own Linux package format: Synology SPK, QNAP QPKG, Asustor APKG, TerraMaster TPK and UGREEN UPK. Synology is the most restrictive and best documented. Since DSM 7.0, packages must run as a non-privileged user, and only Synology-signed packages are "trusted", so community packages always show a warning. QNAP uses code signing and blocks or flags unsigned QPKGs unless the user opts in. UGREEN (new in 2025-2026) has a real developer platform with a `ugcli` tool and a `.upk` format that can wrap Docker Compose apps. Asustor and TerraMaster have older, thinner programs.

### Cited Findings

**Synology DSM (SPK)**
- The official "Synology DSM 7.2.2 Developer Guide" covers compiling programs, integrating with DSM, the desktop, firewall and resource monitor. The package layout is INFO, package.tgz, scripts, conf, wizard and LICENSE. The toolkit has Build Stage, Pack Stage and Sign Package sections, and "Sign Package" is marked "only for DSM6.X". — [Synology Developer Guide](https://help.synology.com/developer-guide/)
- DSM 7 offers "resource acquisition" workers for Docker, Web Service, MariaDB, Index DB, Systemd User Unit and Port Config. These let a package request system resources declaratively instead of running as root. — [Synology Developer Guide](https://help.synology.com/developer-guide/)
- `conf/privilege` is required and "controls security related behaviours in entire package lifecycle". `run-as` can be `package` (files owned by the package user, scripts run as that user) or `root`. Per-action `ctrl-script` and per-file `executable` overrides exist, and since 7.0-40656 the `tool` field can grant Linux `capabilities`. — [Synology privilege config](https://help.synology.com/developer-guide/privilege/privilege_config.html)
- Synology's publication review checklist says "The package should be run with non-privileged user" (from DSM 7.0). It also requires the package to cause no Security Advisor issues, pass virus scanning, make no abnormal connections during install, produce no AppArmor denials, register its ports without conflicts, support offline install, and remove its files on uninstall. — [Synology Appendix C: Publication Review](https://help.synology.com/developer-guide/appendix/publication_review.html)
- In the DSM 7 beta, the SynoCommunity Syncthing package was blocked from installing because it ran as root: "Packages with root privileges might execute commands as the root user and compromise your system security." Synology published a third-party package status table ("Supported", "Unsupported", "Ongoing") and said it would add some packages previously available only through SynoCommunity to Package Center. The article is dated Jan 2022 and was updated Aug 2022. — [mariushosting](https://mariushosting.com/3rd-party-package-support-in-dsm-7/)
- SynoCommunity (community repo, built with `spksrc`) targets DSM 7. New packages support DSM 7 from their first version. On DSM 7, "only Synology-signed packages are trusted", so community packages always show a third-party warning during installation regardless of signing. Upgrading to DSM 7 can lose package settings after a "Package repair". DSM 7 porting status is tracked in issue #4524. — [SynoCommunity FAQ](https://github.com/SynoCommunity/spksrc/wiki/Frequently-Asked-Questions); [synocommunity.com](https://synocommunity.com); [docs.synocommunity.com](https://docs.synocommunity.com/developer-guide/)
- spksrc repository activity: a third-party index shows the last push on 2025-05-13. A pkg.go.dev pseudo-version dated 2026-03-05 suggests commits continued into 2026. — [awesome.ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fsynocommunity%2Fspksrc); [pkg.go.dev](https://pkg.go.dev/github.com/SynoCommunity/spksrc@v0.0.0-20260305001044-3b3a6535930c)
- Community package sources such as 007revad can be added in Package Center under Settings, then Package Sources. This is not an official Synology feature. — [NASCompares](https://nascompares.com/news/synology-modding-007revad-community-packages-dsm-package-center/amp/)
- DSM 7.3 (anecdotal forum reports): DSM 7.3 updates may "repair" packages installed on third-party NVMe volumes by reinstalling them on HDD volumes. — [synology-forum.de](https://www.synology-forum.de/threads/neue-version-7-3-2-86009.140586/page-3)
- DSM 7.3 relaxed drive-compatibility restrictions for unverified HDDs. This is not package-related, but it signals some policy loosening. — [ITdaily](https://itdaily.com/software/synology-dsm-7-3)
- DSM 7.2.2 reportedly removed Video Station and pushed users toward Plex or Jellyfin. This comes from a single secondary source. — [NASCompares](https://nascompares.com/2024/08/28/synology-release-dsm-7-2-2-should-you-upgrade/)

**QNAP QTS / QuTS hero (QPKG)**
- QDK (QNAP Development Kit) builds QPKGs and adds architecture checks at install, "support for digital signatures", multiple compression options and dependency checks. `qbuild --create-env <name>` scaffolds a project, which is configured through `qpkg.cfg`. — [QNAP Wiki: QPKG Development Guidelines](https://wiki.qnap.com/wiki/QPKG_Development_Guidelines); [QDK Quick Start Guide v4](https://eu1.qnap.com/dev/QDK_Quick_Start_Guide_v4_eng.pdf)
- QDK changelog 2.3.14 adds "HSM (USB Token) support while doing QNAP code signing", which implies official signing uses a QNAP-held key or hardware token, not a key the developer controls. — [tailscale/qdk fork](https://github.com/tailscale/qdk)
- App Center flags apps without a QNAP digital signature with an exclamation mark. QNAP's FAQ (2022-11-24) recommends updating the app first; the second option is to allow installation without a valid signature, with a warning. It says third-party apps "may be available from the Qnapclub Store". — [QNAP FAQ](https://www.qnap.com/en/how-to/faq/con_show.php?cid=2434)
- Security Counselor can stop unsigned apps. The App Center gear icon has an option to allow apps without a valid signature. The source also says QNAP points to Container Station as the better route since QTS 5.0. This is a German secondary source. — [schieb.de](https://www.schieb.de/wenn-apps-auf-einem-qnap-nas-beendet-werden)
- Community example: a Jellyfin QPKG that wraps the official Docker image through Container Station is "unsigned because it was created by me, and my public key is not available to the QNAP App Store". It requires users to set App Center to allow unsigned apps. — [kajain99/Jellyfin-QPKG](https://github.com/kajain99/Jellyfin-QPKG)
- A 2020 thread (QTS 4.5.1) shows QPKGs blocked for "no digital signature". — [dbpoweramp forum](https://forum.dbpoweramp.com/forum/dbpoweramp/asset-upnp/41001-qnap-4-5-1-no-digital-signature?p=277158)

**Asustor ADM (APKG)**
- The ASUSTOR Developer's Corner is where developers "manage, edit and upload your Apps to ASUSTOR's App Central". Once approved, apps are "ready for sale" on App Central. — [developer.asustor.com](https://developer.asustor.com/)
- The latest guide found is App Central Developer's Guide rev. 4.2.2 (July 2023), covering APKG 2.0. — [Asustor guide PDF](https://downloadgb.asustor.com/developer/App_Central_Developer_Guide_4.2.2_20230712.pdf)
- Community description: an APKG is a zip with `config.json` (name, version, developer, firmware requirement). Private apps can be installed through App Central > Management > Manual Install without submission. — [Asustor forum](https://forum.asustor.com/viewtopic.php?p=48338); [Asustor forum](https://forum.asustor.com/viewtopic.php?p=39568)

**TerraMaster TOS (TPK)**
- Development process: "Download the development environment --> Develop application --> Pack application --> Test --> Apply for listing --> Update". The development environments are x86_64 and ARMv8. Apps are packaged as `.tpk` following the "TOS 5 application packaging guide". TerraMaster says it "cannot give direct technical support to every developer". — [TerraMaster developer page](https://www.terra-master.com/us/developer)
- Distribution: developers may share TPKs directly. To list on the official market, they fill in a "Third Party Application Key Info Table" and email pm@terra-master.com, after which the product team evaluates and may test the app. — [TerraMaster developer page](https://www.terra-master.com/us/developer)
- A 2020 announcement says developers can charge for apps. — [TerraMaster blog](https://www.terra-master.com/blogs/news/create-app)
- The App Center has three app categories: official TerraMaster closed-source apps, third-party commercial apps packaged with the TPK tool, and open-source community apps packaged with the TPK tool. — [TerraMaster forum](https://forum.terra-master.com/en/viewtopic.php?p=43540)

**UGREEN UGOS Pro (UPK)**
- UGREEN runs a developer platform at developer.ugnas.com. UGOS Pro is Linux-based and supports x86_64 and ARM64. Developers build on Debian 12 and use the `ugcli` CLI. UPK files must be built on Linux with `ugcli pack` so that Unix file modes are correct. Test devices need UGOS Pro 1.13.0.0000 or later. — [UGREEN dev docs: Prepare](https://developer.ugnas.com/en/doc/backend/quick-start/prepare.html)
- Device developer authorization: email UGREEN the serial number, MAC address and admin username, then place the returned `ugdev.sig` file. From UGOS Pro 1.16.0.0000, authorization is done in App Center > Settings > App Development Settings. Packaged apps are installed manually as `.upk` files through App Center during testing. — [UGREEN dev docs: Prepare](https://developer.ugnas.com/en/doc/backend/quick-start/prepare.html)
- A German forum post reports that native apps must be written in C/C++ or Go. This is unverified. — [heimnetz.de forum](https://forum.heimnetz.de/threads/3rd-party-developer-und-openclaw.8242/)
- Listing flow: develop, self-test, email basic information to UGREEN using their template, talk with the business team, submit materials for review, then the app is listed. No fees, timelines or license rules appear on that page. — [UGREEN listing flow](https://developer.ugnas.com/en/doc/flow.html)

**WD My Cloud (OS 5)**
- A WD Community user reports that WD "fully removed any docker components" from OS 5. Docker on OS 3 came from an independent developer and was not supported by WD. — [WD Community](https://community.wd.com/t/docker-support-in-os5/257063)
- OS3 to OS5 upgrades broke third-party apps such as Plex, and recovery often needed SSH. Some users reinstalled OS5 versions of Plex and Docker without problems. — [Plex forum](https://forums.plex.tv/t/compatibility-with-mycloud-os-5/647729?page=10)

### Inferences
- Synology's DSM 7 model (non-root `run-as package`, resource workers, AppArmor, review checklist) is technically workable for a photo DAM that only needs its own data and read access to shared folders. But "trusted" status in Package Center requires going through Synology's publisher program, and community SPKs always show warnings.
- QNAP's signing model ties trust to QNAP's own signing key. An OSS project would either go through QNAP's program to get official signing, distribute through the QNAP Club store, or ask users to allow unsigned apps, which is a bad user experience after the ransomware incidents.
- UGREEN's UPK Docker-app format is effectively "a Compose file plus `docker save` tarballs, with privileged features banned". That maps cleanly onto a Compose-based DAM stack.

### Gaps
- No primary source on DSM 7.3-specific package-framework changes. Synology's developer guide is still versioned 7.2.2, and its `breaking_changes.html` and `release_notes.html` pages were not fetched.
- The Synology guide does not say whether `run-as: root` is ever approved for third-party packages. The review checklist implies it is not.
- The current QTS 5.2 / QuTS hero default for unsigned QPKGs could not be confirmed from a 2024-2026 primary QNAP source. How a third-party developer obtains QNAP code signing (program, cost, NDA) was not found.
- No current (ADM 5) Asustor developer guide was found; the latest is July 2023 (ADM 4.2). No TerraMaster TOS 6/7 packaging guide was found; the page references TOS 5.
- UGREEN app permission/sandbox model, code signing of UPKs and review timelines were not covered by the pages fetched.

## Q2. Container route: is Docker Compose the de facto cross-vendor path?

### Takeaway
Yes, in practice. Major OSS projects such as Immich and Jellyfin document Docker or Compose through the vendor's container manager as the main NAS path, and native packages are often just wrappers around their Docker images. Caveats: Docker availability on low-end ARM models is inconsistent, WD My Cloud OS 5 has no supported Docker, and UGREEN can wrap a Compose stack as an App Center UPK.

### Cited Findings
- Immich's Synology install guide uses Container Manager's "Project" feature: upload `docker-compose.yml` and `.env`, create a project, and open firewall port 2283. The page is labeled community-maintained and not officially supported by the Immich team. — [Immich docs: Synology](https://docs.immich.app/install/synology/)
- A French guide warns that Immich containers use at least 1 GB of RAM by default and advises against installing on 2 GB NAS units. — [IT-Connect](https://www.it-connect.fr/nas-synology-comment-auto-heberger-immich-avec-docker/)
- Jellyfin's official Synology docs install through Docker in Container Manager (DSM 7.0+). A Jellyfin moderator describes the SynoCommunity package as "just a re-wrap of our docker image". — [Jellyfin docs](https://jellyfin.org/docs/general/installation/advanced/synology); [Jellyfin forum](https://forum.jellyfin.org/t-migrate-jellyfin-package-to-docker-container-on-synology-nas)
- Synology Container Manager on ARM: release 20.10.23-1437 (Sept 2023) added ARMv8 models DS220j and DS120j. Later notes list DS420j and DS223 and require DSM 7.2+. Third-party sites contradict this and claim value/j models are unsupported. Some older models, for example DS418 and DS1517, reportedly lack Container Manager. — [Synology Container Manager release notes](https://www.synology.com/releaseNote/ContainerManager); [mariushosting](https://mariushosting.com/?p=59886); [Jellyfin forum](https://forum.jellyfin.org/t-jellyfin-synology-compatibility)
- QNAP has pointed users to Container Station as the preferred route for third-party apps since QTS 5.0 (secondary source). — [schieb.de](https://www.schieb.de/wenn-apps-auf-einem-qnap-nas-beendet-werden)
- UGREEN Docker apps: images are exported with `docker save` into `rootfs_{arch}/images/`. A standard Compose file goes in `rootfs_common/docker-compose.yaml`, and `project.yaml` sets `is_docker_app: true`. The `latest` tag is forbidden, `privileged`, `cap_add` and host PID/IPC are rejected, and host networking is flagged at pack time. — [UGREEN dev docs: Docker APP](https://developer.ugnas.com/en/doc/backend/quick-start/develop-docker-app.html)
- Synology DSM 7 has a "Docker" resource worker for packages, so an SPK can declare Docker resources. — [Synology Developer Guide](https://help.synology.com/developer-guide/)
- WD My Cloud OS 5 reportedly has no Docker support (community reports). — [WD Community](https://community.wd.com/t/docker-support-in-os5/257063)

### Inferences
- A multi-arch (amd64 plus arm64) Compose stack with no privileged features covers Synology Container Manager, QNAP Container Station, UGREEN (raw Docker or a UPK wrapper) and, by extension, Asustor and TerraMaster Docker tooling. That is the lowest-effort path. A native SPK or QPKG "launcher" that declares a Docker resource (Synology) or wraps Container Station (QNAP) is a second step for discoverability.
- RAM requirements matter for a photo DAM with ML workloads: 2 GB entry NAS units are a poor fit.

### Gaps
- Not researched in detail: Asustor's Docker/Portainer apps, TerraMaster Docker Manager and QNAP Container Station's LXD support, including current ARM model coverage.
- No official Synology list of Container Manager-supported models was retrieved.

## Q3. Official APIs (files, auth, photos, events)

### Takeaway
Synology publishes official Web API PDFs for File Station and DSM Login (SYNO.API.Info and SYNO.API.Auth). The Synology Photos API (SYNO.Foto.*) is undocumented and was reverse-engineered by the community. QNAP publishes old (2013-2016) PDFs for File Station and QTS HTTP authentication (`authLogin.cgi`, `sid`, 2-step verification). For Asustor, TerraMaster and WD I found no public file APIs. UGREEN documents "Login Authentication" and "System Capabilities" for in-app use. No vendor offers a documented file-change webhook or event API; the closest Synology mechanism is the undocumented `synoindex` CLI.

### Cited Findings
- Synology File Station Official API guide (PDF): Ch. 3 covers SYNO.API.Info and SYNO.API.Auth; Ch. 4 covers list, search, upload, download, copy/move, delete, extract and compress. The document is marked proprietary. — [Synology File Station API Guide PDF](https://cndl.synology.cn/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf)
- Synology also publishes a "DSM Login Web API Guide" on its knowledge base. — [Synology KB: DSM Login Web API Guide](https://kb.synology.cn/zh-cn/DG/DSM_Login_Web_API_Guide/1)
- Synology Photos API: the definitions live in `/volume1/@appstore/SynologyPhotos/usr/webapi` and can be discovered through `SYNO.API.Info` on port 5001 or under `/photo`. The community docs say "The informations here are by far not complete." — [zeichensatz/SynologyPhotosAPI](https://github.com/zeichensatz/SynologyPhotosAPI)
- A French forum notes the Photos APIs "ne sont pas documentées à moins d'en faire une rétro-ingénierie" (are undocumented unless you reverse-engineer them). — [nas-forum.com](https://www.nas-forum.com/forum/topic/76684-cr%C3%A9ation-dalbums-photos-automatique-en-fonction-des-dossiers)
- QNAP File Station API v0.9: `cgi-bin/authLogin.cgi?user=...&pwd=...` returns a session ID (sid), with the password encoded by QNAP's `ezEncode`. — [QNAP File Station API v0.9 PDF](https://eu1.qnap.com/dev/QNAP_QTS_File_Station_API_v0.9.pdf)
- QTS HTTP API Authentication v5.1.0 adds `qtoken` (`remme`), `force_to_check_2sv` for two-step verification, and other options. — [QTS HTTP API Authentication v5.1.0 PDF](https://eu1.qnap.com/dev/QTS_HTTP_API-Authentication_v5.1.0.pdf)
- The older File Station v4.1 API uses `filemanager/wfm2Login.cgi` and `utilRequest.cgi?func=...`. — [QNAP File Station API v4.1 PDF](https://eu1.qnap.com/dev/QNAP_QTS_File_Station_API_v4.1.pdf)
- A third-party guide uses POST with Base64 passwords against authLogin.cgi, which conflicts with the official `ezEncode` description. — [Linux Fabrik docs](https://docs.linuxfabrik.ch/hardware/qnap-qts.html)
- UGREEN developer docs include "Login Authentication" (`/en/doc/backend/system-capabilities/login-auth.html`) and "System Capabilities" pages. I did not fetch their contents. — [UGREEN dev docs index](https://developer.ugnas.com/en/doc/backend/quick-start/prepare.html)
- Synology `synoindex`: community users call it to make DSM rescan for new files, per folder or in full. Synology's official Media Indexing help says it indexes multimedia in shared folders but cannot index remote-mounted folders. — [FileBot forum](https://www.filebot.net/forums/viewtopic.php?p=33929); [Synology KB: Media Indexing](https://www.synology.com/en-uk/knowledgebase/DSM/help/DSM/AdminCenter/application_mediaindexservice_general)
- DSM 7 offers an "Index DB" resource worker to packages (contents not fetched). — [Synology Developer Guide](https://help.synology.com/developer-guide/)

### Inferences
- A DAM should treat native filesystem access (bind mounts or the package's shared-folder permissions) as the main integration, with inotify or periodic scanning for changes. Vendor HTTP APIs are useful for remote "import from NAS" connectors but are not event sources.
- Integrating with Synology Photos (for example, importing albums or tags) depends on an undocumented API that can change between releases.

### Gaps
- No official Synology OAuth documentation for third-party apps was found. Synology's SSO Server package exists, but I did not research it.
- No documented webhook or file-change notification API was found for any vendor.
- No current (QTS 5.2 / QuTS hero) QNAP File Station API reference was found.
- No public HTTP APIs were found for Asustor ADM, TerraMaster TOS or WD My Cloud OS 5.
- Contents of the "Index DB" worker and UGREEN Login Authentication pages were not fetched.

## Q4. Existing third-party SDKs and libraries

### Takeaway
The main Python wrapper for Synology, N4S4/synology-api, is MIT-licensed and moderately mature (around 600 stars, around 300 APIs, a self-described hobby project). Several community Synology Photos clients exist. I did not research the licensing of other libraries such as python `synology-dsm` or the Home Assistant integrations.

### Cited Findings
- N4S4/synology-api: MIT license, about 598 stars, 168 forks, 1,185 commits, "around +300 APIs implemented". The author calls it a hobby project provided "As Is", and the async client is beta. Its examples use `dsm_version=7`. — [N4S4/synology-api](https://github.com/N4S4/synology-api)
- `synophotos`, a Python CLI for Synology Photos on PyPI, is built on the unofficial API docs. — [synophotos (PyPI)](https://pypi.org/project/synophotos/); [fortysix2ahead/synophotos](https://github.com/fortysix2ahead/synophotos)
- `syno-photos-util` is a Rust tool that maps Photos albums to folders and was started from the zeichensatz docs. — [lib.rs syno-photos-util](https://www.lib.rs/crates/syno-photos-util)

### Inferences
- MIT-licensed wrappers can be used from GPL, AGPL or MIT projects without conflict.

### Gaps
- Not verified: licenses or maturity of `py-synologydsm-api` / `synology-dsm` (used by Home Assistant), QNAP Python libraries, and the Home Assistant Synology and QNAP integrations.

## Q5. Developer program terms and how OSS projects ship on each platform

### Takeaway
Synology requires an application plus acceptance of a "Developer Distribution Agreement and Package Developer Guideline". No fees or GPL clauses appeared in the public pages fetched. UGREEN and TerraMaster use email-based, business-team-mediated listing. Asustor requires approval through its Developer's Corner. In practice, OSS media and photo projects (Immich, Jellyfin) ship as Docker on NAS, with community repackaging (SynoCommunity, QNAP Club, unsigned QPKGs) as a secondary path.

### Cited Findings
- Synology publishing: "Apply on Synology website", "Read and accept the Developer Distribution Agreement and Package Developer Guideline", and packages "must comply with the Terms of Service in Package Center". — [Synology: Publish – Get Started](https://help.synology.com/developer-guide/publish_package/get_start.html)
- The Synology developer guide copyright notice says "No part of this publication may be reproduced…" without permission, so the docs are proprietary. — [Synology Developer Guide](https://help.synology.com/developer-guide/)
- TerraMaster says the developer "personally maintain[s] the application and assume[s] corresponding responsibilities". — [TerraMaster developer page](https://www.terra-master.com/us/developer)
- UGREEN listing is done through email template and business-team review. The footer links to Terms of Use and "Management Rules", which I did not fetch. — [UGREEN listing flow](https://developer.ugnas.com/en/doc/flow.html)
- How projects ship:
  - **Immich:** Docker/Compose through Synology Container Manager (community-maintained guide). — [Immich docs](https://docs.immich.app/install/synology/)
  - **Jellyfin:** official docs use Docker on Synology. SynoCommunity has a package that rewraps the Docker image, with updates said to take up to about a week. On QNAP there is a community unsigned QPKG that wraps Container Station. — [Jellyfin docs](https://jellyfin.org/docs/general/installation/advanced/synology); [Jellyfin forum](https://forum.jellyfin.org/t-migrate-jellyfin-package-to-docker-container-on-synology-nas); [Jellyfin-QPKG](https://github.com/kajain99/Jellyfin-QPKG)
  - **Syncthing:** the SynoCommunity package was blocked on the DSM 7 beta for running as root, which forced a privilege rework. — [mariushosting](https://mariushosting.com/3rd-party-package-support-in-dsm-7/)
  - **Plex:** ships native packages on WD OS 5, and upgrades from OS3 lost configuration. — [Plex forum](https://forums.plex.tv/t/compatibility-with-mycloud-os-5/647729?page=10)
- WD reportedly would not release GPL source for pre-release OS5 builds (single forum user). — [WD Community](https://community.wd.com/t/docker-support-in-os5/257063)

### Inferences
- The publicly visible terms show no explicit open-source or GPL prohibition, but the full Synology Developer Distribution Agreement and UGREEN Terms of Use were not read. An AGPL or GPL DAM shipped as a vendor-signed package would need legal review of redistribution and source-offer obligations under those agreements.
- For an OSS project, "official" listing means a business relationship (Synology application, UGREEN business team, TerraMaster PM email). Most comparable OSS projects avoid this and rely on Docker docs plus community packagers.

### Gaps
- Not found: the text of Synology's Developer Distribution Agreement (NDA, fees, GPL clauses), QNAP's developer program terms and how third parties get QNAP code signing, Asustor's App Central guidelines, and UGREEN Terms of Use or Management Rules.
- Review timelines were not published by any vendor that I found.
- Not researched: how Plex, Home Assistant and Nextcloud ship on QNAP App Center, Asustor or UGREEN.

## Q6. Security history and tightening of third-party app policy

### Takeaway
QNAP's ransomware history (Qlocker 2021, DeadBolt 2022, including a September 2022 DeadBolt exploit of the Photo Station photo app) led QNAP to force firmware updates and to enforce code signing through Security Counselor. Synology's main tightening was DSM 7.0's non-root requirement for packages. A photo-management app was itself the attack vector in a QNAP mass-ransomware event, which matters for how a DAM project presents its security posture.

### Cited Findings
- In January 2022, QNAP force-updated NAS firmware to 5.0.0.1891 in response to DeadBolt, citing that during Qlocker "many people got infected after we had patched the vulnerability". — [Security Affairs](https://securityaffairs.com/127353/malware/qnap-force-installs-update-deadbolt-ransomware.html)
- In September 2022, DeadBolt exploited a Photo Station vulnerability on internet-exposed QNAP NAS. QNAP released a patched Photo Station "within 12 hours" (6.1.2+ on QTS 5.0.1, among other versions) and suggested QuMagie as an alternative. — [Malwarebytes](https://www.malwarebytes.com/blog/news/2022/09/update-now-qnap-warns-users-deadbolt-is-exploiting-photo-station-vulnerability); [Security Affairs](https://securityaffairs.com/135347/malware/qnap-deadbolt-ransomware-new-attacks.html)
- QNAP advised against exposing NAS devices directly to the internet and recommended myQNAPcloud Link or a VPN. — [Malwarebytes](https://www.malwarebytes.com/blog/news/2022/09/update-now-qnap-warns-users-deadbolt-is-exploiting-photo-station-vulnerability)
- Security Counselor stops unsigned apps unless the user allows them. — [schieb.de](https://www.schieb.de/wenn-apps-auf-einem-qnap-nas-beendet-werden)
- Synology DSM 7: packages that need root are blocked in favor of non-privileged packages. — [mariushosting](https://mariushosting.com/3rd-party-package-support-in-dsm-7/); [Synology Appendix C](https://help.synology.com/developer-guide/appendix/publication_review.html)
- UGREEN's Docker-app packer rejects `privileged`, `cap_add` and host PID/IPC. — [UGREEN Docker APP docs](https://developer.ugnas.com/en/doc/backend/quick-start/develop-docker-app.html)

### Inferences
- A DAM package should run unprivileged, expose no admin endpoints by default, and document a reverse proxy or VPN for remote access. Vendors and users now expect this, and the vendors' own photo apps (QNAP Photo Station) have been ransomware entry points.

### Gaps
- Not researched: a specific Synology CVE or advisory history (for example Pwn2Own findings, or Synology Photos and Synology Drive advisories). Also not found: a primary QNAP statement linking the change in signing enforcement to the ransomware campaigns.
