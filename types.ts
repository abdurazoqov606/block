
export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type HandLandmarks = Landmark[];

export interface HandResults {
  multiHandLandmarks: HandLandmarks[];
}
