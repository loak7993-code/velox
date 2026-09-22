// velox — type definitions
declare module 'velox' {
  export interface VeloxFetchOptions {
    headers?: Record<string, string>;
    timeout?: number;
    method?: string;
    body?: string;
    maxRedirects?: number;
    jar?: CookieJar;
    rejectUnauthorized?: boolean;
  }

  export interface LiteResponse {
    url: string; startUrl: string; status: number; headers: Record<string, string>;
    body: Buffer; ms: number;
    text(): string; json(): any;
    doc: HtmlDoc;
    title(): string | null;
    header(name: string): string | undefined;
    cookieHeader(): string | null;
  }

  export interface HtmlDoc {
    select(sel: string): HtmlNode | null;
    selectAll(sel: string): HtmlNode[];
    text(sel: string): string | null;
    attr(sel: string, name: string): string | null;
    html(sel: string): string | null;
    title(): string | null;
    meta(): Record<string, string>;
    links(base?: string): { text: string; href: string }[];
    images(base?: string): { src: string; alt: string }[];
    tables(): { headers: string[]; rows: string[][] }[];
    forms(): { action: string; method: string; fields: { tag: string; name: string; type: string; value: string }[] }[];
    jsonld(): any[];
    readable(): string;
  }

  export interface HtmlNode {
    tag: string; attrs: Record<string, string>; parent: HtmlNode | null;
    textContent(): string;
    select(sel: string): HtmlNode | null;
    selectAll(sel: string): HtmlNode[];
  }

  export interface CookieEntry { name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; url?: string; }

  export interface RequestEntry {
    id: string; url: string; method: string; headers: Record<string, string>;
    resourceType?: string; postData?: string;
    response: { status: number; headers: Record<string, string>; url: string; remoteIP?: string; protocol?: string } | null;
    done: boolean; failed: string | null; canceled?: boolean; encodedDataLength?: number;
    redirectChain?: { url: string; status: number }[];
    body?: string | null;
  }

  export interface RouteRequest {
    id: string; url: string; method: string; headers: Record<string, string>;
    resourceType: string; postData?: string;
    fulfill(r: { status?: number; headers?: Record<string, string>; body?: string; contentType?: string }): Promise<void>;
    abort(reason?: string): Promise<void>;
    continue(r?: { url?: string; method?: string; headers?: Record<string, string>; postData?: string }): Promise<void>;
  }

  export interface Locator {
    sel: string;
    text(): Promise<string | null>;
    attr(name: string): Promise<string | null>;
    html(): Promise<string | null>;
    count(): Promise<number>;
    exists(): Promise<boolean>;
    val(): Promise<string | null>;
    extract(spec?: { text?: boolean; html?: boolean; tag?: boolean; attrs?: string[]; limit?: number }): Promise<any[]>;
    waitFor(opts?: { timeout?: number; state?: 'visible' | 'attached' | 'hidden' }): Promise<Locator>;
    click(opts?: ClickOptions): Promise<VeloxPage>;
    hover(opts?: { timeout?: number }): Promise<VeloxPage>;
    type(text: string, opts?: TypeOptions): Promise<VeloxPage>;
    fill(value: string, opts?: { timeout?: number }): Promise<VeloxPage>;
    screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
    scrollIntoView(): Promise<{ x: number; y: number } | null>;
  }

  export interface GotoOptions { waitUntil?: 'none' | 'interactive' | 'load' | 'networkidle' | 'settle'; timeout?: number; referer?: string; }
  export interface ClickOptions { timeout?: number; button?: 'left' | 'right' | 'middle'; clicks?: number; modifiers?: ('alt' | 'ctrl' | 'meta' | 'shift')[]; delay?: number; inPage?: boolean; }
  export interface TypeOptions { delay?: number; human?: boolean; timeout?: number; }
  export interface ScreenshotOptions { path?: string; full?: boolean; selector?: string; type?: 'png' | 'jpeg'; quality?: number; fast?: boolean; clip?: { x: number; y: number; width: number; height: number }; }
  export interface PdfOptions { path?: string; format?: string | [number, number]; landscape?: boolean; printBackground?: boolean; margin?: { top?: number; right?: number; bottom?: number; left?: number }; scale?: number; headerTemplate?: string; footerTemplate?: string; preferCSSPageSize?: boolean; }

