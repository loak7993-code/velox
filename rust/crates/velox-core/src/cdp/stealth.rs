// velox-rs :: cdp/stealth — fingerprint hardening with mutually coherent values
// (platform ↔ UA-CH ↔ WebGL ↔ screen ↔ fonts ↔ locale ↔ timezone). The injected
// JS template is EXTRACTED FROM THE SHARED SOURCE (src/cdp/stealth.js) at build
// time; this module ports the profile data + resolution + version alignment and
// substitutes the resolved values, so behaviour stays in lockstep with the JS
// package by construction.
use anyhow::{Result, anyhow};
use serde_json::{Value, json};

include!(concat!(env!("OUT_DIR"), "/stealth_assets.rs"));

/// A device profile: every value is claimed coherently.
#[derive(Debug, Clone)]
pub struct Profile {
    pub name: &'static str,
    pub user_agent: &'static str,
    pub ua_metadata: Value,
    pub platform: &'static str,
    pub ua_platform: &'static str,
    pub ua_platform_version: &'static str,
    pub vendor: &'static str,
    pub webgl_vendor: &'static str,
    pub webgl_renderer: &'static str,
    pub hardware_concurrency: u32,
    pub device_memory: u32,
    pub screen: Screen,
    pub languages: &'static [&'static str],
    pub locale: &'static str,
    pub timezone: &'static str,
    pub max_touch_points: u32,
    pub mobile: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct Screen {
    pub width: u32,
    pub height: u32,
    pub avail_width: u32,
    pub avail_height: u32,
    pub color_depth: u32,
    pub pixel_depth: u32,
}

fn brands(v: u32) -> Value {
    json!([
        { "brand": "Chromium", "version": v.to_string() },
        { "brand": "Google Chrome", "version": v.to_string() },
        { "brand": "Not)A;Brand", "version": "24" },
    ])
}

pub static PROFILES: once_cell::sync::Lazy<Vec<Profile>> = once_cell::sync::Lazy::new(|| {
    vec![
        Profile {
            name: "chrome-linux",
            user_agent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            ua_metadata: json!({ "brands": brands(128), "fullVersion": "128.0.0.0", "platform": "Linux", "platformVersion": "6.6.0", "architecture": "x86", "bitness": "64", "model": "", "mobile": false }),
            platform: "Linux x86_64",
            ua_platform: "Linux",
            ua_platform_version: "6.6.0",
            vendor: "Google Inc.",
            webgl_vendor: "Google Inc.",
            webgl_renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
            hardware_concurrency: 8,
            device_memory: 8,
            screen: Screen {
                width: 1920,
                height: 1080,
                avail_width: 1920,
                avail_height: 1040,
                color_depth: 24,
                pixel_depth: 24,
            },
            languages: &["en-US", "en"],
            locale: "en-US",
            timezone: "America/New_York",
            max_touch_points: 0,
            mobile: false,
        },
        Profile {
            name: "chrome-windows",
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            ua_metadata: json!({ "brands": brands(128), "fullVersion": "128.0.0.0", "platform": "Windows", "platformVersion": "15.0.0", "architecture": "x86", "bitness": "64", "model": "", "mobile": false }),
            platform: "Win32",
            ua_platform: "Windows",
            ua_platform_version: "15.0.0",
            vendor: "Google Inc.",
            webgl_vendor: "Google Inc.",
            webgl_renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
            hardware_concurrency: 12,
            device_memory: 8,
            screen: Screen {
                width: 1920,
                height: 1080,
                avail_width: 1920,
                avail_height: 1032,
                color_depth: 24,
                pixel_depth: 24,
            },
            languages: &["en-US", "en"],
            locale: "en-US",
            timezone: "America/Chicago",
            max_touch_points: 0,
            mobile: false,
        },
        Profile {
            name: "chrome-mac",
            user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            ua_metadata: json!({ "brands": brands(128), "fullVersion": "128.0.0.0", "platform": "macOS", "platformVersion": "14.5.0", "architecture": "arm", "bitness": "64", "model": "", "mobile": false }),
            platform: "MacIntel",
            ua_platform: "macOS",
            ua_platform_version: "14.5.0",
            vendor: "Google Inc.",
            webgl_vendor: "Google Inc.",
            webgl_renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
            hardware_concurrency: 10,
            device_memory: 8,
            screen: Screen {
                width: 1512,
                height: 982,
                avail_width: 1512,
                avail_height: 944,
                color_depth: 30,
                pixel_depth: 30,
            },
            languages: &["en-US", "en"],
            locale: "en-US",
            timezone: "America/Los_Angeles",
            max_touch_points: 0,
            mobile: false,
        },
        Profile {
            name: "chrome-android",
            user_agent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
            ua_metadata: json!({ "brands": brands(128), "fullVersion": "128.0.0.0", "platform": "Android", "platformVersion": "14.0.0", "architecture": "", "bitness": "", "model": "Pixel 8", "mobile": true }),
            platform: "Linux armv8l",
            ua_platform: "Android",
            ua_platform_version: "14.0.0",
            vendor: "Google Inc.",
            webgl_vendor: "Qualcomm",
            webgl_renderer: "Adreno (TM) 740",
            hardware_concurrency: 8,
            device_memory: 4,
            screen: Screen {
                width: 412,
                height: 915,
                avail_width: 412,
                avail_height: 915,
                color_depth: 24,
                pixel_depth: 24,
            },
            languages: &["en-US", "en"],
            locale: "en-US",
            timezone: "America/New_York",
            max_touch_points: 5,
            mobile: true,
        },
    ]
});

