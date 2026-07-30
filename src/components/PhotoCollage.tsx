"use client";

/**
 * PhotoCollage
 * ------------
 * Native React port of Chloe's GBOOTH photo-strip booth (commit 33626c6 on
 * CardifyBooth#newcode1), rendered directly in the app instead of an iframe.
 *
 * Ported faithfully from her Gbooth.html / Gboothjava.js:
 *   - layout picker (2 / 3 / 4 slots) with her strip mock-ups
 *   - 3s countdown capture + retake, mirrored viewfinder
 *   - strip canvas (360x960) with her exact per-slot spacing maths
 *   - her 6 filters, 5 preset frame colours + colour wheel, 8 emoji stickers
 *     plus Gettysburg/ICL PNG stickers (public/stickers)
 *   - final screen: strip + print
 *
 * Deliberate differences from her standalone file, and why:
 *   - Her "home" view is dropped: the app's Photo Collage tile is already the
 *     entry point, so her second home screen would be a duplicate.
 *   - Her UI chrome was 17 PNGs (buttons/headings/background) that were never
 *     committed, so they are rebuilt in CSS using her palette and typography.
 *   - The printed strip carries the ICL mark (QR to the ICL website baked in).
 *   - Printing posts the strip PNG to /api/collage/print (silent DS-RX1 print,
 *     DoubleStrip4x6 = two strips per 4x6) instead of window.print().
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Printer } from "lucide-react";
import QRCode from "qrcode";
import { captureDevPhoto, isDevCamera } from "@/lib/dev-camera";
import {
  findFrame,
  framesForCount,
  type FrameBleed,
  type FrameSlot,
  type FrameTheme,
} from "@/data/frame-themes";

type CollageView = "layout" | "camera" | "decor" | "final";
type FilterName = "none" | "traditional" | "sepia" | "soft" | "y2k" | "vivid";
// A sticker is either an emoji (drawn as text) or an image (`src` set, drawn
// from a preloaded PNG). `size` is the glyph font-size for emoji and the
// bounding-box longest side for images.
type Sticker = { id: number; emoji: string; x: number; y: number; size: number; src?: string };
type PaletteDrag = { emoji: string; x: number; y: number; src?: string };

type PhotoCollageProps = {
  /** Return to the app's home (the 4-quadrant chooser). */
  onExit: () => void;
  /**
   * Signals "still in use" to the shell's idle timer. Needed because during the
   * countdown the guest is posing, not tapping, so no pointer/key events fire
   * and the booth would otherwise reset to home mid-session.
   */
  onActivity?: () => void;
};

// Chloe's strip geometry.
const STRIP_W = 600;
const STRIP_H = 1800;
const STRIP_PADDING_X = 24;

// Reframing for the low-mounted booth camera, which captures a lot of empty
// ceiling above the guest. Tune these two if the framing needs adjusting:
const CROP_ZOOM = 1.2; // >1 zooms in to push the ceiling out of frame
const VERTICAL_CROP_BIAS = 0.72; // 0 keeps the top of the frame, 1 keeps the bottom

// Shared layout band so 2/3/4-shot strips are laid out identically: photos
// always fill the same region (top margin → footer) with equal gaps, and the
// footer sits in a fixed reserved band at the bottom. No per-layout tuning.
const STRIP_TOP_MARGIN = 24;
const STRIP_GAP = 20;
const STRIP_FOOTER_H = 250; // reserved bottom band for college text + QR + logo

// Photo width is constant; height follows from how many photos share the band.
// The strip renderer AND the camera preview both call this, so the shape a guest
// frames on the capture screen is exactly the shape that lands on the strip.
const STRIP_PHOTO_W = STRIP_W - STRIP_PADDING_X * 2;
function slotPhotoHeight(slotCount: number): number {
  const contentH = STRIP_H - STRIP_TOP_MARGIN - STRIP_FOOTER_H;
  return slotCount > 0 ? (contentH - (slotCount - 1) * STRIP_GAP) / slotCount : contentH;
}

/**
 * Draw one captured photo into `dest`, cover-cropped and reframed exactly the
 * way the plain-colour strip does it (see renderStrip for why the zoom and the
 * downward bias exist), mirrored like a real booth.
 *
 * `cropAspect` is kept separate from the destination's own aspect so the custom
 * frames can crop to what the guest saw on screen and then stretch that into a
 * print slot with a slightly different shape — Chloe's print sheets squeeze the
 * slots horizontally on purpose to cancel the printer's stretch.
 */
function drawPhotoInto(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  dest: FrameSlot,
  cropAspect: number,
  filterName: FilterName,
) {
  let sw = src.width;
  let sh = src.width / cropAspect;
  if (sh > src.height) {
    sh = src.height;
    sw = src.height * cropAspect;
  }
  sw /= CROP_ZOOM;
  sh /= CROP_ZOOM;
  const sx = (src.width - sw) / 2;
  const sy = (src.height - sh) * VERTICAL_CROP_BIAS;

  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.x, dest.y, dest.w, dest.h);
  ctx.clip();
  ctx.filter = canvasFilter(filterName);
  ctx.translate(dest.x + dest.w, dest.y);
  ctx.scale(-1, 1);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dest.w, dest.h);
  ctx.restore();
}

/**
 * Paint the artwork's outermost opaque pixels outward into its transparent
 * edge bands. Every one of Chloe's print sheets stops ~20px short of the top
 * edge (two stop ~50px short on the right); without this those bands reach the
 * paper as white slivers along the strip edges.
 */
function paintFrameBleed(
  ctx: CanvasRenderingContext2D,
  art: HTMLImageElement,
  bleed: FrameBleed,
  destW: number,
  destH: number,
) {
  const sx = art.naturalWidth / destW;
  const sy = art.naturalHeight / destH;
  const { top, bottom, left, right } = bleed;
  if (top > 0) {
    ctx.drawImage(art, 0, top * sy, art.naturalWidth, 1, 0, 0, destW, top);
  }
  if (bottom > 0) {
    const srcY = art.naturalHeight - bottom * sy - 1;
    ctx.drawImage(art, 0, srcY, art.naturalWidth, 1, 0, destH - bottom, destW, bottom);
  }
  if (left > 0) {
    ctx.drawImage(art, left * sx, 0, 1, art.naturalHeight, 0, 0, left, destH);
  }
  if (right > 0) {
    const srcX = art.naturalWidth - right * sx - 1;
    ctx.drawImage(art, srcX, 0, 1, art.naturalHeight, destW - right, 0, right, destH);
  }
}

