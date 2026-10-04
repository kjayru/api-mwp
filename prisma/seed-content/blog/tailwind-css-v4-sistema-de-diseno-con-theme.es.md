---
title: "Tailwind CSS v4: un sistema de diseño con @theme"
slug: "tailwind-css-v4-sistema-de-diseno-con-theme"
excerpt: "Cómo armamos el sistema de diseño de miwebprofesional con Tailwind v4: tokens semánticos en @theme, solo colores de marca, tipografía fluida con clamp() y contraste AA comprobado."
seoTitle: "Tailwind CSS v4 y @theme: nuestro sistema de diseño"
seoDescription: "Tokens semánticos con @theme, --color-*: initial, tamaños fluidos con clamp(), fuentes de next/font y decisiones de contraste AA en Tailwind CSS v4."
technologies: ["tailwind-css", "nextjs"]
publishedAt: "2026-08-20"
---

Cuando rediseñamos miwebprofesional.com teníamos una regla: cualquier color, tamaño o curva de animación que aparezca en la web tiene que salir de un token con nombre. Tailwind CSS v4 nos lo puso fácil, porque la configuración del tema ya no vive en un archivo JavaScript sino en el propio CSS, dentro de un bloque `@theme`. En este artículo contamos cómo lo organizamos y qué decisiones tomamos por el camino.

## La configuración ahora es CSS

En v4 no hay `tailwind.config.js`. El proyecto (Next.js 16 con el plugin `@tailwindcss/postcss`) importa Tailwind y nuestros tokens desde `globals.css`:

```css
@import "tailwindcss";
@import "../styles/tokens.css";
```

Cada variable que declaramos en `@theme` hace dos cosas a la vez: crea una variable CSS normal (`--color-ink`, disponible en `:root`) y genera las utilidades correspondientes (`text-ink`, `bg-ink`, `border-ink`…). Así el mismo valor sirve para las clases y para el CSS escrito a mano, sin duplicarlo.

## Tokens semánticos, no nombres de color

No tenemos `blue-500` ni `gray-900`. Tenemos nombres que describen **para qué** se usa cada color:

```css
@theme {
  /* Sin la paleta por defecto de Tailwind: solo existen los tokens de marca. */
  --color-*: initial;

  /* Superficies */
  --color-bg: #0e0e0d;
  --color-bg-deep: #090908;
  --color-bg-raise: #131311;

  /* Texto */
  --color-ink: #ece9e2;
  --color-ink-dim: #8d8a83;
  --color-ink-faint: #3a3936;

  /* Líneas finas */
  --color-line: rgb(236 233 226 / 0.12);

  /* Acento (nuestro azul) */
  --color-accent: #1ca3ec;
  --color-accent-soft: #74ccf4;
  --color-accent-deep: #122755;
}
```

La paleta es híbrida: neutros cálidos para fondos y texto, y el azul de la marca como único acento. Con nombres semánticos, un componente dice `text-ink-dim` y no "gris 500". Si mañana ajustamos el tono del texto secundario, se cambia en un solo lugar.

### `--color-*: initial`: solo existen nuestros colores

La línea más importante del bloque es la primera. `--color-*: initial` borra todo el espacio de nombres de colores por defecto de Tailwind. A partir de ahí, `bg-red-500` simplemente no genera nada. Esto tiene dos ventajas prácticas:

- nadie del equipo puede "colar" un color fuera de la marca sin que se note en la revisión;
- el autocompletado del editor solo sugiere los tokens válidos.

El mismo patrón sirve para otros espacios de nombres. Además de colores, en `@theme` definimos radios (`--radius-pill`, `--radius-card`), el ancho máximo del contenido (`--container-site: 90rem`, que da la utilidad `max-w-site`), la curva de animación de la marca (`--ease-out`) y las animaciones con sus `@keyframes`.

## Tipografía fluida con `clamp()`

Los títulos gigantes son parte de la identidad del sitio, y tienen que funcionar igual a 375 px que a 1440 px. En lugar de encadenar breakpoints (`text-6xl md:text-8xl lg:text-9xl`), definimos tamaños fluidos como tokens, con su interlineado y su espaciado entre letras:

```css
@theme {
  --text-display-xl: clamp(4rem, 2.4rem + 11vw, 12.5rem);
  --text-display-xl--line-height: 0.9;
  --text-display-xl--letter-spacing: -0.04em;

  --text-display-lg: clamp(3.5rem, 1.6rem + 10vw, 11rem);
  --text-display-lg--line-height: 0.9;
  --text-display-lg--letter-spacing: -0.04em;

  --text-display-md: clamp(3.5rem, 1.4rem + 7.4vw, 8.5rem);
  --text-display-md--line-height: 0.92;
  --text-display-md--letter-spacing: -0.035em;
}
```

Con la convención `--text-NOMBRE--line-height`, la clase `text-display-xl` aplica tamaño, interlineado y tracking en una sola utilidad. `clamp()` garantiza un mínimo legible en móvil y un techo en pantallas grandes, y entre ambos el tamaño crece con el ancho de la ventana.

