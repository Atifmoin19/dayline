import { extendTheme } from "@chakra-ui/react";

/**
 * TaskBoard Enterprise design system.
 *
 * Global rules (enforced here so components can't drift):
 *  - ONE font family everywhere (system sans, no remote load — CSP safe).
 *  - Exactly 4 distinct font sizes (0.75 / 0.875 / 1.125 / 1.5 rem). Emphasis comes from
 *    weight + color, never new sizes.
 *  - One brand blue accent + a neutral gray-blue scale. Semantic red/amber/green reserved
 *    for priority/status only.
 *  - Gradients + glassmorphism used sparingly for polish (brand surfaces, CTAs, elevated cards).
 */

const FONT_STACK =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Brand blue (single accent).
const brand = {
  50: "#eff5ff",
  100: "#dbe7fe",
  200: "#bfd3fe",
  300: "#93b4fd",
  400: "#608cfa",
  500: "#3b6bf6",
  600: "#2563eb", // primary accent
  700: "#1d4ed8",
  800: "#1e40af",
  900: "#1e3a8a",
};

// The one blue "glow" shadow — every solid brand button uses this (Create Task, Save Changes,
// the sidebar CTA, active view-toggle tabs, the FAB), so it never has to be redefined per call site.
const BRAND_GLOW = "0 8px 20px -4px rgba(37,99,235,0.3)";
const BRAND_GLOW_HOVER = "0 10px 24px -4px rgba(37,99,235,0.4)";

// Neutral gray-blue scale for surfaces / text / borders.
const neutral = {
  50: "#f5f7fa",
  100: "#eef1f6",
  200: "#e2e8f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
};

