import { defineConfig, type Plugin } from "vite";

// Serves api/tts.ts during `npm run dev`, the same function Vercel runs in production.
function devApi(): Plugin {
  return {
    name: "dev-api-tts",
    configureServer(server) {
      server.middlewares.use("/api/tts", async (req, res) => {
        try {
          const mod = await server.ssrLoadModule("/api/tts.ts");
          await mod.default(req, res);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devApi()],
  build: { target: "es2022" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
} as never);
