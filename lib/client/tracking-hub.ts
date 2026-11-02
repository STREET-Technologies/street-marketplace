import {
  trackingBlob,
  type TrackingBlob,
  type TrackingConnection,
} from "../tracking.ts";
export type TrackingUpdate = {
  connection: TrackingConnection;
  blob: TrackingBlob | null;
  mapboxToken: string | null;
};
type Listener = (update: TrackingUpdate) => void;
export type TrackingTransport = {
  mapboxToken: string | null;
  listen: (
    id: string,
    value: (value: unknown) => void,
    error: () => void,
  ) => () => void;
  dispose: () => Promise<void>;
};
export function createTrackingHub(
  connect: (
    userId: string,
    state: (state: TrackingConnection) => void,
  ) => Promise<TrackingTransport>,
) {
  let owner: string | null = null,
    generation = 0,
    transport: TrackingTransport | null = null;
  let connection: TrackingConnection = "connecting",
    retried = false;
  const entries = new Map<
    string,
    { listeners: Set<Listener>; blob: TrackingBlob | null; stop?: () => void }
  >();
  const notify = () => {
    for (const entry of entries.values())
      for (const listener of entry.listeners)
        listener({
          connection,
          blob: entry.blob,
          mapboxToken: transport?.mapboxToken ?? null,
        });
  };
  function stopTransport() {
    generation++;
    for (const entry of entries.values()) {
      entry.stop?.();
      entry.stop = undefined;
      entry.blob = null;
    }
    const old = transport;
    transport = null;
    if (old) void old.dispose().catch(() => {});
  }
  function reset() {
    stopTransport();
    connection = "signed-out";
    notify();
    entries.clear();
    owner = null;
    retried = false;
  }
  function attach(
    id: string,
    entry: NonNullable<ReturnType<typeof entries.get>>,
  ) {
    const epoch = generation;
    entry.stop = transport!.listen(
      id,
      (value) => {
        if (epoch !== generation || entries.get(id) !== entry) return;
        const blob = trackingBlob(value);
        // Ignore an older delivery projection; status hints still get verified by REST.
        if (
          blob?.updatedAt &&
          entry.blob?.updatedAt &&
          blob.updatedAt < entry.blob.updatedAt
        )
          return;
        entry.blob = blob;
        for (const listener of entry.listeners)
          listener({
            connection,
            blob,
            mapboxToken: transport?.mapboxToken ?? null,
          });
      },
      () => {
        if (epoch !== generation) return;
        if (!retried) {
          retried = true;
          stopTransport();
          void start();
        } else {
          connection = "unavailable";
          notify();
        }
      },
    );
  }
  async function start() {
    const epoch = ++generation,
      user = owner!;
    connection = "connecting";
    notify();
    try {
      const result = await connect(user, (state) => {
        if (epoch === generation) {
          connection = state;
          notify();
        }
      });
      if (epoch !== generation || owner !== user || !entries.size) {
        await result.dispose();
        return;
      }
      transport = result;
      for (const [id, entry] of entries) attach(id, entry);
      notify();
    } catch {
      if (epoch === generation) {
        connection = "unavailable";
        notify();
      }
    }
  }
  return {
    reset,
    subscribe(userId: string, id: string, listener: Listener) {
      if (owner && owner !== userId) reset();
      const first = !owner;
      if (first) connection = "connecting";
      owner = userId;
      let entry = entries.get(id);
      if (!entry) {
        entry = { listeners: new Set(), blob: null };
        entries.set(id, entry);
        if (transport) attach(id, entry);
      }
      entry.listeners.add(listener);
      listener({
        connection,
        blob: entry.blob,
        mapboxToken: transport?.mapboxToken ?? null,
      });
      if (first) void start();
      const held = entry;
      return () => {
        held.listeners.delete(listener);
        if (entries.get(id) !== held) return;
        if (!held.listeners.size) {
          held.stop?.();
          entries.delete(id);
        }
        if (!entries.size) {
          stopTransport();
          owner = null;
          retried = false;
        }
      };
    },
  };
}
