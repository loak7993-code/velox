// velox — type definitions
declare module 'velox' {
  export interface ProxyOptions {
    server: string;                 // 'http://host:port' | 'socks5://host:port' | 'host:port'
    username?: string;
    password?: string;
    bypass?: string | string[];     // e.g. ['<-loopback>'] to force loopback through the proxy
  }

  export interface PluginHooks {
    name?: string;
    setup?(api: any): void;
    launchOptions?(opts: LaunchOptions): LaunchOptions;
    pageOptions?(opts: PageOptions): PageOptions;
    contextOptions?(opts: ContextOptions): ContextOptions;
    onBrowser?(browser: Browser): void;
    onPage?(page: VeloxPage): void;
    onRequest?(req: RouteRequest): void;
    onResponse?(entry: RequestEntry): void;
    onError?(err: Error, context?: any): void;
  }

  export interface VeloxConfig {
    timeout?: number; navTimeout?: number; engine?: 'auto' | 'lite' | 'cdp';
    retries?: number; retryDelay?: number; headless?: boolean;
    stealth?: boolean; ads?: boolean; capture?: boolean;
    transport?: 'pipe' | 'socket'; proxy?: string | ProxyOptions; noSandbox?: boolean;
    baseURL?: string; storageState?: string | object; headers?: Record<string, string>; userAgent?: string;
  }

  export interface VeloxFetchOptions {
    /** Conditional-GET cache instance (velox.createCache()). */
    cache?: HttpCache;
    /** Abort the body beyond this many bytes. */
    maxBytes?: number;
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

  /** console messages (page.on('console')) */
  export interface ConsoleMessage { type: string; text: string; page: VeloxPage; }
  /** uncaught page errors (page.on('pageerror')) */
  export interface PageErrorEvent { text: string; url?: string; line?: number; page: VeloxPage; }
  /** dialogs (page.on('dialog')) */
  export interface DialogEvent { type: string; message: string; url?: string; defaultPrompt?: string; respond(accept?: boolean, promptText?: string): Promise<void>; }

  /** what waitForResponse()/netlog() hand back — bodies are one await away */
  export interface ResponseView {
    url: string;
    status: number | null;
    headers: Record<string, string>;
    method: string;
    postData?: string;
    resourceType?: string;
    fromCache?: boolean;
    timing?: any;
    entry: RequestEntry;
    text(): Promise<string | null>;
    body(): Promise<string | null>;
    json(): Promise<any>;
  }

  export interface CaptchaTokenOptions { timeout?: number; poll?: number; type?: string; }
  export interface ChallengeWidget {
    type: 'turnstile' | 'recaptcha' | 'hcaptcha' | 'arkose' | 'awswaf-grid' | 'px' | null;
    sitekey?: string | null;
    iframeUrl?: string | null;
    containerId?: string | null;
    visible?: boolean;
    tokenPresent?: boolean;
    tokenLength?: number;
    scriptLoaded?: boolean;
    markers?: string[];
  }
  export interface DebugDumpResult {
    dir: string; url: string; title: string | null;
    console: { type: string; text: string }[];
    errors: { text: string; url?: string; line?: number }[];
    requests: number; cookies: number; createdAt: string;
  }
  export interface CookieImportResult { cookies: CookieEntry[]; skipped: { cookie: any; why: string }[]; dropped: number; }

