---
title: "3D and scroll animations (React Three Fiber, GSAP, Lenis) without sacrificing performance"
slug: "3d-and-scroll-animations-without-sacrificing-performance"
excerpt: "How we added a glass 3D logo, smooth scrolling and physics to the MWP site without hurting load: deferred three.js, adaptive quality, rendering paused off-screen and physics on DOM nodes."
seoTitle: "3D and scroll animations without sacrificing performance"
seoDescription: "three.js via next/dynamic after WebGL and reduced-motion checks, adaptive quality at 25 fps, Lenis on the GSAP ticker and Matter.js driving DOM nodes. CLS 0."
technologies: ["threejs", "gsap", "react", "nextjs"]
publishedAt: "2026-09-23"
---

For the miwebprofesional.com redesign we wanted real motion: an iridescent glass MWP logo in 3D in the hero, smooth scrolling, headings that reveal line by line, and a footer where our technologies drop in as pills you can drag around. We also had a hard limit: none of it could make loading, accessibility or visual stability worse. Here's how we pulled it off.

## SVG first, 3D second

The hero is always server-rendered with the **static SVG** logo. It fills exactly the same box the 3D version will, so there's no layout shift (CLS) when the canvas arrives. If the 3D version never loads, visitors still see a crisp logo and lose nothing.

We only mount the 3D version (React Three Fiber, drei and three.js) on top of that SVG when every one of these holds:

1. the user has **not** asked for reduced motion (`prefers-reduced-motion`);
2. the browser can create a **hardware-accelerated** WebGL context;
3. data saving (`Save-Data`) is off;
4. the hero is near the viewport (`IntersectionObserver`).

```tsx
// three.js, R3F and drei live only in this lazily loaded chunk (client-only).
const HeroLogo3D = dynamic(() => import("./HeroLogo3D"), { ssr: false });

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const options: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const context = canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options);
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
```

`failIfMajorPerformanceCaveat` does the heavy lifting. Software renderers (SwiftShader, or a blocklisted GPU) return `null` with that flag, so those machines keep the SVG instead of getting a 3D scene at a handful of frames per second. And since `next/dynamic` with `ssr: false` only downloads the module when it actually renders, three.js never lands in the shared bundle. Visitors who don't qualify never download it.

Reduced motion is read through `useSyncExternalStore`, with `true` as the server value. That way, server HTML and hydration always agree (static logo), and the 3D version only appears afterwards, on the client.

### The cross-fade

Once the canvas has painted its first three frames, it fires `onReady` and we cross-fade: the SVG goes to opacity 0 and the canvas to 1. The SVG isn't removed. It stays in the DOM for screen readers (the canvas is `aria-hidden`) and comes back if WebGL fails or the context is lost. An error boundary around the `Canvas` catches anything the scene throws and falls back to the SVG as well.

## Adaptive quality, and the 30 fps trap

There are two materials: `high` (`MeshTransmissionMaterial`, refractive glass) and `low` (`MeshPhysicalMaterial` with clearcoat and iridescence, no transmission). Touch devices and machines with 4 cores or fewer start on `low`. From there, the render loop measures itself:

```ts
// After a warm-up, sample the frame time every 2 s.
// Slow (under 25 fps) at dpr 2 -> drop to dpr 1. Still slow -> onStruggling
// (the parent switches to the cheaper material, then gives up on 3D).
if (perf.time >= 2) {
  const average = perf.time / perf.frames;
  if (average > 1 / 25) {
    if (!perf.dprLowered && state.viewport.dpr > 1) {
      perf.dprLowered = true;
      setDpr(1);
    } else {
      onStruggling();
    }
    perf.warmup = 1; // let the new settings settle before judging again
  }
  perf.time = 0;
  perf.frames = 0;
}
```

Our first version used 30 fps as the threshold, and it surprised us. With Chrome's **battery saver** on, `requestAnimationFrame` is capped at 30 fps. With a 30 fps bar, tiny dips below the cap were enough to downgrade the logo on perfectly capable laptops that were simply saving power. We lowered the threshold to **25 fps**. A steady 30 fps looks smooth, and what we actually want to catch is hardware that genuinely can't keep up.

## Don't render what nobody sees

A WebGL canvas that keeps drawing off-screen burns GPU and battery for nothing. React Three Fiber lets you pause the loop with the `frameloop` prop:

```tsx
<Canvas
  aria-hidden="true"
  dpr={[1, 2]}
  frameloop={onScreen && pageVisible ? "always" : "never"}
  gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
  style={{ pointerEvents: "none" }}
>
```