Hay un caso que `clamp()` no resuelve: una palabra muy larga ("Technologies") puede desbordar su contenedor aunque el tamaño sea razonable. Para eso tenemos una función, `fitFontSize()`, que calcula `min(MAX, calc(100cqi / ANCHO))`, donde `MAX` es el tamaño máximo y `ANCHO` el ancho de la palabra en em, a partir de anchos medidos de la fuente. El token sigue siendo el techo y la función solo lo reduce cuando hace falta.

## Fuentes: `next/font` conectado al tema

Usamos cuatro familias de Google Fonts: Bricolage Grotesque para los títulos, Instrument Serif para las palabras de acento en cursiva, Geist para el texto y Geist Mono para etiquetas. `next/font/google` las descarga en el build y las sirve desde nuestro propio dominio, sin peticiones a Google en tiempo de ejecución:

```ts
import { Bricolage_Grotesque, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-bricolage",
  display: "swap",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

// Geist y Geist Mono siguen el mismo patrón.
```

La opción `variable` hace que cada fuente exponga una variable CSS a través de una clase, que ponemos en el elemento `html` del layout (`className={fontVariables}`). El subconjunto `latin` ya incluye á, é, ñ, ¿ y ¡, así que no necesitamos más.

Falta conectar esas variables con las utilidades `font-*` de Tailwind. Para eso usamos `@theme inline`:

```css
@theme inline {
  --font-display: var(--font-bricolage), ui-sans-serif, system-ui, sans-serif;
  --font-serif: var(--font-instrument-serif), ui-serif, Georgia, serif;
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}
```

La palabra `inline` importa: le dice a Tailwind que escriba el valor directamente en la utilidad (`font-family: var(--font-bricolage), …`) en lugar de una referencia a `--font-display`. Sin ella, la variable del tema se resolvería donde se declara el tema y no donde se usa la clase, lo que da sorpresas si alguna de esas variables cambia más abajo en el árbol. Es lo que recomienda la documentación de Tailwind para los tokens que apuntan a otras variables.

## Utilidades propias con `@utility`

Lo que no es un token pero se repite se convierte en utilidad. Por ejemplo, las palabras en serif cursiva dentro de los títulos:

```css
@utility serif-accent {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
}
```

Las utilidades declaradas con `@utility` funcionan con variantes (`md:serif-accent`, `hover:…`) como cualquier clase nativa.

## Contraste AA: decidirlo en los tokens

La accesibilidad no se revisa al final: se decide al definir la paleta. Anotamos en el mismo `tokens.css` el contraste de cada token de texto sobre el fondo `#0e0e0d`:

| Token | Contraste sobre `bg` | Uso permitido |
|---|---|---|
| `ink` | 15,9:1 | Cualquier texto |
| `ink-dim` | 5,6:1 | Texto de cuerpo y secundario (supera el 4,5:1 de AA) |
| `accent` | 6,9:1 | Enlaces y acentos |
| `accent-soft` | 10,8:1 | Acentos sobre fondos oscuros |
| `ink-faint` | 1,7:1 | Solo decoración: líneas y números fantasma, nunca texto |

Esa última fila es la decisión clave. `ink-faint` es útil para la estética, pero no cumple ningún nivel de contraste, así que nunca debe llevar información. Cuando un texto decorativo repite algo que ya está en la página, lo ocultamos a los lectores de pantalla:

```tsx
export function OutlineText({ children, as: Tag = "span", decorative = false, className }: OutlineTextProps) {
  return (
    <Tag className={cn("ol", className)} aria-hidden={decorative || undefined}>
      {children}
    </Tag>
  );
}
```

Un "404" gigante en contorno, por ejemplo, va con `decorative`, porque al lado está el texto real "Página no encontrada". También documentamos las combinaciones que **no** funcionan. Sobre la franja clara (`ink`), `accent` e `ink-dim` no alcanzan el mínimo, así que ahí el acento pasa a ser `accent-deep`.

Por último, en `globals.css` respetamos las preferencias del sistema: con `prefers-reduced-motion: reduce` se desactivan las animaciones de los tokens, y con `forced-colors: active` el texto en contorno vuelve a ser texto sólido con `CanvasText`.

## En resumen

- En Tailwind v4 el tema es CSS: `@theme` genera a la vez variables y utilidades.
- `--color-*: initial` deja solo los colores de la marca y evita colores sueltos.
- Los tamaños `display` son tokens fluidos con `clamp()`, con su interlineado y tracking incluidos.
- `next/font` sirve las fuentes desde nuestro dominio, y `@theme inline` las conecta con `font-*`.
- El contraste se decide en los tokens: cada uno tiene un uso permitido, y el texto decorativo va con `aria-hidden`.

Si estás armando o migrando un sistema de diseño a Tailwind v4, conversemos: en MWP lo hemos hecho con estas mismas piezas. La referencia oficial está en la [documentación de temas de Tailwind CSS](https://tailwindcss.com/docs/theme).