  export interface Identity {
    id: string; country: string; countryName: string;
    locale: string; timezone: string; languages: string[];
    firstName: string; lastName: string; fullName: string; username: string;
    email: string; emailLocal: string; emailDomain: string;
    phone: string; phoneCountry: string;
    address: { line1: string; city: string; region: string; postalCode: string; country: string; countryCode: string };
    dob: string; age: number; password: string;
    device: { profile: string; width: number; height: number; dsf: number; seed: number };
    coherence: { ok: boolean; issues: { field: string; why: string }[] };
  }
  export interface RiskReport {
    score: number | null; reasons: string[]; status: number | null;
    markers: string[]; url: string | null; ok: boolean | null; verificationRequired: boolean | null;
  }
  export interface AccountRecord {
    index: number; identity: Identity; url: string; ok: boolean;
    steps: { step: string; ok: boolean; ms: number; error?: string }[];
    risk: RiskReport; signals: any[]; error: string | null;
    cookies: string[]; localStorageKeys: string[]; ua: string | null;
    proxy: string | null; fingerprintSeed: number | null; ms: number;
    extracted: Record<string, any>;
  }
  export interface AccountPlanStep {
    goto?: string; fill?: string; type?: string; value?: any; click?: string; humanClick?: string;
    check?: string; select?: string; press?: string; scroll?: number;
    waitFor?: string; waitForText?: string; waitForCaptchaToken?: string; waitForResponse?: any; waitMs?: number;
    extract?: string; as?: string; assert?: (ctx: any) => any; call?: (ctx: any) => any;
    optional?: boolean; timeout?: number; cps?: number; name?: string;
  }
  export interface AccountPlan {
    url?: string; identity?: Identity | Record<string, any>; steps: AccountPlanStep[];
    expect?: { selector?: string; text?: string; check?: (ctx: any) => any };
    warmup?: boolean | { mouse?: number; scroll?: number; dwellMs?: number };
    waitUntil?: string; timeout?: number; proxy?: any;
  }

  export class AccountRunner {
    constructor(opts?: { browser?: Browser; launch?: LaunchOptions; pool?: ProxyPool; contextOpts?: PageOptions; paceMs?: [number, number]; maxPerHour?: number; keepPages?: boolean; onEvent?: (event: string, payload: any) => void });
    register(plan: AccountPlan, opts?: { index?: number; proxy?: any }): Promise<AccountRecord>;
    farm(plan: AccountPlan, opts?: { count?: number; concurrency?: number; identities?: Identity[]; pace?: [number, number] }): Promise<AccountRecord[]>;
    verifyIsolation(records?: AccountRecord[]): { ok: boolean; issues: any[]; notes: any[]; accounts: number };
    summary(records?: AccountRecord[]): any[];
    readonly records: AccountRecord[];
    close(): Promise<void>;
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
    innerText(): Promise<string | null>;
    innerHTML(): Promise<string | null>;
    getAttribute(name: string): Promise<string | null>;
    inputValue(): Promise<string | null>;
    count(): Promise<number>;
    exists(): Promise<boolean>;
    val(): Promise<string | null>;
    extract(spec?: { text?: boolean; html?: boolean; tag?: boolean; attrs?: string[]; limit?: number }): Promise<any[]>;
    allTextContents(): Promise<string[]>;
    all(): Promise<Locator[]>;
    waitFor(opts?: { state?: 'visible' | 'attached' | 'hidden'; timeout?: number }): Promise<Locator | null>;
    first(): Locator;
    last(): Locator;
    nth(i: number): Locator;
    filter(o: { hasText?: string; has?: string }): Locator;
    locator(sel: string): Locator;
    click(opts?: ClickOptions & { position?: { x: number; y: number }; force?: boolean; trial?: boolean }): Promise<VeloxPage>;
    dblclick(opts?: any): Promise<VeloxPage>;
    tap(opts?: any): Promise<VeloxPage>;
    hover(opts?: any): Promise<VeloxPage>;
    focus(): Promise<any>;
    blur(): Promise<any>;
    scrollIntoViewIfNeeded(o?: { timeout?: number }): Promise<any>;
    type(text: string, opts?: TypeOptions): Promise<VeloxPage>;
    press(key: string, opts?: any): Promise<VeloxPage>;
    fill(value: string, opts?: { timeout?: number }): Promise<VeloxPage>;
    setChecked(checked: boolean, opts?: any): Promise<VeloxPage>;
    check(opts?: any): Promise<VeloxPage>;
    uncheck(opts?: any): Promise<VeloxPage>;
    selectOption(values: any, opts?: any): Promise<string[]>;
    selectText(opts?: any): Promise<any>;
    dragTo(target: string | Locator, opts?: any): Promise<VeloxPage>;
    isChecked(): Promise<boolean>;
    isDisabled(): Promise<boolean>;
    isEditable(): Promise<boolean>;
    isVisible(): Promise<boolean>;
    isHidden(): Promise<boolean>;
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    ariaSnapshot(): Promise<string>;
    screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
    elementHandle(): Promise<ElementHandle>;
    evaluate(fn: (el: any, arg?: any) => any, arg?: any): Promise<any>;
  }

