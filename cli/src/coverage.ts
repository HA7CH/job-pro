// Canonical static map of which adapters have an end-to-end-verified apply
// endpoint. Mirrors `endpoint_verified: true` declarations across the per-
// adapter schemas so the CLI can answer "is X apply-ready right now?"
// without firing 50 schema fetches.
//
// Update flow (when promoting a 🔑 to ✅):
//   1. The adapter's fetchApplicationSchema → `endpointVerified: true` on
//      buildBespokeApplySchema, or `endpoint_verified: true` on the literal
//      schema for family-factory adapters (feishu/moka/wecruit/beisen-italent).
//   2. Add the adapter key here.
//   3. Add a row in `pnpm test:debug-submit` if it's wire-format-testable.
//
// Audited at: 1.0.78 — count must equal 45 (all non-external).

export const ENDPOINT_VERIFIED: ReadonlySet<string> = new Set([
  // multipart-anon (end-to-end smoked via httpbin)
  "xpeng", "weride", "hoyoverse",
  // multipart-session (anon-probe-verified)
  "alibaba", "pdd", "meituan", "mihoyo", "liauto",
  // moka-aes (anon-probe-verified — AES envelope)
  "moonshot", "megvii", "deepseek", "galaxyuniversal", "stepfun", "cambricon", "geely",
  // beisen-italent (anon-probe-verified — IIS 500 template)
  "iflytek", "vivo",
  // multipart-session probe-verified via re-routing (1.0.50)
  "sf",
  // multipart-session probe-verified via 405 (route exists, method/body wrong)
  "netease", "didi", "pingan",
  // probe-verified via re-routed sub-tree + JWT gateway response (1.0.52)
  "byd",
  // probe-verified via re-routed sub-tree (1.0.53)
  "bilibili",
  // probe-verified via host-root path (1.0.54)
  "xiaohongshu",
  // probe-verified via host-root + auth-middleware (1.0.55)
  "baidu",
  // probe-verified via JS-bundle string extraction (1.0.57)
  "tencent",
  // verified via JS-bundle path extraction + cross-domain check (1.0.58)
  "jd",
  // probe-verified via Spring 500 + JS-bundle sub-tree discovery (1.0.59)
  "oppo",
  // probe-verified via JS-bundle extraction (1.0.60)
  "trip",
  // Feishu family: /api/v1/user/applications discovered via SPA chunk 4026
  // (1.0.62). Promotes all 8 Feishu adapters since they share backend.
  "xiaomi", "nio", "minimax", "zhipu", "iqiyi", "agibot", "zerooneai", "baichuan",
  // bytedance: atsx-throne tenant, same /api/v1/user/applications (1.0.63)
  "bytedance",
  // Beisen Wecruit family: anon probe with X-Requested-With (1.0.63)
  "sensetime", "horizonrobotics",
  // kuaishou: /recruit/campus/e/api/v1/ sub-tree discovered (1.0.64)
  "kuaishou",
  // weibo: proxies to Moka (verified earlier) (1.0.65)
  "weibo",
  // huawei: /reccampportal/services/portal/portaluser/ Jalor framework (1.0.66)
  "huawei",
  // lilith: atsx-throne tenant, /api/v1/user/applications 405 (1.0.67)
  "lilith",
  // antgroup: talent.antgroup.com second umi bundle revealed (1.0.68)
  "antgroup",
]);
