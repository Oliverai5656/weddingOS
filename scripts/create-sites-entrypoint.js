const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const assets = {};

function collectAssets(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      collectAssets(fullPath);
      continue;
    }

    if (item.name === "index.js") {
      continue;
    }

    const route = "/" + path.relative(distDir, fullPath).replace(/\\/g, "/");
    const ext = path.extname(fullPath);
    assets[route] = {
      body: fs.readFileSync(fullPath, "utf8"),
      type: types[ext] || "text/plain; charset=utf-8"
    };
  }
}

collectAssets(distDir);

const entrypoint = `const assets = ${JSON.stringify(assets)};

async function handleFetch(request) {
  const url = new URL(request.url);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const asset = assets[path] || assets["/index.html"];

  return new Response(asset.body, {
    headers: {
      "content-type": asset.type,
      "cache-control": path === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable"
    }
  });
}

export { handleFetch as fetch };
export default { fetch: handleFetch };
`;

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "index.js"), entrypoint);
