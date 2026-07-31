import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "periwinkle desk" — tinted light atmosphere, floating white cards
        ink: {
          950: "#E4E9F3", // page (blue-tinted light)
          900: "#FFFFFF", // card
          850: "#F1F4F9", // inset
          800: "#E6EAF4", // hover
          700: "#D5DCEB", // seams
          600: "#C2CCE2",
        },
        char: "#171F38", // deep navy ink
        steel: {
          300: "#313B59",
          400: "#4A5473",
          500: "#76809C",
        },
        arc: {
          300: "#3050C8",
          400: "#3B5BDB",
          500: "#3D5EE0",
          600: "#2E49B8",
        },
        yield: "#0F8A50",
        amber: "#A87718",
        danger: "#C24438",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderColor: {
        hairline: "rgba(23, 31, 56, 0.14)",
        midline: "rgba(23, 31, 56, 0.28)",
        inkline: "rgba(23, 31, 56, 0.28)",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(23, 31, 56, 0.09), 0 12px 32px rgba(23, 31, 56, 0.12)",
        lift: "0 2px 8px rgba(23, 31, 56, 0.10), 0 22px 52px rgba(23, 31, 56, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
