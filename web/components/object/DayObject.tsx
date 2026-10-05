"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import s from "./dayobject.module.css";

/**
 * The day, machined: the next 24 hours of half-hourly prices as a studio-lit aluminium ring of 48 fins.
 * Fin height is price; the cheapest quarter is anodised cobalt, the dearest quarter graphite; a polished
 * pin stands at now. Drag to turn it; hover a fin for its time and price.
 */
export interface ObjectSlot {
  s: number;
  e: number;
  p: number;
}
export interface DayObjectProps {
  slots: ObjectSlot[];
  now: number;
  timeZone: string;
  unit: "p" | "¢" | "ct";
  /** Stretches to pick out in cobalt instead of the cheapest quarter (e.g. a planned run). */
  highlight?: { start: number; end: number } | null;
  label: string;
  className?: string;
}

const FINS = 48;
const R_IN = 2.12;
const R_OUT = 2.9;
const BASE_R = 3.3;
const H_MIN = 0.12;
const H_MAX = 2.5;

const COBALT = new THREE.Color("#1530ff");

function minuteOfDay(t: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}
function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/** The 48 half-hour positions of the next day, each with its price (or null if not yet published). */
function finsOf(slots: ObjectSlot[], now: number) {
  const first = Math.floor(now / 1800_000) * 1800_000;
  return Array.from({ length: FINS }, (_, i) => {
    const t = first + i * 1800_000 + 900_000;
    const slot = slots.find((x) => x.s <= t && t < x.e) ?? null;
    return { start: first + i * 1800_000, price: slot ? slot.p : null };
  });
}

