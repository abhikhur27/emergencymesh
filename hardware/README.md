# RescueMesh enclosure

Editable FreeCAD design and separate printable parts for a T3 LoRa32 V1.6.1 radio and a universal USB adapter cradle. **Prototype fit only: measure your physical board, connector, antenna and adapter before a full print.** No physical fit, drop, thermal, RF or water-resistance test has been performed.

The design was built in the installed FreeCAD application through the installed FreeCAD MCP server's native `create_object` and boolean feature tools. `cad-recipe.json` records those operations. Python was used inside the MCP only for saving/exporting the native document, presentation and validity queries; no standalone Python geometry generator was used.

## Files

- `RescueMesh-enclosure.FCStd`: editable native feature tree, including the construction primitives and boolean history.
- `RescueMesh-enclosure.step`: neutral solid CAD assembly.
- `BasePrint.stl`, `LidPrint.stl`, `AdapterPrint.stl`: separate print parts, millimetres. Parts retain their layout coordinates; use the slicer's centre/arrange action.
- `enclosure-preview.png`: actual CAD viewport capture.
- `mcp-smoke.json`, `cad-receipt.json`: tool and validity evidence.
- `cad-recipe.json`: explicit MCP modelling calls, with host-specific save locations. Adapt paths and use a new document name before replaying.

## Construction

The charcoal base has an 88 × 54 × 24 mm rounded outer body, 2.4 mm floor/walls, a large cable opening at one short end and open-top antenna clearance at the other. Two inner rails accept removable insulating foam under the PCB. Four corner bosses use 2.1 mm pilot holes; the lid uses 2.9 mm clearance holes. Use four M2.5 × 8–10 mm screws and check their actual engagement before tightening. Avoid conductive foam or hardware touching the PCB.

The 3 mm orange lid has a 32 × 18 mm display window and raised signal bars. The display window position, USB opening and antenna opening are initial allowances, not measured connector coordinates. The PCB must be supported and restrained with the supplied foam/strap; this design deliberately does not invent a board mounting-hole pattern.

The separate 40 × 28 × 14 mm adapter cradle has a 35.2 × 23.2 mm open pocket, open end access and two cable-tie tunnels. The adapter in the photograph was not measured. Resize the pocket before printing if the dongle is larger. A loose service loop and a tie around the cable jacket should carry cable loads; do not put bending loads on the phone's USB-C socket or the board's micro-USB socket. The case does not turn the assembly into a rigid phone-mounted plug.

## Print and fit check

1. First print only the first 5 mm of the base and a thin lid outline; compare against the real board/ports. Check that the antenna feed and every component clear the case and metal screws.
2. Adjust construction primitive dimensions in FreeCAD, recompute, then export the three final `*Print` objects. Change dependent opening/rail coordinates together. The feature tree is editable; it is not a fully constrained spreadsheet-driven design.
3. Start with PETG, 0.2 mm layers, three walls, four top/bottom layers and about 20% infill. Print all parts flat on their broad bottom faces. Enable supports or verify bridging for the USB opening and adapter tie tunnels in your slicer. These are proposed settings, not a validated print profile.
4. Insulate the board, leave the external antenna unobstructed, connect the correct antenna before any transmission, and check cable strain relief and heat during a supervised bench test.

No gasket or sealing feature is included. Do not call the case weatherproof, rugged or RF validated.

## Dimensional source

The manufacturer currently lists T3 V1.6.1 overall dimensions as 66 × 36 × 15 mm: [LILYGO LoRa32 documentation](https://wiki.lilygo.cc/products/t3-series/t3-lora32/). Different published PCB-only dimensions exist; this design uses a generous allowance instead of treating a retail photograph as a dimensioned drawing. Hardware identity should also be checked against [LILYGO's V1.6.1 source](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t3_v161_sx1276/t3_v161_sx1276_hw.md).
