// Node port of generate-frame-manifest.py (used when Python/PIL is unavailable).
// Generates src/data/frame-themes.ts from the frame PNGs in public/frames.
// Slot rectangles are detected from the alpha channel: the photo windows are the
// large fully-transparent regions. Uses 4-connectivity to match scipy.ndimage.label.
//
// Keep the THEMES table in sync with generate-frame-manifest.py.
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const SINGLE = path.join(ROOT, "public/frames/single");
const PRINT = path.join(ROOT, "public/frames/print");

// theme -> label, and per photo-count the source filenames.
// NOTE: two filenames are misnomers and were verified visually --
// frontend "baseball" is the FOOTBALL art, backend "softball" is the LACROSSE art.
const THEMES = [
  ["animal", "Animals", { 3: ["animal pic3.png", "backend-animal-3pic.png"], 4: ["animal pic 4.png", "backend-animal-4pic.png"] }],
  ["apple", "Apple", { 2: ["apple sale pic2.png", "backend-apple-2pic.png"], 3: ["apple pic3.png", "backend-apple-3pic.png"], 4: ["apple sale pic 4.png", "backend-apple-4pic.png"] }],
  ["basketball", "Basketball", { 2: ["Basketball pic2.png", "backend-basketball-2pic.png"], 3: ["basketball pic3.png", "backend-basketball-3pic.png"], 4: ["basketball pic 4.png", "backend-basketball-4pic.png"] }],
  ["brit", "Pattern", { 2: ["Britan pattern2.png", "backend-brit-2pic.png"], 3: ["brittan pattern 3.png", "backend-brit-3pic.png"], 4: ["brittan pic4.png", "backend-brit-4pic.png"] }],
  ["circuit", "Circuit", { 2: ["circuit2.png", "backend-circuit-2pic.png"], 3: ["circuit pic 3.png", "backend-circuit-3pic.png"], 4: ["circuit pic4.png", "backend-circuit-4pic.png"] }],
  ["doodle", "Doodles", { 2: ["cute doodle pic2.png", "backend-doodle-2pic.png"], 3: ["cute doodle pic3.png", "backend-doodle-3pic.png"], 4: ["cute doodle pic 4.png", "backend-doodle-4pic.png"] }],
  ["football", "Football", { 2: ["baseball pic2.png", "backend-football-2pic.png"], 3: ["baseball pic3.png", "backend-football-3pic.png"], 4: ["baseball pic4.png", "backend-football-4pic.png"] }],
  ["lacrosse", "Lacrosse", { 2: ["lacrosse pic2.png", "backend-softball-2pic.png"], 3: ["lacrosse pic3.png", "backend-softball-3pic.png"], 4: ["lacrosse pic 4.png", "backend-softball-4pic.png"] }],
  ["penhall", "Penn Hall", { 2: ["penhall pic2.png", "backend-penhall-2pic.png"], 3: ["pen hall 3 pic.png", "backend-penhall-3pic.png"], 4: ["pen hall pic 4.png", "backend-penhall-4pic.png"] }],
  ["picnic", "Picnic", { 2: ["Picnic2.png", "backend-picnic-2pic.png"], 3: ["picnic 3 strip.png", "backend-picnic-3pic.png"], 4: ["picnic4pic.png", "backend-picnic-4pic.png"] }],
  ["polka", "Polka Dot", { 2: ["polkadot 2pic.png", "backend-polkadot-2pic.png"], 3: ["polka dot pic3.png", "backend-polka-3pic.png"], 4: ["polka dot4.png", "backend-polka-4pic.png"] }],
  ["soccer", "Soccer", { 2: ["soccer 2pic.png", "backend-soccer-2pic.png"], 3: ["soccer pic3.png", "backend-soccer-3pic.png"], 4: ["soccer pic 4.png", "backend-soccer-4pic.png"] }],
  ["tech", "Tech", { 2: ["tech2.png", "backend-tech-2pic.png"], 3: ["tech pic3.png", "backend-tech-3pic.png"], 4: ["tech pic4.png", "backend-tech-4pic.png"] }],
  ["window", "Windows", { 3: ["window pic3.png", "backend-window-3pic.png"], 4: ["window pic 4.png", "backend-window-4pic.png"] }],
];

const MIN_AREA = 20000;

