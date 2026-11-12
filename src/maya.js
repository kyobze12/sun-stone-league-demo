// Small helpers that give the game its Maya identity: bar-and-dot numerals,
// a vigesimal day-count style timer and callout vocabulary.

// Returns an SVG string drawing a number (0-19 per glyph, stacked vigesimal
// for larger values) in Maya bar-and-dot notation. 0 is the shell glyph.
export function mayaNumeralSVG(value, { size = 44, color = '#f4d58d' } = {}) {
  value = Math.max(0, Math.floor(value));
  const digits = [];
  if (value === 0) digits.push(0);
  while (value > 0) { digits.unshift(value % 20); value = Math.floor(value / 20); }
  const glyphH = size, gap = size * 0.22;
  const totalH = digits.length * glyphH + (digits.length - 1) * gap;
  let body = '';
  digits.forEach((digit, index) => {
    const top = index * (glyphH + gap);
    body += numeralGlyph(digit, size, top, color);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${totalH}" width="${size}" height="${totalH}" role="img" aria-label="${value}">${body}</svg>`;
}

function numeralGlyph(digit, size, top, color) {
  if (digit === 0) {
    const cx = size / 2, cy = top + size / 2;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${size * .34}" ry="${size * .2}" fill="none" stroke="${color}" stroke-width="${size * .08}"/>` +
      `<path d="M${cx - size * .18} ${cy} q${size * .18} ${-size * .16} ${size * .36} 0" fill="none" stroke="${color}" stroke-width="${size * .06}"/>`;
  }
  const bars = Math.floor(digit / 5), dots = digit % 5;
  const barH = size * .11, barGap = size * .07, dotR = size * .085;
  let y = top + size - barH;
  let out = '';
  for (let i = 0; i < bars; i += 1) {
    out += `<rect x="${size * .08}" y="${y}" width="${size * .84}" height="${barH}" rx="${barH * .4}" fill="${color}"/>`;
    y -= barH + barGap;
  }
  if (dots) {
    const span = size * .84, step = span / dots;
    const cy = y - dotR - size * .02;
    for (let i = 0; i < dots; i += 1) {
      const cx = size * .08 + step * (i + .5);
      out += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${color}"/>`;
    }
  }
  return out;
}

export const CALLOUTS = Object.freeze({
  ring: ["K'IN RING!", 'SUN-STONE!', 'THROUGH THE RING!'],
  backline: ['BACK LINE!', 'INTO THE ZONE!'],
  doubleBounce: ['DOUBLE BOUNCE', 'FAULT'],
  strike: ['HIP STRIKE', 'KINETIC BLOW', 'STRIKE!'],
  bigStrike: ['JAGUAR BLOW!', 'CRUSHING STRIKE!'],
  lob: ['KNEE LOB', 'SKY VOLLEY'],
  tackle: ['SHOULDER CHARGE', 'TAKEDOWN'],
  shield: ['SUN SHIELD HOLDS'],
  suddenDeath: ['SUDDEN DEATH — NEXT POINT WINS'],
});

export function pick(list, random = Math.random) {
  return list[Math.floor(random() * list.length) % list.length];
}
