import { icon } from './icons.js';

/** Hyperscript: h('button.btn.primary', { onclick }, 'Label'). Null/false children are skipped. */
export function h(sel, props, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const ic = icon;

export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** A destructive button that needs a second click within 3 s ("Delete" → "Confirm delete"). */
export function armed(button, armedLabel, action) {
  let timer = null;
  const original = [...button.childNodes];
  const title = button.getAttribute('aria-label');
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (button.classList.contains('armed')) {
      clearTimeout(timer);
      action();
      return;
    }
    button.classList.add('armed');
    if (!button.classList.contains('icon-btn')) button.replaceChildren(armedLabel);
    if (title) button.setAttribute('aria-label', armedLabel);
    timer = setTimeout(() => {
      button.classList.remove('armed');
      button.replaceChildren(...original);
      if (title) button.setAttribute('aria-label', title);
    }, 3000);
  });
  return button;
}