  export interface PageOptions {
    stealth?: boolean;
    ads?: boolean;
    blockUrls?: string[];
    device?: string | Device;
    viewport?: [number, number] | null;
    ua?: string;
    platform?: string;
    locale?: string;
    timezone?: string;
    geolocation?: { latitude: number; longitude: number; accuracy?: number };
    headers?: Record<string, string>;
    routes?: Record<string, (req: RouteRequest) => void>;
    initScripts?: string[];
    dialogs?: { action?: 'accept' | 'dismiss'; promptText?: string };
    downloads?: string | false;
    isolated?: boolean;
    colorScheme?: 'light' | 'dark';
  }

  export interface Device { width: number; height: number; dsf?: number; mobile?: boolean; touch?: boolean; ua?: string; platform?: string; locale?: string; }

  export interface LaunchOptions {
    browser?: string;
    executablePath?: string;
    headless?: boolean;
    args?: string[];
    userDataDir?: string;
    proxy?: { server: string; username?: string; password?: string };
    userAgent?: string;
    windowSize?: [number, number];
    timeout?: number;
    transport?: 'pipe' | 'socket';
    noSandbox?: boolean;
    env?: Record<string, string>;
  }

  export interface Session {
    readonly engine: 'lite' | 'cdp';
    readonly url: string;
    readonly status: number | null;
    title(): Promise<string | null>;
    html(): Promise<string>;
    content(): Promise<string>;
    text(sel?: string): Promise<string | null>;
    readable(): Promise<string>;
    $(sel: string): Locator;
    $$(sel: string): Promise<any[]>;
    extract(sel: string, spec?: { text?: boolean; html?: boolean; tag?: boolean; attrs?: string[]; limit?: number }): Promise<any[]>;
    texts(sel: string): Promise<string[]>;
    links(): Promise<{ text: string; href: string }[]>;
    images(): Promise<{ src: string; alt: string }[]>;
    tables(): Promise<{ headers: string[]; rows: string[][] }[]>;
    forms(): Promise<any[]>;
    meta(): Promise<Record<string, string>>;
    jsonld(): Promise<any[]>;
    cookies(): Promise<any[]>;
    click(sel: string, opts?: ClickOptions): Promise<Session>;
    hover(sel: string, opts?: { timeout?: number }): Promise<Session>;
    type(sel: string, text: string, opts?: TypeOptions): Promise<Session>;
    fill(sel: string, value: string, opts?: { timeout?: number }): Promise<Session>;
    press(key: string, opts?: { modifiers?: string[] }): Promise<Session>;
    screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
    pdf(opts?: PdfOptions): Promise<Buffer>;
    eval(js: string, opts?: { awaitPromise?: boolean }): Promise<any>;
    waitForSelector(sel: string, opts?: { timeout?: number; state?: string }): Promise<Locator>;
    saveSession(path?: string): Promise<any>;
    loadSession(pathOrData: any): Promise<Session>;
    upgrade(): Promise<Session>;
    close(): Promise<void>;
    raw?: VeloxPage;
  }