  export interface GotoOptions { waitUntil?: 'none' | 'interactive' | 'load' | 'networkidle' | 'settle'; timeout?: number; referer?: string; }
  export interface ClickOptions { timeout?: number; button?: 'left' | 'right' | 'middle'; clicks?: number; modifiers?: ('alt' | 'ctrl' | 'meta' | 'shift')[]; delay?: number; inPage?: boolean; }
  export interface TypeOptions { delay?: number; human?: boolean; timeout?: number; }
  export interface ScreenshotOptions { path?: string; full?: boolean; selector?: string; type?: 'png' | 'jpeg'; quality?: number; fast?: boolean; clip?: { x: number; y: number; width: number; height: number }; }
  export interface PdfOptions { path?: string; format?: string | [number, number]; landscape?: boolean; printBackground?: boolean; margin?: { top?: number; right?: number; bottom?: number; left?: number }; scale?: number; headerTemplate?: string; footerTemplate?: string; preferCSSPageSize?: boolean; }

  export interface BandwidthRules {
    preset?: 'full' | 'lean' | 'minimal' | 'text-only';
    block?: string[];
    maxBytes?: number;
    blockThirdParty?: boolean;
  }

  export interface StealthOptions {
    profile?: 'chrome-linux' | 'chrome-windows' | 'chrome-mac' | 'chrome-android';
    geo?: string;                  // 'de-DE' → locale + timezone + Accept-Language together
    locale?: string; timezone?: string; acceptLanguage?: string;
    noise?: boolean;               // canvas/audio noise (default true)
    seed?: number;                 // deterministic noise: same seed → same fingerprint
    webrtc?: 'default' | 'block';
    mediaDevices?: boolean;
    hideEngine?: boolean;
    /** add the chrome.runtime shim — OFF by default: a clean page has {app, csi, loadTimes} only */
    chromeRuntime?: boolean;
  }

  export interface ChallengeInfo {
    vendor: string | null;
    detected: string[];
    signals: string[];
    cleared: boolean;
    challenged: boolean;
    outcome?: { vendor: string | null; cleared: boolean; acted: string[]; ms: number; timeout?: boolean };
  }

  export interface HumanBehaviour {
    moveTo(x: number, y: number, o?: { overshoot?: number }): Promise<HumanBehaviour>;
    click(sel: string, o?: { hold?: number; dwell?: number; button?: string }): Promise<VeloxPage>;
    clickAt(x: number, y: number, o?: { hold?: number; button?: string }): Promise<VeloxPage>;
    type(sel: string, text: string, o?: { cps?: number; mistakes?: number }): Promise<VeloxPage>;
    scroll(o?: { by?: number; read?: boolean; to?: number }): Promise<HumanBehaviour>;
    /** Press & hold with tremor for hold/style challenges (PerimeterX). */
    hold(sel: string | { x: number; y: number }, o?: { ms?: number; jitter?: number; microMoves?: number; button?: string }): Promise<VeloxPage>;
    /** Look alive before the first interaction: cursor moves, scrolls, idle dwell. */
    warmup(o?: { mouse?: number; scroll?: number; dwellMs?: number }): Promise<VeloxPage>;
    idle(ms?: number): Promise<HumanBehaviour>;
    readText(sel: string, o?: { wpm?: number }): Promise<number>;
    position(): Promise<{ x: number; y: number }>;
  }

