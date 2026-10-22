# cf-dam agent on a Mac or PC

The same agent as the NAS one, run on your own computer: for folders on its disks, on network shares
it mounts, and on **external drives that are only plugged in now and then**. A drive's photos stay in
cf-dam while it's unplugged (marked offline), and are picked up again when it comes back, under any
drive letter or mount point. Drives are known by their volume id, not their name or letter, so another
card also called EOS_DIGITAL, or another disk that gets E:, is never mistaken for it.

It only reads your photos. It never changes, moves or deletes them.

## You need

- **Node.js 24** from https://nodejs.org (the LTS installer).
- About 1 GB of free memory while it indexes.
- The address of your cf-dam, e.g. `https://dam.example.com`.
- For previews of iPhone and Samsung **HEIC** photos: nothing on a Mac (it uses macOS's own `sips`); on
  Windows or Linux, libheif's `heif-dec` or `heif-convert` on the PATH (Linux: the `libheif-examples`
  package). Without it, HEIC photos are listed as failed, and tried again once it's installed and the
  agent is updated.

cf-dam offers its folder picker the drives and shares this computer has mounted, and your Pictures
folder, and only lets people pick those or folders inside them. The system disk itself (Macintosh HD,
C:) isn't offered, so nobody managing agents in cf-dam can index everyone's files on it. For photos
elsewhere on it, list their folders in `AGENT_FOLDERS` (separated by `;` on Windows, `:` on a Mac), e.g.
`AGENT_FOLDERS="D:/Photos;C:/Archive"`, and they're offered too.

The status page answers on this computer only (http://localhost:8790). To see it from elsewhere on
your network, set `STATUS_HOST=0.0.0.0` (and `PORT` for another port).

## macOS

```sh
./install-macos.sh https://dam.example.com "Studio iMac"
```

This installs the agent in `~/Library/Application Support/cf-dam-agent/app` and starts it at login
(a LaunchAgent, `com.cf-dam.agent`). Its log is `~/Library/Logs/cf-dam-agent.log`; the first lines show
the pairing code to type into cf-dam → Computers and NAS. The status page is http://localhost:8790.

macOS asks before an app reads external drives, network volumes or your Pictures folder. Allow it, or
add `node` under System Settings → Privacy & Security → Files and Folders (or Full Disk Access).

To remove it, with its key, file list and log: `sh uninstall-macos.sh`. `sh uninstall-macos.sh --node`
also removes Node.js as nodejs.org's installer put it, for a Mac that had Node only for the agent.
Photos are never touched. Then disconnect the agent in cf-dam.

## Windows

In PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Url https://dam.example.com -Name "Studio PC"
```

This installs the agent in `%APPDATA%\cf-dam-agent\app` and runs it at sign-in as you (a scheduled task,
`cf-dam agent`), so it sees your mapped drives and network shares with your credentials. Folders on a
network share are best added by their `\\server\share` path, which works whatever drive letter is mapped.
The log is `%APPDATA%\cf-dam-agent\agent.log`; the status page is http://localhost:8790.

To remove it: `Unregister-ScheduledTask -TaskName "cf-dam agent"`, then delete the `cf-dam-agent` folder.

## Anywhere else (Linux, or running it by hand)

```sh
npm install --omit=dev
CF_DAM_URL=https://dam.example.com AGENT_NAME="My laptop" node agent.mjs
```
