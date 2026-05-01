import type { Config } from "tailwindcss";

const config: Config = {
  prefix: "hl-",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
