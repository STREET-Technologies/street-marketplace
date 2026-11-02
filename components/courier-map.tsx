"use client";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { movementMetres, type Coordinates } from "../lib/tracking";
const lngLat = (point: Coordinates): [number, number] => [
  point.longitude,
  point.latitude,
];
export default function CourierMap({
  destination,
  courier,
  token,
}: {
  destination: Coordinates;
  courier: Coordinates;
  token: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<mapboxgl.Map | null>(null),
    rider = useRef<mapboxgl.Marker | null>(null);
  const latest = useRef(courier);
  latest.current = courier;
  const lastRoute = useRef<Coordinates | null>(null),
    lastRouteAt = useRef(0);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    setReady(false);
    setError(false);
    lastRoute.current = null;
    lastRouteAt.current = 0;
    let instance: mapboxgl.Map;
    try {
      instance = new mapboxgl.Map({
        container: container.current,
        accessToken: token,
        style: "mapbox://styles/mapbox/streets-v12",
        bounds: new mapboxgl.LngLatBounds(
          lngLat(destination),
          lngLat(latest.current),
        ),
        fitBoundsOptions: { padding: 60, maxZoom: 16 },
        scrollZoom: false,
      });
    } catch {
      setError(true);
      return;
    }
    map.current = instance;
    const marker = (label: string, kind: string) => {
      const element = document.createElement("span");
      element.className = `tracking-map-marker ${kind}`;
      element.textContent = label;
      element.setAttribute(
        "aria-label",
        kind === "rider" ? "Rider" : "Delivery address",
      );
      return element;
    };
    const customer = new mapboxgl.Marker({
      element: marker("Home", "destination"),
    })
      .setLngLat(lngLat(destination))
      .addTo(instance);
    rider.current = new mapboxgl.Marker({ element: marker("Rider", "rider") })
      .setLngLat(lngLat(latest.current))
      .addTo(instance);
    instance.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    const timeout = setTimeout(() => {
      if (!instance.loaded()) setError(true);
    }, 15000);
    instance.on("load", () => {
      clearTimeout(timeout);
      setReady(true);
      setError(false);
    });
    instance.on("error", () => setError(true));
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);
    return () => {
      clearTimeout(timeout);
      resize.disconnect();
      customer.remove();
      rider.current?.remove();
      rider.current = null;
      instance.remove();
      map.current = null;
    };
  }, [destination.latitude, destination.longitude, token, retry]);
  useEffect(() => {
    rider.current?.setLngLat(lngLat(courier));
  }, [courier.latitude, courier.longitude]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (lastRoute.current && movementMetres(lastRoute.current, courier) < 50)
      return;
    const controller = new AbortController();
    const delay = Math.max(0, 5000 - (Date.now() - lastRouteAt.current));
    const timer = setTimeout(async () => {
      lastRoute.current = courier;
      lastRouteAt.current = Date.now();
      try {
        const url = new URL(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${courier.longitude},${courier.latitude};${destination.longitude},${destination.latitude}`,
        );
        url.search = new URLSearchParams({
          access_token: token,
          geometries: "geojson",
          overview: "simplified",
        }).toString();
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Route unavailable");
        const body = await response.json(),
          geometry = body.routes?.[0]?.geometry;
        if (!geometry || controller.signal.aborted || !map.current) return;
        const data = { type: "Feature" as const, properties: {}, geometry };
        const existing = map.current.getSource("courier-route") as
          mapboxgl.GeoJSONSource | undefined;
        if (existing) existing.setData(data);
        else {
          map.current.addSource("courier-route", { type: "geojson", data });
          map.current.addLayer({
            id: "courier-route",
            type: "line",
            source: "courier-route",
            paint: { "line-color": "#222222", "line-width": 4 },
          });
        }
      } catch {
        if (
          !controller.signal.aborted &&
          map.current?.getLayer("courier-route")
        ) {
          map.current.removeLayer("courier-route");
          map.current.removeSource("courier-route");
        }
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    courier.latitude,
    courier.longitude,
    destination.latitude,
    destination.longitude,
    token,
    ready,
  ]);
  return (
    <div className="tracking-map">
      <div
        ref={container}
        className="tracking-map-canvas"
        aria-label="Courier and delivery address map"
      />
      {error && (
        <div className="tracking-map-error">
          <p>
            The map could not be updated. Your order status is still available.
          </p>
          <button
            className="text-link"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry map
          </button>
        </div>
      )}
    </div>
  );
}