  export interface VeloxPage extends Session {
    readonly browser: Browser;
    readonly targetId: string;
    goto(url: string, opts?: GotoOptions): Promise<{ url: string; status: number | null; ms: number }>;
    reload(opts?: GotoOptions): Promise<VeloxPage>;
    back(): Promise<boolean>;
    forward(): Promise<boolean>;
    wait(ms: number): Promise<void>;
    waitForLoad(state?: string, timeout?: number): Promise<boolean>;
    waitForUrl(match: string | RegExp, timeout?: number): Promise<string>;
    waitForFunction(js: string, opts?: { timeout?: number }): Promise<any>;
    count(sel: string): Promise<number>;
    attr(sel: string, name: string): Promise<string | null>;
    val(sel: string): Promise<string | null>;
    mouse: {
      move(x: number, y: number, opts?: { steps?: number }): Promise<void>;
      click(x: number, y: number, opts?: { button?: string; clicks?: number; modifiers?: string[]; delay?: number }): Promise<void>;
      dblclick(x: number, y: number, opts?: any): Promise<void>;
      down(button?: string): Promise<void>;
      up(button?: string): Promise<void>;
      wheel(dx: number, dy: number): Promise<void>;
      humanMove(x: number, y: number, opts?: { steps?: number }): Promise<void>;
    };
    keyboard: {
      down(key: string): Promise<void>;
      up(key: string): Promise<void>;
      press(key: string): Promise<void>;
      sendChar(ch: string): Promise<void>;
      type(text: string, opts?: { delay?: number; human?: boolean }): Promise<void>;
    };
    touch: { tap(x: number, y: number): Promise<void>; swipe(x1: number, y1: number, x2: number, y2: number, opts?: { steps?: number }): Promise<void>; };
    scrollBy(dx: number, dy: number): Promise<number[]>;
    scrollToBottom(): Promise<void>;
    setViewport(w: number, h: number, opts?: { mobile?: boolean; dsf?: number }): Promise<VeloxPage>;
    setUA(ua: string, platform?: string): Promise<VeloxPage>;
    setHeaders(headers: Record<string, string>): Promise<VeloxPage>;
    setLocale(locale: string): Promise<VeloxPage>;
    setTimezone(tz: string): Promise<VeloxPage>;
    setGeolocation(g: { latitude: number; longitude: number; accuracy?: number }): Promise<VeloxPage>;
    colorScheme(scheme?: 'light' | 'dark'): Promise<VeloxPage>;
    emulate(device: string | Device): Promise<VeloxPage>;
    setCookies(cookies: CookieEntry[]): Promise<VeloxPage>;
    clearCookies(): Promise<VeloxPage>;
    localStorage(): Promise<{ local: Record<string, string>; session: Record<string, string> }>;
    setLocalStorage(k: string, v: string): Promise<void>;
    requests(opts?: { filter?: (r: RequestEntry) => boolean }): RequestEntry[];
    body(entryOrId: RequestEntry | string): Promise<string | null>;
    har(opts?: { withBodies?: boolean }): Promise<any>;
    block(urls: string | string[]): Promise<VeloxPage>;
    unblock(): Promise<VeloxPage>;
    route(pattern: string | RegExp, handler: (req: RouteRequest) => void): VeloxPage;
    unroute(pattern: string | RegExp): VeloxPage;
    mock(urlPattern: string, response: any): VeloxPage;
    uploadFile(sel: string, files: string | string[]): Promise<VeloxPage>;
    expose(name: string, fn: (...args: any[]) => any): Promise<VeloxPage>;
    setContent(html: string, opts?: { timeout?: number }): Promise<VeloxPage>;
    inFrame(sel: string): VeloxPage;
    frameTree(): Promise<{ id: string; url: string; name?: string; parentId?: string; depth: number }[]>;
    console(): any[];
    errors(): any[];
    activate(): Promise<VeloxPage>;
    close(): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): () => void;
    isClosed: boolean;
  }

  export interface Browser {
    conn: any;
    pages(): VeloxPage[];
    newPage(opts?: PageOptions): Promise<VeloxPage>;
    close(): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): () => void;
    versionInfo?: any;
    closed: boolean;
  }

  export class Pool {
    constructor(opts?: { browsers?: number; pagesPerBrowser?: number; size?: number; launch?: LaunchOptions; pageOpts?: PageOptions });
    acquire(): Promise<VeloxPage>;
    release(page: VeloxPage): void;
    use<T>(fn: (page: VeloxPage) => Promise<T>): Promise<T>;
    map<T>(items: any[], fn: (item: any, page: VeloxPage, index: number) => Promise<T>, opts?: { concurrency?: number }): Promise<T[]>;
    close(): Promise<void>;
    metrics: { created: number; acquired: number; released: number; waited: number };
  }

  export class CookieJar {
    constructor();
    setFrom(url: string, setCookies: string[]): void;
    headerFor(url: string): string | null;
    toJSON(): any[];
    get size(): number;
  }

  export const DEVICES: Record<string, Device>;

  export interface OpenOptions extends PageOptions, VeloxFetchOptions {
    engine?: 'auto' | 'lite' | 'cdp';
    headless?: boolean;
    executablePath?: string;
    browser?: Browser;
    waitUntil?: string;
    stealth?: boolean;
    ads?: boolean;
    routes?: Record<string, (req: RouteRequest) => void>;
  }

  const velox: {
    open(url: string, opts?: OpenOptions): Promise<Session>;
    scrape(url: string, opts?: OpenOptions & { recipe?: 'text' | 'links' | 'images' | 'tables' | 'meta' | 'jsonld' | 'all' }): Promise<any>;
    fetch(url: string, opts?: VeloxFetchOptions): Promise<LiteResponse>;
    launch(opts?: LaunchOptions): Promise<Browser>;
    connect(endpoint: string, opts?: any): Promise<Browser>;
    detect(): { path: string; name: string }[];
    Pool: typeof Pool;
    DEVICES: Record<string, Device>;
    parseHtml(html: string): HtmlDoc;
    needsJS(res: LiteResponse): boolean;
    CookieJar: typeof CookieJar;
    Browser: any;
    VeloxPage: any;
    version: string;
  };

  export default velox;
  export { velox };
}
