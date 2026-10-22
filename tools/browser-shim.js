// 极简 DOM 替身 —— 让 调参器.html 的内联脚本能在 Node 里真跑一遍。
//
// 为什么值得写这个东西：
//   沙箱禁止 Chromium 的命名管道（platform_channel 拒绝访问），headless 起不来，
//   所以调参器一直只能做"静态校验"（正则找关键函数在不在）。那种校验挡不住
//   真正的坑 —— 变量名写错、函数在 TDZ 里被调用、id 拼错、批量乘漏了只读过滤……
//   这些全都要**执行**才暴露得出来，而且暴露在玩家那边（白屏 / 点了没反应）。
//
// 覆盖面：createElement / appendChild / parentNode / classList / style / dataset /
//        textContent / innerHTML / value / checked / disabled / addEventListener /
//        dispatchEvent / querySelector('#id') / createTextNode。
// 不覆盖：布局、CSS 层叠、真实事件冒泡。需要"看得见"的判断一律不在这里做。
//
// 静态 HTML 里的元素（<input id="q"> 这些）用正则扫出来建好 —— 不去解析 HTML，
// 只要拿到 id / tag / type / checked / value / min / max / step 就够了。
// 这样测的就是页面里**真实写的那份** HTML，而不是测试里另抄一份。
'use strict';

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...n) { for (const x of n) if (x) this.set.add(x); this.#sync(); }
  remove(...n) { for (const x of n) this.set.delete(x); this.#sync(); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const on = force === undefined ? !this.set.has(n) : !!force;
    if (on) this.set.add(n); else this.set.delete(n);
    this.#sync();
    return on;
  }
  #sync() { this.el._className = [...this.set].join(' '); }
  toString() { return [...this.set].join(' '); }
}

class TextNode {
  constructor(t) { this.nodeType = 3; this._text = String(t); this.parentNode = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}

class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList(this);
    this._className = '';
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._innerHTML = '';
    this._listeners = new Map();
    // 真实 DOM 里这些属性都存在，脚本可能不设就读，给个确定的初值
    this.id = '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
    this.placeholder = '';
    this.min = undefined;
    this.max = undefined;
    this.step = undefined;
    this.selectedIndex = 0;
  }
  get className() { return this._className; }
  set className(v) {
    this._className = String(v || '');
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  appendChild(n) {
    n.parentNode = this;
    this.children.push(n);
    this._text = '';
    this._innerHTML = '';
    // <select> 的 value 在真实 DOM 里等于第一个 option 的 value
    if (this.tagName === 'SELECT' && this.children.length === 1) this.value = n.value;
    return n;
  }
  get textContent() {
    let s = this._text;
    for (const c of this.children) s += c.textContent;
    return s;
  }
  set textContent(v) { this._text = String(v); this.children = []; this._innerHTML = ''; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); this.children = []; this._text = ''; }
  /** 只给测试用：把 innerHTML 里的标签剥掉，方便断言文案 */
  plain() { return (this._innerHTML || this.textContent).replace(/<[^>]*>/g, ''); }
  addEventListener(t, fn) {
    if (!this._listeners.has(t)) this._listeners.set(t, []);
    this._listeners.get(t).push(fn);
  }
  /** 触发事件。返回 handler 的返回值（async handler 会返回 Promise，测试要 await） */
  fire(type, extra) {
    const ev = Object.assign({ type, target: this, currentTarget: this }, extra || {});
    const out = [];
    for (const fn of this._listeners.get(type) || []) out.push(fn(ev));
    return out.length === 1 ? out[0] : out;
  }
  /** 便捷写法：.fire() 的别名，语义上更像真实交互 */
  click() { return this.fire('click'); }
  focus() {}
  scrollIntoView() {}
  querySelector() { return null; }
}

/** 扫静态 HTML（<script> 之前的部分）里的 id="..." 元素。 */
function scanStatic(html) {
  const head = html.slice(0, html.indexOf('<script>'));
  const out = new Map();
  const re = /<(\w+)\b([^>]*?\bid="([^"]+)"[^>]*?)>/g;
  let m;
  while ((m = re.exec(head))) {
    const tag = m[1], attrs = m[2], id = m[3];
    const el = new El(tag);
    el.id = id;
    const a = (name) => {
      const r = new RegExp('\\b' + name + '="([^"]*)"').exec(attrs);
      return r ? r[1] : undefined;
    };
    if (a('type') !== undefined) el.type = a('type');
    if (a('value') !== undefined) el.value = a('value');
    if (a('placeholder') !== undefined) el.placeholder = a('placeholder');
    if (a('title') !== undefined) el.title = a('title');
    for (const k of ['min', 'max', 'step']) if (a(k) !== undefined) el[k] = a(k);
    // 布尔属性：写了就为真
    if (/\bchecked\b/.test(attrs)) el.checked = true;
    if (/\bdisabled\b/.test(attrs)) el.disabled = true;
    if (a('class') !== undefined) el.className = a('class');
    out.set(id, el);
  }
  return out;
}

/**
 * 造一个能跑调参器脚本的全局环境。
 * @param {string} html  完整页面（含 <script>）
 * @returns {{document:object, window:object, globals:object, static:Map}}
 */
function makeDom(html) {
  const staticEls = scanStatic(html);
  const document = {
    activeElement: null,
    createElement: (tag) => new El(tag),
    createTextNode: (t) => new TextNode(t),
    querySelector: (sel) => {
      if (typeof sel !== 'string' || sel[0] !== '#') return null;
      return staticEls.get(sel.slice(1)) || null;
    },
    querySelectorAll: () => [],
    body: new El('body'),
  };
  const window = {};
  const globals = {
    document,
    window,
    console,
    setTimeout,
    clearTimeout,
    confirm: () => true,
    alert: () => {},
    // 页面里没用到 URL/Blob，但留个明确的缺口比让它们意外变成 undefined 好
  };
  return { document, window, globals, static: staticEls };
}

module.exports = { makeDom, El, TextNode };
