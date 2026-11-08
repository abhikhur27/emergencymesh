# RescueMesh operating window

The requested window ends Monday November9,2026 at11PM Central: `2026-11-10T05:00:00Z`.

The physical ECSW receiver runs on ABHIKHUR because its USB radio is attached there. Keep that laptop plugged in, awake and connected to the radio. The bounded owner requests system wakefulness while running; it does not change global power or lid settings. Closing the laptop, losing power, unplugging the board or restarting Windows can interrupt intake. The desktop supervisor and its provider tasks run independently on ABHIONEMILLION.

## Laptop owner

`hub/scripts/run-hub-session.ps1` owns one local Ollama process if it had to start one, and one Node receiver controller. An exclusive file lock and occupied-port check prevent a duplicate owner. Private `session-wrapper.json`, `session-state.json` and `bridge-state.json` record current process identities, working directory, deadline and cleanup state. These files contain operational state and stay out of public exports.

The controller copies application source into a private immutable release, syntax-checks it and runs the hub tests before switching the receiver. Source must remain unchanged for30seconds before an update is considered. Saved incidents, region, enrolled keys and sessions stay in the original private data directory. Failed validation retains the running release; failed readiness returns to the last verified release. A disk-backed last-good pointer allows recovery after controller restart even while source edits are incomplete.

The controller verifies authenticated physical-radio readiness periodically and restarts after three consecutive failures. The serial adapter reopens on application restart, allowing an unplug/replug to recover when the same COM port returns. Startup probes reuse one temporary session. All probes revoke their sessions. An IPC shutdown and parent-disconnect handler release the receiver on controlled restart or owner loss. Child-process cleanup checks ownership and creation time before stopping anything.

Application updates are automatic within this window. **Dependencies are frozen**: do not run package installation against the shared live `hub/node_modules`. A dependency upgrade needs a separate validated dependency directory and controlled owner update. The current package lock pins the installed dependencies.

To request an immediate application restart, increment `revision` in private `hub/.emergency/session-config.json`. Set `paused:true` to release the serial port temporarily; set it back tofalse to resume. This process pause is separate from the dashboard's Pause automation control, which preserves radio intake. Creating `hub/.emergency/session.stop` ends this bounded session. These are local operator controls, not public endpoints.

The loopback SSH bridge forwards only Mongo27018 and supervisor4782 to the desktop. It owns its SSH child, reconnects after connection failure and stops at the same absolute deadline. MongoDB/network failure keeps local intake and the durable outbound queue available; supervisor delivery retries with the same case identity.

## Desktop owner

See [runtime setup](runtime-setup.md) for verified desktop task names, paths, authenticated services, model receipts and deployment command. Both desktop startup tasks are enabled and bounded to the same deadline. They preserve existing unrelated jobs and the existing Cloudflare8080 service. The isolated Quick Tunnel is authenticated and can change hostname if its connector restarts.

## Phone enrollment and hardware

New phone profiles receive independent random256-bit keys. Existing known legacy profiles remain accepted during the handoff so a working phone is not silently disconnected. Import a new private profile into each phone, confirm an authenticated receipt, then explicitly revoke its old identity. Keep profiles outside the source ZIP and public repository. SHA-256 fingerprints identify enrollments; they are not encryption keys or proof of board ownership.

The attached hub can be updated here. The companion must be attached over a data USB cable before its new OLED/BLE firmware can be flashed. A compiled companion image does not prove installation. Never infer phone receipt delivery or operator review from the OLED's radio activity.

Emergency-service dispatch remains simulated. Actual radio reception, local Nemotron execution, automatic regional coordination and simulated allocations each have separate evidence. Historical reports are reception evidence and are not silently re-dispatched on upgrade.