  export interface PageOptions {
    stealth?: boolean | StealthOptions;
    human?: boolean | { seed?: number; speed?: number; jitter?: number };
    bandwidth?: 'full' | 'lean' | 'minimal' | 'text-only' | BandwidthRules;
    capture?: boolean;              // false = skip the Network domain (faster, no request log)
    proxy?: ProxyOptions;
    retries?: number; retryDelay?: number;
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
    transport?: 'pipe' | 'socket';
    noSandbox?: boolean;
    /** Blank renderers kept warm so newPage() is ~2ms. Default 1, 0 disables. */
    spare?: number;
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
    context: BrowserContext | null;
    clock: { install(o?: { time?: string | number | Date }): Promise<any>; setFixedTime(t: string | number | Date): Promise<any>; advance(ms: number): Promise<any>; fastForward(ms: number): Promise<any>; resume(): Promise<any>; };
    video: { start(o?: { path?: string; dir?: string; width?: number; maxFrames?: number }): Promise<any>; stop(): Promise<any | null>; recorder: any };
    coverage: { startJSCoverage(): Promise<void>; stopJSCoverage(): Promise<any[]>; startCSSCoverage(): Promise<void>; stopCSSCoverage(): Promise<any[]> };
    accessibility: { snapshot(o?: { interestingOnly?: boolean }): Promise<any>; yaml(): Promise<string> };
    locator(sel: string): Locator;
    getByRole(role: string, o?: { name?: string; exact?: boolean }): Locator;
    getByText(text: string, o?: { exact?: boolean }): Locator;
    getByLabel(text: string, o?: { exact?: boolean }): Locator;
    getByPlaceholder(text: string, o?: { exact?: boolean }): Locator;
    getByAltText(text: string, o?: { exact?: boolean }): Locator;
    getByTitle(text: string, o?: { exact?: boolean }): Locator;
    getByTestId(id: string): Locator;
    $eval(sel: string, fn: (el: any, arg?: any) => any, arg?: any): Promise<any>;
    $$eval(sel: string, fn: (els: any[], arg?: any) => any, arg?: any): Promise<any>;
    evaluateHandle(jsOrFn: any, arg?: any): Promise<JSHandle>;
    elementHandle(sel: string): Promise<ElementHandle>;
    elementHandles(sel: string): Promise<ElementHandle[]>;
    waitForEvent(name: string, o?: { predicate?: (p: any) => boolean; timeout?: number }): Promise<any>;
    waitForRequest(match: string | RegExp | ((url: string) => boolean), o?: { timeout?: number }): Promise<RequestEntry>;
    waitForResponse(match: string | RegExp | ((url: string) => boolean), o?: { timeout?: number }): Promise<RequestEntry>;
    waitForRequestFinished(match: any, o?: { timeout?: number }): Promise<RequestEntry>;
    waitForDialog(timeout?: number): Promise<any>;
    waitForPopup(timeout?: number): Promise<VeloxPage>;
    waitForDownload(timeout?: number): Promise<Download>;
    setOffline(offline?: boolean): Promise<VeloxPage>;
    emulateNetwork(o?: { offline?: boolean; latency?: number; downloadThroughput?: number; uploadThroughput?: number }): Promise<VeloxPage>;
    addInitScript(fnOrSrc: any): Promise<string>;
    removeInitScript(identifier?: string): Promise<boolean>;
    addScriptTag(o: { url?: string; content?: string; path?: string }): Promise<any>;
    addStyleTag(o: { url?: string; content?: string; path?: string }): Promise<any>;
    dragAndDrop(source: string, target: string, o?: { steps?: number }): Promise<VeloxPage>;
    emulateMedia(o?: { media?: string; colorScheme?: string; reducedMotion?: string }): Promise<VeloxPage>;
    setViewportSize(size: { width: number; height: number }): Promise<VeloxPage>;
    bringToFront(): Promise<VeloxPage>;
    createCDPSession(): any;
    frames(): Promise<any[]>;
    frameLocator(sel: string): any;
    goto(url: string, opts?: GotoOptions): Promise<{ url: string; status: number | null; ms: number }>;
    reload(opts?: GotoOptions): Promise<VeloxPage>;
    back(): Promise<boolean>;
    forward(): Promise<boolean>;
    wait(ms: number): Promise<void>;
    waitForLoad(state?: string, timeout?: number): Promise<boolean>;
    waitForUrl(match: string | RegExp, timeout?: number): Promise<string>;
    waitForFunction(js: string, opts?: { timeout?: number }): Promise<any>;
    /** Run several actions over one pipelined flush — [method, ...args] or a function. */
    batch(actions: any[], opts?: { concurrency?: number }): Promise<any[]>;
    /** Pre-parse selectors in the page. */
    warm(selectors: string | string[]): Promise<number>;
    /** Register a custom in-page selector engine, used as `name=value`. */
    addSelectorEngine(name: string, fn: ((value: string, root: any) => any[]) | string): Promise<any>;
    setDefaultTimeout(ms: number): VeloxPage;
    /** Bytes actually transferred, grouped by type, plus what the profile blocked. */
    transferred(): { total: number; byType: Record<string, number>; human: string; blockedBytes: number; blocked: Record<string, number>; profile: string };
    blockedRequests(): { reason: string; count: number }[];
    setBandwidth(profile: PageOptions['bandwidth']): Promise<VeloxPage>;
    /** Human-like interaction (attached automatically). */
    human: HumanBehaviour;
    /** Bot-management awareness: detect / engage / navigate through challenges. */
    challenge: {
      detect(o?: { url?: string }): Promise<ChallengeInfo>;
      isCleared(vendor?: string | null, o?: { url?: string }): Promise<boolean>;
      engage(o?: { human?: boolean; vendor?: string; timeout?: number }): Promise<any>;
      goto(url: string, o?: { timeout?: number; waitUntil?: string; engage?: boolean; human?: boolean }): Promise<{ response: any; challenge: ChallengeInfo }>;
      open(url: string, o?: any): Promise<any>;
    };
    /** Free namespace for your own extensions. */
    ext: Record<string, any>;
    /** Wait for a captcha token field to populate; on timeout says WHICH state it died in. */
    waitForCaptchaToken(selector?: string, o?: CaptchaTokenOptions): Promise<string>;
    /** Structured info about the anti-bot widget on the page (prefix-matches dynamic container ids). */
    detectChallenge(): Promise<ChallengeWidget>;
    /** Filtered network log with lazy bodies: page.netlog(/checkout|auth/) */
    netlog(filter?: string | RegExp | ((e: RequestEntry) => boolean)): ResponseView[];
    /** DOM + network + console + errors + storage + screenshot in one call. */
    debugDump(dir?: string, o?: { fullPage?: boolean }): Promise<DebugDumpResult>;
    /** Navigate with backoff — flaky residential proxies are the normal case. */
    gotoWithRetry(url: string, o?: { retries?: number; backoff?: number; factor?: number; waitUntil?: string; timeout?: number; onAttempt?: (a: any, e: Error | null) => void; retryOn?: (e: Error) => boolean }): Promise<{ url: string; status: number | null; ms: number; attempts: any[] }>;
    /** Raw CDP passthrough. */
    cdp(method: string, params?: Record<string, any>): Promise<any>;
    cdpFire(method: string, params?: Record<string, any>): void;
    /** Cookie/session plumbing for hybrid HTTP+browser pipelines. */
    importSession(input: CookieEntry[] | string, o?: { domain?: string; urlFilter?: string | RegExp }): Promise<{ imported: number }>;
    exportSession(): Promise<any>;
    importCurl(cookieHeader: string, o?: { domain?: string }): Promise<{ imported: number }>;
    importHAR(file: string, o?: { urlFilter?: string | RegExp }): Promise<{ imported: number }>;
    /** Playwright alias for waitForLoad(). */
    waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', timeout?: number): Promise<boolean>;
    prewarm(count?: number, opts?: PageOptions): Promise<number>;
    waitForDownload(timeout?: number): Promise<Download>;
    healthy(opts?: { timeout?: number }): Promise<boolean>;
    reconnect(opts?: { attempts?: number; delay?: number }): Promise<Browser>;
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
    newContext(opts?: ContextOptions): Promise<BrowserContext>;
    defaultContext(): BrowserContext;
    close(): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): () => void;
    waitForEvent(event: string, opts?: { predicate?: (p: any) => boolean; timeout?: number }): Promise<any>;
    healthy(opts?: { timeout?: number }): Promise<boolean>;
    reconnect(opts?: { attempts?: number; delay?: number }): Promise<Browser>;
    proxy?: ProxyOptions;
    versionInfo?: any;
    closed: boolean;
  }