`onScreen` comes from an `IntersectionObserver` on the hero, and `pageVisible` from the `visibilitychange` event. All the animation is driven by each frame's `delta`, so pausing the loop also pauses the spin, and it resumes exactly where it left off.

## Lenis on the GSAP ticker

Smooth scrolling comes from Lenis, and scroll-linked animations come from GSAP with ScrollTrigger. If each library ran its own `requestAnimationFrame` loop, they'd drift a frame apart. So Lenis gets no loop of its own (`autoRaf: false`) and is driven by GSAP's ticker:

```ts
const lenis = new Lenis({
  autoRaf: false,
  anchors: false,
  stopInertiaOnNavigate: true,
  lerp: 0.1,
});

lenis.on("scroll", ScrollTrigger.update);
const tick = (time: number) => lenis.raf(time * 1000);
gsap.ticker.add(tick);
gsap.ticker.lagSmoothing(0);
```

GSAP's ticker reports time in seconds and Lenis expects milliseconds, hence the `* 1000`. Under reduced motion Lenis never starts, and if the preference changes while the page is open, it's torn down live. A `ResizeObserver` on `body` calls `ScrollTrigger.refresh()` whenever content height changes (images loading, client navigation), so triggers don't end up misplaced.

## Text reveals only after hydration

Headings that reveal line by line use GSAP's SplitText, but the server sends **plain, fully visible** text. The split happens on the client, inside `useGSAP` (which runs after mount), and only when there's no reduced-motion preference:

```ts
const mm = gsap.matchMedia();
mm.add("(prefers-reduced-motion: no-preference)", () => {
  const split = SplitText.create(element, {
    type: "lines",
    mask: "lines",
    aria: "none",
    autoSplit: true,
    onSplit: (self) =>
      gsap.from(self.lines, {
        yPercent: 115,
        stagger: 0.09,
        scrollTrigger: { trigger: element, start: "top 88%", once: true },
        onComplete: () => self.revert(),
      }),
  });
  return () => split.revert();
});
```

That buys three things. Without JavaScript, the content reads in full. Hydrated HTML matches the server HTML. And once the animation finishes, `revert()` restores the original DOM, so screen readers don't trip over dozens of `span` elements. Headings that are visible on load (like the hero title) use CSS-only animations, which run before hydration and never flash.

## Physics on DOM nodes, not a canvas

In the footer, our technologies drop in as pills powered by Matter.js. The usual approach would be to draw them on a canvas, but then the text would stop being text. We do it differently. The real list (a `ul` with one `li` per technology) is always in the HTML, and Matter.js only computes positions that we apply as `transform` on those same elements:

```ts
function render(force = false) {
  for (const pill of pills) {
    if (pill.body.isSleeping && !force) continue;
    const { x, y } = pill.body.position;
    pill.element.style.transform = `translate3d(${(x - pill.width / 2).toFixed(2)}px, ${(y - pill.height / 2).toFixed(2)}px, 0) rotate(${pill.body.angle.toFixed(4)}rad)`;
  }
}
```

Styles, text selection and accessibility all survive. DOM order never changes, so a screen reader reads the list as written. Matter.js is imported dynamically once the footer is within 400 px of the viewport. The simulation only runs while it's visible, and it stops on its own once every pill is asleep. We also replace Matter's mouse listeners with our own pointer events, so touch scrolling never gets hijacked.

## What we measured

With all of this switched on, a mobile Lighthouse run on the home page (`/es`) gave us:

| Metric | Result |
|---|---|
| Performance | 88 |
| Accessibility | 96 |
| Best Practices | 100 |
| SEO | 100 |
| CLS | 0 |

three.js and Matter.js stay in deferred chunks, out of the shared bundle. The CLS of 0 follows directly from "SVG first": nothing changes size when the 3D version arrives. There's still room to improve Performance, and we'll keep at it in our performance phase.

## In short

- The static SVG is server-rendered first, and the 3D version cross-fades in only when it makes sense.
- three.js loads through `next/dynamic({ ssr: false })` after checking for accelerated WebGL, reduced motion, Save-Data and visibility.
- Adaptive quality uses a 25 fps threshold, because Chrome's battery saver caps rAF at 30.
- `frameloop="never"` while off-screen or in a hidden tab.
- Lenis runs on GSAP's ticker, so there are no duplicate loops.
- SplitText runs only after hydration, and Matter.js physics drives real DOM elements.

Want motion on your site without paying for it in performance or accessibility? Let's talk. The official references are the [React Three Fiber docs](https://r3f.docs.pmnd.rs/) and [GSAP's ScrollTrigger docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/).
