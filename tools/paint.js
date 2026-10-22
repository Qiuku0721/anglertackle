// ============================================================================
//  paint.js -- 一套极小的"像素画绘图 API"
//
//  为什么需要它：手写 16×16 字符画时，我反复数错格子（少了/多了 1 格），
//  而且完全没有办法画出真实物体需要的曲线。改成用坐标+算法画：
//    · 直线、圆/圆弧、椭圆、多边形填充
//    · 描边（把形状外圈染成深色）
//    · 明暗（同色系三档自动上色）
//  这样形状由数学决定，不再依赖我数格子。
// ============================================================================

class Canvas {
  /**
   * @param {number} w 宽（像素）
   * @param {number} h 高（像素）
   */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(null);   // null = 透明，否则 '#RRGGBB'
  }

  /** 越界保护：所有绘制都会经过它，所以坐标写错不会崩。 */
  set(x, y, color) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.px[yi * this.w + xi] = color;
  }

  get(x, y) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return null;
    return this.px[yi * this.w + xi];
  }

  /** 填充矩形。 */
  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        this.set(x + i, y + j, color);
      }
    }
    return this;
  }

  /** Bresenham 直线。 */
  line(x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (Math.abs(x - x0) > 500 || Math.abs(y - y0) > 500) break;   // 死循环保护
    }
    return this;
  }

  /** 粗线（沿法线两侧扩展）。 */
  thickLine(x0, y0, x1, y1, thickness, color) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    const half = (thickness - 1) / 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      for (let o = -half; o <= half; o += 1) {
        this.set(cx + o, cy, color);
      }
    }
    return this;
  }

  /** 椭圆弧：中心、半径、起止角度（度，0=右，逆时针为正 y 向下时需注意）。 */
  arc(cx, cy, rx, ry, fromDeg, toDeg, color, thickness = 1) {
    const steps = Math.max(48, Math.ceil((Math.abs(toDeg - fromDeg) / 360) * 180));
    for (let s = 0; s <= steps; s++) {
      const a = ((fromDeg + (toDeg - fromDeg) * (s / steps)) * Math.PI) / 180;
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      if (thickness <= 1) {
        this.set(x, y, color);
      } else {
        for (let o = 0; o < thickness; o++) {
          this.set(x + o, y, color);
        }
      }
    }
    return this;
  }

  /** 椭圆填充（可选"上半/下半"只填一部分，用 yFrom/yTo 比例控制）。 */
  ellipse(cx, cy, rx, ry, color, yRatioFrom = -1, yRatioTo = 1) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y - cy) / ry;
      if (dy < -1 || dy > 1) continue;
      if (dy < yRatioFrom || dy > yRatioTo) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
        this.set(x, y, color);
      }
    }
    return this;
  }

  /** 多边形填充（扫描线，顶点数组 [[x,y],...]）。 */
  polygon(points, color) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) {
          this.set(x, y, color);
        }
      }
    }
    return this;
  }

  /** 给所有不透明像素的外圈加描边（MC 物品的标准做法）。 */
  outline(color) {
    const copy = this.px.slice();
    const opaque = (x, y) => {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      return copy[y * this.w + x] !== null;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (opaque(x, y)) continue;
        if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
          this.set(x, y, color);
        }
      }
    }
    return this;
  }

  /**
   * 把某个颜色的像素替换成另一个颜色，但只在"已经是该颜色"的地方替换。
   * 用于给同一形状上明暗（先整体填底色，再把左上都换成亮色）。
   */
  replace(from, to) {
    for (let i = 0; i < this.px.length; i++) {
      if (this.px[i] === from) this.px[i] = to;
    }
    return this;
  }

  /**
   * 自动明暗：对指定颜色，按"离指定光源的远近"分成三档。
   * 这是让像素画有立体感的关键——平坦的单色看起来就是"乱搞"。
   *
   * @param {string} base   底色
   * @param {string} light  亮部
   * @param {string} dark   暗部
   * @param {number} lx     光源 X（像素）
   * @param {number} ly     光源 Y
   */
  shade(base, light, dark, lx, ly) {
    // 收集所有 base 像素
    const cells = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.px[y * this.w + x] === base) cells.push([x, y]);
      }
    }
    if (cells.length === 0) return this;
    let minD = Infinity;
    let maxD = -Infinity;
    const dists = cells.map(([x, y]) => {
      const d = Math.hypot(x - lx, y - ly);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
      return d;
    });
    const span = Math.max(0.0001, maxD - minD);
    cells.forEach(([x, y], i) => {
      const t = (dists[i] - minD) / span;
      this.px[y * this.w + x] = t < 0.34 ? light : t < 0.72 ? base : dark;
    });
    return this;
  }

  /** 转成 rasterize() 需要的 16 进制调色板 + 字符画（便于复用现有 PNG 编码器）。 */
  toPaletteRows() {
    const palette = {};
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=?';
    let next = 0;
    const rows = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (c === null) {
          row += '.';
          continue;
        }
        if (!(c in palette)) {
          if (next >= chars.length) throw new Error('颜色太多，超出调色板容量');
          palette[c] = chars[next++];
        }
        row += palette[c];
      }
      rows.push(row);
    }
    // 反转：字符 -> 颜色
    const charToColor = { '.': null };
    for (const [color, ch] of Object.entries(palette)) {
      charToColor[ch] = color;
    }
    return { rows, palette: charToColor };
  }
}

module.exports = { Canvas };
