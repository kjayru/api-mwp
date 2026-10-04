---
title: "Animaciones 3D y de scroll (React Three Fiber, GSAP, Lenis) sin sacrificar rendimiento"
slug: "animaciones-3d-y-scroll-sin-sacrificar-rendimiento"
excerpt: "Cómo pusimos un logo 3D de vidrio, scroll suave y física en la web de MWP sin castigar la carga: three.js diferido, calidad adaptativa, render en pausa fuera de pantalla y física sobre el DOM."
seoTitle: "Animaciones 3D y scroll sin sacrificar rendimiento"
seoDescription: "Three.js con next/dynamic tras comprobar WebGL y movimiento reducido, calidad adaptativa a 25 fps, Lenis en el ticker de GSAP y Matter.js sobre el DOM. CLS 0."
technologies: ["threejs", "gsap", "react", "nextjs"]
publishedAt: "2026-09-23"
---

En el rediseño de miwebprofesional.com quisimos movimiento de verdad: un logo MWP 3D de vidrio iridiscente en el hero, scroll suave, títulos que aparecen línea por línea y un pie de página donde las tecnologías caen como fichas que se pueden arrastrar. También teníamos un límite claro: nada de eso podía empeorar la carga, la accesibilidad ni la estabilidad visual. Este es el detalle de cómo lo hicimos.

## Primero el SVG, después el 3D

El hero siempre se renderiza en el servidor con el logo **estático en SVG**. Ocupa exactamente la misma caja que ocupará la versión 3D, así que no hay salto de diseño (CLS) cuando llega el canvas. Si el 3D nunca carga, el visitante ve un logo perfecto y no se pierde nada.

Sobre ese SVG montamos la versión 3D (React Three Fiber, drei y three.js) solo si se cumplen todas estas condiciones:

1. el usuario **no** pidió movimiento reducido (`prefers-reduced-motion`);
2. el navegador puede crear un contexto WebGL **acelerado por hardware**;
3. no tiene activado el ahorro de datos (`Save-Data`);
4. el hero está cerca de la ventana (`IntersectionObserver`).

```tsx
// three.js, R3F y drei viven solo en este chunk diferido (solo cliente).
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

`failIfMajorPerformanceCaveat` es la pieza clave. Los renderizadores por software (por ejemplo, SwiftShader o una GPU en lista negra) devuelven `null` con esa opción, y esos equipos se quedan con el SVG en lugar de un 3D a pocos cuadros por segundo. Como `next/dynamic` con `ssr: false` solo descarga el módulo cuando se renderiza, three.js nunca entra en el bundle común: quien no cumple las condiciones nunca lo descarga.

El movimiento reducido se lee con `useSyncExternalStore`, con `true` como valor en el servidor. Así el HTML del servidor y la hidratación siempre coinciden (logo estático) y el 3D solo aparece después, en el cliente.

### El cruce entre las dos versiones

Cuando el canvas pinta sus primeros tres cuadros, avisa con `onReady` y hacemos un fundido: el SVG baja a opacidad 0 y el canvas sube a 1. El SVG no se elimina: sigue en el DOM para los lectores de pantalla (el canvas es `aria-hidden`) y vuelve a mostrarse si WebGL falla o se pierde el contexto. Un *error boundary* alrededor del `Canvas` captura cualquier excepción de la escena y también devuelve el SVG.

## Calidad adaptativa y la trampa de los 30 fps

Hay dos materiales: `high` (`MeshTransmissionMaterial`, vidrio con refracción) y `low` (`MeshPhysicalMaterial` con *clearcoat* e iridiscencia, sin transmisión). Los dispositivos táctiles o con 4 núcleos o menos empiezan en `low`. Después, el propio bucle de render mide:

```ts
// Tras un calentamiento, mide el tiempo por cuadro cada 2 s.
// Lento (por debajo de 25 fps) con dpr 2: baja a dpr 1. Sigue lento: onStruggling
// (el padre pasa al material barato y, en último caso, abandona el 3D).
if (perf.time >= 2) {
  const average = perf.time / perf.frames;
  if (average > 1 / 25) {
    if (!perf.dprLowered && state.viewport.dpr > 1) {
      perf.dprLowered = true;
      setDpr(1);
    } else {
      onStruggling();
    }
    perf.warmup = 1; // dejar que se asienten los cambios antes de volver a medir
  }
  perf.time = 0;
  perf.frames = 0;
}
```

La primera versión usaba 30 fps como umbral, y nos llevamos una sorpresa: en Chrome con el **ahorro de batería** activado, `requestAnimationFrame` queda limitado a 30 fps. Con un umbral de 30, pequeñas variaciones por debajo bastaban para degradar el logo en equipos perfectamente capaces, que simplemente estaban ahorrando batería. Bajamos el umbral a **25 fps**: 30 fps estables se ven fluidos, y lo que queremos detectar son los equipos que de verdad no llegan.

## No renderizar lo que no se ve

Un canvas WebGL que sigue dibujando fuera de pantalla gasta GPU y batería para nada. React Three Fiber permite pausar el bucle con la prop `frameloop`:

```tsx
<Canvas
  aria-hidden="true"
  dpr={[1, 2]}
  frameloop={onScreen && pageVisible ? "always" : "never"}
  gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
  style={{ pointerEvents: "none" }}
