# Hiking and cycling trails

The optional trail overlay is a browser-direct display dependency backed by
Maptoolkit. The vector source is TRAIL_TILEJSON_URL
(https://tiles.maptoolkit.org/mtk.json), and the hosted road source layer is
filtered locally into walking and cycling networks:

- hiking uses walking_network values iwn, nwn, rwn, and lwn;
- cycling uses cycling_network values icn, ncn, rcn, and lcn.

The session-only Show trails switch creates or removes the source, its three
line layers, and one Maptoolkit logo control. The overlay begins at zoom 7,
uses the TileJSON attribution in MapLibre's always-expanded attribution
control, and is inserted below fog and imported activity layers. Maptoolkit
TileJSON and visible vector tiles are requested directly by the browser; the
optional sync server has no trail role, and Maptoolkit responses are excluded
from application-managed service-worker caches.

Hiking foreground lines are blue (#3b82f6) with dash array [3, 2] and keep
their solid light casing. Cycling lines are light green (#4cb056) with dash
array [2, 2] and no casing. Provider, network, HTTP, CORS, decode, and
unknown map failures are isolated to this optional overlay, so local data,
fog, basemaps, and sync remain usable.

See the [trail overlay data flow](fog-and-data.md#trail-overlay-data-flow),
the [map-layer tests](../app/lib/map/layers.test.ts), the
[service-worker routing tests](../app/lib/map/swRouting.test.ts), and the
[Maptoolkit trail E2E tests](../e2e/specs/trails.spec.ts) for the executable
contract.
