// A tolerant, minimal XML parser: enough for JUnit and NUnit reports.
// Produces { name, attrs, children, text } nodes. Namespaces are kept as part of the name.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function parseXml(input) {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      top().text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top().text += src.slice(lt + 9, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE and friends, possibly with an internal subset in [...]
      let depth = 0;
      let j = lt + 2;
      for (; j < src.length; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        else if (src[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end === -1 ? src.length : end).trim();
      // Pop to the matching element; tolerate stray closing tags.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? src.length : end + 1;
    } else {
      const { node, selfClosing, next } = readStartTag(src, lt);
      if (!node) {
        top().text += '<';
        i = lt + 1;
        continue;
      }
      top().children.push(node);
      if (!selfClosing) stack.push(node);
      i = next;
    }
  }
  return root;
}

function readStartTag(src, lt) {
  let j = lt + 1;
  const nameMatch = /^[A-Za-z_:][\w:.-]*/.exec(src.slice(j, j + 200));
  if (!nameMatch) return { node: null };
  const node = { name: nameMatch[0], attrs: {}, children: [], text: '' };
  j += nameMatch[0].length;
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (j >= src.length) return { node, selfClosing: true, next: src.length };
    if (src[j] === '>') return { node, selfClosing: false, next: j + 1 };
    if (src[j] === '/' && src[j + 1] === '>') return { node, selfClosing: true, next: j + 2 };
    const attr = /^([^\s=/>]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/.exec(src.slice(j, j + 100000));
    if (!attr || !attr[0]) return { node, selfClosing: false, next: j + 1 };
    let value = attr[2] ?? '';
    if (value[0] === '"' || value[0] === "'") value = value.slice(1, -1);
    node.attrs[attr[1]] = decodeEntities(value);
    j += attr[0].length;
  }
}

export function localName(name) {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

export function* walk(node, parents = []) {
  yield [node, parents];
  for (const child of node.children) yield* walk(child, [...parents, node]);
}

export function firstChild(node, name) {
  return node.children.find((c) => localName(c.name) === name) || null;
}

export function textOf(node) {
  if (!node) return '';
  return (node.text + node.children.map(textOf).join('')).trim();
}
