// velox :: cdp/devices.js — device emulation presets
const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  bot: 'Mozilla/5.0 (compatible; VeloxBot/1.0; +https://velox.dev/bot)',
};

export const DEVICES = {
  desktop: { width: 1366, height: 768, dsf: 1, mobile: false, ua: UA.win, platform: 'Windows' },
  desktop_hd: { width: 1920, height: 1080, dsf: 1, mobile: false, ua: UA.win, platform: 'Windows' },
  mac: { width: 1512, height: 982, dsf: 2, mobile: false, ua: UA.mac, platform: 'macOS' },
  iphone_13: { width: 390, height: 844, dsf: 3, mobile: true, touch: true, ua: UA.iphone, platform: 'iPhone' },
  iphone_15: { width: 393, height: 852, dsf: 3, mobile: true, touch: true, ua: UA.iphone, platform: 'iPhone' },
  iphone_se: { width: 375, height: 667, dsf: 2, mobile: true, touch: true, ua: UA.iphone, platform: 'iPhone' },
  ipad: { width: 820, height: 1180, dsf: 2, mobile: true, touch: true, ua: UA.ipad, platform: 'iPad' },
  pixel_8: { width: 412, height: 915, dsf: 2.625, mobile: true, touch: true, ua: UA.android, platform: 'Linux armv8l' },
  galaxy_s24: { width: 384, height: 854, dsf: 3, mobile: true, touch: true, ua: UA.android, platform: 'Linux armv8l' },
  bot: { width: 1280, height: 720, dsf: 1, mobile: false, ua: UA.bot, platform: 'Linux x86_64' },
};
