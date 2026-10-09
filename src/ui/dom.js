// Tiny DOM helpers. All text goes through text nodes, so data can never inject HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPERTIES = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'open']);

function apply(node, props, isSvg) {
  for (const [key, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (key.startsWith('on') && typeof v === 'function') node.addEventListener(key.slice(2).toLowerCase(), v);
    else if (key === 'class') node.setAttribute('class', v);
    else if (key === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (key === 'dataset') Object.assign(node.dataset, v);
    else if (!isSvg && PROPERTIES.has(key)) node[key] = v;
    else node.setAttribute(key, v === true ? '' : v);
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  apply(node, props, false);
  append(node, children);
  return node;
}

export function svg(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, props, true);
  append(node, children);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function select(options, value, onChange, props = {}) {
  return el(
    'select',
    { ...props, onchange: (e) => onChange(e.target.value) },
    options.map((o) => el('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label))
  );
}

export function download(fileName, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One floating tooltip for every element with a data-tip attribute. */
export function installTooltip(tip) {
  const show = (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (!target) {
      tip.hidden = true;
      return;
    }
    tip.textContent = target.getAttribute('data-tip');
    tip.hidden = false;
    const pad = 14;
    const { innerWidth: w, innerHeight: h } = window;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX + pad, w - r.width - 8)}px`;
    tip.style.top = `${Math.min(e.clientY + pad, h - r.height - 8)}px`;
  };
  document.addEventListener('mousemove', show);
  document.addEventListener('mouseleave', () => (tip.hidden = true));
  document.addEventListener('scroll', () => (tip.hidden = true), true);
}