  export class ProxyPool {
    constructor(proxies: (string | ProxyOptions)[], opts?: {
      strategy?: 'round-robin' | 'random' | 'least-used' | 'least-latency';
      maxFailures?: number; cooldownMs?: number;
      healthCheckUrl?: string; healthCheckTimeout?: number;
    });
    readonly size: number;
    available(): ProxyEntry[];
    next(): ProxyEntry;
    sticky(key: string): ProxyEntry;
    release(proxy: ProxyEntry | string, outcome?: { ok?: boolean; latency?: number }): void;
    withProxy<T>(fn: (proxy: ProxyEntry) => Promise<T>, opts?: { attempts?: number }): Promise<T>;
    healthCheck(o?: { url?: string; ipUrl?: string; timeout?: number }): Promise<any[]>;
    stats(): { id: string; server: string; uses: number; failures: number; latency: number | null; ejected: boolean }[];
  }
  export interface ProxyEntry extends ProxyOptions {
    id: string; scheme: string; host: string; port: number; url: string;
    latency: number | null; uses: number; failures: number; ejectedUntil: number;
    toProxy(): ProxyOptions;
  }

  export interface ContextOptions extends PageOptions {
    baseURL?: string;
    storageState?: string | { cookies: CookieEntry[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
    httpCredentials?: { username: string; password: string };
    serviceWorkers?: 'allow' | 'block';
    bypassCSP?: boolean;
    offline?: boolean;
    testIdAttribute?: string;
    recordVideo?: { dir: string };
    contextOpts?: Record<string, any>;
  }

  export interface BrowserContext {
    browser: Browser;
    pages(): VeloxPage[];
    newPage(opts?: PageOptions): Promise<VeloxPage>;
    route(pattern: string | RegExp, handler: (req: RouteRequest) => void): BrowserContext;
    unroute(pattern: string | RegExp): BrowserContext;
    addInitScript(fnOrSrc: any): BrowserContext;
    expose(name: string, fn: (...args: any[]) => any): Promise<void>;
    exposeBinding(name: string, fn: (...args: any[]) => any): Promise<void>;
    setExtraHTTPHeaders(headers: Record<string, string>): Promise<BrowserContext>;
    cookies(urls?: string[]): Promise<CookieEntry[]>;
    setCookies(cookies: CookieEntry[]): Promise<BrowserContext>;
    clearCookies(): Promise<BrowserContext>;
    storageState(path?: string): Promise<any>;
    setStorageState(stateOrPath: any): Promise<BrowserContext>;
    grantPermissions(perms: string[], o?: { origin?: string }): Promise<BrowserContext>;
    clearPermissions(): Promise<BrowserContext>;
    setOffline(offline?: boolean): Promise<BrowserContext>;
    setGeolocation(g: { latitude: number; longitude: number; accuracy?: number }): Promise<BrowserContext>;
    setColorScheme(s: string): Promise<BrowserContext>;
    newCDPSession(page: VeloxPage): Promise<any>;
    request: { fetch(url: any, o?: any): Promise<any>; get(u: any, o?: any): Promise<any>; post(u: any, o?: any): Promise<any>; put(u: any, o?: any): Promise<any>; patch(u: any, o?: any): Promise<any>; delete(u: any, o?: any): Promise<any>; head(u: any, o?: any): Promise<any> };
    startTracing(o?: { screenshots?: boolean; categories?: string[] }): Promise<BrowserContext>;
    stopTracing(path?: string): Promise<any>;
    close(): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): () => void;
  }