export const theme = extendTheme({
  config: { initialColorMode: "light", useSystemColorMode: false },
  fonts: {
    body: FONT_STACK,
    heading: FONT_STACK,
  },
  // Exactly 4 distinct sizes (bumped one notch up for readability); the standard Chakra keys
  // all map onto these 4 values.
  fontSizes: {
    xs: "0.8125rem", // caption / labels (13px)
    sm: "0.9375rem", // body (15px)
    md: "0.9375rem", // body (alias)
    lg: "1.1875rem", // section titles (19px)
    xl: "1.1875rem", // section titles (alias)
    "2xl": "1.625rem", // page headings (26px)
    "3xl": "1.625rem",
    "4xl": "1.625rem",
    "5xl": "1.625rem",
    "6xl": "1.625rem",
  },
  colors: {
    brand,
    neutral,
    surface: {
      page: "#f5f7fa",
      card: "#ffffff",
      border: "#e2e8f0",
    },
    // Preserved legacy tokens (still referenced in older components) — do not remove.
    primary: {
      "10": "#e1f5fe", "40": "#eceffa", "50": "#cee0f9", "100": "#adcbf6",
      "200": "#8db6f2", "300": "#6ca2ee", "400": "#4b8dea", "500": "#0d3772",
      "600": "#114793", "700": "#0d3772", "800": "#092752", "900": "#092752",
    },
    secondary: {
      "10": "#eaf8ff", "40": "#eaf8ff", "50": "#bfe9ff", "100": "#95dbff",
      "200": "#6acdff", "300": "#40beff", "400": "#15b0ff", "500": "#009bea",
      "600": "#007fbf", "700": "#006295", "800": "#00466a", "900": "#002a40",
    },
    appGrey: "#8A8B8B",
    appDarkGrey: "#E8E8E8",
    warning: "#D0342C",
  },
  radii: {
    card: "1rem",
    pill: "9999px",
  },
  shadows: {
    card: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
    cardHover: "0 8px 24px rgba(15,23,42,0.10)",
    glass: "0 8px 32px rgba(15,23,42,0.10)",
  },
  // Reusable gradients — sparing, for brand surfaces / CTAs only.
  // (referenced via bgGradient="var(--chakra-... )" is awkward, so expose as plain values)
  styles: {
    global: {
      "html, body, #root": {
        bg: "surface.page",
        color: "neutral.800",
        fontFamily: FONT_STACK,
        fontSize: "sm",
        // Safety net: an absolutely-positioned tooltip/popover that computes past the true
        // viewport edge (e.g. near a horizontally-scrollable container, whose scrollWidth can
        // become Popper's clipping boundary instead of the viewport) must never grow the page's
        // own horizontal scrollbar. Nested elements keep their own overflow-x scrolling as-is.
        overflowX: "hidden",
        // Explicit (not left to the UA's overflow-x/-y coupling, which would silently compute
        // this to "auto"): an "auto" #root never actually overflows internally (it just sizes to
        // content), but IS the nearest scrolling ancestor for any `position:sticky` element inside
        // it (e.g. Header) — so sticky locks onto a box that never scrolls, while the real scroll
        // happens one level up on body/html, and the header scrolls away instead of sticking.
        overflowY: "visible",
      },
      "*::selection": { bg: "brand.100" },
      // Thin, unobtrusive scrollbars.
      "::-webkit-scrollbar": { width: "10px", height: "10px" },
      "::-webkit-scrollbar-thumb": {
        background: "#cbd5e1",
        borderRadius: "9999px",
        border: "2px solid transparent",
        backgroundClip: "content-box",
      },
    },
  },
  components: {
    Heading: {
      baseStyle: { fontWeight: 700, color: "neutral.900", letterSpacing: "-0.01em" },
      // Cap heading sizes to the 4-size scale.
      sizes: {
        xs: { fontSize: "sm" },
        sm: { fontSize: "lg" },
        md: { fontSize: "lg" },
        lg: { fontSize: "2xl" },
        xl: { fontSize: "2xl" },
        "2xl": { fontSize: "2xl" },
      },
      defaultProps: { size: "md" },
    },
    Text: {
      baseStyle: { fontSize: "sm", color: "neutral.700" },
    },
    Card: {
      baseStyle: {
        container: {
          bg: "surface.card",
          borderRadius: "card",
          borderWidth: "1px",
          borderColor: "surface.border",
          boxShadow: "card",
        },
      },
      variants: {
        glass: {
          container: {
            bg: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(14px)",
            borderRadius: "card",
            borderWidth: "1px",
            borderColor: "rgba(255,255,255,0.6)",
            boxShadow: "glass",
          },
        },
      },
    },
    Badge: {
      baseStyle: {
        borderRadius: "pill",
        px: 2.5,
        py: 1,
        fontSize: "xs",
        fontWeight: 600,
        textTransform: "none",
      },
    },
    // Every plain Select/Input/Textarea/NumberInput field shares one rounded look (0.75rem,
    // same as AssigneePicker's combobox button) so dropdowns and text fields never drift into
    // the browser-default squared corners depending on which screen/form they're used in.
    Select: {
      baseStyle: { field: { borderRadius: "0.75rem" } },
    },
    Input: {
      baseStyle: { field: { borderRadius: "0.75rem" } },
    },
    Textarea: {
      baseStyle: { borderRadius: "0.75rem" },
    },
    NumberInput: {
      baseStyle: { field: { borderRadius: "0.75rem" } },
    },
    Button: {
      baseStyle: { borderRadius: "0.6rem", fontWeight: 600 },
      defaultProps: { colorScheme: "brand" },
      variants: {
        // Every solid brand button gets the same blue glow (Create Task, Save Changes, the
        // sidebar CTA, etc.) — one place so it can't drift between surfaces again.
        solid: (props: { colorScheme?: string }) =>
          !props.colorScheme || props.colorScheme === "brand"
            ? {
                boxShadow: BRAND_GLOW,
                _hover: { boxShadow: BRAND_GLOW_HOVER, filter: "brightness(1.05)" },
                _active: { transform: "scale(0.97)" },
              }
            : {},
      },
    },
  },
  breakpoints: {
    xs: "300px", sm: "576px", md: "768px", lg: "992px",
    xl: "1200px", "2xl": "1400px", "3xl": "1600px", "4xl": "1900px",
  },
});

// Re-exported for the handful of non-<Button> brand-blue elements that need the exact same
// glow inline (the FAB, the dashboard view-toggle's active tab) — the Button theme above
// already applies it automatically to every plain solid brand <Button>.
export { BRAND_GLOW, BRAND_GLOW_HOVER };

// Brand gradient constants (import where a subtle gradient accent is wanted).
export const BRAND_GRADIENT = "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)";
export const HERO_GRADIENT = "linear-gradient(135deg, #eff5ff 0%, #f5f7fa 60%)";
// Rich brand hero (for the dashboard welcome banner) + soft accent gradients for KPI tiles.
export const HERO_BRAND_GRADIENT =
  "linear-gradient(120deg, #1d4ed8 0%, #2563eb 45%, #3b6bf6 100%)";
export const STAT_GRADIENTS: Record<string, string> = {
  blue: "linear-gradient(135deg, #eff5ff 0%, #dbe7fe 100%)",
  indigo: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
  emerald: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
  amber: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
  rose: "linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)",
  violet: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
};
