import type { Vec2 } from "./layout.js";

export interface Station {
  id: string;
  name: string;
  room: string;
  roles: ("standby" | "observe")[];
  position: Vec2;
  look_at: Vec2;
  surfaces: string[];
  rooms: string[];
  observes_zone_ids: string[];
}
export interface Zone {
  id: string;
  name: string;
  room: string;
  polygon: Vec2[];
}
export interface SurfaceFront {
  surface_id: string;
  room: string;
  position: Vec2;
  look_at: Vec2;
  near_m: number;
}
export interface StationMap {
  version: 1;
  stations: Station[];
  zones: Zone[];
  surface_fronts: SurfaceFront[];
  kitchen_entry: string | null;
  meal_watch: string | null;
}
