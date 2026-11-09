// Follows a car. "chase" turns the world so the car always points up (left
// button = left on screen, best on phones); "fixed" keeps north up and looks
// ahead in the direction of travel.

import { clamp, damp, dampAngle } from './util.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.heading = -Math.PI / 2;
    this.zoom = 0.5;
    this.lookX = 0;
    this.lookY = 0;
    this.shakeAmt = 0;
    this.ox = 0;
    this.oy = 0;
    this.mode = 'chase';
    this.rot = 0;
    this.anchorX = 0;
    this.anchorY = 0;
    this.fast = 0; // smoothed speed, for how far ahead to look
  }

  baseZoom(w, h) {
    let z = 0.8 * Math.pow(Math.sqrt(w * h) / 574, 0.67);
    if (this.mode === 'chase' && w > h) z *= Math.pow(h / w, 0.35);
    return clamp(z, 0.35, 1.6);
  }

  snap(target, w, h, zoomMul = 1) {
    this.x = target.x;
    this.y = target.y;
    this.heading = target.angle;
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = this.baseZoom(w, h) * zoomMul;
  }

  shake(amount) {
    this.shakeAmt = Math.min(16, this.shakeAmt + amount);
  }

  update(dt, target, { w, h, mode, touchUI, speedFrac = 0, boost = false, zoomMul = 1, rate = 1, anchorX = null, anchorY = null }) {
    this.mode = mode;
    const base = this.baseZoom(w, h);
    // Faster: zoom out and (chase view) sit the car lower, to see braking zones sooner.
    this.fast = damp(this.fast, clamp(speedFrac, 0, 1.2), 2.5 * rate, dt);
    const zt = base * (1 - 0.33 * clamp(speedFrac, 0, 1.2)) * (boost ? 0.93 : 1) * zoomMul;
    this.zoom = damp(this.zoom, zt, 1.8 * rate, dt);

    if (mode === 'chase') {
      // Blend heading with direction of travel so drifts don't whip the view around.
      let dirA = target.angle;
      const sp = Math.hypot(target.vx, target.vy);
      if (sp > 80) {
        const va = Math.atan2(target.vy, target.vx);
        const fwd = Math.cos(va - target.angle) > 0;
        if (fwd) dirA = target.angle + Math.atan2(Math.sin(va - target.angle), Math.cos(va - target.angle)) * 0.5;
      }
      this.heading = dampAngle(this.heading, dirA, 4.5 * rate, dt);
      this.lookX = damp(this.lookX, 0, 4, dt);
      this.lookY = damp(this.lookY, 0, 4, dt);
      this.rot = -Math.PI / 2 - this.heading;
      this.anchorX = w / 2;
      this.anchorY = h * ((touchUI && h > w ? 0.6 : h < 500 ? 0.74 : 0.66) + 0.06 * Math.min(1, this.fast));
    } else {
      this.lookX = damp(this.lookX, target.vx * 0.36, 3, dt);
      this.lookY = damp(this.lookY, target.vy * 0.36, 3, dt);
      this.rot = 0;
      this.anchorX = w / 2;
      this.anchorY = h * (touchUI && h > w ? 0.44 : 0.5);
    }
    if (anchorX != null) this.anchorX = anchorX;
    if (anchorY != null) this.anchorY = anchorY;
    this.x = damp(this.x, target.x + this.lookX, 14 * rate, dt);
    this.y = damp(this.y, target.y + this.lookY, 14 * rate, dt);

    this.ox = (Math.random() - 0.5) * 2 * this.shakeAmt;
    this.oy = (Math.random() - 0.5) * 2 * this.shakeAmt;
    this.shakeAmt *= Math.exp(-9 * dt);
  }

  apply(ctx, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.anchorX + this.ox, this.anchorY + this.oy);
    ctx.rotate(this.rot);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  toScreen(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [this.anchorX + (dx * c - dy * s) * this.zoom, this.anchorY + (dx * s + dy * c) * this.zoom];
  }

  // World-space box that covers the whole screen (rotation included).
  viewRect(w, h) {
    const cx = w / 2 - this.anchorX;
    const cy = h / 2 - this.anchorY;
    const c = Math.cos(-this.rot);
    const s = Math.sin(-this.rot);
    const wx = this.x + (cx * c - cy * s) / this.zoom;
    const wy = this.y + (cx * s + cy * c) / this.zoom;
    const r = Math.hypot(w, h) / 2 / this.zoom + 20;
    return { minX: wx - r, minY: wy - r, maxX: wx + r, maxY: wy + r };
  }
}
