// Smoke, dust, flying bits of grass and gravel, wind streaks, sparks and
// boost flames, plus skid marks that stay on the track.

export class Particles {
  constructor(max = 900) {
    this.max = max;
    this.list = [];
  }

  spawn(p) {
    if (this.list.length >= this.max) return;
    p.max = p.life;
    p.drag ??= 2;
    p.grow ??= 0;
    this.list.push(p);
  }

  update(dt) {
    const a = this.list;
    let j = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      a[j++] = p;
    }
    a.length = j;
  }

  draw(ctx, view) {
    const m = 40;
    const inView = (p) => p.x > view.minX - m && p.x < view.maxX + m && p.y > view.minY - m && p.y < view.maxY + m;
    for (const p of this.list) {
      if (p.kind !== 'smoke' && p.kind !== 'dust') continue;
      if (!inView(p)) continue;
      const f = p.life / p.max;
      const [r, g, b] = p.rgb;
      ctx.fillStyle = `rgba(${r},${g},${b},${(p.alpha ?? 0.35) * f})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bits kicked up off the road, and air streaming past a car.
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this.list) {
      if (p.kind !== 'bit' && p.kind !== 'wind') continue;
      if (!inView(p)) continue;
      const f = p.life / p.max;
      if (p.kind === 'bit') {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.min(1, f * 2);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = (p.alpha ?? 0.5) * Math.sin(Math.PI * f);
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.dx * p.len, p.y + p.dy * p.len);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.list) {
      if (p.kind !== 'spark' && p.kind !== 'flame') continue;
      if (!inView(p)) continue;
      const f = p.life / p.max;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = Math.min(1, f * 1.6);
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = f * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * f + 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export class Skids {
  constructor(max = 2600) {
    this.max = max;
    this.buf = new Float32Array(max * 4);
    this.i = 0;
    this.count = 0;
  }

  add(x1, y1, x2, y2) {
    const k = this.i * 4;
    this.buf[k] = x1;
    this.buf[k + 1] = y1;
    this.buf[k + 2] = x2;
    this.buf[k + 3] = y2;
    this.i = (this.i + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
  }

  draw(ctx, view) {
    const b = this.buf;
    ctx.beginPath();
    for (let s = 0; s < this.count; s++) {
      const k = s * 4;
      const x = b[k];
      const y = b[k + 1];
      if (x < view.minX || x > view.maxX || y < view.minY || y > view.maxY) continue;
      ctx.moveTo(x, y);
      ctx.lineTo(b[k + 2], b[k + 3]);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = 'rgba(12,12,14,0.3)';
    ctx.stroke();
  }
}
