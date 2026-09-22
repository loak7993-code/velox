// velox :: cdp/har.js — HAR 1.2 export from captured entries
export function buildHar(entries) {
  const toHeaders = (h = {}) => Object.entries(h).map(([name, value]) => ({ name, value: String(value) }));
  return {
    log: {
      version: '1.2',
      creator: { name: 'velox', version: '1.0.0' },
      pages: [{ startedDateTime: new Date().toISOString(), id: 'page_1', title: 'velox capture', pageTimings: {} }],
      entries: entries.map(({ e, content }) => {
        const resp = e.response || {};
        const hdrs = toHeaders(resp.headers);
        const ct = hdrs.find((h) => h.name.toLowerCase() === 'content-type')?.value;
        const t = resp.timing || {};
        const blocked = Math.max(0, (t.dnsStart || 0));
        const dns = Math.max(0, (t.dnsEnd || 0) - (t.dnsStart || 0));
        const connect = Math.max(0, (t.connectEnd || 0) - (t.connectStart || 0));
        const send = Math.max(0, (t.sendEnd || 0) - (t.sendStart || 0));
        const wait = Math.max(0, (t.receiveHeadersEnd || 0) - (t.sendEnd || 0));
        return {
          pageref: 'page_1',
          startedDateTime: new Date((e.wallTime || Date.now() / 1000) * 1000).toISOString(),
          time: blocked + dns + connect + send + wait,
          request: {
            method: e.method, url: e.url, httpVersion: resp.protocol || 'http/1.1',
            headers: toHeaders(e.headers), queryString: [...new URL(e.url).searchParams].map(([name, value]) => ({ name, value })),
            headersSize: -1, bodySize: e.postData ? e.postData.length : 0,
            ...(e.postData !== undefined ? { postData: { mimeType: 'application/octet-stream', text: e.postData } } : {}),
          },
          response: {
            status: resp.status || 0, statusText: resp.statusText || '',
            httpVersion: resp.protocol || 'http/1.1', headers: hdrs,
            content: { size: e.encodedDataLength || 0, mimeType: ct || '', ...(content ? { text: content.text, encoding: content.encoding } : {}) },
            redirectURL: e.redirectChain?.length ? e.redirectChain[e.redirectChain.length - 1].url : '',
            headersSize: -1, bodySize: e.encodedDataLength || 0,
          },
          cache: {},
          timings: { blocked, dns, connect, send, wait, receive: 0, ssl: connect },
          ...(e.redirectChain?.length ? { _redirects: e.redirectChain.length } : {}),
          _resourceType: e.resourceType, _remoteIP: resp.remoteIP || '', _canceled: !!e.canceled, _failed: e.failed || false,
        };
      }),
    },
  };
}