export default function DayObject({ slots, now, timeZone, unit, highlight, label, className }: DayObjectProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ update: (p: DayObjectProps) => void } | null>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = matchMedia("(pointer: coarse)").matches;
    // Sharp enough on retina, a third of the pixels of DPR 2.
    // (Recordings at CSS zoom set window.__lowtidePixelRatio so the canvas matches the output size.)
    const forced = (window as Window & { __lowtidePixelRatio?: number }).__lowtidePixelRatio;
    renderer.setPixelRatio(forced ?? Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The light and the object never move relative to each other (only the camera orbits), so the shadow
    // map is redrawn only while the fins change height.
    renderer.shadowMap.autoUpdate = false;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.85;

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 7.4, 10.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.05, 0);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.55;
    controls.maxPolarAngle = 1.2;
    controls.autoRotate = !reduce && !coarse;
    controls.autoRotateSpeed = 0.35;
    controls.update();

    // Light: a soft key from above-left for the shadow, a cool rim from behind.
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(-5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new THREE.DirectionalLight("#cfd8ff", 1.1);
    rim.position.set(4, 5, -8);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight("#ffffff", "#c9ced6", 0.5));

    // Seamless studio floor that only shows the shadow.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    scene.add(floor);

    // Materials.
    // Standard materials where clearcoat adds nothing visible; physical only for the lacquered cobalt.
    const aluminium = new THREE.MeshStandardMaterial({ color: "#b9c0c9", metalness: 1, roughness: 0.22 });
    const brushed = new THREE.MeshStandardMaterial({ color: "#bfc5cd", metalness: 1, roughness: 0.42 });
    const cobalt = new THREE.MeshPhysicalMaterial({ color: COBALT, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const graphite = new THREE.MeshStandardMaterial({ color: "#2a2d33", metalness: 0.7, roughness: 0.3 });
    const ghost = new THREE.MeshStandardMaterial({ color: "#c9ced6", metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.35 });
    const engraving = new THREE.MeshStandardMaterial({ color: "#3a3f47", metalness: 0.4, roughness: 0.6 });
    const polished = new THREE.MeshStandardMaterial({ color: "#f2f4f7", metalness: 1, roughness: 0.08 });

    // The base: a bevelled puck.
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(BASE_R - 0.05, 0),
      new THREE.Vector2(BASE_R, 0.05),
      new THREE.Vector2(BASE_R, 0.2),
      new THREE.Vector2(BASE_R - 0.06, 0.26),
      new THREE.Vector2(0, 0.26),
    ];
    const base = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), brushed);
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);
    // Engraved hour ticks on the rim of the base.
    for (let h = 0; h < 24; h++) {
      const major = h % 6 === 0;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(major ? 0.05 : 0.025, 0.012, major ? 0.24 : 0.12), engraving);
      const a = (h / 24) * Math.PI * 2;
      const r = BASE_R - (major ? 0.2 : 0.14);
      tick.position.set(Math.sin(a) * r, 0.266, -Math.cos(a) * r);
      tick.rotation.y = -a;
      scene.add(tick);
    }
    // Hub.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.14, 96), polished);
    hub.position.y = 0.35;
    hub.castShadow = true;
    scene.add(hub);

    // Fins.
    const depth = R_OUT - R_IN;
    const width = ((2 * Math.PI * ((R_IN + R_OUT) / 2)) / FINS) * 0.58;
    const finGeo = new RoundedBoxGeometry(width, 1, depth, 3, 0.035);
    finGeo.translate(0, 0.5, 0);
    const fins: THREE.Mesh[] = [];
    const finState: { target: number; from: number; delay: number }[] = [];
    for (let i = 0; i < FINS; i++) {
      const m = new THREE.Mesh(finGeo, aluminium);
      m.castShadow = true;
      m.receiveShadow = true;
      m.scale.y = 0.001;
      m.position.y = 0.26;
      scene.add(m);
      fins.push(m);
      finState.push({ target: 0.001, from: 0.001, delay: 0 });
    }

    // Now: a polished pin with a cobalt cap.
    const pin = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.05, 16), polished);
    rod.position.y = 1.52 + 0.26;
    rod.castShadow = true;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), cobalt);
    cap.position.y = 3.05 + 0.26;
    pin.add(rod, cap);
    scene.add(pin);

    let props: DayObjectProps | null = null;
    let finData: { start: number; price: number | null }[] = [];
    let animStart = performance.now();

    const update = (p: DayObjectProps) => {
      props = p;
      finData = finsOf(p.slots, p.now);
      const prices = finData.filter((f) => f.price != null).map((f) => f.price!);
      const lo = Math.min(...prices);
      const hi = Math.max(...prices);
      const span = Math.max(0.01, hi - lo);
      const sorted = [...prices].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? lo;
      const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? hi;
      const startMin = minuteOfDay(finData[0].start, p.timeZone);
      finData.forEach((f, i) => {
        const fin = fins[i];
        const a = (((startMin + i * 30 + 15) % 1440) / 1440) * Math.PI * 2;
        const r = (R_IN + R_OUT) / 2;
        fin.position.set(Math.sin(a) * r, 0.26, -Math.cos(a) * r);
        fin.rotation.y = -a;
        const inHighlight = p.highlight && f.start + 900_000 >= p.highlight.start && f.start + 900_000 < p.highlight.end;
        if (f.price == null) fin.material = ghost;
        else if (p.highlight) fin.material = inHighlight ? cobalt : f.price >= q3 ? graphite : aluminium;
        else fin.material = f.price <= q1 ? cobalt : f.price >= q3 ? graphite : aluminium;
        const k = f.price == null ? 0 : (f.price - lo) / span;
        finState[i].from = fin.scale.y;
        finState[i].target = f.price == null ? 0.05 : H_MIN + k * (H_MAX - H_MIN);
        finState[i].delay = reduce ? 0 : (i / FINS) * 0.9;
      });
      const nowA = ((minuteOfDay(p.now, p.timeZone) % 1440) / 1440) * Math.PI * 2;
      pin.position.set(Math.sin(nowA) * (BASE_R - 0.32), 0, -Math.cos(nowA) * (BASE_R - 0.32));
      animStart = performance.now();
      renderer.shadowMap.needsUpdate = true;
      needsFrame = true;
    };
    api.current = { update };

    // Size is cached here so the frame loop never reads layout.
    let W = 1;
    let H = 1;
    let needsFrame = true;
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      W = w;
      H = h;
      needsFrame = true;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      // Keep the whole object in frame on narrow, tall boxes.
      // Distance that keeps the whole ring (radius ~3.6 with labels) in frame at this aspect.
      const fitW = 4.3 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
      camera.position.sub(controls.target).setLength(Math.max(12.5, fitW)).add(controls.target);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Hover: which fin is under the pointer. Raycast at most once a frame, and write the tooltip
    // straight to the DOM (no React render per mouse move).
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hoverIdx = -1;
    let pending: { x: number; y: number } | null = null;
    const hideTip = () => {
      const t = tipRef.current;
      if (t) t.style.opacity = "0";
    };
    const pick = () => {
      if (!pending || !props) return;
      const { x, y } = pending;
      pending = null;
      ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(fins, false)[0];
      hoverIdx = hit ? fins.indexOf(hit.object as THREE.Mesh) : -1;
      const t = tipRef.current;
      if (!t) return;
      if (hoverIdx < 0) return hideTip();
      const f = finData[hoverIdx];
      const u = props.unit === "ct" ? " ct" : props.unit;
      t.textContent = `${hhmm(f.start, props.timeZone)}–${hhmm(f.start + 1800_000, props.timeZone)}  ${f.price == null ? "not published yet" : `${f.price.toFixed(1)}${u}/kWh`}`;
      t.style.transform = `translate(${x + 14}px, ${y - 34}px)`;
      t.style.opacity = "1";
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const box = renderer.domElement.getBoundingClientRect();
      pending = { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const onLeave = () => {
      pending = null;
      hoverIdx = -1;
      hideTip();
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    // Hour labels follow the base as it turns.
    const labelPos = [0, 6, 12, 18].map((h) => {
      const a = (h / 24) * Math.PI * 2;
      return new THREE.Vector3(Math.sin(a) * (BASE_R + 0.42), 0.15, -Math.cos(a) * (BASE_R + 0.42));
    });

    let visible = true;
    let seen = false;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      needsFrame = true;
      // The fins rise the first time the object is actually seen, not while it waited off screen.
      if (visible && !seen) {
        seen = true;
        if (!reduce && performance.now() - animStart > 400) {
          for (const st of finState) st.from = 0.001;
          animStart = performance.now();
        }
      }
    });
    io.observe(el);

    // Frames are drawn on demand: every frame while the fins move or someone is turning the object,
    // every other frame for the slow idle turn, and not at all when nothing changes or it's off screen.
    let interacting = false;
    controls.addEventListener("start", () => (interacting = true));
    controls.addEventListener("end", () => (interacting = false));
    controls.addEventListener("change", () => (needsFrame = true));
    let frameNo = 0;
    let warmed = false;
    let raf = 0;
    const tmp = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // One warm-up frame even off screen: buffer uploads and the shadow pass happen now, not on scroll.
      if ((!visible || document.hidden) && warmed) return;
      frameNo++;
      const e = (t - animStart) / 1000;
      const animating = e < 0.9 + 0.75;
      if (animating) {
        for (let i = 0; i < FINS; i++) {
          const st = finState[i];
          const k = Math.max(0, Math.min(1, (e - st.delay) / 0.7));
          const ease = 1 - Math.pow(1 - k, 3);
          fins[i].scale.y = Math.max(0.001, st.from + (st.target - st.from) * ease);
        }
        renderer.shadowMap.needsUpdate = true;
        needsFrame = true;
      }
      const idleTurn = controls.autoRotate && !interacting && !animating;
      if (idleTurn && frameNo % 2) return;
      controls.update();
      pick();
      if (!needsFrame && !idleTurn) return;
      needsFrame = false;
      renderer.render(scene, camera);
      warmed = true;
      const w = W;
      const h = H;
      toCam.copy(camera.position).setY(0).normalize();
      labelPos.forEach((p, i) => {
        const n = labels.current[i];
        if (!n) return;
        // Labels on the far side would sit behind the fins: hide them.
        n.style.opacity = dir.copy(p).normalize().dot(toCam) < -0.35 ? "0" : "1";
        tmp.copy(p).project(camera);
        n.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -50%)`;
      });
    };
    // Tiny meshes out of sight carry every fin material, so all their shaders compile up front.
    for (const m of [graphite, ghost, cobalt, aluminium]) {
      const w = new THREE.Mesh(finGeo, m);
      w.position.set(0, -50, 0);
      w.scale.setScalar(0.001);
      scene.add(w);
    }
    // Compile shaders off the main thread where the browser allows it, then start drawing.
    let disposed = false;
    renderer
      .compileAsync(scene, camera)
      .catch(() => {})
      .finally(() => {
        if (!disposed) raf = requestAnimationFrame(tick);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
      [aluminium, brushed, cobalt, graphite, ghost, engraving, polished].forEach((m) => m.dispose());
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.update({ slots, now, timeZone, unit, highlight, label });
  }, [slots, now, timeZone, unit, highlight, label]);

  return (
    <div className={`${s.wrap} ${className ?? ""}`} role="img" aria-label={label}>
      <div ref={host} className={s.canvas} />
      {!failed &&
        ["00:00", "06:00", "12:00", "18:00"].map((h, i) => (
          <span key={h} ref={(n) => void (labels.current[i] = n)} className={s.hour} aria-hidden>
            {h}
          </span>
        ))}
      <span ref={tipRef} className={s.tip} style={{ opacity: 0 }} aria-hidden />
      {failed && <p className={s.fallback}>This browser can&apos;t draw 3D. The numbers under the ring are the same prices.</p>}
    </div>
  );
}
