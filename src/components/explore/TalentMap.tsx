"use client";

import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef } from "react";

export type MapPin = { id: string; lat: number; lng: number; city: string; online: boolean; label: string; role: "developer" | "designer" | "marketer" };

// Default: Esri "World Hillshade" = shaded terrain only: no labels and no borders drawn (the Light Gray Base prints "Bhutan / India"
// style region names, which we don't want). Keyless, DEVELOPMENT ONLY: for production use a licensed
// provider and set NEXT_PUBLIC_MAP_TILE_URL (CARTO's free tiles now require an API key; see README "Map & India's borders").
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "Tiles © Esri";
const BOUNDARY_URL = process.env.NEXT_PUBLIC_INDIA_BOUNDARY_GEOJSON ?? "/geo/india-official-boundary.geojson";

/** The map never pans away from India, and opens on the whole country until results tell it where to look. */
const INDIA_BOUNDS: [[number, number], [number, number]] = [[5.5, 67.0], [37.5, 98.5]];
const INDIA_CENTRE: [number, number] = [22.6, 80.8];
/** City names appear once you are zoomed in enough for them not to collide. */
const LABEL_MIN_ZOOM = 6;

/**
 * Leaflet map with clustered pins.
 *  - Pins are CITY CENTROIDS (talent never gives a street address), so many people share one point; the
 *    cluster layer groups them and "spiderfies" them apart when you zoom in all the way.
 *  - A cluster glows green when at least one person inside is Online (PRD §1 "availability radar").
 *  - Base map labels are off on purpose: we label only cities that have people in the current results, and never draw place names or borders
 *    ourselves. See README "Map & India's borders" before launch.
 */
export default function TalentMap({
  pins,
  selectedId,
  onSelect,
}: {
  pins: MapPin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{
    L: typeof Leaflet;
    map: Leaflet.Map;
    cluster: Leaflet.MarkerClusterGroup;
    labels: Leaflet.LayerGroup;
    markers: Map<string, Leaflet.Marker>;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // 1. Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      // leaflet.markercluster is an old-style plugin that looks for a GLOBAL `L`, so set it before loading.
      (window as unknown as { L: typeof Leaflet }).L = L;
      await import("leaflet.markercluster");
      if (cancelled || !el.current || state.current) return;

      const map = L.map(el.current, {
        center: INDIA_CENTRE,
        zoom: 5,
        minZoom: 4,
        maxBounds: INDIA_BOUNDS,
        maxBoundsViscosity: 0.9,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18, maxNativeZoom: 15, subdomains: "abcd", className: "dm-basemap" }).addTo(map);

      // A colour wash between the terrain tiles (z 200) and the pins (z 600): multiplied onto the grey relief, so the whole map is tinted.
      const tint = map.createPane("tint");
      tint.style.zIndex = "250";
      tint.style.pointerEvents = "none";
      tint.classList.add("dm-tint");

      // Our own city labels (the base map has none). Rebuilt from the results; shown only when zoomed in.
      const labels = L.layerGroup();
      const syncLabels = () => {
        if (map.getZoom() >= LABEL_MIN_ZOOM) labels.addTo(map);
        else labels.remove();
      };
      map.on("zoomend", syncLabels);

      const cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 50,
        iconCreateFunction: (c) => {
          const kids = c.getAllChildMarkers() as (Leaflet.Marker & { options: { online?: boolean } })[];
          const online = kids.some((k) => k.options.online);
          return L.divIcon({
            className: "dm-cluster-wrap",
            html: `<div class="dm-cluster ${online ? "dm-cluster--online" : ""}">${kids.length}</div>`,
            iconSize: [40, 40],
          });
        },
      });
      map.addLayer(cluster);
      state.current = { L, map, cluster, labels, markers: new Map() };
      syncLabels();

      // Optional: the official boundary overlay, if the file has been provided (see public/geo/README.txt).
      fetch(BOUNDARY_URL)
        .then((r) => (r.ok ? r.json() : null))
        .then((geo) => {
          if (geo && !cancelled) L.geoJSON(geo, { interactive: false, style: { color: "#0f172a", weight: 1.2, fill: false } }).addTo(map);
        })
        .catch(() => undefined);

      // Trigger the pins effect now that the map exists.
      map.fire("dm:ready");
    })();
    return () => {
      cancelled = true;
      state.current?.map.remove();
      state.current = null;
    };
  }, []);

  // 2. Sync pins whenever the result set changes.
  useEffect(() => {
    let off: (() => void) | undefined;
    const apply = () => {
      const s = state.current;
      if (!s) return;
      const { L, map, cluster, labels, markers } = s;
      cluster.clearLayers();
      labels.clearLayers();
      markers.clear();
      const seenCities = new Set<string>();
      for (const p of pins) {
        const m = L.marker([p.lat, p.lng], {
          title: p.label,
          online: p.online,
          icon: L.divIcon({
            className: "dm-pin-wrap",
            html: `<div class="dm-pin dm-pin--${p.role} ${p.online ? "dm-pin--online" : ""}" data-id="${p.id}"></div>`,
            iconSize: [26, 26],
          }),
        } as Leaflet.MarkerOptions);
        m.on("click", () => onSelectRef.current(p.id));
        markers.set(p.id, m);
        cluster.addLayer(m);
        if (!seenCities.has(p.city)) {
          seenCities.add(p.city);
          L.marker([p.lat, p.lng], { interactive: false, icon: L.divIcon({ className: "dm-city-anchor", html: "" }) })
            .bindTooltip(p.city, { permanent: true, direction: "bottom", className: "dm-city-label", offset: [0, 10] })
            .addTo(labels);
        }
      }
      if (pins.length > 0) map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 9 });
      else map.setView(INDIA_CENTRE, 5);
    };
    if (state.current) apply();
    else {
      // map still loading: wait for it
      const t = setInterval(() => {
        if (state.current) {
          clearInterval(t);
          apply();
        }
      }, 80);
      off = () => clearInterval(t);
    }
    return off;
  }, [pins]);

  // 3. Selecting a card highlights its pin and brings it into view.
  useEffect(() => {
    const s = state.current;
    document.querySelectorAll(".dm-pin--selected").forEach((n) => n.classList.remove("dm-pin--selected"));
    if (!s || !selectedId) return;
    const m = s.markers.get(selectedId);
    if (!m) return;
    s.cluster.zoomToShowLayer(m, () => {
      document.querySelector(`.dm-pin[data-id="${selectedId}"]`)?.classList.add("dm-pin--selected");
    });
  }, [selectedId, pins]);

  return <div ref={el} className="h-full min-h-[22rem] w-full" role="application" aria-label="Map of available talent" />;
}
