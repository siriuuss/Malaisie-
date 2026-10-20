// Convert a TTF to a three.js typeface JSON (subset to the glyphs we need).
// Usage: npm pack opentype.js@1.3.4, extract, then point this import at dist/opentype.module.js.
import opentype from 'opentype.js';
import fs from 'node:fs';
const [, , src, out, chars] = process.argv;
const font = opentype.parse(fs.readFileSync(src).buffer);
const scale = (1000 * 100) / ((font.unitsPerEm || 2048) * 72);
const glyphs = {};
for (const ch of new Set(chars)) {
  const g = font.charToGlyph(ch);
  const token = { ha: Math.round(g.advanceWidth * scale), x_min: Math.round(g.xMin * scale), x_max: Math.round(g.xMax * scale), o: '' };
  for (const c of g.path.commands) {
    const t = c.type.toLowerCase() === 'c' ? 'b' : c.type.toLowerCase();
    token.o += t + ' ';
    if (c.x !== undefined && c.y !== undefined) token.o += Math.round(c.x * scale) + ' ' + Math.round(c.y * scale) + ' ';
    if (c.x1 !== undefined) token.o += Math.round(c.x1 * scale) + ' ' + Math.round(c.y1 * scale) + ' ';
    if (c.x2 !== undefined) token.o += Math.round(c.x2 * scale) + ' ' + Math.round(c.y2 * scale) + ' ';
  }
  glyphs[ch] = token;
}
const json = {
  glyphs, familyName: font.names.fontFamily?.en || 'font',
  ascender: Math.round(font.ascender * scale), descender: Math.round(font.descender * scale),
  underlinePosition: Math.round(font.tables.post.underlinePosition * scale), underlineThickness: Math.round(font.tables.post.underlineThickness * scale),
  boundingBox: { yMin: Math.round(font.tables.head.yMin * scale), xMin: Math.round(font.tables.head.xMin * scale), yMax: Math.round(font.tables.head.yMax * scale), xMax: Math.round(font.tables.head.xMax * scale) },
  resolution: 1000, original_font_information: font.tables.name,
};
fs.writeFileSync(out, JSON.stringify(json));
console.log('glyphs', Object.keys(glyphs).join(''));
