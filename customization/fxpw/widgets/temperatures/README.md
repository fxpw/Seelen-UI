# CPU / GPU temperatures

`bridge.mjs` publishes actual readings to the existing Seelen temperature plugin. It listens on loopback with a random
bearer token stored only in `%LOCALAPPDATA%\fxpw-seelen\sensors\bridge.json`. Do not commit that file or generated
plugin manifests.

CPU readings come from a small CPU-only helper built against
[LibreHardwareMonitor 0.9.6](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.6). It uses
the signed [PawnIO 2.2.0 driver](https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0). Both downloads are pinned
by SHA-256 in `setup-cpu.ps1`; the PawnIO installer publisher signature is checked too. The .NET Framework compiler
included with Windows builds `CpuCollector.cs`; no separate .NET SDK is needed.

Run once from the fork:

```powershell
.\customization\fxpw\widgets\temperatures\setup-cpu.ps1
```

Setup requests Windows elevation, installs PawnIO if missing, and registers the hidden `fxpw-SeelenCpuSensors` task for
the current user's logon. The helper alone runs elevated; Seelen and the Node bridge remain normal user processes. The
helper only reads CPU sensors; it does not enable GPU/motherboard scanning, fan controls or stress tests.

The collector writes `cpu.json` atomically every two seconds. The bridge reads it every five seconds, preferring package
/ Tctl/Tdie temperature. Missing drivers, initialization zeros, corrupt data, future timestamps and stale snapshots
produce a dash, not a guessed temperature. The original optional WMI providers remain a fallback. NVIDIA readings use
`nvidia-smi` as before.

Update a running bridge without changing any panel layouts or reloading Seelen:

```powershell
.\customization\fxpw\widgets\temperatures\restart-bridge.ps1
```

This preserves the existing loopback port and bearer token, so already loaded widgets reconnect. For a new Seelen
session, the fork's existing `scripts/fxpw/start.ps1 -Sensors` loads the temperature plugin. The CPU task starts
automatically at logon; it does not start Seelen or the Node bridge itself.

Checks:

```powershell
node --test customization/fxpw/widgets/temperatures/*.test.mjs
```

Live verification on 2026-11-03: Ryzen 9 5950X exposed `Core (Tctl/Tdie)` and both CCD sensors. The selected package
reading was 59–71 C during setup; NVIDIA RTX 5060 Ti returned 39–49 C. The pre-install probe returned no CPU reading,
and the post-install probe returned actual sensors. No Windows restart or Seelen restart was needed. Readings depend on
the current workload.

To stop / remove only the CPU collector, run in an elevated PowerShell:

```powershell
Stop-ScheduledTask -TaskName fxpw-SeelenCpuSensors
Unregister-ScheduledTask -TaskName fxpw-SeelenCpuSensors -Confirm:$false
```

This leaves PawnIO installed for other monitoring applications. Removing the shared driver is a separate action.