/// locale → coherent timezone / Accept-Language, so a geo preset cannot contradict itself.
pub fn geo(locale: &str) -> Option<(&'static str, &'static str)> {
    Some(match locale {
        "en-US" => ("America/New_York", "en-US,en;q=0.9"),
        "en-GB" => ("Europe/London", "en-GB,en;q=0.9"),
        "de-DE" => ("Europe/Berlin", "de-DE,de;q=0.9,en;q=0.8"),
        "fr-FR" => ("Europe/Paris", "fr-FR,fr;q=0.9,en;q=0.8"),
        "es-ES" => ("Europe/Madrid", "es-ES,es;q=0.9,en;q=0.8"),
        "pt-BR" => ("America/Sao_Paulo", "pt-BR,pt;q=0.9,en;q=0.8"),
        "ja-JP" => ("Asia/Tokyo", "ja-JP,ja;q=0.9,en;q=0.8"),
        "ko-KR" => ("Asia/Seoul", "ko-KR,ko;q=0.9,en;q=0.8"),
        "zh-CN" => ("Asia/Shanghai", "zh-CN,zh;q=0.9,en;q=0.8"),
        "ru-RU" => ("Europe/Moscow", "ru-RU,ru;q=0.9,en;q=0.8"),
        "nl-NL" => ("Europe/Amsterdam", "nl-NL,nl;q=0.9,en;q=0.8"),
        "it-IT" => ("Europe/Rome", "it-IT,it;q=0.9,en;q=0.8"),
        "pl-PL" => ("Europe/Warsaw", "pl-PL,pl;q=0.9,en;q=0.8"),
        "tr-TR" => ("Europe/Istanbul", "tr-TR,tr;q=0.9,en;q=0.8"),
        "id-ID" => ("Asia/Jakarta", "id-ID,id;q=0.9,en;q=0.8"),
        _ => return None,
    })
}

/// How the stealth layer is configured. `Default` matches the JS package's
/// `stealth: true` (chrome-linux, seed 1337, noise on, hide the engine surface).
#[derive(Debug, Clone)]
pub struct StealthOpts {
    pub profile: Option<String>,
    pub geo: Option<String>,
    pub locale: Option<String>,
    pub timezone: Option<String>,
    pub user_agent: Option<String>,
    pub seed: u32,
    pub noise: bool,
    pub webrtc_block: bool,
    pub media_devices: bool,
    pub hide_engine: bool,
    pub chrome_runtime: bool,
}

impl Default for StealthOpts {
    fn default() -> Self {
        StealthOpts {
            profile: None,
            geo: None,
            locale: None,
            timezone: None,
            user_agent: None,
            seed: 1337,
            noise: true,
            webrtc_block: false,
            media_devices: true,
            hide_engine: true,
            chrome_runtime: false,
        }
    }
}

/// A resolved, coherent configuration.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub profile: &'static Profile,
    pub profile_name: String,
    pub user_agent: String,
    pub locale: String,
    pub languages: Vec<String>,
    pub timezone: String,
    pub accept_language: String,
    pub seed: u32,
    pub noise: bool,
    pub webrtc: &'static str,
    pub media_devices: bool,
    pub hide_engine: bool,
    pub chrome_runtime: bool,
}

