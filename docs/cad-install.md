# CAD MCP installation receipt — November 7, 2026

Host: **ABHIKHUR**. This is an actual local installation, not a plugin suggestion.

- FreeCAD **1.1.4**, installed from `FreeCAD.FreeCAD` through Windows Package Manager. Winget verified the installer hash before installation.
- Application: `C:/Users/abhim/AppData/Local/Programs/FreeCAD 1.1/bin/FreeCAD.exe`.
- Upstream MCP: [neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp), pinned source commit `ec8abf21fb9e9ed4bbcbba497515e088423ad251`.
- Source checkout: `C:/Users/abhim/.codex/tools/freecad-mcp`.
- Isolated MCP environment: `C:/Users/abhim/.codex/tools/freecad-mcp-env`, package **freecad-mcp 0.1.30**.
- FreeCAD addon: `C:/Users/abhim/AppData/Roaming/FreeCAD/v1-1/Mod/FreeCADMCP`.
- Registered with `codex mcp add freecad -- C:/Users/abhim/.codex/tools/freecad-mcp-env/Scripts/freecad-mcp.exe --only-text-feedback`.
- `codex mcp get freecad` reports enabled stdio transport with that exact executable. Other MCP configurations and model/router settings were preserved.

A real MCP SDK client initialized the installed server over stdio and called `get_rpc_status` and `list_documents`. The addon reported `rpc_server: running`, healthy GUI dispatch, addon version 0.1.30 and `version_check: ok`; document enumeration succeeded. See `../hardware/mcp-smoke.json`. Native document creation and primitive modelling were then exercised through that same installed MCP server.

The addon listens only on **127.0.0.1:9875**. Remote access and automatic startup remain disabled. FreeCAD must be running with its RPC addon started when the MCP is used; installing the MCP does not create a permanent scheduled service. A new Codex session may be needed for the registered server to appear in its tool inventory. This session used a real SDK client to exercise it immediately.

## Start it again

Open FreeCAD, choose the **MCP Addon** workbench, then **Start RPC Server**. The manual startup macro used for the bounded modelling session is `C:/Users/abhim/.codex/tools/start-freecad-mcp.FCMacro`; it starts the addon and contains no enclosure geometry. No recurring job or auto-start setting was created.

Follow [upstream installation instructions](https://github.com/neka-nat/freecad-mcp/blob/main/docs/installation.md) on another machine. The local FreeCAD application/MCP were installed on ABHIKHUR; an ABHIONEMILLION installation is not claimed. Enclosure files can be opened in FreeCAD on either Windows or macOS without the MCP.

## Model verification

The completed modelling receipt contains **109 successful MCP calls**, including **105 native object operations**, with zero reported tool errors. Native FreeCAD geometry inspection reports one valid solid for each final part:

| Part | Bounds, mm | Solid volume, mm³ |
| --- | --- | --- |
| BasePrint | 88 × 54 × 24 | 27516.47 |
| LidPrint | 88 × 54 × 3.6 | 12399.23 |
| AdapterPrint | 40 × 28 × 14 | 4924.18 |

The FCStd, STEP and all three STL exports exist and are non-empty. The actual viewport capture was opened and visually inspected. This verifies CAD creation/export, not physical fit or print success. The native FCStd SHA-256 is `cabf554e430f8918164cec6b938bdba18ac6829d563bb5541969a44f5db3522d`.

The owned hidden FreeCAD process was stopped after saving/exporting. A final listener check found zero listening endpoints on port 9875. Installation and the enabled Codex MCP configuration persist; no CAD process or scheduled background worker was left running. Start FreeCAD and the addon manually before the next CAD session.
