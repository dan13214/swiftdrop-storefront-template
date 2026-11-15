import fs from "fs";

// One repo, three kinds of site, chosen per Vercel project with the TEMPLATE env var:
//   TEMPLATE unset or "index"  the original general storefront (unchanged)
//   TEMPLATE=sim               the sim trucking / sim racing store, with free tools
//   TEMPLATE=toolkit           the sales page for the Job Pricing & Quoting Toolkit
// PREVIEW=1 builds a self-contained page with sample products and payment switched off.
const template = (process.env.TEMPLATE || "index").toLowerCase();
const preview = process.env.PREVIEW === "1";
const accent = process.env.ACCENT_COLOR || "#4f6ef7";
const defaults = {
  index: { brand: "Nordly", tagline: "Trending products at prices worth talking about. New arrivals weekly, free UK delivery over £50.", categories: "" },
  sim: { brand: "Low Gear Supply", tagline: "Original gear for sim truckers and sim racers, plus free tools: ETS2 cargo weights, a triple-screen FOV calculator and more.", categories: "Sim Trucking,Sim Racing,Rig Gear" },
  toolkit: { brand: "SwiftTrades", tagline: "A spreadsheet for UK trades: work out the day rate you need, price a job with materials, markup and VAT, and print a clean quote.", categories: "Trade Tools" },
}[template];
if (!defaults) throw new Error(`Unknown TEMPLATE "${template}". Use index, sim or toolkit.`);

const brandName = process.env.BRAND_NAME || defaults.brand;
const siteUrl = (process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://example.vercel.app")).replace(/\/$/, "");
const categories = (process.env.STORE_CATEGORIES ?? defaults.categories).split(",").map(s => s.trim()).filter(Boolean);
const contact = process.env.CONTACT_EMAIL ? `Questions or a problem with an order: ${process.env.CONTACT_EMAIL}` : "";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Shown only in PREVIEW builds, and labelled as samples on the page.
const samples = {
  sim: [
    ...["S", "M", "L", "XL"].map((size, i) => ({ id: `pf_sample1${i}`, name: `Convoy Crew Tee / Black / ${size}`, price: 22, category: "Sim Trucking", emoji: "👕", sample: true })),
    { id: "pf_sample20", name: "Night Shift Mug", price: 13, category: "Sim Trucking", emoji: "☕", sample: true },
    { id: "pf_sample30", name: "Late Braker Desk Mat", price: 24, category: "Sim Racing", emoji: "🏁", sample: true },
    { id: "pf_sample40", name: "Three Screens, No Mirrors Tee / Navy / M", price: 22, category: "Sim Racing", emoji: "👕", sample: true },
  ],
  toolkit: [{ id: "dg_job-pricing-toolkit", name: "Job Pricing & Quoting Toolkit", price: 14, category: "Trade Tools", emoji: "🧰", sample: true }],
  index: [],
}[template];

const vars = {
  BRAND_NAME: esc(brandName),
  BRAND_NAME_UPPER: esc(brandName.toUpperCase()),
  TAGLINE: esc(process.env.TAGLINE || defaults.tagline),
  HERO_HEADLINE: process.env.HERO_HEADLINE || "Today's Hottest Products",
  ACCENT_COLOR: accent,
  ACCENT_COLOR_HEX: accent.replace("#", ""),
  SITE_URL: siteUrl,
  META_PIXEL_ID: process.env.META_PIXEL_ID || "",
  TIKTOK_PIXEL_ID: process.env.TIKTOK_PIXEL_ID || "",
  API_URL: process.env.API_URL || "https://swiftdrop-backend-production.up.railway.app",
  STORE_CATEGORIES_JSON: JSON.stringify(categories),
  PREVIEW: preview ? "true" : "false",
  SAMPLE_PRODUCTS_JSON: JSON.stringify(preview ? samples : []).replace(/</g, "\\u003c"),
  TOOLKIT_PRODUCT_ID: process.env.TOOLKIT_PRODUCT_ID || "dg_job-pricing-toolkit",
  CONTACT_LINE: esc(contact),
};
// The original template printed these three unescaped; keep that behaviour for the 25 live sites.
if (template === "index") Object.assign(vars, { BRAND_NAME: brandName, BRAND_NAME_UPPER: brandName.toUpperCase(), TAGLINE: process.env.TAGLINE || defaults.tagline });

function fill(text, extra = {}) {
  for (const [key, val] of Object.entries({ ...extra, ...vars })) text = text.split(`{{${key}}}`).join(val);
  return text;
}
function render(path, extra) {
  let text = fill(fs.readFileSync(path, "utf8"), extra);
  if (preview) {
    // Self-contained: no Stripe, no analytics, shared files inlined.
    text = text.replace(/<!--STRIPE-->[\s\S]*?<!--\/STRIPE-->/g, "").replace(/<!--ANALYTICS-->[\s\S]*?<!--\/ANALYTICS-->/g, "")
      .replace('<link rel="stylesheet" href="/shop.css">', () => `<style>${fs.readFileSync("assets/shop.css", "utf8")}</style>`)
      .replace('<script src="/shop.js"></script>', () => `<script>${fs.readFileSync("assets/shop.js", "utf8")}</script>`);
  }
  return text;
}

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });
const pages = [""];
fs.writeFileSync("dist/index.html", render(template === "index" ? "index.template.html" : `${template}.template.html`));

if (template !== "index") {
  fs.copyFileSync("assets/shop.js", "dist/shop.js");
  fs.copyFileSync("assets/shop.css", "dist/shop.css");
}
if (template === "sim") {
  const partials = {
    TOOL_HEAD: fill(fs.readFileSync("tools/_head.html", "utf8")),
    TOOL_TOP: fill(fs.readFileSync("tools/_top.html", "utf8")),
    TOOL_FOOT: fill(fs.readFileSync("tools/_foot.html", "utf8")),
    CARGO_DATA: fs.readFileSync("tools/ets2-cargo-data.txt", "utf8").trim(),
  };
  fs.mkdirSync("dist/tools", { recursive: true });
  for (const file of fs.readdirSync("tools").filter(f => f.endsWith(".template.html"))) {
    const slug = file.replace(".template.html", "");
    fs.writeFileSync(`dist/tools/${slug}.html`, render(`tools/${file}`, partials));
    pages.push(`tools/${slug}`);
  }
}

fs.writeFileSync("dist/robots.txt", fill(fs.readFileSync("robots.template.txt", "utf8")));
const sitemap = template === "index"
  ? fill(fs.readFileSync("sitemap.template.xml", "utf8"))
  : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `  <url><loc>${siteUrl}/${p}</loc></url>`).join("\n")}\n</urlset>\n`;
fs.writeFileSync("dist/sitemap.xml", sitemap);

console.log(`Built ${template} site "${brandName}"${preview ? " (preview)" : ""} -> ${siteUrl} [${pages.length} page(s)]`);
