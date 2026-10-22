import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet';
import { useEffect, useRef, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';

const TILE_URL: string = import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION: string = import.meta.env.VITE_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

/** Подгоняет кадр под точки один раз (при первом появлении данных), дальше карту двигает человек. */
function FitOnce({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0] as LatLngExpression, 14);
    else map.fitBounds(points as LatLngBoundsExpression, { padding: [40, 40], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export function BaseMap({ points, children, tall, label }: { points: Array<[number, number]>; children: ReactNode; tall?: boolean; label: string }) {
  return (
    <div className={tall ? 'map tall' : 'map'} role="region" aria-label={label}>
      <MapContainer center={[48.5, 15]} zoom={4} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <FitOnce points={points} />
        {children}
      </MapContainer>
    </div>
  );
}

/** Цвета меток совпадают с легендой в CSS (.map-legend). */
export const MAP_COLORS = {
  free: '#2E7D5B',
  busy: '#FFC43D',
  order: '#1F4E79',
  waiting: '#B3261E',
  track: '#1F4E79',
};
