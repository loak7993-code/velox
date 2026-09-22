// velox :: cdp/accessibility.js — accessibility tree via the CDP Accessibility domain
export class Accessibility {
  constructor(page) {
    this.page = page;
    this.session = page.session;
  }

  /** Nested AX tree: {role, name, value, children:[…]} */
  async snapshot({ interestingOnly = true } = {}) {
    const { nodes } = await this.session.send('Accessibility.getFullAXTree', {}).catch(() => ({ nodes: [] }));
    if (!nodes?.length) return null;
    const byId = new Map();
    for (const n of nodes) byId.set(n.nodeId, { ...axNode(n), children: [] });
    let root = null;
    for (const n of nodes) {
      const node = byId.get(n.nodeId);
      const parent = n.parentId ? byId.get(n.parentId) : null;
      if (parent) parent.children.push(node);
      else if (!root && node.role) root = node;
    }
    if (interestingOnly) return prune(root);
    return root;
  }

  /** Playwright-ish YAML snapshot of the AX tree. */
  async yaml() {
    const tree = await this.snapshot();
    const lines = [];
    (function walk(node, depth) {
      if (!node) return;
      const label = [node.role, node.name ? `"${node.name}"` : '', node.value != null ? `(${JSON.stringify(node.value)})` : ''].filter(Boolean).join(' ');
      lines.push('  '.repeat(depth) + '- ' + label);
      node.children.forEach((c) => walk(c, depth + 1));
    })(tree, 0);
    return lines.join('\n');
  }
}

function axNode(n) {
  return {
    role: n.role?.value || '',
    name: n.name?.value || '',
    value: n.value?.value ?? undefined,
    description: n.description?.value || undefined,
    checked: findProp(n.properties, 'checked')?.value?.value,
    disabled: findProp(n.properties, 'disabled')?.value?.value,
    expanded: findProp(n.properties, 'expanded')?.value?.value,
    focused: findProp(n.properties, 'focused')?.value?.value,
    level: findProp(n.properties, 'level')?.value?.value,
  };
}
function findProp(props, name) { return (props || []).find((p) => p.name === name); }

const BORING = new Set(['', 'generic', 'InlineTextBox', 'StaticText', 'presentation', 'none', 'RootWebArea']);
function prune(node) {
  if (!node) return null;
  const kids = node.children.map(prune).filter(Boolean);
  if (!BORING.has(node.role) || node.name || kids.length) {
    node.children = kids;
    return node;
  }
  return null;
}
