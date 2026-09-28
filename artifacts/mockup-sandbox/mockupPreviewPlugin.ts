import type { Plugin, ViteDevServer } from "vite";
import fg from "fast-glob";
import fs from "fs";
import path from "path";

const MOCKUPS_DIR = "src/components/mockups";
const GENERATED_FILE = "src/.generated/mockup-components.ts";

function getComponentName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function getFolderName(filePath: string): string {
  const rel = path.relative(MOCKUPS_DIR, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : "";
}

async function generateRegistry(root: string) {
  const pattern = `${MOCKUPS_DIR}/**/*.tsx`;
  const files = await fg(pattern, {
    cwd: root,
    ignore: ["**/_*/**", "**/_*.tsx"],
  });

  const imports: string[] = [];
  const entries: string[] = [];

  files.forEach((file, i) => {
    const name = getComponentName(file);
    const folder = getFolderName(file);
    const importPath = `../../${file}`;
    const alias = `Comp${i}`;
    imports.push(`import { ${name} as ${alias} } from "${importPath}";`);
    const route = folder ? `${folder}/${name}` : name;
    entries.push(`  "${route}": ${alias},`);
  });

  const content = `// AUTO-GENERATED — do not edit\n${imports.join("\n")}\n\nexport const mockupComponents: Record<string, React.ComponentType> = {\n${entries.join("\n")}\n};\n`;

  const outPath = path.join(root, GENERATED_FILE);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content);
}

export function mockupPreviewPlugin(): Plugin {
  let root: string;
  let server: ViteDevServer;

  return {
    name: "mockup-preview-plugin",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await generateRegistry(root);
    },
    configureServer(s) {
      server = s;
      const mockupsPath = path.join(root, MOCKUPS_DIR);
      fs.mkdirSync(mockupsPath, { recursive: true });

      // Intercept /__mockup/preview/<folder>/<Name> — inject data-route into #root
      s.middlewares.use(async (req, res, next) => {
        const PREVIEW_PREFIX = "/__mockup/preview/";
        const url = (req.url ?? "").split("?")[0];
        if (url.startsWith(PREVIEW_PREFIX)) {
          const route = url.slice(PREVIEW_PREFIX.length).replace(/\/$/, "");
          const indexHtmlPath = path.join(root, "index.html");
          let html = fs.readFileSync(indexHtmlPath, "utf-8");
          html = html.replace(
            '<div id="root"></div>',
            `<script>window.__MOCKUP_ROUTE__="${route}";</script><div id="root"></div>`
          );
          // Apply Vite's HTML transforms (injects @react-refresh etc.)
          html = await s.transformIndexHtml(url, html);
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        }
        next();
      });

      s.watcher.add(mockupsPath);
      s.watcher.on("add", async (file) => {
        if (file.includes(MOCKUPS_DIR) && file.endsWith(".tsx")) {
          await generateRegistry(root);
          server.restart();
        }
      });
      s.watcher.on("unlink", async (file) => {
        if (file.includes(MOCKUPS_DIR)) {
          await generateRegistry(root);
          server.restart();
        }
      });
    },
  };
}
