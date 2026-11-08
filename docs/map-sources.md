# UT Dallas map sources

The offline campus asset uses the current official [UT Dallas Parking & Transportation main campus map](https://services.utdallas.edu/download/Parking_Map.pdf), effective **July 30, 2026**, retrieved November 8, 2026. Page 1 contains the campus drawing; page 2 gives building codes and names.

The source is a six-page, 357,364-byte PDF. Its SHA-256 is recorded in the JSON asset. PyMuPDF extracted the original filled path operators rather than drawing replacement building rectangles. Original parking colors, logos, legend, and building-code artwork were omitted. The application supplies its own neutral styling and readable interactive labels. Attribution remains in the asset.

## Offline contract

- `hub/public/assets/campus-map.json`: 24 named building footprints, 160 background context paths, source metadata, and camera bounds.
- `hub/public/assets/campus-map.svg`: neutral offline vector background, no scripts, external images, external fonts, or remote requests.
- `regions/utd-campus-map.json`: byte-identical source data for region tooling.
- Coordinates use PDF points on a 612 by 792 page. X increases right/east; Y increases down/south. Full map bounds are `[35.69, 90.02, 540.21, 666.29]`; the suggested initial camera is `[175, 350, 240, 210]`.

Each named feature has a lowercase stable `id`, full `name`, `shortName`, `aliases`, `anchor`, original SVG `path`, `bounds`, and `sourceDrawingIds`. Each background path has a `kind`, `path`, `sourceDrawingId`, and `fillRule`. UI markers and labels must use these feature anchors, never the old schematic region percentages.

**ECSW is the western C-shaped building, drawing 1166, with anchor `[237, 482]` on its solid lower wing. ECSS is the separate building east of it, drawing 1159, with anchor `[274, 471]`.** Hoblitzelle is north of ECSW and ECSN is northeast. These distinctions were visually checked against the enlarged official drawing.

## Building coordinate metadata

The official [UT Dallas interactive map](https://map.utdallas.edu/index.html) embeds [Concept3D map 1772](https://map.concept3d.com/?id=1772). Its public academic-building location data supplies independent WGS84 building points for 20 matched features. The JSON retains those points, source location IDs, and direct public map links in `feature.geo`. For example, ECSW is location 435231 at latitude 32.98632, longitude -96.751701; ECSS is location 435127 at latitude 32.986374, longitude -96.750458. These are building-location points, not a surveyed receiver/phone position.

The PDF itself declares no geographic reference system. A provisional 20-point affine comparison had a leave-one-out median discrepancy near 11 meters and a worst discrepancy near 50.2 meters. That is insufficient to independently establish a phone GPS transform, so **no transform is shipped and `georeference.available` remains false**. A phone's actual GPS and recorded accuracy can still be displayed as source evidence, but must not be plotted into this PDF coordinate system as if it were exact. Named landmarks may be selected and filtered using the sourced footprints.

## Verification

The JSON copies are byte-identical; all 24 feature IDs are unique; all anchors lie inside both their bounds and rendered source footprints. ECSW and ECSS use distinct original paths. The neutral map was rendered and visually checked at enlarged campus scale. A 2017 ArcGIS point dataset was inspected but rejected as the source of current campus geometry because it predates newer buildings.

No explicit open-data license is stated in the source map metadata. Retain source attribution. The asset contains no private reports, user GPS samples, credentials, or live radio coverage claims.

## Regional street map — November8 update

The regional desk uses Leaflet1.9.4 (BSD-2-Clause, vendored reviewed assets) with the standard OpenStreetMap raster service at https://tile.openstreetmap.org/{z}/{x}/{y}. Public approximate ECSW, Plano, Garland and Addison hub landmarks anchor the view. The selected saved allocation supplies each handoff line; unallocated needs draw no handoff. These connections are resource exchanges, not driving routes or measured radio coverage.

Map controls support pan, zoom, keyboard interaction and hub selection. Visible Leaflet/OpenStreetMap attribution is retained. The browser sends its public origin as Referer, caches ordinary viewed tiles, and performs no tile prefetch or offline downloads. Tile access needs Internet; the offline campus vector remains independent. Sources: https://leafletjs.com/examples/quick-start/ and https://operations.osmfoundation.org/policies/tiles/ .

## Local request GPS map — November8 correction

The local request Location panel now uses Leaflet1.9.4 and the same attributed OpenStreetMap street service as the regional map. Original phone WGS84 latitude/longitude place the magenta point directly; a meter-based circle reflects its reported accuracy. A recognized building is not required, and the map can pan/zoom outside UT Dallas. ECSW is a distinct gray receiving-hub reference, never a substitute report location.

Without GPS, a recognized campus landmark may use its official WGS84 point with an approximate-landmark label. With neither GPS nor a known landmark, no report point is drawn. An operator-corrected landmark remains separate from original phone GPS. The Network view retains the offline campus PDF geometry; no GPS-to-PDF transform has been invented. Ordinary viewed street tiles require Internet and retain visible OpenStreetMap/Leaflet attribution, browser caching and origin Referer behavior.
