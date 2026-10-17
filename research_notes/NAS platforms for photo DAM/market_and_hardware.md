# NAS platforms photographers use: market share and on-box hardware constraints (as of Oct 2026)

Evidence-quality legend used throughout: **[ANALYST]** = paid market-research summary (often low reliability, inconsistent); **[SURVEY]** = survey with stated sample; **[EDITORIAL]** = review/roundup (often affiliate-funded); **[ANECDOTE]** = forum/Reddit/blog user report; **[VENDOR]** = vendor page/release notes; **[UNVERIFIED-TK]** = researcher's prior knowledge, NOT confirmed by a fetched source this session; check before relying on it.

## Q1. Overall consumer/SMB NAS market share by vendor (analyst reports)

### Takeaway
No analyst report I could access gives credible, consistent per-vendor share numbers for consumer/SMB NAS. Free summaries contradict each other: one ranks WD first at ~30%, another has Synology+QNAP at 34.8%. The most usable vendor-split figure comes from a self-hoster population: Synology ~62%, QNAP ~14%, custom builds ~11%, Asustor ~3%, UGREEN ~2%, WD+TerraMaster ~3%. Its sample is undisclosed and skews toward tech-savvy users. Either way, Synology is the clear #1 platform to target, with QNAP second.

### Cited Findings
- Overall NAS market size estimates disagree. Mordor Intelligence values the NAS market at USD 39.62B in 2025 **[ANALYST]**. The Business Research Company puts it at $44.73B for 2025 **[ANALYST]**. A Global Market Insights-based figure is $34.5B in 2024, rising to $136.4B by 2034 at a 17.1% CAGR **[ANALYST]**. — [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/network-attached-storage-nas-market); [The Business Research Company](https://www.thebusinessresearchcompany.com/report/network-attached-storage-global-market-report); [CommandLinux stats compilation](https://commandlinux.com/statistics/nas-and-file-server-os-distribution/)
- Consumer NAS segment: $6.1B in 2024, projected $12B by 2030 at a 12.1% CAGR. North America held 34.2% of it. 4-bay designs were over 28% of consumer sales and HDD over 65% of consumer deployments (attributed to Grand View Research via a compilation) **[ANALYST, secondhand]**. — [CommandLinux](https://commandlinux.com/statistics/nas-and-file-server-os-distribution/)
- Another consumer-segment estimate is ~USD 11.39B in 2025, so the scope definitions clearly differ **[ANALYST]**. — [Global Growth Insights](https://www.globalgrowthinsights.com/market-reports/consumer-nas-market-105865)
- Global Growth Insights claims Western Digital holds ~30% of the global consumer NAS market and Synology ~25% **[ANALYST, low reliability]**. The WD figure likely counts My Cloud single-drive "personal cloud" units and conflicts with every enthusiast data point. — [Global Growth Insights](https://www.globalgrowthinsights.com/market-reports/consumer-nas-market-105865)
- Dataintelo is internally inconsistent. It says Synology, QNAP and Asustor collectively hold ~67.3% of consumer NAS, but its key takeaways say Synology and QNAP had a 34.8% combined share **[ANALYST, inconsistent]**. — [Dataintelo](https://dataintelo.com/report/consumer-network-attached-storage-nas-market)
- Self-hosted respondents using pre-built NAS hardware: Synology 62%, QNAP 14.3%, custom-built 11.2%, ASUSTOR 3.1%, UGREEN 2.0%, Western Digital + TerraMaster combined 2.8%. No survey name, year or sample size is given. Published Feb 2026 **[SURVEY, unverifiable provenance]**. — [CommandLinux](https://commandlinux.com/statistics/nas-and-file-server-os-distribution/)
- Coverage of Synology's Oct 2025 policy reversal says NAS sales "dropped sharply" after the 2025 drive lock-in. This is a press claim; Synology never confirmed sales figures **[EDITORIAL]**. — [Guru3D](https://guru3d.com/story/synology-reverses-policy-banning-thirdparty-hdds-after-nas-sales-plummet/); [Neowin](https://www.neowin.net/news/synology-backtracks-on-policy-that-allegedly-turned-buyers-away-from-its-nas-devices/)

### Inferences
- The 62% Synology figure is consistent with community sentiment and with Synology heading nearly every photographer roundup (Q2). Treat it as directional only: undisclosed sample, enthusiast population.
- WD's high share in some analyst reports most likely reflects single-drive My Cloud Home / personal-cloud boxes. These are closed appliances that can't run third-party software, so they don't matter as a DAM target even if the unit counts are real.
- Practical target ranking for a DAM: (1) Synology DSM via Docker/Container Manager; (2) generic Docker on Linux, which covers QNAP, UGREEN, Asustor, TerraMaster, Unraid, TrueNAS SCALE and OMV; (3) a native QNAP package only if demand appears.

### Gaps
- No IDC or Gartner consumer/SMB NAS vendor-share figures were accessible. IDC's storage trackers are paywalled and generally don't break out prosumer NAS.
- I found no data splitting US vs EU vendor share. Anecdotally, UGREEN and TerraMaster are prominent on Amazon in both regions, but this is unquantified.
- I found no reliable 2026 unit-shipment figures per vendor.

## Q2. What photographers and creative professionals actually use (including DIY)

### Takeaway
No photographer-specific usage survey exists that I could find. Editorial roundups for photographers consistently put Synology first, typically the DS925+, DS923+, DS224+/DS225+ or DS1825+. They then list UGREEN (value hardware), QNAP (ZFS via QuTS hero, video) and TerraMaster/Asustor (budget, all-flash). Among tech-savvy prosumers and self-hosters, DIY OSes are significant. In selfh.st's 2025 survey (n=4,081), TrueNAS was 19.0%, Unraid 10.1%, DSM 9.8% and OMV 5.0% of respondents, and 67.8% deploy a NAS.

### Cited Findings
- **Fstoppers, "Best NAS for Photographers in 2026"** (late Sep/Oct 2026) **[EDITORIAL]**:
  - Best Overall: Synology DS925+.
  - Best Hardware for the Money: UGREEN DXP4800 Pro.
  - Best Budget: TerraMaster F4-424.
  - Large Libraries: Synology DS1825+.
  - Compact 2-bay: TerraMaster F2-425 Plus.
  - All-flash: Asustor Flashstor 6 Gen2 FS6806X.
  - Data integrity (ZFS): QNAP TVS-h474.
  - Offsite backup: Synology BeeStation Plus.
  - Synology was picked for "most polished" DSM and Synology Photos. UGOS Pro was flagged as young, with a thin security track record. DIY (Unraid/TrueNAS) was not mentioned.
  - Source: [Fstoppers](https://fstoppers.com/best-nas-photographers-2026)
- Other 2026 roundups also lead with Synology:
  - One names the DS423 best for most photographers, the UGREEN DXP2800 top value and the DS223j for beginners.
  - Another picks the DS923+ as best overall.
  - A third lists the DS224+ then DS423+, praising Synology Photos face recognition.
  - QNAP TS-264 is cited for QuMagie AI photo indexing.
  - QNAP TS-453BT3 is cited for Mac/Thunderbolt users.
  - All are affiliate-heavy **[EDITORIAL]**. — [findingdulcinea](https://www.findingdulcinea.com/best-nas-for-photographers-january-2026/); [requirementspc](https://requirementspc.com/best-nas-for-photographers/); [speedtesthq](https://speedtesthq.com/best/best-nas-for-photos)
- Australian guide: Synology DS425+ is best all-round for photographers, and QNAP TS-464 is suggested for photographers who also do video **[EDITORIAL]**. — [needtoknowit.com.au](https://needtoknowit.com.au/blog/best-nas-for-photography-australia/)
- **selfh.st 2025 Self-Host User Survey** (4,081 completed responses) **[SURVEY, self-hoster population, not photographers]**:
  - OS usage: TrueNAS 774 (19.0%), Unraid 412 (10.1%), DiskStation Manager 398 (9.8%), OpenMediaVault 204 (5.0%), Raspberry Pi OS 979 (24.0%).
  - NAS deployment: deploy 2,768 (67.8%), don't deploy 1,313 (32.2%).
  - Hardware types (multi-select): consumer hardware 57.8%, low-powered device 50.0%, custom build 37.8%, enterprise hardware 20.0%.
  - Immich was a "favorite software" for 429 of 3,678 responses (11.7%). PhotoPrism, Synology Photos and Ente did not appear; the chart drops anything under 20 mentions.
  - Sources: [selfh.st 2025 results](https://selfh.st/survey/2025-results/); [raw JSON on GitHub](https://raw.githubusercontent.com/selfhst/cdn/main/assets/surveys/annual/2025-results.json)
- The same 2025 survey found Linux at ~81% of respondents' OS and Docker as the most common container platform **[SURVEY via news]**. — [Linuxiac](https://linuxiac.com/self-hosters-confirm-it-again-linux-dominates-the-homelab-os-space/)
- Open-source NAS OS popularity ranking (2024, by page views/downloads): OMV first, TrueNAS second, XigmaNAS third. No shares given **[ANALYST-lite]**. — [CommandLinux](https://commandlinux.com/statistics/nas-and-file-server-os-distribution/)

### Inferences
- Mainstream working photographers, especially non-technical ones, mostly land on Synology plus Lightroom Classic on a local SSD, using the NAS for archive and backup. Synology Photos and QNAP QuMagie are the incumbent "DAM-lite" apps an open-source DAM would compete with.
- Self-hosting-oriented photographers skew TrueNAS/Unraid. In selfh.st, TrueNAS + Unraid (29%) outnumber DSM (9.8%), but that population is not representative of photographers at large.
- Immich already has strong mindshare (11.7% "favorite" among self-hosters). A new DAM will be benchmarked against Immich's install experience: a single docker-compose file.

### Gaps
- I found no survey of photographers' NAS brand usage from DPReview, Fred Miranda, Lightroom Queen, PetaPixel, B&H or Adorama. I did not fetch Reddit threads directly, so community sentiment from r/photography, r/synology and r/DataHoarder is not quantified here.
- selfh.st has no NAS-vendor or CPU-architecture question, so ARM vs x86 share among self-hosters is unknown.

## Q3. Legacy installed base: WD My Cloud, Drobo, Netgear ReadyNAS

### Takeaway
Three formerly photographer-popular lines are dead or dying:
- **WD My Cloud OS 3:** support ended April 2022; the devices are local-only now.
- **WD My Cloud OS 5:** support was promised only "through 2026", so it is reaching its stated horizon now.
- **Drobo:** went bankrupt in 2022 and was liquidated (Chapter 7) in 2023. It was especially popular with photographers.
- **Netgear ReadyNAS:** not confirmed in this session.

These users represent a migration pool. Their data typically sits on proprietary RAID (Drobo BeyondRAID) or aging ARM boxes that can't run containers.

### Cited Findings
- WD ended remote access, security updates and tech support on Jan 15, 2022 for OS5-compatible devices still on old firmware, and on April 15, 2022 for OS 3-only devices. Those devices are now local-network only. WD advises disabling remote access and disconnecting them from the internet **[VENDOR]**. — [WD OS3 end-of-service page](https://www.westerndigital.com/support/software/my-cloud-os/os3/os3-eos); [PetaPixel 2021](https://petapixel.com/2021/11/19/western-digital-to-end-support-for-prior-generations-of-my-cloud-os)
- WD says My Cloud OS 5 support is "guaranteed through 2026". My Cloud Home products are excluded from that notice. I found no newer 2026 announcement extending or ending OS 5 support **[VENDOR]**. — [WD My Cloud updates](https://westerndigital.com/mycloudupdates)
- Drobo and its parent StorCentric filed Chapter 11 in 2022 (N.D. Cal.), which converted to Chapter 7 liquidation in late April 2023. Drobo's site says that as of Jan 27, 2023, products and support are no longer available. PetaPixel and PopPhoto covered it as photographer-relevant news **[NEWS]**. — [PetaPixel](https://petapixel.com/2022/07/18/storage-company-drobo-files-for-chapter-11-bankruptcy/); [PopPhoto](https://www.popphoto.com/news/drobo-files-chapter-11-bankruptcy/); [512 Pixels citing Ars Technica](https://512pixels.net/2023/05/the-end-of-drobo/); [AppleInsider](https://appleinsider.com/articles/22/07/06/storage-firm-drobo-has-filed-for-chapter-11-bankruptcy)

### Inferences
- A DAM "import from legacy NAS over SMB/NFS" path is valuable. These users will move to a new box and need ingest and deduplication of large existing trees, not in-place operation on the old hardware.
- WD's "through 2026" OS 5 horizon means another wave of WD My Cloud EX/PR users may be migrating in 2027.

### Gaps
- Netgear ReadyNAS exit: no source surfaced. My recollection is that Netgear stopped new ReadyNAS development around 2020–2021 and ended support thereafter, but this is **[UNVERIFIED-TK]** and needs a check against Netgear's EOL page.
- I found no installed-base estimates for Drobo or My Cloud.

## Q4. Newer entrants (UGREEN, Asustor, TerraMaster, mini-PC makers): traction and openness

### Takeaway
UGREEN NASync has quickly become the default "better hardware for the money" alternative in roundups. All its DXP models are x86 Intel with Docker in UGOS Pro, and TrueNAS/Unraid install fine. Warranty statements on a third-party OS conflict. TerraMaster (TOS) and Asustor (ADM, including all-flash Flashstor) are also x86 with Docker and appear in photographer roundups for budget and all-flash niches. All of these allow Docker. None restricts drives the way Synology did in 2025.

### Cited Findings
- UGREEN's share among self-hosted pre-built NAS users is ~2.0% (Asustor 3.1%; WD + TerraMaster combined 2.8%) **[SURVEY, unverified provenance]**. — [CommandLinux](https://commandlinux.com/statistics/nas-and-file-server-os-distribution/)
- UGREEN DXP models are standard x86 Intel machines, and TrueNAS SCALE and Unraid install via UEFI. To do so, the built-in boot NVMe must be removed, and it carries a warranty sticker **[ANECDOTE/EDITORIAL]**. — [needtoknowit](https://needtoknowit.com.au/blog/truenas-unraid-on-ugreen-dxp.md); [TrueNAS forum](https://www.truenas.com/community/threads/ugreen-nasync-support.117567/)
- UGREEN's warranty position on a third-party OS conflicts across sources:
  - 2024 statements relayed by NASCompares: a third-party OS is unsupported and the warranty covers hardware only; another answer said modifying the system loses the warranty.
  - A more recent review says UGREEN told them a third-party OS doesn't void the hardware warranty.
  - **[VENDOR-via-EDITORIAL, conflicting]** — [NASCompares Q&A](https://nascompares.com/guide/ugreen-brand-user-qa-questions-about-the-new-nasync-nas-storage-solution/); [WunderTech](https://www.wundertech.net/?p=20214)
- UGOS Pro is Linux-based with Docker support. Its app ecosystem is thin and it lacks a long security-patch track record. UGREEN does not restrict drives or SSDs **[EDITORIAL]**. — [Fstoppers](https://fstoppers.com/best-nas-photographers-2026); [datacenterdisk](https://datacenterdisk.com/nas-devices/ugreen)
- TerraMaster: TOS is described as behind DSM, and the author notes TerraMaster's security history. TerraMaster F4-424 and F2-425 Plus (TOS 7) are recommended for photographers **[EDITORIAL]**. — [Fstoppers](https://fstoppers.com/best-nas-photographers-2026)
- Asustor Flashstor 6 Gen2 FS6806X: Ryzen Embedded V3C14, 8GB DDR5-4800 ECC (up to 64GB), 6 PCIe 4.0 NVMe slots, 10GbE, ADM. Recommended as the all-flash option **[EDITORIAL]**. — [Fstoppers](https://fstoppers.com/best-nas-photographers-2026)
- Remote ML offload: guides suggest running Immich ML on a separate N100/N150 mini-PC with 16GB RAM minimum rather than on a Synology **[EDITORIAL]**. — [hometechops](https://hometechops.com/nas/local-ai-on-nas-immich-frigate-ollama); [needtoknowit Immich AI guide](https://needtoknowit.com.au/blog/immich-ai-features-guide/)

### Inferences
- The newer entrants are all x86 with Docker, so a single amd64 container image covers them. The main per-vendor work would be packaging: app-store listings and path/permission conventions such as UGOS shares, TOS and ADM volumes.
- Mini-PCs (Beelink, Minisforum, Aoostar N100/N150/Ryzen) are the most likely "ML sidecar" or full-DAM host for prosumers. That suggests designing the DAM so ML and thumbnailing workers can run remotely from the storage box, as Immich already does.

### Gaps
- No quantified traction data was found for Zettlabs, Minisforum (N5 Pro NAS), Beelink (ME mini) or Aoostar (WTR Pro). Their openness: these are generally plain x86 PCs where any OS is installable **[UNVERIFIED-TK]**.
- TerraMaster TOS 6/7 and Asustor ADM third-party-OS warranty policies were not verified this session. TerraMaster has historically tolerated third-party OS installs on a USB boot drive **[UNVERIFIED-TK]**.

## Q5. Hardware profile of popular photographer models (and the Synology 2025 drive lock-in)

### Takeaway
Synology's current Plus line is split two ways:
- **Intel Celeron J4125** (2018-era Gemini Lake Refresh, 4C/4T, UHD 600 iGPU, 6GB RAM ceiling): DS224+, DS225+, DS423+, DS425+.
- **AMD Ryzen Embedded R1600/V1500B** (2C/4T or 4C/8T, ECC, up to 32GB, no iGPU so no hardware video/JPEG acceleration): DS723+, DS725+, DS923+, DS925+, DS1522+, DS1525+, DS1621+, DS1821+, DS1825+.

Competitors ship much newer Intel silicon (N95/N100/N150/N300/N5105/Pentium 8505/i3-1315U/i5-1235U, or 12th-gen desktop Core in QNAP TVS-h874), all with Quick Sync iGPUs, DDR5 and often 10GbE built in.

Synology's 2025 third-party drive lock was partly reversed in DSM 7.3 (Oct 8, 2025). HDDs and SATA SSDs are allowed again on 2025 Plus/Value/J models, but M.2 cache still needs Synology-listed SSDs.

### Cited Findings
**Synology drive-compatibility controversy:**
- DSM 7.3 was released Oct 8, 2025. It lets 2025 Plus, Value and J series models create storage pools with unverified 3.5" HDDs and 2.5" SATA SSDs (e.g., WD, Seagate) **[NEWS citing VENDOR]**. — [TechSpot](https://www.techspot.com/news/109787-synology-reverses-course-non-certified-hdds-nas-systems.html); [Gigazine](https://www.gigazine.net/gsc_news/en/20251009-synology-third-party-hdd-support-returns); [TechRadar](https://www.techradar.com/pro/synology-now-allows-3rd-party-hdds-to-boost-its-nas-sales-meaning-you-can-add-that-sweet-30tb-seagate-exos-hard-drive)
- M.2 SSD caches still require Synology-HCL drives. Business/enterprise models and previous-generation products stay on the old HCL policy. Reports conflict on whether warnings still appear **[NEWS]**. — [nasstore.eu](https://nasstore.eu/dsm-7-3-synology-finally-reintroduces-support-for-third-party-hard-drives/); [Neowin](https://www.neowin.net/news/synology-backtracks-on-policy-that-allegedly-turned-buyers-away-from-its-nas-devices/)
- Fstoppers (2026): third-party NVMe can be used in a storage pool but not as cache on Synology **[EDITORIAL]**. — [Fstoppers](https://fstoppers.com/best-nas-photographers-2026)

**Hardware table.** Sourced specs are cited. Cells marked † are **[UNVERIFIED-TK]** and should be checked against vendor spec pages before publication.

| Model | CPU (arch) | iGPU / Quick Sync | RAM default / max | PCIe slot | Network | Source |
|---|---|---|---|---|---|---|
| Synology DS925+ (2025) | AMD Ryzen V1500B 4C/8T (x86) | **None** | 4GB DDR4 ECC / 32GB | None†; 2x M.2 | 2x 2.5GbE | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026); [NASCompares](https://nascompares.com/news/synology-ds925-nas-news/) |
| Synology DS425+ (2025) | Intel Celeron J4125 4C/4T (x86) | UHD 600 (Quick Sync). Plex HW transcode reportedly not enabled on 2025 models without a community workaround | 2GB† / 6GB | None | 2x 2.5GbE† | [blackvoid](https://www.blackvoid.club/synology-ds425-overview/); [Plex forum](https://forums.plex.tv/t/synology-ds925-vs-ds425/925447?page=3) |
| Synology DS225+ (2025) | Celeron J4125 | UHD 600 | 2GB / 6GB | None | 1x 2.5GbE + 1x 1GbE† | [geizhals listings](https://geizhals.de/synology-diskstation-plus-serie-v96707.html) |
| Synology DS1525+ (2025) | Ryzen V1500B 4C/8T (up from R1600 in DS1522+) | None | 8GB ECC / 32GB† | 1x PCIe Gen3† | 2x 2.5GbE† | [NASCompares](https://nascompares.com/news/synology-ds1525-nas-revealed/) |
| Synology DS1825+ (2025) | Ryzen V1500B | None | 8GB ECC / 32GB | PCIe Gen3 x8 (x4 link) for 10/25GbE | 2x 2.5GbE† | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026) |
| Synology DS224+ | Celeron J4125† | UHD 600† | 2GB / 6GB† | None† | 2x 1GbE† | † |
| Synology DS923+ | Ryzen R1600 2C/4T† | None† | 4GB ECC / 32GB† | Proprietary slot for E10G22-T1-Mini 10GbE† | 2x 1GbE† | † |
| Synology DS1522+ | Ryzen R1600† | None† | 8GB / 32GB† | 10GbE mini slot† | 4x 1GbE† | † |
| Synology DS1621+ / DS1821+ | Ryzen V1500B† | None† | 4GB/8GB / 32GB† | PCIe Gen3 x8 (x4)† | 4x 1GbE† | † |
| Synology DS223j / DS223 / DS423 / DS124 | Realtek RTD1619B 4C Cortex-A55 1.7GHz (**ARM64**) | No usable media engine for 3rd-party apps† | DS223j 1GB DDR4 | None | 1GbE† | [NASCompares DS223j](https://nascompares.com/news/the-synology-ds223j-a-new-budget-friendly-nas-solution-for-home-users/); [NASCompares DS423](https://nascompares.com/news/synology-ds423-released-4-bay-value-series-nas/); [blackvoid DS223](https://www.blackvoid.club/synology-ds223-overview/) |
| QNAP TS-464 | Celeron N5095 or N5105 4C/4T (sources conflict) | UHD (Jasper Lake) | 8GB / 16GB official | PCIe Gen3 x2 (5/10GbE or QM2) | 2x 2.5GbE; 2x M.2 Gen3 x1 | [esp32.co.uk](https://esp32.co.uk/?p=995157); [needtoknowit](https://needtoknowit.com.au/blog/ugreen-dxp4800-plus-vs-qnap-ts-464-australia/) |
| QNAP TVS-h474 | Pentium Gold G7400 2C/4T | UHD 710† | 8GB / 64GB | PCIe Gen4 | 2x 2.5GbE; QuTS hero ZFS | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026) |
| QNAP TS-h973AX | Ryzen V1500B† | None† | 8GB / 32GB† | None† | 1x 10GbE + 2x 2.5GbE† | † |
| QNAP TVS-h874 | Intel Core i5-12400 / i7-12700 / i9 variants† | UHD 730/770† | 16–32GB / 128GB† | 2x PCIe Gen4† | 2x 2.5GbE† | † |
| UGREEN DXP4800 Plus | Pentium Gold 8505 5C/6T | Intel UHD (Alder Lake) | 8GB DDR5 / 64GB | None; 2x M.2 + 128GB boot SSD | 1x 10GbE + 1x 2.5GbE | [esp32.co.uk](https://esp32.co.uk/?p=995157) |
| UGREEN DXP4800 Pro | Core i3-1315U 6C/8T | Intel iGPU | 8GB DDR5 / 96GB | 2x PCIe 4.0 NVMe | 10GbE + 2.5GbE | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026) |
| UGREEN DXP6800 Pro | Core i5-1235U† | Iris Xe† | 8GB / 64GB† | PCIe x4 slot† | 2x 10GbE† | † |
| TerraMaster F4-424 | Intel N95 | UHD (Alder Lake-N) | 8GB DDR5 / 32GB | 2x M.2 PCIe3 x1 | 2x 2.5GbE | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026) |
| TerraMaster F4-424 Pro | Core i3-N300 8C† | UHD† | 32GB DDR5† | 2x M.2† | 2x 2.5GbE† | † |
| TerraMaster F2-425 Plus | Intel N150 | UHD | 8GB DDR5 / 32GB | 3x M.2 | 2x 5GbE | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026) |
| Asustor AS6704T (Lockerstor 4 Gen2) | Celeron N5105† | UHD† | 4GB / 16GB† | None; 4x M.2† | 2x 2.5GbE† | † |
| Asustor FS6806X | Ryzen Embedded V3C14 | None (V3000 has no iGPU)† | 8GB DDR5 ECC / 64GB | 6x PCIe 4.0 NVMe | 1x 10GbE | [Fstoppers](https://fstoppers.com/best-nas-photographers-2026) |

- The DS925+ (Ryzen V1500B) has no graphics engine, so Plex/Jellyfin can't hardware-transcode. The J4125 is the only Synology desktop-range CPU with an iGPU **[EDITORIAL]**. — [NASCompares](https://nascompares.com/news/synology-ds925-nas-news/); [blackvoid DS425+](https://www.blackvoid.club/synology-ds425-overview/)
- Plex recommends Jasper Lake or newer for reliable HEVC-output transcoding, which leaves the J4125 marginal **[EDITORIAL]**. — [blackvoid DS425+](https://www.blackvoid.club/synology-ds425-overview/)
- Synology's hardware-acceleration APIs are reserved for its own apps, so GPU passthrough to containers is effectively unavailable on most Synology models **[EDITORIAL]**. — [hometechops](https://hometechops.com/nas/local-ai-on-nas-immich-frigate-ollama)

### Inferences
- The modal photographer Synology (DS923+/DS925+/DS1522+/DS1825+) has 4–8 Zen1 threads, 4–8GB default RAM and **no iGPU**. Any ML, RAW decode or HEIC/AVIF work runs on the CPU. Many owners never upgrade RAM, so the DAM's memory budget at defaults should be roughly ≤1–2GB.
- The J4125 Synologys have an iGPU but are hard-capped at 6GB RAM and four slow Goldmont Plus cores. They are the weakest x86 target that still matters.
- UGREEN, TerraMaster and QNAP's newer Intel models have Quick Sync and OpenVINO-capable iGPUs. On them, VA-API/QSV for video previews and OpenVINO for ML are realistic accelerations.
- The DS923+ and DS1621+ are 2022–2023 models but still widely installed. The 2025 refresh barely changed CPUs (V1500B dates from 2018 silicon).

### Gaps
- Cells marked † were not verified this session; they need checking against synology.com, qnap.com, ugreen.com, asustor.com and terra-master.com spec pages.
- I found no vendor-published sales mix by model, so the "top ~15 models" list is drawn from editorial recommendations, not sales data.

## Q6. ARM share of entry models and its implications

### Takeaway
Synology's entire non-Plus consumer line (j and Value: DS124, DS223j, DS223, DS423, plus older DS220j/DS420j) uses ARM SoCs, mainly the Realtek RTD1619B with 1–2GB RAM. Container Manager (Docker) is officially available on some ARMv8 Value/j models (DS223, DS124, DS220j, DS120j, DS420j) but not confirmed on all, and RAM is tiny. QNAP's entry TS-x33/TS-x16 lines are also ARM. Implication: a DAM should publish arm64 images, but expect only "storage + light indexing" on these boxes, with ML and RAW rendering offloaded elsewhere.

### Cited Findings
- DS223j: Realtek RTD1619B quad-core 64-bit 1.7GHz, 1GB DDR4 non-ECC **[EDITORIAL]**. — [NASCompares](https://nascompares.com/news/the-synology-ds223j-a-new-budget-friendly-nas-solution-for-home-users/)
- DS423 (4-bay Value) uses the Realtek RTD1619B 4-core 1.7GHz 64-bit. DS124 (1-bay) uses a 64-bit ARM Cortex-A55 (RTD1619B) **[EDITORIAL/RETAIL]**. — [NASCompares DS423](https://nascompares.com/news/synology-ds423-released-4-bay-value-series-nas/); [Galaxus DS124](https://www.galaxus.ch/en/s1/product/synology-diskstation-ds124-nasstorage-server-desktop-ethernet-lan-black-rtd1619b-nas-45078649)
- DS223: quad-core 1.7GHz ARMv8 Realtek RTD1619B **[EDITORIAL]**. — [blackvoid DS223](https://www.blackvoid.club/synology-ds223-overview/)
- Synology's Container Manager release notes list support for ARMv8 models DS420j and DS223, later adding DS220j and DS120j. The applied-models list includes DS124. Third-party guides claim DS223/DS223j aren't supported, which contradicts the vendor notes **[VENDOR vs EDITORIAL conflict]**. — [Synology Container Manager release notes](https://www.synology.com/en-uk/releaseNote/ContainerManager); [Synology Container Manager package page](https://www.synology.com/dsm/packages/ContainerManager); contradicted by [PCWorld DS223j review](https://www.pcworld.com/article/2110247/synology-diskstation-ds223j-review-new-nas-same-appealing-story.html), [storagediskprices](https://storagediskprices.com/synology-docker-guide/)
- Immich supports only amd64 and arm64 (no armv7). It needs a minimum 6GB RAM / 2 cores, recommended 8GB / 4 cores. With 4GB it runs only with ML disabled. On amd64 the ML container requires x86-64-v2 or higher. Thumbnails and transcodes add ~10–20% to library size, and Postgres should be on local SSD **[VENDOR docs]**. — [Immich requirements](https://docs.immich.app/install/requirements/)
- Immich FAQ: ML can be too heavy for a Raspberry Pi. Options are to host ML on a more powerful machine or disable it **[VENDOR docs, via search summary]**. — [Immich (via search)](https://mustafa.net/2026/10/10/immich-without-gpu-intel-nuc/)

### Inferences
- By Immich's own minimums, a 1–2GB RTD1619B Synology cannot run an Immich-class stack (Postgres + ML) at all. A DAM wanting to cover these boxes needs a **thin on-box agent**: file watcher, EXIF extraction, maybe embedded-JPEG extraction from RAW. Heavy work (libraw full decode, CLIP, faces) would run on a desktop, mini-PC or client.
- libraw-style full RAW demosaic of 24–60MP files on 4x Cortex-A55 at 1.7GHz will likely take seconds per image. Extracting the camera-embedded JPEG preview, as most RAW formats allow, is the realistic on-box path. This is an inference; I found no benchmark.
- The RTD1619B has a hardware video decoder, but it isn't exposed to third-party containers on DSM, so on-box video transcoding should be assumed unavailable.
- x86-64-v2 is satisfied by the J4125 (SSE4.2) and all Ryzen V/R-series; only very old Atom/Celeron NAS units would fail it.

### Gaps
- I found no quantified ARM share of Synology/QNAP unit sales. Model-count share is clear: all current j/Value Synology models are ARM. Unit share is unknown.
- QNAP ARM entry models (TS-133/233/433 on Cortex-A55; Annapurna Alpine in older TS-x31) were not verified this session **[UNVERIFIED-TK]**.
- Container Manager support for DS223j and DS423 is unconfirmed.

## Q7. Feasibility of thumbnails, RAW decode and face/CLIP ML on these CPUs (benchmarks)

### Takeaway
Hard benchmarks on NAS-class CPUs are scarce. The best measured CPU-only datapoint is a 2018 Core i7-8559U NUC (4C/8T, Immich 3.3.1, default models):
- CLIP ViT-B-32: 14.8 images/s, 51k images in about 58 minutes.
- buffalo_l face pipeline: 5.2 photos/s, about 2 hours for 40k photos.

J4125, R1600 and V1500B are slower, perhaps by roughly 2–4x (inference). That puts a 50k-image initial index at several hours to about a day, which matches anecdotal reports that first indexing "completes in a day". Thumbnail generation and video transcoding are reported to be heavier than ML but were not measured.

### Cited Findings
- **Intel Core i7-8559U NUC, 16GB, no GPU, Immich 3.3.1** **[ANECDOTE, but carefully measured]**:
  - CLIP (`ViT-B-32__openai`) over 51,126 previews: 57 min 39 s at 14.8 items/s; model call median 0.124 s.
  - Faces (`buffalo_l`): 3,000-photo sample in 9 min 33 s at 5.2 photos/s; median call 0.280 s, p95 0.817 s.
  - Extrapolated about 2 h 6 min for 39,546 photos.
  - Cold first call: ~11.7 s (search model), ~7.8 s (faces).
  - Library was on a Synology DS723+ over NFS with a 0.007 s median read.
  - The author says thumbnail generation "can easily take longer" than ML but gave no figures.
  - Source: [mustafa.net, Oct 10 2026](https://mustafa.net/2026/10/10/immich-without-gpu-intel-nuc/)
- Immich ML on a J4125 (DS423+): one user switched to the much larger SigLIP2 ViT-SO400M model and didn't mind the processing time, since they use it mainly for search **[ANECDOTE]**. — [Lemmy via forum.agnos.is](https://forum.agnos.is/post/https%3A%2F%2Flemmy.ca%2Fcomment%2F17650834)
- A guide claims initial indexing finishes in about a day for 5k–20k-photo family libraries on a QNAP TS-464 (N5105). It says a DS423+ (J4125) must go to 8GB RAM before running Immich ML, and performs similarly afterwards. That conflicts with the J4125's 6GB official ceiling, and no method is given **[EDITORIAL, low reliability]**. — [needtoknowit Immich AI guide](https://needtoknowit.com.au/blog/immich-ai-features-guide/)
- Immich says initial face-processing time "varies substantially" with model, concurrency, hardware acceleration, CPU and storage **[VENDOR docs, via search summary]**. — [needtoknowit Immich on NAS](https://needtoknowit.com.au/blog/immich-on-nas-setup-guide.md)
- GitHub discussion #7011: facial recognition (clustering) is much faster than face detection. GitHub issue #23131 describes a full re-run of detection being needed after external-library changes, which "took ages" on a large library **[ANECDOTE]**. — [Immich discussion #7011](https://github.com/immich-app/immich/discussions/7011); [Immich issue #23131](https://github.com/immich-app/immich/issues/23131)
- Synology's Plus models with Ryzen have no iGPU, and Synology reserves its acceleration APIs for first-party apps. Guides recommend a remote ML container on an N100 or Mac for acceleration **[EDITORIAL]**. — [hometechops](https://hometechops.com/nas/local-ai-on-nas-immich-frigate-ollama)

### Inferences
- Order-of-magnitude for a 50k-photo initial index, CPU-only:
  - **i7-8559U NUC:** ~1 h CLIP + ~2.5 h faces (measured, extrapolated).
  - **N100 / N150 / N5105:** maybe ~1.5–3x slower.
  - **J4125 / R1600:** maybe ~3–5x slower, i.e., roughly 4–15 hours.
  - **V1500B (4C/8T Zen1):** somewhere between.
  - **ARM RTD1619B:** impractical with 1–2GB RAM.
  - These multipliers are inferences from relative CPU class, not measurements. Incremental ingest (hundreds of images per shoot) is fine on all x86 boxes.
- Choose small models by default (MobileCLIP/ViT-B-32-class, SCRFD/buffalo_s for faces), make the job queue resumable and low-priority, and support remote workers. These are the main levers.
- RAW: generating previews from the embedded JPEG is cheap on any box. Full libraw decode at 45–61MP on a J4125 is likely multiple seconds per file plus ~1GB+ transient RAM per worker (inference), so concurrency must be capped on 4–6GB boxes.
- Intel-iGPU boxes (UGREEN, TerraMaster, QNAP Intel, J4125 Synology) could use OpenVINO for ML and VA-API for video. Ryzen-V Synologys cannot, which makes them the "pure CPU" worst case among popular x86 targets.

### Gaps
- I found no published Immich or PhotoPrism benchmarks specifically on J4125, N100, R1600 or V1500B. GitHub discussions with per-CPU numbers likely exist but were not located within the tool budget.
- No libraw/darktable-cli/RawTherapee RAW-decode timings on NAS CPUs were found.
- PhotoPrism-on-Synology performance data was not found this session.
