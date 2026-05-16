// job-pro session bridge — background service worker.
//
// Captures cookies + recent CSRF / XSRF-Token headers from supported
// careers sites and stores them in chrome.storage so the popup can hand
// them off as a downloadable session.json file. The CLI's auto-apply
// then loads `~/.jobpro/<co>.session.json` and re-uses the captured
// credentials to fire the actual submission POST.
//
// Design constraint: this is a manifest-v3 service worker, so it
// shouldn't hold state in module-scope (workers can be evicted at any
// time). All state goes through chrome.storage.local.

// Map of careers-site host → adapter key. Used both to identify which
// "company" a session belongs to and to scope what we export.
const HOST_TO_KEY = {
  "join.qq.com": "tencent",
  "jobs.bytedance.com": "bytedance",
  "campus-talent.alibaba.com": "alibaba",
  "zhaopin.meituan.com": "meituan",
  "job.xiaohongshu.com": "xiaohongshu",
  "campus.jd.com": "jd",
  "campus.kuaishou.cn": "kuaishou",
  "xiaomi.jobs.f.mioffice.cn": "xiaomi",
  "talent.baidu.com": "baidu",
  "hr.163.com": "netease",
  "talent.didiglobal.com": "didi",
  "jobs.bilibili.com": "bilibili",
  "careers.pinduoduo.com": "pdd",
  "career.huawei.com": "huawei",
  "campus.pingan.com": "pingan",
  "careers.ctrip.com": "trip",
  "www.unitree.com": "unitree",
  "job.byd.com": "byd",
  "talent.antgroup.com": "antgroup",
  "hrcareersweb.antgroup.com": "antgroup",
  "hr.sensetime.com": "sensetime",
  "wecruit.hotjob.cn": "horizonrobotics",
  "app.mokahr.com": "moka",
  "careers.oppo.com": "oppo",
  "hr.vivo.com": "vivo",
  "vivo.zhiye.com": "vivo",
  "iflytek.zhiye.com": "iflytek",
  "campus.sf-express.com": "sf",
  "www.lixiang.com": "liauto",
  "lilithgames.jobs.feishu.cn": "lilith",
  "www.liepin.com": "liepin",
};

function adapterKeyForHost(host) {
  if (HOST_TO_KEY[host]) return HOST_TO_KEY[host];
  // .jobs.feishu.cn / .zhiye.com wildcard fallback — store by subdomain.
  if (host.endsWith(".jobs.feishu.cn")) return `feishu:${host}`;
  if (host.endsWith(".zhiye.com")) return `zhiye:${host}`;
  return null;
}

// Cache the latest auth-related request headers per adapter key. We
// don't keep XHR bodies — only `Cookie` / `X-Xsrf-Token` / `Authorization`
// / `X-Csrf-Token` / `X-Fscp-Std-Info` etc.
const AUTH_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "x-xsrf-token",
  "x-csrf-token",
  "x-csrftoken",
  "x-requested-with",
  "x-fscp-std-info",
  "x-fscp-version",
  "x-fscp-trace-id",
  "x-client-type",
  "langtype",
  "x-token",
  "x-auth-token",
]);

chrome.webRequest?.onSendHeaders?.addListener?.(
  // Note: in MV3 you can't *modify* requests without `declarativeNetRequest`,
  // but reading via webRequest is still allowed for hosts in host_permissions.
  // If the user is on a network where webRequest isn't available we fall
  // back to cookies-only capture (see chrome.cookies below).
  (details) => {
    try {
      const u = new URL(details.url);
      const key = adapterKeyForHost(u.hostname);
      if (!key) return;
      const captured = {};
      for (const h of details.requestHeaders ?? []) {
        const name = (h.name ?? "").toLowerCase();
        if (AUTH_HEADER_NAMES.has(name)) captured[name] = h.value ?? "";
      }
      if (Object.keys(captured).length === 0) return;
      const storageKey = `auth_headers:${key}`;
      chrome.storage.local.get([storageKey]).then((existing) => {
        chrome.storage.local.set({
          [storageKey]: {
            adapter: key,
            host: u.hostname,
            url: details.url,
            captured_at: new Date().toISOString(),
            headers: { ...(existing[storageKey]?.headers ?? {}), ...captured },
          },
        });
      });
    } catch (err) {
      console.warn("[job-pro] header capture err:", err);
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

// Expose a message API for the popup: "give me everything you have for
// the active tab", and a "clear" command.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "list_sessions") {
      const all = await chrome.storage.local.get(null);
      const out = Object.entries(all)
        .filter(([k]) => k.startsWith("auth_headers:"))
        .map(([k, v]) => ({ key: k.slice("auth_headers:".length), ...v }));
      sendResponse({ ok: true, sessions: out });
      return;
    }
    if (msg?.type === "export_session" && typeof msg.key === "string") {
      const stored = (await chrome.storage.local.get([`auth_headers:${msg.key}`]))[
        `auth_headers:${msg.key}`
      ];
      if (!stored) {
        sendResponse({ ok: false, message: `no session captured for ${msg.key}` });
        return;
      }
      const cookies = await chrome.cookies.getAll({ url: `https://${stored.host}/` });
      const session = {
        adapter: msg.key,
        host: stored.host,
        exported_at: new Date().toISOString(),
        headers: stored.headers,
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expiresAt: c.expirationDate,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
      };
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      try {
        const dlId = await chrome.downloads.download({
          url: dataUrl,
          filename: `jobpro/${msg.key}.session.json`,
          saveAs: false,
        });
        sendResponse({ ok: true, downloadId: dlId, host: stored.host, cookieCount: cookies.length });
      } catch (err) {
        sendResponse({ ok: false, message: `download failed: ${err?.message ?? String(err)}` });
      }
      return;
    }
    if (msg?.type === "clear_sessions") {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith("auth_headers:"));
      await chrome.storage.local.remove(keys);
      sendResponse({ ok: true, cleared: keys.length });
      return;
    }
    sendResponse({ ok: false, message: `unknown message type: ${msg?.type}` });
  })().catch((err) => sendResponse({ ok: false, message: String(err) }));
  return true; // async sendResponse
});
