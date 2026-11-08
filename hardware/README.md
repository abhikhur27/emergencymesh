# EmergencyMesh enclosure

Editable FreeCAD design and separate printable parts for a standard T3 LoRa32 V1.6.1 radio and a USB adapter cradle. **Prototype fit only:** measure the actual board, connectors, antenna and adapter before relying on the enclosure. No physical fit, drop, thermal, RF or water-resistance test is claimed.

The model was created in FreeCAD through FreeCAD MCP native primitives and boolean feature operations. It includes an editable construction history. Exports retain their layout coordinates; use the slicer's centre/arrange command.

## Files

- `RescueMesh-enclosure.FCStd`: native editable FreeCAD feature tree.
- `RescueMesh-enclosure.step`: neutral solid assembly.
- `BasePrint.stl`, `LidPrint.stl`, `AdapterPrint.stl`: separate millimetre print parts.
- `enclosure-preview.png`: actual CAD viewport capture.

The historical `RescueMesh` CAD filename is retained to preserve links in the native document.

## Construction

The rounded base is 88 × 54 × 24 mm with 2.4 mm floor/walls, a cable opening at one short end and open-top antenna clearance at the other. Inner rails accept removable insulating foam under the PCB. Corner bosses have 2.1 mm pilot holes; the lid has 2.9 mm clearance holes. Four M2.5 × 8–10 mm screws are a starting proposal; check actual engagement before tightening. Avoid conductive foam or hardware touching the PCB.

The lid has a 32 × 18 mm display window and raised signal bars. Display, USB and antenna opening positions are initial allowances, not measured coordinates. Restrain and insulate the PCB with suitable foam or a strap; this model does not assume a mounting-hole pattern.

The separate 40 × 28 × 14 mm adapter cradle has a 35.2 × 23.2 mm pocket, open end access and two cable-tie tunnels. Measure the adapter and resize before printing if needed. A flexible service loop and strain relief should carry cable loads rather than the phone's USB-C or board's microUSB socket.

## Print and fit

1. Start with a short base section and thin lid outline as a fit check against the real board and ports.
2. Adjust the native FreeCAD construction dimensions and dependent openings together, recompute and export the three final print objects.
3. Proposed starting settings: PETG, 0.2 mm layers, three walls, four top/bottom layers and about 20% infill. Print broad bottom faces flat. Verify bridging/support for the USB opening and tie tunnels in the slicer. These are unvalidated suggestions.
4. Keep the antenna unobstructed, attach it before transmission, and check strain relief and temperature during a supervised bench test.

No gasket or sealing feature is included. Manufacturer reference: [LILYGO LoRa32 hardware](https://wiki.lilygo.cc/products/t3-series/t3-lora32/). Different board revisions need direct measurement.
