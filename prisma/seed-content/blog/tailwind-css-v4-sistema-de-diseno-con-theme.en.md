---
title: "Tailwind CSS v4: a design system built on @theme"
slug: "tailwind-css-v4-design-system-with-theme"
excerpt: "How we built the miwebprofesional design system on Tailwind v4: semantic tokens in @theme, brand-only colors, fluid type with clamp() and contrast checked against WCAG AA."
seoTitle: "Tailwind CSS v4 and @theme: our design system"
seoDescription: "Semantic tokens with @theme, --color-*: initial, fluid display sizes with clamp(), next/font families and AA contrast decisions in Tailwind CSS v4."
technologies: ["tailwind-css", "nextjs"]
publishedAt: "2026-08-20"
---

When we redesigned miwebprofesional.com we set ourselves one rule: every color, size and easing curve on the site has to come from a named token. Tailwind CSS v4 made that easy, because theme configuration no longer lives in a JavaScript file. It lives in the CSS itself, inside an `@theme` block. Here is how we organized it and the calls we made along the way.

## Configuration is CSS now

There is no `tailwind.config.js` in v4. The project (Next.js 16 with the `@tailwindcss/postcss` plugin) imports Tailwind and our tokens from `globals.css`:

```css
@import "tailwindcss";
@import "../styles/tokens.css";
```

Every variable declared in `@theme` does two jobs. It becomes a regular CSS custom property (`--color-ink`, available on `:root`), and it generates the matching utilities (`text-ink`, `bg-ink`, `border-ink` and so on). One value feeds both the class names and any hand-written CSS, with nothing duplicated.

## Semantic tokens, not color names

We have no `blue-500` and no `gray-900`. Our names describe **what** a color is for:

```css
@theme {
  /* Drop Tailwind's default palette so only brand tokens exist. */
  --color-*: initial;

  /* Surfaces */
  --color-bg: #0e0e0d;
  --color-bg-deep: #090908;
  --color-bg-raise: #131311;

  /* Text */
  --color-ink: #ece9e2;
  --color-ink-dim: #8d8a83;
  --color-ink-faint: #3a3936;

  /* Hairlines */
  --color-line: rgb(236 233 226 / 0.12);

  /* Accent (our blue) */
  --color-accent: #1ca3ec;
  --color-accent-soft: #74ccf4;
  --color-accent-deep: #122755;
}
```

The palette is a hybrid of warm neutrals for surfaces and text, with the brand blue as the only accent. With semantic names, a component asks for `text-ink-dim` rather than "gray 500". If we retune secondary text next month, we change one line.

### `--color-*: initial`: only our colors exist

The most important line in that block is the first one. `--color-*: initial` clears Tailwind's entire default color namespace, so `bg-red-500` simply generates nothing. In practice that buys us two things:

- an off-brand color can't sneak into a pull request unnoticed;
- editor autocomplete only suggests valid tokens.

The same idea applies to other namespaces. Beyond colors, our `@theme` defines radii (`--radius-pill`, `--radius-card`), the content width (`--container-site: 90rem`, which gives us the `max-w-site` utility), the brand easing curve (`--ease-out`) and the animations with their `@keyframes`.

## Fluid display type with `clamp()`

Huge headings are part of the site's identity, and they have to hold up at 375 px as well as at 1440 px. Instead of chaining breakpoints (`text-6xl md:text-8xl lg:text-9xl`), we define fluid sizes as tokens, each with its own line height and letter spacing:

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

Thanks to the `--text-NAME--line-height` convention, a single `text-display-xl` class sets size, leading and tracking. `clamp()` gives a readable floor on phones and a ceiling on large screens, and in between the size scales with the viewport.

There is one thing `clamp()` can't solve on its own. A very long word ("Technologies") can still overflow its container at a reasonable size. For that we have a small helper, `fitFontSize()`, which returns `min(MAX, calc(100cqi / WIDTH))`, where `MAX` is the ceiling and `WIDTH` the word width in em, from measured font widths. The token stays the ceiling, and the helper only shrinks it when it has to.

## Fonts: wiring `next/font` into the theme

We use four Google Fonts families: Bricolage Grotesque for headings, Instrument Serif for the italic accent words, Geist for body copy and Geist Mono for labels. `next/font/google` downloads them at build time and serves them from our own domain, so there are no runtime requests to Google:

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

// Geist and Geist Mono follow the same pattern.
```

The `variable` option makes each font expose a CSS variable through a class name, which we put on the layout's `html` element (`className={fontVariables}`). The `latin` subset already covers the Spanish characters we need (á, é, ñ, ¿, ¡).

What's left is connecting those variables to Tailwind's `font-*` utilities, which is what `@theme inline` is for:

```css
@theme inline {
  --font-display: var(--font-bricolage), ui-sans-serif, system-ui, sans-serif;
  --font-serif: var(--font-instrument-serif), ui-serif, Georgia, serif;
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}
```

The `inline` keyword matters. It tells Tailwind to write the value straight into the utility (`font-family: var(--font-bricolage), …`) instead of pointing at `--font-display`. Without it, the theme variable resolves where the theme is declared rather than where the class is used, which causes surprises if one of those variables changes further down the tree. The Tailwind docs recommend `inline` for any token that references another variable.

## Custom utilities with `@utility`

Anything that isn't a token but keeps repeating becomes a utility. The italic serif words inside headings are one example:

```css
@utility serif-accent {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
}
```

Utilities declared with `@utility` work with variants (`md:serif-accent`, `hover:…`) just like built-in classes.

## AA contrast is decided in the tokens

We don't leave accessibility for a final review. We decide it when we define the palette. `tokens.css` records the contrast of each text token against the `#0e0e0d` background:

| Token | Contrast on `bg` | Allowed use |
|---|---|---|
| `ink` | 15.9:1 | Any text |
| `ink-dim` | 5.6:1 | Body and secondary text (clears AA's 4.5:1) |
| `accent` | 6.9:1 | Links and accents |
| `accent-soft` | 10.8:1 | Accents on dark surfaces |
| `ink-faint` | 1.7:1 | Decoration only: rules and ghost numbers, never text |

The last row is the key decision. `ink-faint` earns its place visually, but it fails every contrast level, so it must never carry information. When decorative text repeats something already on the page, we hide it from screen readers:

```tsx
export function OutlineText({ children, as: Tag = "span", decorative = false, className }: OutlineTextProps) {
  return (
    <Tag className={cn("ol", className)} aria-hidden={decorative || undefined}>
      {children}
    </Tag>
  );
}
```

A giant outlined "404", for instance, is marked `decorative` because the real "Page not found" label sits right next to it. We also write down the combinations that **don't** work. On the light `ink` strip, neither `accent` nor `ink-dim` reaches the minimum, so the accent switches to `accent-deep` there.

Finally, `globals.css` respects system preferences. Under `prefers-reduced-motion: reduce`, the token animations are switched off. Under `forced-colors: active`, outlined text goes back to solid `CanvasText`.

## In short

- In Tailwind v4 the theme is CSS: `@theme` generates both custom properties and utilities.
- `--color-*: initial` leaves only brand colors and keeps stray colors out.
- The display sizes are fluid `clamp()` tokens that carry their own line height and tracking.
- `next/font` self-hosts the fonts, and `@theme inline` maps them to `font-*`.
- Contrast is decided in the tokens: each token has an allowed use, and decorative text gets `aria-hidden`.

If you're building a design system on Tailwind v4, or migrating one, we'd be glad to talk it through: these are the exact pieces we use at MWP. The official reference is the [Tailwind CSS theme documentation](https://tailwindcss.com/docs/theme).
