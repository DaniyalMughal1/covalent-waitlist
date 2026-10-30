// Bakes the poster art's two fades into the image and writes src/assets/poster-art.png.
// Re-run it whenever the art, --paper or the poster's --ground changes.
//
// The art's paper tone melts into the page's and its last rows into the ground. As a CSS
// gradient over the image, Safari painted that gradient into the art's layer every time the
// poster came back into view, about 45ms in one frame. In the image it costs nothing, and the
// picture is the same. shared-field-footer.png stays the untouched original.
//
//   node tools/render-poster-art.mjs
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = fileURLToPath(new URL("../src/assets/shared-field-footer.png", import.meta.url));
const out = fileURLToPath(new URL("../src/assets/poster-art.png", import.meta.url));

const PAPER = [0xfa, 0xf9, 0xf6];
const GROUND = [0x0a, 0x0b, 0x0d];

const clamp = (v) => Math.min(1, Math.max(0, v));
// Fractions of the art's height: paper down to 5%, gone by 22%, ground from 84% to the end.
const paperAt = (v) => 1 - clamp((v - 0.05) / 0.17);
const groundAt = (v) => clamp((v - 0.84) / 0.16);

const { data, info } = await sharp(source).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

for (let y = 0; y < height; y++) {
  const v = (y + 0.5) / height;
  const paper = paperAt(v);
  const ground = groundAt(v);
  for (let x = 0; x < width; x++) {
    const at = (y * width + x) * channels;
    for (let c = 0; c < 3; c++) {
      const lit = data[at + c] * (1 - paper) + PAPER[c] * paper;
      data[at + c] = Math.round(lit * (1 - ground) + GROUND[c] * ground);
    }
  }
}

await sharp(data, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toFile(out);