  export interface JSHandle {
    evaluate(fn: (el: any, arg?: any) => any, arg?: any): Promise<any>;
    jsonValue(): Promise<any>;
    getProperties(): Promise<Record<string, any>>;
    getProperty(name: string): Promise<any>;
    dispose(): Promise<void>;
    toString(): string;
  }
  export interface ElementHandle extends JSHandle {
    click(o?: any): Promise<VeloxPage>;
    point(): Promise<{ x: number; y: number } | null>;
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    text(): Promise<string | null>;
    attr(name: string): Promise<string | null>;
    html(): Promise<string | null>;
    fill(value: string): Promise<boolean>;
    type(text: string, o?: { delay?: number }): Promise<VeloxPage>;
    press(key: string): Promise<VeloxPage>;
    focus(): Promise<any>;
    scrollIntoView(): Promise<any>;
    $(sel: string): Promise<ElementHandle | null>;
    $$(sel: string): Promise<ElementHandle[]>;
    screenshot(o?: any): Promise<Buffer>;
  }
  export interface Download {
    url: string;
    suggestedFilename: string;
    state: string;
    filename: string;
    finished(timeout?: number): Promise<Download>;
    path(): string | null;
    saveAs(target: string): Promise<string>;
    cancel(): Promise<void>;
  }
  export interface WebSocketTracker {
    url: string;
    framesSent: { text: string; opcode: number; timestamp: number }[];
    framesReceived: { text: string; opcode: number; timestamp: number }[];
    isClosed: boolean;
    on(event: string, handler: (...args: any[]) => void): () => void;
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

