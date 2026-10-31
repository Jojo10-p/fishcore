import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1.25rem", lg: "2rem" }, screens: { "2xl": "1240px" } },
    extend: {
      colors: {
        night: { DEFAULT: "#101C35", 900: "#0A1326", 800: "#101C35", 700: "#18284A", 600: "#263B58" },
        slate2: "#263B58",
        paper: "#F7F8FA",
        mist: "#E9EDF2",
        teal: { DEFAULT: "#20B6A5", 50: "#E8F8F6", 100: "#C9EFEA", 600: "#1A9A8C", 700: "#147A6F" },
        champagne: { DEFAULT: "#C9A96E", 50: "#FAF5EC", 100: "#F1E6CF", 700: "#9A7C45" },
        ink: { DEFAULT: "#101C35", soft: "#4A5873", faint: "#8592A8" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { xl2: "1.25rem" },
      boxShadow: {
        soft: "0 1px 2px rgba(16,28,53,.04), 0 8px 24px -12px rgba(16,28,53,.12)",
        lift: "0 24px 48px -24px rgba(16,28,53,.28)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
      },
      animation: { shimmer: "shimmer 1.6s infinite", floaty: "floaty 6s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;
