import { Prisma } from '../generated/prisma/client';
import type { LatLng } from '@masterio/shared';

/** SQL-фрагмент geography(Point) из координат. Порядок в PostGIS: долгота, широта. */
export function geoPoint(p: LatLng): Prisma.Sql {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
}
