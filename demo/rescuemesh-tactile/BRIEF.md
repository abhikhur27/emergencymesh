# RescueMesh tactile product demo

12 seconds, 30 fps, 1920×1080. The four requested digital scenes occupy frames 0–239; the native Blender product turntable occupies frames 240–359.

| Frames | Scene | Main idea |
|---|---|---|
| 0–49 | Offline phone | Cellular and Wi-Fi off; BLE companion connected |
| 50–99 | Tactile send | Press at 55, release at 63; encrypted packet |
| 100–175 | Mesh relay | Companion → relay A → relay B → ECSW, an illustrated three-link route |
| 176–239 | Hub receipt | Authenticated receipt after durable hub intake |
| 240–359 | Product | Actual CAD-based Blender turntable on white, logo/name at right |

Brand and form fields come from the RescueMesh app. This is an illustrative product journey, not a measured RF trace: there is no invented latency, agency integration, infrastructure-free claim or guarantee of delivery. Receipt means saved at the hub, not responders dispatched. The phone can be offline; cloud regional inference still needs an upstream connection.

The two spring constants preserve the supplied damping, mass and stiffness. Every animated element uses Remotion frame math, not CSS keyframes. Scenes are modular components and individually registered compositions.

`scripts/generate-audio.mjs` writes original stereo PCM tones: E6 discovery; 80 Hz plus 3.2 kHz tap; 55 Hz release; pitch-stepped 4 kHz hops; C5/G5 receipt and a short low decay. Timing and peak/RMS provenance are recorded in `public/audio/synthesis.json`. No third-party sound assets or paid generators are used.

The product clip is owned by the Blender MCP rendering task at `public/product/turntable.mp4`. It must be present before a final render. Until then the Studio end card says “Product render in progress,” rather than pretending a generic substitute is the CAD model.

The November 8 visual revision removes gray footer copy, gives the phone a clear gap below the brand and corrects the radio SVG's clipped outer arcs. The updated native product clip includes the short black whip antenna and gold connector confirmed by the owner. Diagram timing remains illustrative; no on-screen latency or responder-dispatch claim is introduced.
