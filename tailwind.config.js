/** @type {import('tailwindcss').Config} */

// The Grove: parchment, canopy green and an old orangutan's orange, in a light
// and a dark mode. Every colour is a CSS variable declared twice in
// `src/index.css` — once on `:root` (light) and once under `[data-theme="dark"]`
// — so a component names a role and never a mode. The token names predate the
// two modes and are kept because three hundred call sites already say what each
// colour is *for*:
//
//   ledger / panel / panel-raised / edge   the page, cards, raised bands, hairlines
//   sheet / sheet-alt / band / rule        data rows, zebra, subtotals, hairlines
//   chalk / chalk-soft, ink / ink-soft     text on the first set and the second
//
// In both modes the two surfaces are the same lightness, so `chalk` and `ink`
// are the same colour; the pairs survive so a future mode can pull them apart
// again without touching a component.
//
// Each variable holds bare RGB channels so Tailwind's opacity modifiers
// (`border-vermilion/60`) keep working.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ledger: token("ledger"), // app background
        panel: token("panel"), // cards
        "panel-raised": token("panel-raised"), // header bands, hover
        edge: token("edge"), // hairline around cards

        sheet: token("sheet"), // data rows
        "sheet-alt": token("sheet-alt"), // zebra row
        band: token("band"), // group and subtotal rows
        rule: token("rule"), // hairline between rows

        ink: token("ink"), // text on the data rows
        "ink-soft": token("ink-soft"),
        chalk: token("chalk"), // text on the page and cards
        "chalk-soft": token("chalk-soft"),

        // The header is the canopy in both modes — the one surface that does
        // not follow the page — so it has tokens of its own, and `coin` is the
        // active-tab underline drawn on it.
        canopy: token("canopy"),
        "on-canopy": token("on-canopy"),
        "on-canopy-soft": token("on-canopy-soft"),
        coin: token("coin"),
        // The one warning colour that sits on the canopy — the unsent-edits
        // badge — and so is tuned for that green, not for the page.
        "on-canopy-rust": token("on-canopy-rust"),

        // The primary action and its label. Green like income, but a token of
        // its own: `azure` is also a bucket colour beside `verdant` on the plan's
        // split, and the two have to stay apart there.
        action: token("action"),
        "on-action": token("on-action"),

        azure: token("azure"), // figures, links, the essentials bucket
        verdant: token("verdant"), // income, under budget, yes
        vermilion: token("vermilion"), // spending, over budget, no
        sulfur: token("sulfur"), // caution, the selected segment
        "vermilion-ink": token("vermilion-ink"), // destructive actions on rows

        // The net-worth series, and the only colours chosen by measurement. A
        // stacked chart is read by telling its bands apart, so the four (cash is
        // `verdant`, debt `vermilion`) are checked all-pairs, and against the
        // card they sit on, in both modes: CIEDE2000 under normal vision and
        // under simulated protan and deutan (Machado 2009, full severity).
        // Worst pair 12.4 in light and 12.6 in dark, where Gotham's four scored
        // 8.5 by the same measure. `invested` and `property` differ in lightness
        // as well as hue, which is what carries them under protanopia.
        // **Changing one of these four means re-running the check on all four,
        // in both modes.** The legend, the direct label and the table view stay
        // regardless — colour is never the only channel.
        invested: token("invested"),
        property: token("property"),
      },
      fontFamily: {
        // Young Serif is for the few words that name a place — the app and each
        // page title — and nothing that has to be scanned. DM Sans carries the
        // structure, and the figures stay in Plex Mono.
        display: ["'Young Serif'", "Georgia", "serif"],
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        // A dense scale — this is a data tool, not a marketing page.
        label: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.08em" }],
        row: ["0.8125rem", { lineHeight: "1.25rem" }],
        figure: ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.01em" }],
      },
    },
  },
  plugins: [],
};