// 4-connected connected components over a boolean mask (alpha < 16), matching
// scipy.ndimage.label's default cross-shaped structuring element.
async function slots(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const N = W * H;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = data[i * ch + 3] < 16 ? 1 : 0;

  const labels = new Int32Array(N).fill(0);
  const queue = new Int32Array(N);
  const out = [];
  let cur = 0;
  for (let start = 0; start < N; start++) {
    if (!mask[start] || labels[start]) continue;
    cur++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = cur;
    let x0 = W, x1 = -1, y0 = H, y1 = -1, count = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % W, y = (p - x) / W;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      // 4-neighbours
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = cur; queue[tail++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = cur; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - W] && !labels[p - W]) { labels[p - W] = cur; queue[tail++] = p - W; }
      if (y < H - 1 && mask[p + W] && !labels[p + W]) { labels[p + W] = cur; queue[tail++] = p + W; }
    }
    if (count < MIN_AREA) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 100 || h < 100 || w > W * 0.95) continue; // skip edge bleed bands
    out.push({ x: x0, y: y0, w, h });
  }

  // Leading fully-transparent rows/cols at each edge (bleed bands).
  const rowTrans = (y) => { for (let x = 0; x < W; x++) if (!mask[y * W + x]) return false; return true; };
  const colTrans = (x) => { for (let y = 0; y < H; y++) if (!mask[y * W + x]) return false; return true; };
  const leadRows = (rev) => { let i = 0; while (i < H && rowTrans(rev ? H - 1 - i : i)) i++; return i; };
  const leadCols = (rev) => { let i = 0; while (i < W && colTrans(rev ? W - 1 - i : i)) i++; return i; };
  const edges = { top: leadRows(false), bottom: leadRows(true), left: leadCols(false), right: leadCols(true) };
  return { w: W, h: H, rects: out, edges };
}

async function main() {
  const entries = [], problems = [];
  for (const [key, label, variants] of THEMES) {
    for (const count of Object.keys(variants).map(Number).sort((a, b) => a - b)) {
      const [sname, pname] = variants[count];
      const sp = path.join(SINGLE, sname), pp = path.join(PRINT, pname);
      if (!fs.existsSync(sp) || !fs.existsSync(pp)) { problems.push(`${key}/${count}: missing file`); continue; }
      const s = await slots(sp), p = await slots(pp);
      const ss = s.rects.slice().sort((a, b) => a.y - b.y);
      const left = p.rects.filter((r) => r.x + r.w / 2 < p.w / 2).sort((a, b) => a.y - b.y);
      const right = p.rects.filter((r) => r.x + r.w / 2 >= p.w / 2).sort((a, b) => a.y - b.y);
      if (ss.length !== count || left.length !== count || right.length !== count) {
        problems.push(`${key}/${count}: detected single=${ss.length} left=${left.length} right=${right.length} (want ${count})`);
        continue;
      }
      entries.push({
        key, label, photoCount: count,
        single: { src: `/frames/single/${sname}`, w: s.w, h: s.h, slots: ss, bleed: s.edges },
        print: { src: `/frames/print/${pname}`, w: p.w, h: p.h, slots: { left, right }, bleed: p.edges },
      });
    }
  }
  for (const p of problems) process.stderr.write(`WARN ${p}\n`);

  const body = JSON.stringify(entries, null, 2);
  const ts = `// GENERATED by scripts/generate-frame-manifest.py -- do not edit by hand.
// Slot rects are detected from each PNG's alpha channel (the transparent photo windows).

export type FrameSlot = { x: number; y: number; w: number; h: number };

/** Fully transparent rows/cols at each edge of the artwork; the renderer
 *  clamps the art outward into them so they don't print as white slivers. */
export type FrameBleed = { top: number; bottom: number; left: number; right: number };

export type FrameTheme = {
  key: string;
  label: string;
  photoCount: number;
  single: { src: string; w: number; h: number; slots: FrameSlot[]; bleed: FrameBleed };
  print: {
    src: string;
    w: number;
    h: number;
    slots: { left: FrameSlot[]; right: FrameSlot[] };
    bleed: FrameBleed;
  };
};

export const FRAME_THEMES: FrameTheme[] = ${body};

export function framesForCount(count: number): FrameTheme[] {
  return FRAME_THEMES.filter((t) => t.photoCount === count);
}

export function findFrame(key: string, count: number): FrameTheme | undefined {
  return FRAME_THEMES.find((t) => t.key === key && t.photoCount === count);
}
`;
  const dest = path.join(ROOT, "src/data/frame-themes.ts");
  fs.writeFileSync(dest, ts, "utf-8");
  process.stdout.write(`wrote ${dest}: ${entries.length} variants, ${problems.length} problems\n`);
}

main();