>
```

`onScreen` viene de un `IntersectionObserver` sobre el hero, y `pageVisible` del evento `visibilitychange`. Como toda la animación se calcula a partir del `delta` de cada cuadro, al pausar el bucle también se detiene el giro, y al volver continúa donde estaba, sin saltos.

## Lenis sobre el ticker de GSAP

Para el scroll suave usamos Lenis, y para las animaciones ligadas al scroll, GSAP con ScrollTrigger. Si cada librería tuviera su propio `requestAnimationFrame`, irían desfasadas un cuadro. Por eso Lenis no tiene bucle propio (`autoRaf: false`) y se mueve con el ticker de GSAP:

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

El ticker de GSAP entrega el tiempo en segundos y Lenis lo espera en milisegundos, de ahí el `* 1000`. Con movimiento reducido Lenis no se inicia, y si la preferencia cambia mientras la página está abierta, se desmonta en vivo. Un `ResizeObserver` sobre el `body` llama a `ScrollTrigger.refresh()` cuando cambia la altura del contenido (imágenes que cargan, navegación), para que los disparadores no queden desplazados.

## Texto que se revela solo después de hidratar

Los títulos que aparecen línea por línea usan SplitText de GSAP, pero el servidor envía el texto **normal y visible**. La división en líneas se hace en el cliente, dentro de `useGSAP` (que corre después del montaje) y solo si no hay preferencia de movimiento reducido:

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

Esto tiene tres efectos: sin JavaScript el contenido se lee completo, el HTML hidratado coincide con el del servidor y, al terminar, `revert()` devuelve el DOM original para que el lector de pantalla no tropiece con decenas de `span`. Los títulos que se ven al cargar (como el del hero) usan animaciones solo con CSS, que funcionan antes de hidratar y no producen parpadeos.

## Física sobre el DOM, no en un canvas

En el pie, las tecnologías caen como fichas con Matter.js. La forma habitual sería pintarlas en un canvas, pero entonces el texto dejaría de ser texto. Nosotros hacemos otra cosa: la lista real (`ul` con un `li` por tecnología) siempre está en el HTML, y Matter.js solo calcula posiciones que aplicamos como `transform` a esos mismos elementos:

```ts
function render(force = false) {
  for (const pill of pills) {
    if (pill.body.isSleeping && !force) continue;
    const { x, y } = pill.body.position;
    pill.element.style.transform = `translate3d(${(x - pill.width / 2).toFixed(2)}px, ${(y - pill.height / 2).toFixed(2)}px, 0) rotate(${pill.body.angle.toFixed(4)}rad)`;
  }
}
```

Así mantenemos los estilos, la selección y la accesibilidad. El orden del DOM nunca cambia, así que un lector de pantalla lee la lista tal cual. Matter.js se importa de forma dinámica cuando el pie está a 400 px de aparecer, la simulación solo corre mientras es visible y se detiene sola cuando todas las fichas "duermen". Los listeners de ratón de Matter se sustituyen por eventos de puntero propios, para no secuestrar el scroll en pantallas táctiles.

## Lo que medimos

Con todo esto activo, el Lighthouse móvil de la portada (`/es`) dio:

| Métrica | Resultado |
|---|---|
| Performance | 88 |
| Accessibility | 96 |
| Best Practices | 100 |
| SEO | 100 |
| CLS | 0 |

Three.js y Matter.js quedan en chunks diferidos, fuera del bundle común. El CLS de 0 sale directamente de la decisión de "primero el SVG": nada cambia de tamaño cuando llega el 3D. Todavía hay margen en Performance, y lo seguiremos trabajando en la fase de rendimiento.

## En resumen

- Primero el SVG estático renderizado en el servidor y después, solo si conviene, el 3D con un fundido.
- three.js con `next/dynamic({ ssr: false })`, tras comprobar WebGL acelerado, movimiento reducido, Save-Data y visibilidad.
- Calidad adaptativa con umbral de 25 fps, porque el ahorro de batería de Chrome limita el rAF a 30.
- `frameloop="never"` fuera de pantalla o con la pestaña oculta.
- Lenis movido por el ticker de GSAP, sin bucles duplicados.
- SplitText solo después de hidratar, y física de Matter.js aplicada sobre elementos del DOM.

¿Quieres movimiento en tu web sin pagarlo en rendimiento ni en accesibilidad? Conversemos. Las referencias oficiales son la [documentación de React Three Fiber](https://r3f.docs.pmnd.rs/) y la de [ScrollTrigger de GSAP](https://gsap.com/docs/v3/Plugins/ScrollTrigger/).
