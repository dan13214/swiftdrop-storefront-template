import fs from "fs";

const accent = process.env.ACCENT_COLOR || "#4f6ef7";
const brandName = process.env.BRAND_NAME || "Nordly";
const siteUrl = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://example.vercel.app");

const vars = {
  BRAND_NAME: brandName,
  BRAND_NAME_UPPER: brandName.toUpperCase(),
  TAGLINE: process.env.TAGLINE || "Trending products at prices worth talking about. New arrivals weekly, free UK delivery over £50.",
  HERO_HEADLINE: process.env.HERO_HEADLINE || "Today's Hottest Products",
  ACCENT_COLOR: accent,
  ACCENT_COLOR_HEX: accent.replace("#", ""),
  SITE_URL: siteUrl,
};

function render(templatePath) {
  let text = fs.readFileSync(templatePath, "utf8");
  for (const [key, val] of Object.entries(vars)) {
    text = text.split(`{{${key}}}`).join(val);
  }
  return text;
}

fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/index.html", render("index.template.html"));
fs.writeFileSync("dist/robots.txt", render("robots.template.txt"));
fs.writeFileSync("dist/sitemap.xml", render("sitemap.template.xml"));

console.log(`Built storefront "${brandName}" (${accent}) -> ${siteUrl}`);