/// Resolve the option set into a coherent profile (ported from resolveStealth):
/// explicit locale/timezone win over the geo preset, which wins over the profile;
/// locale/languages/Accept-Language are kept in sync.
pub fn resolve(opts: &StealthOpts) -> Result<Resolved> {
    let name = opts.profile.as_deref().unwrap_or("chrome-linux");
    let profile = PROFILES.iter().find(|p| p.name == name).ok_or_else(|| {
        anyhow!(
            "unknown stealth profile \"{name}\" — try: {}",
            PROFILES
                .iter()
                .map(|p| p.name)
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;

    let geo_tz = opts.geo.as_deref().and_then(geo);
    let explicit_langs: Option<Vec<String>> = None; // Rust API passes locale instead

    let locale = opts
        .locale
        .clone()
        .or_else(|| opts.geo.clone())
        .unwrap_or_else(|| profile.locale.to_string());

    let languages: Vec<String> = match explicit_langs {
        Some(l) => l,
        None => {
            if let Some(g) = &opts.geo {
                let base = g.split('-').next().unwrap_or(g).to_string();
                vec![g.clone(), base, "en".to_string()]
            } else {
                let base = locale.split('-').next().unwrap_or(&locale).to_string();
                let mut out = vec![locale.clone(), base.clone()];
                for l in profile.languages {
                    if !l.starts_with(&base) && out.len() < 3 {
                        out.push(l.to_string());
                    }
                }
                out.truncate(3);
                out
            }
        }
    };

    let timezone = opts
        .timezone
        .clone()
        .or_else(|| geo_tz.map(|(tz, _)| tz.to_string()))
        .unwrap_or_else(|| profile.timezone.to_string());
    let accept_language = geo_tz
        .map(|(_, al)| al.to_string())
        .unwrap_or_else(|| languages.join(","));

    Ok(Resolved {
        profile,
        profile_name: profile.name.to_string(),
        user_agent: opts
            .user_agent
            .clone()
            .unwrap_or_else(|| profile.user_agent.to_string()),
        locale,
        languages,
        timezone,
        accept_language,
        seed: opts.seed,
        noise: opts.noise,
        webrtc: if opts.webrtc_block {
            "block"
        } else {
            "default"
        },
        media_devices: opts.media_devices,
        hide_engine: opts.hide_engine,
        chrome_runtime: opts.chrome_runtime,
    })
}

/// Align the claimed Chrome version with the real binary — claiming 128 while the
/// browser is 154 is exactly the contradiction detectors pick up.
pub fn align_version(mut r: Resolved, version: Option<&str>) -> Resolved {
    let Some(version) = version else { return r };
    let full = version
        .rsplit('/')
        .next()
        .unwrap_or(version)
        .trim()
        .to_string();
    let Some(major) = full.split('.').next() else {
        return r;
    };
    if major.is_empty() || !major.chars().all(|c| c.is_ascii_digit()) {
        return r;
    }
    // patch UA + UA-CH brands so the whole surface claims the real version
    if let Ok(mut md) = serde_json::from_value::<Value>(r.profile.ua_metadata.clone()) {
        if let Some(brands) = md.get_mut("brands").and_then(Value::as_array_mut) {
            for b in brands.iter_mut() {
                let is_chrome = b
                    .get("brand")
                    .and_then(Value::as_str)
                    .map(|s| s.contains("Chromium") || s.contains("Google Chrome"))
                    .unwrap_or(false);
                if is_chrome {
                    b["version"] = json!(major);
                }
            }
        }
        md["fullVersion"] = json!(full);
        r.profile = aligned_profile(&r, md, &full);
    }
    r.user_agent = regex_patch_chrome(&r.user_agent, &full);
    r
}

thread_local! {
    // aligned profiles are built at runtime; keep them alive for &'static Profile
    static ALIGNED: std::cell::RefCell<Vec<Profile>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn aligned_profile(r: &Resolved, md: Value, full: &str) -> &'static Profile {
    let p = r.profile;
    let aligned = Profile {
        name: p.name,
        user_agent: Box::leak(regex_patch_chrome(p.user_agent, full).into_boxed_str()),
        ua_metadata: md,
        ..*p
    };
    ALIGNED.with(|cell| {
        let mut v = cell.borrow_mut();
        v.push(aligned);
        // SAFETY of the &'static: the Vec lives for the whole process via the
        // thread-local; pages do not outlive their runtime thread.
        let le: &'static Profile =
            unsafe { std::mem::transmute::<&Profile, &'static Profile>(v.last().unwrap()) };
        le
    })
}

fn regex_patch_chrome(ua: &str, full: &str) -> String {
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"Chrome/[\d.]+").unwrap())
        .replace_all(ua, format!("Chrome/{full}"))
        .to_string()
}

/// Build the injected stealth source for a resolved profile. Deterministic: the
/// same seed always produces the same noise (canvas reads agree — what
/// canvas-fingerprint detectors check).
pub fn build_source(r: &Resolved) -> String {
    let p = r.profile;
    let r_obj = json!({
        "profile": r.profile_name,
        "platform": p.platform,
        "uaPlatform": p.ua_platform,
        "uaPlatformVersion": p.ua_platform_version,
        "vendor": p.vendor,
        "webglVendor": p.webgl_vendor,
        "webglRenderer": p.webgl_renderer,
        "hardwareConcurrency": p.hardware_concurrency,
        "deviceMemory": p.device_memory,
        "screen": {
            "width": p.screen.width, "height": p.screen.height,
            "availWidth": p.screen.avail_width, "availHeight": p.screen.avail_height,
            "colorDepth": p.screen.color_depth, "pixelDepth": p.screen.pixel_depth,
        },
        "languages": r.languages,
        "locale": r.locale,
        "timezone": r.timezone,
        "maxTouchPoints": p.max_touch_points,
        "mobile": p.mobile,
        "noise": r.noise,
        "seed": r.seed,
        "webrtc": r.webrtc,
        "mediaDevices": r.media_devices,
        "uaMetadata": p.ua_metadata,
        "chromeRuntime": r.chrome_runtime,
    });

    let template = STEALTH_TEMPLATE;
    let hide = STEALTH_HIDE_ENGINE;

    // substitute the resolved-values object: the template's `var R = ${JSON.stringify({…})}`
    // — the interpolation spans `${JSON.stringify(` … `})}` (object, call, closer)
    let start = template
        .find("${JSON.stringify(")
        .expect("stealth template: R object");
    let end = template[start..]
        .find("})}")
        .map(|i| start + i + 3)
        .expect("stealth template: R object close");
    let mut out = String::with_capacity(template.len() + hide.len() + 2048);
    out.push_str(&template[..start]);
    out.push_str(&serde_json::to_string(&r_obj).unwrap());
    out.push_str(&template[end..]);

    // the hideEngine conditional was lifted out at build time; splice per config
    if r.hide_engine {
        let anchor = out.find("})();").unwrap_or(out.len());
        let insert_at = anchor; // before the IIFE close, exactly where the JS conditional sat
        out.insert_str(insert_at, hide);
    }

    // the one direct vendor interpolation
    out.replace(
        "${JSON.stringify(v.vendor)}",
        &serde_json::to_string(p.vendor).unwrap(),
    )
}

/// UA/env overrides that must land BEFORE the first navigation.
pub fn env_overrides(r: &Resolved) -> Value {
    json!({
        "userAgent": r.user_agent,
        "platform": r.profile.platform,
        "userAgentMetadata": r.profile.ua_metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_resolves_coherently() {
        let r = resolve(&StealthOpts::default()).unwrap();
        assert_eq!(r.profile_name, "chrome-linux");
        assert_eq!(r.locale, "en-US");
        assert_eq!(r.timezone, "America/New_York");
        assert_eq!(r.languages[0], "en-US");
        assert!(r.noise && r.hide_engine);
    }

    #[test]
    fn geo_overrides_tz_and_language() {
        let r = resolve(&StealthOpts {
            geo: Some("de-DE".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(r.timezone, "Europe/Berlin");
        assert_eq!(r.accept_language, "de-DE,de;q=0.9,en;q=0.8");
        assert_eq!(r.languages[0], "de-DE");
    }

    #[test]
    fn version_aligns_ua_and_brands() {
        let r = resolve(&StealthOpts::default()).unwrap();
        let r = align_version(r, Some("HeadlessChrome/155.0.8059.39"));
        assert!(
            r.user_agent.contains("Chrome/155.0.8059.39"),
            "{}",
            r.user_agent
        );
        assert!(r.user_agent.contains("155.0.8059.39"));
        let md = r.profile.ua_metadata.clone();
        assert_eq!(md["fullVersion"], "155.0.8059.39");
        assert_eq!(md["brands"][1]["version"], "155");
    }

    #[test]
    fn source_contains_resolved_values_and_hides_engine() {
        let r = resolve(&StealthOpts::default()).unwrap();
        let src = build_source(&r);
        assert!(
            src.contains("\"profile\":\"chrome-linux\""),
            "R object substituted"
        );
        assert!(
            !src.contains("${JSON.stringify"),
            "no unsubstituted interpolations"
        );
        assert!(
            src.contains("__vlx"),
            "hideEngine block spliced in by default"
        );
        let off = resolve(&StealthOpts {
            hide_engine: false,
            ..Default::default()
        })
        .unwrap();
        let src2 = build_source(&off);
        assert!(
            !src2.contains("var hide = function"),
            "hideEngine off → block absent"
        );
    }

    #[test]
    fn unknown_profile_is_an_error() {
        assert!(
            resolve(&StealthOpts {
                profile: Some("nope".into()),
                ..Default::default()
            })
            .is_err()
        );
    }
}
