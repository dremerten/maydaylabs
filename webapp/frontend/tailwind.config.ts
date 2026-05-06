import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: "#050f1a",
          surface: "#0a1f35",
          border: "#163355",
          cyan: "#0096c7",
          violet: "#2ec4b6",
          green: "#06d6a0",
          red: "#ef4444",
          text: "#caf0f8",
          muted: "#4a7a9b",
          fg: "#f0f9ff",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        cyan: "0 0 20px #0096c730, 0 0 60px #0096c710",
        violet: "0 0 20px #2ec4b630, 0 0 60px #2ec4b610",
        green: "0 0 20px #06d6a030",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "grid-move": "gridMove 20s linear infinite",
        scanline: "scanline 8s linear infinite",
      },
      keyframes: {
        gridMove: {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "40px 40px" },
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
