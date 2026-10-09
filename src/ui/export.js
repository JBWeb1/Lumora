// Download a rendered chart as a standalone SVG or a high-resolution PNG.

import { download } from './dom.js';

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity',
  'font-size', 'font-weight', 'font-family', 'font-variant-numeric',
];

// Chart colours come from CSS classes, so copy the computed styles inline before exporting.
function inlineStyles(source, target) {
  const cs = getComputedStyle(source);
  const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
  target.setAttribute('style', `${target.getAttribute('style') ?? ''};${style}`);
  target.removeAttribute('data-tip');
  for (let i = 0; i < source.children.length; i++) inlineStyles(source.children[i], target.children[i]);
}

function standalone(svgEl) {
  const clone = svgEl.cloneNode(true);
  inlineStyles(svgEl, clone);
  const { width, height } = svgEl.viewBox.baseVal;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.removeAttribute('class');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', getComputedStyle(svgEl.closest('.card') ?? document.body).backgroundColor);
  clone.insertBefore(bg, clone.firstChild);
  return { text: new XMLSerializer().serializeToString(clone), width, height };
}

export function exportChart(svgEl, baseName, format) {
  const { text, width, height } = standalone(svgEl);
  const name = baseName.replace(/[^\w\- ]+/g, '').trim() || 'chart';
  if (format === 'svg') {
    download(`${name}.svg`, text, 'image/svg+xml');
    return;
  }
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob((blob) => download(`${name}.png`, blob, 'image/png'), 'image/png');
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}