/** Stickers are placed in STRIP_W x STRIP_H space; `scale`/`offsetX` map them
 *  onto a print sheet half. */
function drawStickers(
  ctx: CanvasRenderingContext2D,
  stickers: Sticker[],
  images: Map<string, HTMLImageElement>,
  scale = 1,
  offsetX = 0,
) {
  ctx.save();
  stickers.forEach((s) => {
    if (s.src) {
      // Image sticker: fit inside a `size`x`size` box preserving aspect ratio,
      // centred on (x, y). Skipped if the PNG hasn't finished preloading.
      const img = images.get(s.src);
      if (!img || !img.complete || !img.naturalWidth) return;
      const box = s.size * scale;
      const ar = img.naturalWidth / img.naturalHeight;
      const w = ar >= 1 ? box : box * ar;
      const h = ar >= 1 ? box / ar : box;
      ctx.drawImage(img, offsetX + s.x * scale - w / 2, s.y * scale - h / 2, w, h);
      return;
    }
    ctx.font = `${s.size * scale}px Arial`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(s.emoji, offsetX + s.x * scale, s.y * scale);
  });
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame image failed to load: ${src}`));
    img.src = src;
  });
}

// Her palette.
const PRESET_COLORS = ["#043371", "#CC4E00", "#EB9AB2", "#CDED76", "#AEA43A"];
const DEFAULT_STRIP_COLOR = "#EB9AB2";
const SKY = "#82c4f5";
const ACCENT = "#0022ff";

const FILTERS: { key: FilterName; label: string }[] = [
  { key: "none", label: "Original" },
  { key: "traditional", label: "Traditional" },
  { key: "sepia", label: "Sepia" },
  { key: "soft", label: "Soft Light" },
  { key: "y2k", label: "Y2K" },
  { key: "vivid", label: "Vivid" },
];

const STICKER_EMOJIS = ["❤️", "⭐", "✨", "🎀", "🕶️", "👑", "🐈", "🍒"];

// Gettysburg / ICL PNG stickers (transparent). Dragged onto the strip like the
// emoji, but drawn from preloaded images. Files live in public/stickers.
const IMAGE_STICKERS: { src: string; label: string }[] = [
  { src: "/stickers/gburg-primary-logo.png", label: "Gettysburg College logo" },
  { src: "/stickers/gburg-g-logo.png", label: "Gettysburg G logo" },
  { src: "/stickers/bullet-mascot.png", label: "Bullets mascot" },
  { src: "/stickers/gburg-college.png", label: "Gettysburg College" },
  { src: "/stickers/gburg-pennant.png", label: "Gettysburg pennant" },
  { src: "/stickers/gburg-cookie.png", label: "Gettysburg cookie" },
  { src: "/stickers/do-great-work-glasses.png", label: "Do great work glasses" },
  { src: "/stickers/icl-logo-sticker.png", label: "ICL logo" },
];
// Image stickers drop bigger than emoji so logos stay legible.
const IMAGE_STICKER_SIZE = 150;
const EMOJI_STICKER_SIZE = 84;

const LAYOUT_OPTIONS = [
  { slots: 2, label: "2 SHOTS", sub: "Classic duo" },
  { slots: 3, label: "3 SHOTS", sub: "Triple strip" },
  { slots: 4, label: "4 SHOTS", sub: "Full strip" },
];

/** Her exact Safari-safe canvas filter strings. */
function canvasFilter(name: FilterName): string {
  switch (name) {
    case "traditional":
      return "grayscale(100%) contrast(120%) brightness(103%)";
    case "sepia":
      return "sepia(75%) saturate(115%) contrast(105%)";
    case "soft":
      return "brightness(114%) contrast(92%) saturate(108%)";
    case "y2k":
      return "contrast(120%) brightness(108%) saturate(50%) hue-rotate(-8deg)";
    case "vivid":
      return "contrast(112%) saturate(170%) brightness(104%)";
    default:
      return "none";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PhotoCollage({ onExit, onActivity }: PhotoCollageProps) {
  const [view, setView] = useState<CollageView>("layout");
  const [slots, setSlots] = useState(4);
  const [filter, setFilter] = useState<FilterName>("none");
  const [bgColor, setBgColor] = useState(DEFAULT_STRIP_COLOR);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  // null = the plain background-colour strip. Anything else is one of Chloe's
  // custom frames; the two paths are independent all the way to the printer.
  const [frameKey, setFrameKey] = useState<string | null>(null);
  const [frameImg, setFrameImg] = useState<HTMLImageElement | null>(null);
  const [framePage, setFramePage] = useState(0);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [sessionDone, setSessionDone] = useState(false);
  const [retakeNonce, setRetakeNonce] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [stripDataUrl, setStripDataUrl] = useState("");
  const [printState, setPrintState] = useState<"idle" | "printing" | "sent">("idle");
  const [printError, setPrintError] = useState<string | null>(null);

  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const [brandReady, setBrandReady] = useState(false);
  const [stripQrReady, setStripQrReady] = useState(false);
  // Preloaded PNG stickers, keyed by src so drawStickers can look them up
  // synchronously. `stickerImgsReady` bumps once they load so the preview
  // re-renders any already-placed image stickers.
  const stickerImgsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [stickerImgsReady, setStickerImgsReady] = useState(false);

  const lastRelayIdRef = useRef(0);
  const activePointersRef = useRef<Map<number, {x: number, y: number}>>(new Map());
  const pinchRef = useRef<{ id: number; startDist: number; startSize: number } | null>(null);
  const captureResolversRef = useRef(new Map<string, (photo: string | null) => void>());
  const photosRef = useRef<HTMLCanvasElement[]>([]);
  // Incremented on every capture-session run so a stale/overlapping async loop
  // (StrictMode re-invoke, or re-entering the camera from Decorate) can detect
  // that a newer run has taken over and stop appending photos.
  const captureRunRef = useRef(0);
  const decorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brandImgRef = useRef<HTMLImageElement | null>(null);
  const stripQrImgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const paletteDragRef = useRef<PaletteDrag | null>(null);

  // Held in a ref: the parent passes an inline arrow, so depending on it
  // directly would restart the capture session on every parent render.
  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);



  // The ICL mark is local, so drawing it cannot taint the printable canvas.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      brandImgRef.current = img;
      setBrandReady(true);
    };
    img.src = "/cardify/icl-logo.png";

    // Static QR code pointing to the ICL website
    QRCode.toDataURL("https://icl.sites.gettysburg.edu/", {
      margin: 1,
      width: 150,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        const qrImg = new Image();
        qrImg.onload = () => {
          stripQrImgRef.current = qrImg;
          setStripQrReady(true);
        };
        qrImg.src = url;
      })
      .catch(() => {});
  }, []);

  // Preload the PNG stickers once so drawStickers can blit them synchronously.
  useEffect(() => {
    let remaining = IMAGE_STICKERS.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) setStickerImgsReady(true);
    };
    IMAGE_STICKERS.forEach(({ src }) => {
      const img = new Image();
      img.onload = () => {
        stickerImgsRef.current.set(src, img);
        done();
      };
      img.onerror = done;
      img.src = src;
    });
  }, []);

  // --- Camera relay ---------------------------------------------------------
  const sendToMirror = useCallback((message: Record<string, unknown>) => {
    void fetch("/api/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "mirror", ...message }),
    }).catch(() => {});
  }, []);

  const stopCamera = useCallback(() => {
    sendToMirror({ type: "countdown", value: 0 });
  }, [sendToMirror]);

  const requestMirrorPhoto = useCallback(() => new Promise<string | null>((resolve) => {
    // Laptop testing: capture straight from the shared stream instead of asking
    // the mirror window, which isn't running.
    if (isDevCamera()) {
      resolve(captureDevPhoto());
      return;
    }

    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      captureResolversRef.current.delete(requestId);
      resolve(null);
    }, 5000);

    captureResolversRef.current.set(requestId, (photo) => {
      window.clearTimeout(timeout);
      captureResolversRef.current.delete(requestId);
      resolve(photo);
    });
    sendToMirror({ type: "capture-request", requestId });
  }), [sendToMirror]);

  useEffect(() => {
    let cancelled = false;
    const captureResolvers = captureResolversRef.current;

    const poll = async () => {
      try {
        const response = await fetch(`/api/mirror?role=kiosk&since=${lastRelayIdRef.current}`, { cache: "no-store" });
        const data = (await response.json()) as { events?: Array<Record<string, unknown> & { id?: number }> };
        for (const event of data.events ?? []) {
          lastRelayIdRef.current = Math.max(lastRelayIdRef.current, event.id ?? 0);
          if (event.type === "captured-photo" && typeof event.requestId === "string" && typeof event.dataUrl === "string") {
            captureResolversRef.current.get(event.requestId)?.(event.dataUrl);
          }
        }
      } catch {}

      if (!cancelled) window.setTimeout(poll, 200);
    };

    void poll();
    return () => {
      cancelled = true;
      captureResolvers.forEach((resolve) => resolve(null));
      captureResolvers.clear();
      stopCamera();
    };
  }, [stopCamera]);

  /** Clear the shot state. Called from handlers (not the effect) so we never
   *  setState synchronously inside an effect body. */
  const resetShots = useCallback(() => {
    photosRef.current = [];
    setPreviews([]);
    setSessionDone(false);
    setCountdown(null);
    setCameraError(null);
  }, []);

  const startSession = (nextSlots: number) => {
    resetShots();
    setSlots(nextSlots);
    setStickers([]);
    setFilter("none");
    setBgColor(DEFAULT_STRIP_COLOR);
    setFrameKey(null);
    setFramePage(0);
    setView("camera");
  };

  const retakeAll = () => {
    resetShots();
    setRetakeNonce((n) => n + 1);
  };

  // --- Capture session (her countdown + retake flow) -------------------------
  useEffect(() => {
    if (view !== "camera") return;
    let cancelled = false;
    const runId = ++captureRunRef.current;

    // Start every camera visit from a clean slate: re-entering the camera (e.g.
    // Back from Decorate) must not append onto a previous session's photos, and
    // a stale async loop must stop the moment a newer run takes over.
    photosRef.current = [];
    setPreviews([]);
    setSessionDone(false);
    setCameraError(null);

    // True once this run has been superseded or torn down — the guard against
    // two countdown loops both pushing photos.
    const isStale = () => cancelled || runId !== captureRunRef.current;

    (async () => {
      sendToMirror({ type: "mirror-start" });
      sendToMirror({ type: "mirror-ping" });
      await sleep(500);

      for (let i = 0; i < slots; i++) {
        for (let t = 3; t > 0; t--) {
          if (isStale()) return;
          setCountdown(t);
          sendToMirror({ type: "countdown", value: t });
          await sleep(1000);
        }
        if (isStale()) return;
        setCountdown(null);
        sendToMirror({ type: "countdown", value: 0 });

        const photo = await requestMirrorPhoto();
        if (isStale()) return;
        if (!photo) {
          setCameraError("Please check the camera screen and try again.");
          return;
        }

        const image = new Image();
        image.src = photo;
        await new Promise<void>((resolve) => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
        });
        if (isStale()) return;

        // Cap at the chosen slot count so a rogue loop can never overshoot.
        if (image.naturalWidth > 0 && photosRef.current.length < slots) {
          const c = document.createElement("canvas");
          c.width = 640;
          c.height = 480;
          const cx = c.getContext("2d");
          if (cx) {
            // The CRT relay sends its mirrored view; flip it back for the print.
            cx.translate(640, 0);
            cx.scale(-1, 1);
            cx.drawImage(image, 0, 0, 640, 480);
            photosRef.current.push(c);
            setPreviews((p) => [...p, c.toDataURL("image/png")]);
            // Taking a shot counts as being actively used, even though the guest
            // never touched the screen.
            onActivityRef.current?.();
          }
        }
        if (i < slots - 1) await sleep(1200);
      }
      if (!isStale()) setSessionDone(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [view, slots, retakeNonce, requestMirrorPhoto, sendToMirror]);

  // --- Custom frames --------------------------------------------------------
  // A frame only exists for some photo counts, so the selection is resolved
  // against the current slot count and silently drops back to the plain strip
  // when the guest switches to a count this theme was not drawn for.
  const availableFrames = useMemo(() => framesForCount(slots), [slots]);
  const framePageCount = Math.max(1, Math.ceil(availableFrames.length / 5));
  const visibleFrames = useMemo(
    () => availableFrames.slice(framePage * 5, framePage * 5 + 5),
    [availableFrames, framePage],
  );
  const activeFrame = useMemo(
    () => (frameKey ? findFrame(frameKey, slots) : undefined),
    [frameKey, slots],
  );

  // Preload the on-screen frame art; renderStrip re-runs once it is decoded.
  useEffect(() => {
    if (!activeFrame) return;
    let cancelled = false;
    loadImage(activeFrame.single.src)
      .then((img) => {
        if (!cancelled) setFrameImg(img);
      })
      .catch(() => {
        if (!cancelled) setFrameImg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFrame]);

  // --- Strip rendering (direct port of renderPhotoStripCanvas) --------------
  const renderStrip = useCallback(() => {
    const canvas = decorCanvasRef.current;
    if (!canvas) return;
    canvas.width = STRIP_W;
    canvas.height = STRIP_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const photos = photosRef.current;

    // Custom frame: the photos go BEHIND the art and show through its
    // transparent windows. The frame already carries its own background and
    // branding, so none of the plain-strip chrome below runs. The src check
    // keeps a half-loaded previous theme from being drawn into the new one
    // (decoded because the browser percent-encodes the spaces in her filenames).
    if (
      activeFrame &&
      frameImg &&
      decodeURIComponent(frameImg.src).endsWith(activeFrame.single.src)
    ) {
      const fx = STRIP_W / activeFrame.single.w;
      const fy = STRIP_H / activeFrame.single.h;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, STRIP_W, STRIP_H);
      paintFrameBleed(ctx, frameImg, activeFrame.single.bleed, STRIP_W, STRIP_H);
      activeFrame.single.slots.forEach((slot, i) => {
        const src = photos[i];
        if (!src) return;
        drawPhotoInto(
          ctx,
          src,
          { x: slot.x * fx, y: slot.y * fy, w: slot.w * fx, h: slot.h * fy },
          slot.w / slot.h,
          filter,
        );
      });
      ctx.drawImage(frameImg, 0, 0, STRIP_W, STRIP_H);
      drawStickers(ctx, stickers, stickerImgsRef.current);
      return;
    }

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, STRIP_W, STRIP_H);

    const slotCount = photos.length;

    // Fill one fixed content band with N equal photos + equal gaps (shared with
    // the camera preview via slotPhotoHeight), so 2/3/4-shot strips look
    // consistent and match what the guest framed — no dead space at the bottom.
    const photoW = STRIP_PHOTO_W;
    const photoH = slotPhotoHeight(slotCount);

    for (let i = 0; i < slotCount; i++) {
      const y = STRIP_TOP_MARGIN + i * (photoH + STRIP_GAP);

      // Cover-crop the source into the slot with no distortion (never stretch),
      // then reframe for the low booth camera, which captures a lot of empty
      // ceiling above the guest:
      //   - start from the largest source region matching the slot aspect,
      //   - zoom in slightly (CROP_ZOOM) to push ceiling out of frame,
      //   - centre the crop horizontally,
      //   - bias the vertical crop DOWNWARD (VERTICAL_CROP_BIAS) so the face and
      //     torso are kept and the ceiling is what gets trimmed.
      const src = photos[i];
      const targetAspect = photoW / photoH;
      let sw = src.width;
      let sh = src.width / targetAspect;
      if (sh > src.height) {
        sh = src.height;
        sw = src.height * targetAspect;
      }
      sw /= CROP_ZOOM;
      sh /= CROP_ZOOM;
      const sx = (src.width - sw) / 2;
      const sy = (src.height - sh) * VERTICAL_CROP_BIAS;

      ctx.save();
      // Clip so filters never bleed past the photo frame.
      ctx.beginPath();
      ctx.rect(STRIP_PADDING_X, y, photoW, photoH);
      ctx.clip();
      ctx.filter = canvasFilter(filter);
      // Mirror, like a real booth.
      ctx.translate(STRIP_PADDING_X + photoW, y);
      ctx.scale(-1, 1);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, photoW, photoH);
      ctx.restore();
    }

    // Footer branding.
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 30px sans-serif";
    ctx.textAlign = "center";
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "2px";
    ctx.fillText("GETTYSBURG COLLEGE", STRIP_W / 2, STRIP_H - 206);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";

    const brandImg = brandReady ? brandImgRef.current : null;
    if (brandImg) {
      const brandSize = 116;
      const brandX = STRIP_W - STRIP_PADDING_X - brandSize;
      const brandY = STRIP_H - 154;
      ctx.drawImage(brandImg, brandX, brandY, brandSize, brandSize);
    }

    const stripQrImg = stripQrReady ? stripQrImgRef.current : null;
    if (stripQrImg) {
      const qrSize = 116;
      const qrX = STRIP_PADDING_X;
      const qrY = STRIP_H - 154;
      ctx.drawImage(stripQrImg, qrX, qrY, qrSize, qrSize);
    }

    drawStickers(ctx, stickers, stickerImgsRef.current);
    // stickerImgsReady is intentional: it isn't read here (drawStickers reads the
    // ref) but forces a repaint once the PNG stickers finish preloading, so any
    // already-placed image sticker appears without waiting for the next interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgColor, filter, stickers, brandReady, stripQrReady, activeFrame, frameImg, stickerImgsReady]);

  useEffect(() => {
    if (view === "decor") renderStrip();
  }, [view, renderStrip]);

  // --- Sticker dragging on the canvas ---------------------------------------
  const canvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * STRIP_W,
      y: ((e.clientY - box.top) / box.height) * STRIP_H,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = canvasCoords(e);
    activePointersRef.current.set(e.pointerId, p);

    if (activePointersRef.current.size === 1) {
      for (let i = stickers.length - 1; i >= 0; i--) {
        const s = stickers[i];
        if (Math.hypot(p.x - s.x, p.y - s.y) < s.size / 1.2) {
          dragRef.current = { id: s.id, dx: p.x - s.x, dy: p.y - s.y };
          e.currentTarget.setPointerCapture(e.pointerId);
          break;
        }
      }
    } else if (activePointersRef.current.size === 2 && dragRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const activeSticker = stickers.find((s) => s.id === dragRef.current!.id);
      if (activeSticker) {
        pinchRef.current = { id: activeSticker.id, startDist: dist, startSize: activeSticker.size };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = canvasCoords(e);
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, p);
    }

    if (activePointersRef.current.size === 2 && pinchRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const newSize = Math.max(20, Math.min(600, pinchRef.current.startSize * (dist / pinchRef.current.startDist)));
      setStickers((prev) =>
        prev.map((s) => (s.id === pinchRef.current!.id ? { ...s, size: newSize } : s)),
      );
    } else if (activePointersRef.current.size === 1 && dragRef.current) {
      setStickers((prev) =>
        prev.map((s) => (s.id === dragRef.current!.id ? { ...s, x: p.x - dragRef.current!.dx, y: p.y - dragRef.current!.dy } : s)),
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (activePointersRef.current.size === 0 && dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const startPaletteDrag = (
    emoji: string,
    src: string | undefined,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    const nextDrag = { emoji, src, x: e.clientX, y: e.clientY };
    paletteDragRef.current = nextDrag;
    setPaletteDrag(nextDrag);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const movePaletteDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!paletteDragRef.current) return;
    const nextDrag = {
      ...paletteDragRef.current,
      x: e.clientX,
      y: e.clientY,
    };
    paletteDragRef.current = nextDrag;
    setPaletteDrag(nextDrag);
  };

  const finishPaletteDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const activeDrag = paletteDragRef.current;
    paletteDragRef.current = null;
    setPaletteDrag(null);

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!activeDrag || !decorCanvasRef.current) return;

    const box = decorCanvasRef.current.getBoundingClientRect();
    const droppedOnStrip =
      e.clientX >= box.left &&
      e.clientX <= box.right &&
      e.clientY >= box.top &&
      e.clientY <= box.bottom;

    if (!droppedOnStrip) return;

    const size = activeDrag.src ? IMAGE_STICKER_SIZE : EMOJI_STICKER_SIZE;
    const x = ((e.clientX - box.left) / box.width) * STRIP_W;
    const y = ((e.clientY - box.top) / box.height) * STRIP_H;
    setStickers((previous) => [
      ...previous,
      {
        id: Date.now() + Math.random(),
        emoji: activeDrag.emoji,
        src: activeDrag.src,
        x: Math.min(STRIP_W - size / 2, Math.max(size / 2, x)),
        y: Math.min(STRIP_H - size / 2, Math.max(size / 2, y)),
        size,
      },
    ]);
  };



  const goFinal = () => {
    const canvas = decorCanvasRef.current;
    if (!canvas) return;

    const imageDataUrl = canvas.toDataURL("image/png");
    setStripDataUrl(imageDataUrl);
    stopCamera();
    setView("final");
  };

  /**
   * Compose a full 4×6 sheet with two identical strips side-by-side, so the
   * printer's centre cut yields two complete 2×6 strips (a classic photobooth
   * pair) instead of bisecting a single strip.
   *
   * Built from the captured strip PNG (`stripDataUrl`), NOT from the live
   * decor canvas: by the time the guest taps Print we are on the "final" view
   * and the decor canvas is unmounted (decorCanvasRef.current === null). Reading
   * that null canvas is what silently dropped this to a single strip, which the
   * DNP queue then cover-scaled to the whole 4×6 and cut through the middle.
   */
  const composeForPrint = useCallback(async (): Promise<string | null> => {
    if (!stripDataUrl) return null;

    const strip = new Image();
    strip.src = stripDataUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        strip.onload = () => resolve();
        strip.onerror = () => reject(new Error("strip image failed to load"));
      });
    } catch {
      return null;
    }

    // 4:6 portrait sheet.
    const sheetH = 1800;
    const sheetW = 1200;
    const halfW = sheetW / 2; // 600 — the physical 2-inch cut line

    // The DNP centre cut lands exactly on the sheet centre (x=600) with an
    // essentially zero-width kerf — verified with a printed ruler: a 1px line
    // drawn at x=600 comes out split across BOTH strips' inner edges. So nothing
    // is trimmed; the earlier strips lost their inner frame only because the
    // border there was too thin and sat right under the blade.
    //
    // Fix: give each 2-inch strip an EQUAL pink margin on both sides by centring
    // it inside its own 600px half. Inner border then matches the outer one and
    // is comfortably clear of the cut. The scale is uniform (photos keep their
    // proportions and sharpness) — the strip is just a little smaller inside an
    // even frame.
    //
    // ►► THESE ARE THE KNOBS ◄◄  (px, ~290px/inch so 1px ≈ 0.088mm.) The blade
    // shaves a little off each strip's INNER edge at the seam, so the inner
    // margin is set LARGER than the outer one — after the cut they come out
    // equal. Tune by eye on a print: if the inner border is still thinner, raise
    // INNER_MARGIN; if it's now fatter, lower it. OUTER_MARGIN sets the overall
    // frame thickness. After changing, rebuild (npm run build) or run the booth
    // in -Dev mode, and HARD-REFRESH the tab (Ctrl+Shift+R) before reprinting.
    const OUTER_MARGIN = 40; // pink outside each strip (outer edge)
    const INNER_MARGIN = 18; // pink from strip to the centre cut

    const stripTargetW = halfW - OUTER_MARGIN - INNER_MARGIN;
    const scale = stripTargetW / strip.width; // uniform — no distortion
    const stripTargetH = strip.height * scale;
    const yTop = (sheetH - stripTargetH) / 2; // centre vertically; even top/bottom margin too

    const sheet = document.createElement("canvas");
    sheet.width = sheetW;
    sheet.height = sheetH;
    const ctx = sheet.getContext("2d");
    if (!ctx) return null;

    // Fill the entire sheet with the strip background so there is no white paper
    // anywhere — the coloured border bleeds to every edge.
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, sheetW, sheetH);

    // Left strip: OUTER_MARGIN from the left paper edge, inner edge short of centre.
    ctx.drawImage(strip, OUTER_MARGIN, yTop, stripTargetW, stripTargetH);

    // Right strip (identical): INNER_MARGIN to the right of centre.
    ctx.drawImage(strip, halfW + INNER_MARGIN, yTop, stripTargetW, stripTargetH);

    return sheet.toDataURL("image/png");
  }, [bgColor, stripDataUrl]);

  /**
   * Custom-frame print path. Chloe's `backendstrip/` files are already complete
   * 1200x1800 sheets: both strips laid out, the pattern bled across the centre
   * seam, and the printer's edge compensation baked into the artwork by hand
   * (measured on real prints). So this deliberately BYPASSES composeForPrint --
   * no background fill, no 542px rescale, no OUTER/INNER inset. All we add are
   * the photos and the guest's stickers.
   *
   * The print slots are narrower than the on-screen ones because that squeeze
   * is part of the compensation, so each photo is cropped to the shape the
   * guest saw on screen and then stretched into the print slot.
   */
  const composeFrameForPrint = useCallback(
    async (frame: FrameTheme): Promise<string | null> => {
      let art: HTMLImageElement;
      try {
        art = await loadImage(frame.print.src);
      } catch {
        return null;
      }

      const sheet = document.createElement("canvas");
      sheet.width = frame.print.w;
      sheet.height = frame.print.h;
      const ctx = sheet.getContext("2d");
      if (!ctx) return null;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      paintFrameBleed(ctx, art, frame.print.bleed, sheet.width, sheet.height);

      const photos = photosRef.current;
      const cropAspect = (i: number) => {
        const s = frame.single.slots[i];
        return s ? s.w / s.h : 1;
      };
      for (const side of ["left", "right"] as const) {
        frame.print.slots[side].forEach((slot, i) => {
          const src = photos[i];
          if (src) drawPhotoInto(ctx, src, slot, cropAspect(i), filter);
        });
      }

      ctx.drawImage(art, 0, 0, sheet.width, sheet.height);

      // Stickers sit on top of the art, once per strip half.
      const halfW = sheet.width / 2;
      const scale = halfW / STRIP_W;
      drawStickers(ctx, stickers, stickerImgsRef.current, scale, 0);
      drawStickers(ctx, stickers, stickerImgsRef.current, scale, halfW);

      return sheet.toDataURL("image/png");
    },
    [filter, stickers],
  );

  const handlePrint = async () => {
    if (!stripDataUrl) return;
    setPrintState("printing");
    setPrintError(null);
    try {
      // Custom frames ship as ready-made 4×6 sheets; the plain-colour strip is
      // composed here into the calibrated two-up sheet.
      const printDataUrl =
        (activeFrame ? await composeFrameForPrint(activeFrame) : await composeForPrint()) ??
        stripDataUrl;

      const res = await fetch("/api/collage/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: printDataUrl }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not send collage to the kiosk printer.";
        throw new Error(msg);
      }
      onActivityRef.current?.();
      setPrintState("sent");
      setTimeout(() => setPrintState("idle"), 1800);
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : "Could not print collage.");
      setPrintState("idle");
    }
  };

  // --- Shared styles (rebuilt from her CSS) ---------------------------------
  const glassBtn =
    "rounded-[20px] border border-white/60 bg-white/20 px-3 py-2.5 text-[12px] font-bold uppercase tracking-[0.5px] text-white transition-all hover:bg-white/35";
  const backBtn =
    "absolute left-6 top-5 z-50 rounded-[30px] border border-white/60 bg-white/25 px-5 py-2.5 text-sm font-bold text-white backdrop-blur-[5px] transition-all hover:bg-white/40 active:scale-95";
  const heading =
    "mb-4 font-['Arial_Black',Arial,sans-serif] text-[15px] font-black uppercase tracking-[1.5px] text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.25)]";

  return (
    <div
      className="relative h-full w-full overflow-hidden font-[Arial,sans-serif]"
      style={{ backgroundColor: SKY }}
    >
      <style>{`
        @keyframes gboothPulseCount {
          0%   { transform: scale(0.95); opacity: 0.9; }
          100% { transform: scale(1.05); opacity: 1; }
        }
        .gbooth-countdown { animation: gboothPulseCount 1s infinite alternate; }
        .gbooth-wheel { position:absolute; top:-10px; left:-10px; width:68px; height:68px; border:none; background:none; cursor:pointer; -webkit-appearance:none; }
      `}</style>

      {paletteDrag && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[100] grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border-2 border-white bg-[#043371]/90 p-1 text-[40px] shadow-xl"
          style={{ left: paletteDrag.x, top: paletteDrag.y }}
        >
          {paletteDrag.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={paletteDrag.src} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            paletteDrag.emoji
          )}
        </div>
      )}

      {/* ================= LAYOUT PICKER ================= */}
      {view === "layout" && (
        <section className="flex h-full w-full flex-col items-center justify-center px-6">
          <button type="button" className={backBtn} onClick={onExit}>
            ← Back
          </button>

          <h2 className="mb-1 text-[42px] font-black uppercase tracking-[2px] text-white [text-shadow:0_4px_10px_rgba(0,0,0,0.25)]">
            Choose Your Layout
          </h2>
          <p className="mb-10 text-[15px] font-bold text-white/85 [text-shadow:0_2px_4px_rgba(0,0,0,0.2)]">
            How many shots do you want on your strip?
          </p>

          <div className="flex max-w-[1100px] items-center justify-center gap-[60px]">
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.slots}
                type="button"
                onClick={() => startSession(opt.slots)}
                className="group flex w-[220px] cursor-pointer flex-col items-center transition-transform duration-[250ms] hover:-translate-y-3"
              >
                {/* Her white strip mock-up */}
                <div className="mb-5 flex w-full justify-center">
                  <div className="flex h-[250px] w-[110px] flex-col gap-2 rounded-[6px] border-2 border-dashed border-[#cbd5e1] bg-white p-2.5 shadow-[0_15px_30px_rgba(0,0,0,0.25)] transition-shadow group-hover:shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
                    {Array.from({ length: opt.slots }).map((_, i) => (
                      <div
                        key={i}
                        className="w-full flex-1 rounded-[4px] border border-[#e2e8f0] bg-[#f1f5f9]"
                      />
                    ))}
                  </div>
                </div>
                <span className="text-[18px] font-black tracking-[1px] text-white [text-shadow:0_2px_5px_rgba(0,0,0,0.3)]">
                  {opt.label}
                </span>
                <span className="mt-1 text-[12px] font-bold text-white/70">{opt.sub}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ================= CAMERA ================= */}
      {view === "camera" && (
        <section className="flex h-full w-full items-center justify-center px-10">
          <button
            type="button"
            className={backBtn}
            onClick={() => {
              stopCamera();
              setView("layout");
            }}
          >
            ← Back
          </button>

          {(() => {
            const viewfinderRatio = STRIP_PHOTO_W / slotPhotoHeight(slots);
            // Same height for both columns so the row never sizes itself off
            // whichever one happens to be taller (the tall 2-shot thumbnails
            // used to do this, leaving the sidebar flush at the top instead of
            // centered like the viewfinder).
            const columnHeight =
              viewfinderRatio >= 1 ? `${560 / viewfinderRatio}px` : "min(78vh, 680px)";
            return (
          <div className="flex w-full max-w-[1100px] items-center justify-center gap-[50px]">
            {/* Viewfinder */}
            <div
              className="relative flex shrink-0 items-center justify-center overflow-hidden bg-black shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
              style={{
                aspectRatio: `${STRIP_PHOTO_W} / ${slotPhotoHeight(slots)}`,
                height: columnHeight,
              }}
            >
              {previews.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previews[previews.length - 1]}
                  alt="Latest captured photo"
                  className="h-full w-full -scale-x-100 object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-10 text-center text-2xl font-black text-white">
                  Look at the camera screen
                </div>
              )}
              {countdown !== null && (
                <div className="gbooth-countdown pointer-events-none absolute z-10 text-[140px] font-black text-white [text-shadow:0_0_25px_rgba(0,0,0,0.8),0_0_50px_#0022ff]">
                  {countdown}
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-8 text-center text-lg font-bold text-white">
                  {cameraError}
                </div>
              )}
            </div>

            {/* Sidebar previews + controls */}
            <div
              className="flex w-[480px] flex-col items-center justify-center gap-[30px]"
              style={{ height: columnHeight }}
            >
              <div
                className="grid w-full gap-[15px]"
                style={{
                  // Always two across, so the tall 2-shot thumbnails sit side by
                  // side (one row) instead of stacking and pushing the Retake/
                  // Continue buttons off the bottom.
                  gridTemplateColumns: "repeat(2, 1fr)",
                  maxWidth: "100%",
                }}
              >
                {Array.from({ length: slots }).map((_, i) => (
                  <div
                    key={i}
                    className="flex w-full items-center justify-center border border-white/50 bg-white/85 shadow-[0_4px_10px_rgba(0,0,0,0.15)]"
                    style={{ aspectRatio: `${STRIP_PHOTO_W} / ${slotPhotoHeight(slots)}` }}
                  >
                    {previews[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previews[i]}
                        alt={`Shot ${i + 1}`}
                        className="h-[90%] w-[90%] -scale-x-100 object-cover"
                        style={{ objectPosition: `center ${VERTICAL_CROP_BIAS * 100}%` }}
                      />
                    ) : (
                      <span className="text-3xl font-black text-[#cbd5e1]">{i + 1}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex h-[90px] items-center justify-center gap-[30px]">
                {sessionDone && (
                  <>
                    <button
                      type="button"
                      onClick={retakeAll}
                      className={`${glassBtn} px-6 py-3 text-[13px]`}
                    >
                      Retake All
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("decor")}
                      className="rounded-[20px] border px-8 py-3 text-[13px] font-bold uppercase tracking-[0.5px] text-white shadow-[0_0_10px_rgba(0,34,255,0.4)] transition-transform hover:scale-105"
                      style={{ background: ACCENT, borderColor: ACCENT }}
                    >
                      Continue →
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
            );
          })()}
        </section>
      )}

      {/* ================= DECORATE ================= */}
      {view === "decor" && (
        <section className="flex h-full w-full items-center justify-center overflow-hidden px-6 py-4">
          <button
            type="button"
            className={backBtn}
            onClick={() => setView("camera")}
          >
            ← Back
          </button>

          <div className="flex w-full max-w-[1200px] items-center justify-center gap-[50px]">
            {/* Strip preview */}
            <div className="flex w-[320px] shrink-0 items-center justify-center">
              <canvas
                ref={decorCanvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerOut={onPointerUp}
                className="max-h-[76vh] max-w-full cursor-crosshair bg-white shadow-[0_12px_35px_rgba(0,0,0,0.3)]"
                style={{ touchAction: "none" }}
              />
            </div>

            {/* Dashboard */}
            <div className="flex w-[680px] flex-col gap-3">
              <h2 className="text-[34px] font-black uppercase tracking-[2px] text-white [text-shadow:0_4px_10px_rgba(0,0,0,0.25)]">
                Customize Your Strip
              </h2>

              <div className="grid grid-cols-2 gap-x-[45px] gap-y-[18px]">
                {/* FRAME COLOR */}
                <div className="flex flex-col items-start">
                  <h3 className={heading}>Frame Color</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Frame colour ${c}`}
                        onClick={() => setBgColor(c)}
                        className="h-[42px] w-[42px] shrink-0 rounded-full border-2 shadow-[0_4px_10px_rgba(0,0,0,0.15)] transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: bgColor === c ? ACCENT : "rgba(255,255,255,0.8)",
                        }}
                      />
                    ))}
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="relative h-[42px] w-[42px] cursor-pointer overflow-hidden rounded-full border-2 border-white shadow-[0_4px_10px_rgba(0,0,0,0.15)]">
                        <input
                          type="color"
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                          className="gbooth-wheel"
                          aria-label="Pick a custom frame colour"
                        />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">
                        pick your color
                      </span>
                    </div>
                  </div>
                </div>

                {/* FILTERS */}
                <div className="flex flex-col items-start">
                  <h3 className={heading}>Filters</h3>
                  <div className="grid w-full grid-cols-2 gap-2.5">
                    {FILTERS.map((f) => {
                      const active = filter === f.key;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setFilter(f.key)}
                          className={glassBtn}
                          style={
                            active
                              ? {
                                  background: ACCENT,
                                  borderColor: ACCENT,
                                  boxShadow: "0 0 10px rgba(0,34,255,0.4)",
                                }
                              : undefined
                          }
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* STICKERS */}
                <div className="col-span-2 flex flex-col items-start">
                  <h3 className={heading}>Stickers</h3>
                  <p className="-mt-2 mb-2 text-[12px] font-bold text-white/85">
                    Drag one onto the strip
                  </p>
                  <div className="grid w-full grid-cols-8 gap-2">
                    {STICKER_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onPointerDown={(event) => startPaletteDrag(emoji, undefined, event)}
                        onPointerMove={movePaletteDrag}
                        onPointerUp={finishPaletteDrag}
                        onPointerCancel={finishPaletteDrag}
                        className="flex h-[58px] touch-none select-none items-center justify-center border border-white/40 bg-white/15 text-[24px] transition-transform hover:scale-105 hover:bg-white/25 active:cursor-grabbing"
                        aria-label={`Drag ${emoji} sticker onto the strip`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 grid w-full grid-cols-8 gap-2">
                    {IMAGE_STICKERS.map(({ src, label }) => (
                      <button
                        key={src}
                        type="button"
                        onPointerDown={(event) => startPaletteDrag("", src, event)}
                        onPointerMove={movePaletteDrag}
                        onPointerUp={finishPaletteDrag}
                        onPointerCancel={finishPaletteDrag}
                        className="flex h-[58px] touch-none select-none items-center justify-center border border-white/40 bg-white/15 p-1.5 transition-transform hover:scale-105 hover:bg-white/25 active:cursor-grabbing"
                        aria-label={`Drag ${label} sticker onto the strip`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={label} draggable={false} className="pointer-events-none max-h-full max-w-full object-contain" />
                      </button>
                    ))}
                  </div>
                  {stickers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStickers([])}
                      className={`mt-4 ${glassBtn}`}
                    >
                      Clear stickers
                    </button>
                  )}
                </div>

                {/* STRIPS */}
                <div className="col-span-2 flex flex-col items-start">
                  <div className="mb-2 flex w-full items-center justify-between">
                    <h3 className="text-[20px] font-black uppercase tracking-[1.5px] text-white [text-shadow:0_3px_8px_rgba(0,0,0,0.25)]">
                      Strips
                    </h3>
                    {framePageCount > 1 && (
                      <div className="flex items-center gap-2 text-[12px] font-black text-white">
                        <button
                          type="button"
                          onClick={() => setFramePage((page) => Math.max(0, page - 1))}
                          disabled={framePage === 0}
                          className="rounded-full border border-white/70 bg-white/15 px-3 py-1.5 disabled:opacity-30"
                          aria-label="Previous frame themes"
                        >
                          &larr;
                        </button>
                        <span>{framePage + 1} / {framePageCount}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setFramePage((page) => Math.min(framePageCount - 1, page + 1))
                          }
                          disabled={framePage === framePageCount - 1}
                          className="rounded-full border border-white/70 bg-white/15 px-3 py-1.5 disabled:opacity-30"
                          aria-label="Next frame themes"
                        >
                          &rarr;
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid w-full grid-cols-6 gap-2.5 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setFrameKey(null)}
                      className="flex flex-col items-center gap-1.5 rounded-[14px] border-2 bg-white/15 p-1.5 transition-transform hover:scale-105"
                      style={{
                        borderColor: !activeFrame ? ACCENT : "rgba(255,255,255,0.55)",
                        boxShadow: !activeFrame ? "0 0 10px rgba(0,34,255,0.4)" : undefined,
                      }}
                    >
                      <span
                        className="h-[74px] w-[26px] rounded-[4px] border border-white/70"
                        style={{ backgroundColor: bgColor }}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-white">
                        Plain
                      </span>
                    </button>

                    {visibleFrames.map((f) => {
                      const active = activeFrame?.key === f.key;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setFrameKey(f.key)}
                          className="flex flex-col items-center gap-1.5 rounded-[14px] border-2 bg-white/15 p-1.5 transition-transform hover:scale-105"
                          style={{
                            borderColor: active ? ACCENT : "rgba(255,255,255,0.55)",
                            boxShadow: active ? "0 0 10px rgba(0,34,255,0.4)" : undefined,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.single.src}
                            alt=""
                            className="h-[74px] w-[26px] rounded-[4px] border border-white/70 object-cover"
                          />
                          <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-[0.5px] text-white">
                            {f.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex w-full justify-end pr-4">
                <button
                  type="button"
                  onClick={goFinal}
                  className="rounded-[30px] border px-10 py-3.5 text-[15px] font-black uppercase tracking-[1px] text-white shadow-[0_0_14px_rgba(0,34,255,0.45)] transition-transform hover:scale-105 active:scale-95"
                  style={{ background: ACCENT, borderColor: ACCENT }}
                >
                  Continue →
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ================= FINAL ================= */}
      {view === "final" && (
        <section className="relative flex h-full w-full flex-col items-center">
          <h2 className="mt-4 text-[38px] font-black uppercase tracking-[2px] text-white [text-shadow:0_4px_10px_rgba(0,0,0,0.25)]">
            Here is your strip!
          </h2>

          {/* Home — top left, larger */}
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onExit();
            }}
            className="absolute left-6 top-6 z-10 flex h-[132px] w-[132px] flex-col items-center justify-center gap-1.5 rounded-full border-4 border-white text-[13px] font-black uppercase tracking-[1px] text-white shadow-[0_10px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-105 active:scale-95"
            style={{ background: "#043371" }}
          >
            <Home size={38} strokeWidth={2.2} />
            Home
          </button>

          <div className="relative flex w-full flex-1 items-center justify-center px-[8vw]">

            {/* CENTER: strip (centered in the viewport) */}
            <div className="flex items-center justify-center">
              {stripDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={stripDataUrl}
                  alt="Your finished photo strip"
                  className="max-h-[750px] w-auto rounded-[4px] bg-white shadow-[0_15px_40px_rgba(0,0,0,0.35)]"
                  style={{ height: "65vh" }}
                />
              )}
            </div>

            {/* RIGHT: print (floated so the strip stays centered) */}
            <div className="absolute right-[8vw] top-1/2 flex -translate-y-1/2 flex-col items-center justify-center gap-8">
              <button
                type="button"
                onClick={handlePrint}
                disabled={printState !== "idle"}
                className="flex h-[140px] w-[140px] flex-col items-center justify-center gap-1.5 rounded-full border-4 border-white text-[15px] font-black uppercase tracking-[1px] text-white shadow-[0_10px_24px_rgba(0,0,0,0.25)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-70"
                style={{ background: ACCENT }}
              >
                <Printer size={36} strokeWidth={2.2} />
                {printState === "printing" ? "Printing…" : printState === "sent" ? "Sent!" : "Print"}
              </button>
            </div>
          </div>

          {printError && (
            <p className="mb-3 rounded-md bg-black/70 px-4 py-2 text-sm font-bold text-[#ff9a9a]">
              {printError}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
