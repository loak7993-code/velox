// velox :: cdp/coverage.js — JS & CSS coverage via Profiler/CSS domains
export class Coverage {
  constructor(page) {
    this.page = page;
    this.session = page.session;
    this._jsOn = false;
    this._cssOn = false;
    this._sheets = new Map(); // styleSheetId → sourceURL
    this.session.on('CSS.styleSheetAdded', ({ header }) => {
      if (header?.sourceURL) this._sheets.set(header.styleSheetId, header.sourceURL);
    });
  }

  async startJSCoverage() {
    await this.session.send('Profiler.enable');
    await this.session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    this._jsOn = true;
  }
  async stopJSCoverage() {
    if (!this._jsOn) return [];
    this._jsOn = false;
    const { result } = await this.session.send('Profiler.takePreciseCoverage');
    await this.session.send('Profiler.stopPreciseCoverage').catch(() => {});
    // flatten to per-script executed ranges
    return result.map((entry) => ({
      url: entry.url,
      scriptId: entry.scriptId,
      functions: entry.functions.map((f) => ({
        functionName: f.functionName,
        ranges: f.ranges.map((r) => ({ start: r.startOffset, end: r.endOffset, count: r.count })),
      })),
    }));
  }

  async startCSSCoverage() {
    await this.session.send('CSS.enable');
    await this.session.send('CSS.startRuleUsageTracking');
    this._cssOn = true;
  }
  async stopCSSCoverage() {
    if (!this._cssOn) return [];
    this._cssOn = false;
    const { ruleUsage } = await this.session.send('CSS.stopRuleUsageTracking');
    await this.session.send('CSS.disable').catch(() => {});
    const bySheet = new Map();
    for (const r of ruleUsage) {
      const url = this._sheets.get(r.styleSheetId) || r.styleSheetId;
      if (!bySheet.has(url)) bySheet.set(url, []);
      bySheet.get(url).push({ start: r.startOffset, end: r.endOffset, used: r.used });
    }
    return [...bySheet.entries()].map(([url, ranges]) => ({ url, ranges }));
  }
}
