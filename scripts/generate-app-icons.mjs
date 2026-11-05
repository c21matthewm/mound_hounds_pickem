import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `${root}public/images/branding/mound-hound.webp`;
await mkdir(`${root}public/icons`, { recursive: true });
for (const [size, file] of [[32, "favicon-32.png"], [180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
  await sharp(source).resize(size, size).flatten({ background: "#0b0f14" }).png({ palette: true, compressionLevel: 9 }).toFile(`${root}public/icons/${file}`);
}
// Keep the important artwork inside Android's maskable-icon safe area.
const artwork = await sharp(source).resize(320, 320).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: "#0b0f14" } })
  .composite([{ input: artwork, left: 96, top: 96 }]).png({ palette: true, compressionLevel: 9 })
  .toFile(`${root}public/icons/icon-maskable-512.png`);
console.log("Generated app icons from the existing official Mound Hounds artwork.");
