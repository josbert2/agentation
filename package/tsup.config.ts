import { defineConfig, type Options } from "tsup";
import * as sass from "sass";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import * as path from "path";
import * as fs from "fs";
import type { Plugin } from "esbuild";

// Read version from package.json at build time
const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const VERSION = pkg.version;

// Custom SCSS CSS Modules plugin with SSR-safe style injection
function scssModulesPlugin(): Plugin {
  return {
    name: "scss-modules",
    setup(build) {
      // Handle all .scss files
      build.onLoad({ filter: /\.scss$/ }, async (args) => {
        const isModule = args.path.includes(".module.");
        // Use parent directory + filename for unique style IDs
        const parentDir = path.basename(path.dirname(args.path));
        const baseName = path.basename(args.path, isModule ? ".module.scss" : ".scss");
        const styleId = `${parentDir}-${baseName}`;

        // Compile SCSS to CSS
        const result = sass.compile(args.path);
        let css = result.css;

        if (isModule) {
          // Process with postcss-modules to get class name mappings
          let classNames: Record<string, string> = {};
          const postcssResult = await postcss([
            postcssModules({
              getJSON(cssFileName, json) {
                classNames = json;
              },
              generateScopedName: "[name]__[local]___[hash:base64:5]",
            }),
          ]).process(css, { from: args.path });

          css = postcssResult.css;

          // Generate JS that exports class names and injects styles (SSR-safe +
          // hydration-safe). Ver nota en la rama de abajo: la inyección se DIFIERE
          // fuera del tick de hidratación de React.
          const contents = `
const css = ${JSON.stringify(css)};
const classNames = ${JSON.stringify(classNames)};

if (typeof document !== 'undefined') {
  var __apply = function () {
    var style = document.getElementById('feedback-tool-styles-${styleId}');
    if (!style) {
      style = document.createElement('style');
      style.id = 'feedback-tool-styles-${styleId}';
      document.head.appendChild(style);
    }
    style.textContent = css;
  };
  // NO mutar <head> mientras React hidrata: en hosts que hidratan el <html>
  // entero (TanStack Start SSR) un appendChild al <head> durante la hidratación
  // rompe la hidratación (React #418) en TODO el árbol. Se difiere con doble rAF
  // (post-commit + post-paint), o setTimeout como fallback.
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(function () { requestAnimationFrame(__apply); });
  else setTimeout(__apply, 0);
}

export default classNames;
`;
          return { contents, loader: "js" };
        } else {
          // Regular SCSS - no CSS modules processing. Inyección diferida igual
          // que en la rama de arriba (hydration-safe).
          const contents = `
const css = ${JSON.stringify(css)};
if (typeof document !== 'undefined') {
  var __apply = function () {
    var style = document.getElementById('feedback-tool-styles-${styleId}');
    if (!style) {
      style = document.createElement('style');
      style.id = 'feedback-tool-styles-${styleId}';
      document.head.appendChild(style);
    }
    style.textContent = css;
  };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(function () { requestAnimationFrame(__apply); });
  else setTimeout(__apply, 0);
}
export default {};
`;
          return { contents, loader: "js" };
        }
      });
    },
  };
}

export default defineConfig((options) => [
  // React component
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: !options.watch,
    external: ["react", "react-dom"],
    esbuildPlugins: [scssModulesPlugin()],
    define: {
      __VERSION__: JSON.stringify(VERSION),
    },
    banner: {
      js: '"use client";',
    },
  },
]);
