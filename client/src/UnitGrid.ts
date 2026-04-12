import { TILE_SIZE } from "./constants";

export class UnitGrid {
  private cellSize: number;
  private grid = new Map<string, string[]>();

  constructor(cellSize = TILE_SIZE * 2) {
    this.cellSize = cellSize;
  }

  public clear() {
    this.grid.clear();
  }

  private getKey(x: number, y: number): string {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    return `${gx},${gy}`;
  }

  public add(id: string, x: number, y: number) {
    const key = this.getKey(x, y);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key)!.push(id);
  }

  public getNeighbors(x: number, y: number, radius: number): string[] {
    const neighbors: string[] = [];
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = `${gx},${gy}`;
        const cell = this.grid.get(key);
        if (cell) {
          neighbors.push(...cell);
        }
      }
    }
    return neighbors;
  }
}