  export class HttpCache {
    constructor(opts?: { dir?: string; maxEntries?: number; maxBytes?: number; ttl?: number });
    get(url: string): any;
    set(url: string, entry: any): any;
    clear(): void;
    readonly size: number;
    readonly bytes: number;
    stats: { hits: number; misses: number; revalidated: number; stores: number; bytesServed: number; bytesSaved: number; bytesFetched: number };
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
    launchPersistentContext(userDataDir: string, opts?: LaunchOptions & { contextOpts?: Record<string, any> }): Promise<BrowserContext>;
    connect(endpoint: string, opts?: any): Promise<Browser>;
    detect(): { path: string; name: string }[];
    Pool: typeof Pool;
    DEVICES: Record<string, Device>;
    parseHtml(html: string): HtmlDoc;
    needsJS(res: LiteResponse): boolean;
    CookieJar: typeof CookieJar;
    expect(target: any, opts?: any): any;
    fetchAll(urls: (string | any)[], opts?: VeloxFetchOptions & { concurrency?: number }): Promise<LiteResponse[]>;
    ProxyPool: typeof ProxyPool;
    checkProxy(proxy: string | ProxyOptions, o?: { url?: string; ipUrl?: string; timeout?: number }): Promise<any>;
    normalizeProxy(proxy: string | ProxyOptions): ProxyOptions;
    config(patch?: VeloxConfig): VeloxConfig;
    getConfig(): VeloxConfig;
    use(plugin: PluginHooks | (() => PluginHooks)): PluginHooks;
    plugins: Record<string, any>;
    registerDevice(name: string, def: Device): Device;
    createCache(opts?: { dir?: string; ttl?: number; maxEntries?: number; maxBytes?: number }): HttpCache;
    /** Wrap every page command: velox.middleware((ctx, next) => …) */
    middleware(fn: (ctx: { page: VeloxPage; method: string; args: any[] }, next: (args?: any[]) => Promise<any>) => any): () => void;
    /** Add your own methods to pages, browsers or locators. */
    registerCommand(name: string, fn: (...args: any[]) => any, o?: { target?: 'page' | 'browser' | 'locator' }): any;
    /** Register a selector engine globally (usable as `name=value` everywhere). */
    registerSelectorEngine(name: string, fn: ((value: string, root: any) => any[]) | string): any;
    /** Extra lifecycle hooks: onNavigation, onPage, onBrowser, onRequest, onResponse, onError, onChallenge. */
    hook(name: string, fn: (...args: any[]) => void): () => void;
    /** Introspect registered extensions. */
    extensions(): { middleware: number; commands: { page: string[]; browser: string[]; locator: string[] }; selectorEngines: string[]; hooks: Record<string, number> };
    /** Stealth profiles + geo presets. */
    STEALTH: { profiles: Record<string, any>; geo: Record<string, any> };
    /** Challenge helpers usable without a page handle. */
    challenge: { detect: any; engage: any; goto: any; vendors: Record<string, any> };
    /** Pre-launch browsers (and optionally pages) so launch()/open() are instant. */
    prewarm(opts?: LaunchOptions & { browsers?: number; pagesPerBrowser?: number }): Promise<Browser[]>;
    /** Coherent synthetic identities for onboarding/fraud-control testing. */
    identity: {
      generate(opts?: { country?: string; seed?: number; emailDomain?: string; realistic?: boolean; emailStyle?: 'name' | 'nameNum' | 'initial' | 'flanked'; minAge?: number; maxAge?: number; password?: string }): Identity;
      generateMany(count: number, opts?: any): Identity[];
      check(id: Identity): { ok: boolean; issues: { field: string; why: string }[] };
      stealth(id: Identity, extra?: any): any;
      geo(id: Identity): { country: string; locale: string; timezone: string; languages: string[] };
      countries: Record<string, any>;
      disposableEmailDomains: string[];
    };
    AccountRunner: typeof AccountRunner;
    readRiskReport(page: VeloxPage, o?: { urlFilter?: RegExp; maxBodies?: number }): Promise<RiskReport>;
    behaviouralRegularity(page: VeloxPage): Promise<{ score: number | null; measurements?: any; reason?: string }>;
    /** Local forwarder for an authenticated upstream proxy (reliable where CDP proxy auth fails). */
    proxyForward(upstream: any, o?: { host?: string; port?: number; auth?: { username: string; password: string } }): Promise<{ server: string; port: number; direct: boolean; stats: any; close(): Promise<void> }>;
    /** Import a session (cookies array, curl header or HAR) — applies to the next page/context. */
    importSession(input: any, o?: any): { cookies: CookieEntry[]; localStorage: any[] };
    normalizeCookies(cookies: any): CookieImportResult;
    parseCurlCookies(header: string, o?: { domain?: string }): CookieEntry[];
    parseNetscapeCookies(text: string): CookieEntry[];
    importHAR(source: string, o?: { urlFilter?: string | RegExp }): { cookies: CookieEntry[] };
    BANDWIDTH: Record<'full' | 'lean' | 'minimal' | 'text-only', BandwidthRules>;
    fmtBytes(n: number): string;
    Browser: any;
    BrowserContext: any;
    VeloxPage: any;
    Locator: any;
    JSHandle: any;
    ElementHandle: any;
    Download: any;
    WebSocketTracker: any;
    version: string;
  };

  export default velox;
  export { velox };
}
