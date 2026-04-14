import { TILE_SIZE } from "./constants";

export class PhysicsTuner {
  // Build 364: Real-time adjustable parameters
  public repulsionRangePadding = TILE_SIZE * 2.5; // Optimized for Build 369
  public repulsionForce = 50000;
  public formationSpacing = TILE_SIZE * 3.0;
  public syncThreshold = TILE_SIZE * 2.5;
  public snapAmount = 0.05;
  public wallAvoidanceRange = TILE_SIZE * 2.2; // Build 370: Increased for anticipatory steering
  public wallAvoidanceForce = 35000;
  public pathSpread = 60; // Build 365: Width of lanes on shared paths

  private container: HTMLDivElement | null = null;

  constructor() {
    if (typeof document !== "undefined") {
      this.createUI();
    }
  }

  private createUI() {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      top: "120px",
      right: "20px",
      width: "240px",
      padding: "16px",
      backgroundColor: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(10px)",
      color: "#fff",
      fontFamily: "'Outfit', sans-serif, Arial",
      fontSize: "12px",
      borderRadius: "12px",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      zIndex: "9999",
      pointerEvents: "auto",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      display: "flex",
      flexDirection: "column",
      gap: "12px"
    });

    this.container.innerHTML = `
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px;">PHYSICS TUNER</div>
      ${this.createSliderHTML("Unit Repel Range", "repulsionRange", 10, 300, Math.round(this.repulsionRangePadding))}
      ${this.createSliderHTML("Unit Repel Power", "repulsionForce", 100, 1000000, this.repulsionForce)}
      ${this.createSliderHTML("Target Group Gap", "spacing", 10, 200, Math.round(this.formationSpacing))}
      ${this.createSliderHTML("Sync Drift Limit", "syncLimit", 10, 300, Math.round(this.syncThreshold))}
      ${this.createSliderHTML("Server Sync %", "snap", 1, 100, Math.round(this.snapAmount * 100))}
      ${this.createSliderHTML("Lane Width on Paths", "pathSpread", 0, 200, this.pathSpread)}
      ${this.createSliderHTML("Obstacle Warn Dist", "wallRange", 0, 200, Math.round(this.wallAvoidanceRange))}
      ${this.createSliderHTML("Obstacle Repel Power", "wallForce", 100, 50000, this.wallAvoidanceForce)}
      <div style="font-size: 10px; opacity: 0.6; text-align: center; margin-top: 4px;">Adjust values to see real-time impact</div>
    `;

    document.body.appendChild(this.container);

    this.setupListeners();
  }

  private createSliderHTML(label: string, id: string, min: number, max: number, value: number) {
    return `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between;">
          <label>${label}</label>
          <span id="val-${id}">${value}</span>
        </div>
        <input type="range" id="input-${id}" min="${min}" max="${max}" value="${value}" style="width: 100%; accent-color: #4ade80; cursor: pointer;">
      </div>
    `;
  }

  private setupListeners() {
    const listen = (id: string, callback: (val: number) => void) => {
      const input = document.getElementById(`input-${id}`) as HTMLInputElement;
      const display = document.getElementById(`val-${id}`);
      if (input && display) {
        input.addEventListener("input", () => {
          const val = Number(input.value);
          display.innerText = val.toString();
          callback(val);
        });
      }
    };

    listen("range", (v) => this.repulsionRangePadding = v);
    listen("force", (v) => this.repulsionForce = v);
    listen("spacing", (v) => this.formationSpacing = v);
    listen("syncLimit", (v) => this.syncThreshold = v);
    listen("snap", (v) => this.snapAmount = v / 100);
    listen("pathSpread", (v) => this.pathSpread = v);
    listen("wallRange", (v) => this.wallAvoidanceRange = v);
    listen("wallForce", (v) => this.wallAvoidanceForce = v);
  }

  public destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
