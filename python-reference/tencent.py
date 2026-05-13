#!/usr/bin/env python3
"""
Thin wrapper around join.qq.com's public campus-recruiting JSON API.

All endpoints listed here are unauthenticated and reachable from any
browser visiting https://join.qq.com — the server only checks Referer/Origin
to discourage hot-linking.

Endpoint inventory:
  GET  /api/v1/position/getAllProject               recruitment-project tree
  GET  /api/v1/position/getPositionFamily           job-family dictionary
  GET  /api/v1/position/getPositionWorkCities       work-city dictionary
  GET  /api/v1/position/getRecruitCity              interview-city dictionary
  GET  /api/v1/dictionary/?types=...                BG / recruit-type dictionaries
  POST /api/v1/position/searchPosition              paged position search
  GET  /api/v1/jobDetails/getJobDetailsByPostId     single job detail
  GET  /api/v1/noticeDynamic/getNoticeDynamicList   announcements
  GET  /api/v1/noticeDynamic/getNoticeDynamicById   announcement detail

CLI:
  python tencent_jobs.py dicts
  python tencent_jobs.py search --keyword "后台开发" --page-size 5
  python tencent_jobs.py detail <postId>
  python tencent_jobs.py notices
  python tencent_jobs.py notice <noticeId>
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any


API_ROOT = "https://join.qq.com/api/v1"
POSTS_PAGE = "https://join.qq.com/post.html"
DETAIL_PAGE = "https://join.qq.com/post_detail.html?postid={post_id}"
NOTICE_PAGE = "https://join.qq.com/notice.html"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://join.qq.com",
}


class JoinQqError(RuntimeError):
    pass


@dataclass
class ApiResponse:
    ok: bool
    data: Any = None
    message: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


def _call(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    referer: str = POSTS_PAGE,
    timeout: float = 20.0,
) -> ApiResponse:
    """Single entry point for talking to join.qq.com.

    The server expects a `timestamp` query param (anti-cache) and a Referer
    pointing back at the site itself. Anything else is optional.
    """
    sep = "&" if "?" in path else "?"
    url = f"{API_ROOT}{path}{sep}timestamp={int(time.time() * 1000)}"

    headers = {**DEFAULT_HEADERS, "Referer": referer}
    payload: bytes | None = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json;charset=UTF-8"

    request = urllib.request.Request(url, data=payload, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        return ApiResponse(False, message=f"HTTP {exc.code}: {exc.reason}")
    except urllib.error.URLError as exc:
        return ApiResponse(False, message=f"Network error: {exc.reason}")
    except json.JSONDecodeError as exc:
        return ApiResponse(False, message=f"Bad JSON: {exc}")

    return ApiResponse(
        ok=raw.get("status") == 0,
        data=raw.get("data"),
        message=raw.get("message") or "",
        raw=raw,
    )


# ---------- dictionaries ----------

def fetch_dictionaries() -> dict[str, Any]:
    """Pull every lookup table the website uses for filter chips."""
    pulls = {
        "projects": _call("GET", "/position/getAllProject"),
        "position_families": _call("GET", "/position/getPositionFamily?lang=zh-cn"),
        "work_cities": _call("GET", "/position/getPositionWorkCities?lang=zh-cn"),
        "recruit_cities": _call("GET", "/position/getRecruitCity?lang=zh-cn"),
        "shared": _call(
            "GET",
            "/dictionary/?types=RecruitType,BusinessGroup,RecruitProjectPostList",
        ),
    }
    return {
        "ok": all(r.ok for r in pulls.values()),
        "source": "join.qq.com",
        **{name: r.data for name, r in pulls.items()},
    }


def collect_all_project_ids() -> list[int]:
    """Flatten the (possibly nested) project tree into a leaf-id list."""
    response = _call("GET", "/position/getAllProject")
    if not response.ok:
        return []

    leaves: list[int] = []

    def walk(nodes: list[dict[str, Any]] | None) -> None:
        for node in nodes or []:
            children = node.get("subDictionary") or []
            if children:
                walk(children)
            else:
                try:
                    leaves.append(int(node["code"]))
                except (KeyError, TypeError, ValueError):
                    continue

    walk(response.data or [])
    return sorted(set(leaves))


# ---------- positions ----------

def search_positions(
    keyword: str = "",
    *,
    project_ids: list[int] | None = None,
    bg_ids: list[int] | None = None,
    work_city_ids: list[int] | None = None,
    recruit_city_ids: list[int] | None = None,
    family_ids: list[int] | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Search the public position list.

    `projectIdList` is required by the server; passing an empty list narrows
    results to zero. We default it to "every project" so a bare search behaves
    like the website's default landing state.
    """
    page_size = max(1, min(100, int(page_size or 20)))
    body = {
        "projectIdList": project_ids or collect_all_project_ids(),
        "keyword": (keyword or "").strip()[:30],
        "bgList": bg_ids or [],
        "workCountryType": 0,
        "workCityList": work_city_ids or [],
        "recruitCityList": recruit_city_ids or [],
        "positionFidList": family_ids or [],
        "pageIndex": max(1, int(page or 1)),
        "pageSize": page_size,
    }

    response = _call("POST", "/position/searchPosition", body=body)
    if not response.ok:
        return {"ok": False, "message": response.message, "query": body, "positions": []}

    rows = (response.data or {}).get("positionList") or []
    total = (response.data or {}).get("count", len(rows))

    return {
        "ok": True,
        "source": "join.qq.com",
        "query": body,
        "page": body["pageIndex"],
        "page_size": body["pageSize"],
        "total": total,
        "positions": [_summarize_position(row) for row in rows],
    }


def _summarize_position(item: dict[str, Any]) -> dict[str, Any]:
    post_id = str(item.get("postId") or "")
    return {
        "post_id": post_id,
        "title": item.get("positionTitle") or "",
        "project": item.get("projectName") or "",
        "recruit_label": item.get("recruitLabelName") or "",
        "bgs": (item.get("bgs") or "").strip(),
        "work_cities": (item.get("workCities") or "").strip(),
        "apply_url": (
            DETAIL_PAGE.format(post_id=urllib.parse.quote(post_id)) if post_id else POSTS_PAGE
        ),
    }


def fetch_position_detail(post_id: str) -> dict[str, Any]:
    """Fetch the full JD for one position.

    `desc`/`request` carry the regular JD body; QingYun (青云) campus-program
    posts route the same content through `topicDetail`/`topicRequirement`
    instead — fall back to those before giving up.
    """
    post_id = (post_id or "").strip()
    if not post_id:
        return {"ok": False, "message": "post_id is required"}

    referer = DETAIL_PAGE.format(post_id=urllib.parse.quote(post_id))
    response = _call(
        "GET",
        f"/jobDetails/getJobDetailsByPostId?postId={urllib.parse.quote(post_id)}",
        referer=referer,
    )
    if not response.ok or not response.data:
        return {"ok": False, "message": response.message or "no detail returned", "post_id": post_id}

    raw = response.data

    def first(*keys: str) -> str:
        for key in keys:
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    return {
        "ok": True,
        "source": "join.qq.com",
        "post_id": str(raw.get("postId") or post_id),
        "title": raw.get("title") or "",
        "direction": raw.get("tidName") or "",
        "project": raw.get("projectName") or "",
        "recruit_label": raw.get("recruitLabelName") or "",
        "description": first("desc", "topicDetail", "introduction"),
        "requirements": first("request", "topicRequirement"),
        "work_cities": raw.get("workCityList") or [],
        "recruit_cities": raw.get("recruitCityList") or [],
        "is_qingyun": bool(raw.get("isQingyun")),
        "apply_url": DETAIL_PAGE.format(
            post_id=urllib.parse.quote(str(raw.get("postId") or post_id))
        ),
    }


def fetch_all_positions(
    *,
    keyword: str = "",
    max_pages: int = 20,
    page_size: int = 100,
) -> dict[str, Any]:
    """Drain the position list across pages.

    Stops early when:
      - the server reports an error,
      - a page comes back empty (we passed the tail), or
      - we've accumulated `total` positions (the server's reported count).

    `max_pages` is a safety cap, not the expected page count.
    """
    page_size = max(1, min(100, int(page_size or 100)))
    max_pages = max(1, int(max_pages or 1))

    project_ids = collect_all_project_ids()  # resolve once, reuse every page
    bucket: list[dict[str, Any]] = []
    total: int | None = None

    for page in range(1, max_pages + 1):
        result = search_positions(
            keyword=keyword,
            project_ids=project_ids,
            page=page,
            page_size=page_size,
        )
        if not result.get("ok"):
            return {
                "ok": False,
                "message": result.get("message"),
                "fetched": len(bucket),
                "positions": bucket,
            }
        if total is None:
            total = result.get("total")
        rows = result.get("positions") or []
        if not rows:
            break
        bucket.extend(rows)
        if total is not None and len(bucket) >= int(total):
            break

    return {
        "ok": True,
        "source": "join.qq.com",
        "total": total if total is not None else len(bucket),
        "fetched": len(bucket),
        "positions": bucket,
    }


# ---------- resume matching ----------

# A small, deliberately generic vocabulary. We do NOT mirror any one
# employer's BG / family taxonomy here — this is just to recognize common
# words that show up in a fresh-grad resume.
_TECH_VOCAB = {
    # languages
    "python", "java", "go", "golang", "c", "c++", "cpp", "rust", "kotlin",
    "swift", "scala", "javascript", "typescript", "php", "ruby", "lua",
    # web / mobile
    "react", "vue", "angular", "next", "nuxt", "webpack", "vite", "tailwind",
    "flutter", "android", "ios", "react-native",
    # backend
    "spring", "springboot", "django", "flask", "fastapi", "express", "nestjs",
    "grpc", "rest", "graphql", "websocket",
    # data / db
    "mysql", "postgresql", "postgres", "redis", "mongodb", "kafka",
    "rabbitmq", "elasticsearch", "spark", "hadoop", "flink", "clickhouse",
    "hive", "presto",
    # infra
    "docker", "kubernetes", "k8s", "linux", "aws", "gcp", "azure",
    "terraform", "nginx", "envoy",
    # ml / ai
    "pytorch", "tensorflow", "huggingface", "llm", "rag", "transformer",
    "bert", "gpt", "diffusion", "cv", "nlp", "embedding",
    # chinese stack terms
    "后台", "后端", "前端", "服务端", "客户端", "测试", "运维", "安全", "算法",
    "推荐", "搜索", "大模型", "微服务", "分布式", "高并发", "数据库", "数据",
    "机器学习", "深度学习", "强化学习", "多模态", "计算机视觉", "自然语言",
}

# Coarse city list; case-sensitive Chinese, mostly first-tier + popular
# campus-recruiting hubs in Greater China.
_CITY_VOCAB = {
    "深圳", "北京", "上海", "广州", "杭州", "成都", "武汉", "南京", "苏州",
    "西安", "合肥", "天津", "厦门", "香港", "remote", "远程",
}


def _extract_resume_signals(text: str) -> tuple[list[str], list[str]]:
    """Pull out tech terms and city preferences from free-form resume text.

    Returns (terms, cities). Both lists preserve discovery order and are
    deduplicated case-insensitively.
    """
    text = text or ""
    lower = text.lower()

    terms: list[str] = []
    seen: set[str] = set()

    # exact vocab match (handles Chinese terms and multi-char tech names)
    for term in _TECH_VOCAB:
        if term in lower and term not in seen:
            terms.append(term)
            seen.add(term)

    # also catch any capitalized english tokens that look like tech names
    # (e.g. "TiDB", "Pulsar") — limit length to avoid grabbing random words
    import re as _re
    for token in _re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{1,15}", text):
        norm = token.lower()
        if norm in seen:
            continue
        # heuristic: keep tokens that contain a digit or are 3-15 chars and
        # not a common English word. We can't ship a stopword list here so
        # just trust the resume context.
        if len(token) >= 3 and not token.lower() in {"the", "and", "for", "with", "via", "from", "able", "this", "that", "have", "skill", "based"}:
            terms.append(token)
            seen.add(norm)
        if len(terms) >= 30:
            break

    cities = [c for c in _CITY_VOCAB if c in text]

    return terms[:30], cities[:6]


def _overlap_reasons(haystack: str, terms: list[str], cities: list[str]) -> tuple[int, list[str]]:
    """Score one JD blob against the resume's terms + cities.

    Long tokens (>2 chars) count more than short ones — single-letter or
    two-letter matches like "go" or "cv" are noisy on Chinese JDs.
    """
    hay = haystack.lower()
    score = 0
    reasons: list[str] = []

    for term in terms:
        if not term:
            continue
        if term.lower() in hay:
            score += 3 if len(term) > 2 else 1
            if len(reasons) < 4:
                reasons.append(f"matched: {term}")

    for city in cities:
        if city in haystack:
            score += 2
            if len(reasons) < 4:
                reasons.append(f"city: {city}")

    return score, reasons


def match_resume(
    text: str,
    *,
    top_n: int = 5,
    detail_candidates: int = 20,
) -> dict[str, Any]:
    """Rank live job openings against resume text.

    Two-pass scoring: first by list-view fields (title / project / cities)
    to pick candidates cheaply, then re-score the shortlist after pulling
    each full JD. We do not surface numeric scores to callers — only the
    matched keywords behind each pick, so the user can't anchor on a fake
    percentage.
    """
    terms, cities = _extract_resume_signals(text)
    if not terms:
        return {
            "ok": False,
            "message": "could not extract any technical signals from the text",
            "preview": (text or "")[:120],
        }

    # search uses the first 3 strongest signals as a single keyword string
    # (the API enforces a 30-char limit, so we keep it compact)
    keyword = " ".join(terms[:3])
    list_result = search_positions(keyword=keyword, page=1, page_size=100)
    if not list_result.get("ok"):
        return {"ok": False, "message": list_result.get("message"), "positions": []}

    # first pass: score on list metadata alone
    scored: list[tuple[int, dict[str, Any], list[str]]] = []
    for position in list_result.get("positions") or []:
        blob = " ".join(
            [
                position.get("title", ""),
                position.get("project", ""),
                position.get("recruit_label", ""),
                position.get("bgs", ""),
                position.get("work_cities", ""),
            ]
        )
        score, reasons = _overlap_reasons(blob, terms, cities)
        if score > 0:
            scored.append((score, position, reasons))
    scored.sort(key=lambda row: row[0], reverse=True)

    shortlist = scored[: max(top_n, detail_candidates)]
    if not shortlist:
        # nothing matched on titles — fall back to top of the result list
        shortlist = [
            (0, p, []) for p in (list_result.get("positions") or [])[:detail_candidates]
        ]

    # second pass: re-score against full JD
    enriched: list[tuple[int, dict[str, Any]]] = []
    for base_score, position, base_reasons in shortlist[:detail_candidates]:
        detail = fetch_position_detail(position.get("post_id", ""))
        if not detail.get("ok"):
            continue
        jd_blob = " ".join(
            [
                detail.get("title", ""),
                detail.get("direction", ""),
                detail.get("description", ""),
                detail.get("requirements", ""),
                " ".join(detail.get("work_cities") or []),
            ]
        )
        extra_score, extra_reasons = _overlap_reasons(jd_blob, terms, cities)
        combined = list(dict.fromkeys([*base_reasons, *extra_reasons]))[:5]
        if not combined:
            combined = ["no specific keyword overlap — surfaced from initial keyword search"]
        enriched.append(
            (
                base_score + extra_score,
                {
                    **position,
                    "title_detail": detail.get("title"),
                    "direction": detail.get("direction"),
                    "description": detail.get("description"),
                    "requirements": detail.get("requirements"),
                    "match_reasons": combined,
                },
            )
        )

    enriched.sort(key=lambda row: row[0], reverse=True)

    return {
        "ok": True,
        "source": "join.qq.com",
        "extracted_terms": terms,
        "city_preferences": cities,
        "matches": [row[1] for row in enriched[:top_n]],
        "note": (
            "match_reasons surfaces overlapping keywords, not a probability of "
            "getting an interview. The only authority on selection is HR."
        ),
    }


# ---------- resume self-check ----------

# Words that often signal puffery rather than concrete evidence. Flagging
# them as a warning, not a fail — sometimes "expert in X" is actually true.
_PUFFERY_HINTS = (
    "精通", "唯一", "完美", "顶尖", "领先", "100%",
    "expert", "perfect", "world-class", "best in class",
)


def check_resume(text: str) -> dict[str, Any]:
    """Run a fast structural check against resume text.

    No network. No model. Just deterministic heuristics that look for the
    skeleton a recruiter expects: contact info, education with dates, work
    or project history, and at least some quantitative evidence.

    Each check returns one of: "pass" (visible), "warn" (worth checking),
    "fail" (likely missing). Order: failures first, then warnings, then
    passes — so a caller iterating the list reads the urgent stuff first.
    """
    import re as _re

    text = text or ""
    if not text.strip():
        return {"ok": False, "message": "empty resume text", "checks": []}

    checks: list[dict[str, str]] = []

    # ---- contact info ----
    email = bool(_re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text))
    phone = bool(_re.search(r"(?:\+?86[-\s]?)?1[3-9]\d{9}", text))
    if email or phone:
        seen = [name for name, ok in (("email", email), ("phone", phone)) if ok]
        checks.append(
            {
                "name": "contact-info",
                "status": "pass",
                "hint": f"found: {', '.join(seen)}",
            }
        )
    else:
        checks.append(
            {
                "name": "contact-info",
                "status": "fail",
                "hint": "no email or 中国大陆 mobile number found — recruiters can't reach you",
            }
        )

    # ---- education ----
    grad_year = _re.search(r"(20\d{2})\s*(?:年|/|\-)?\s*(?:6|7|9|June|July)", text)
    has_school = bool(_re.search(r"(大学|学院|University|College)", text))
    has_major = bool(_re.search(r"(专业|major|本科|硕士|博士|学士|bachelor|master|phd)", text, _re.IGNORECASE))
    edu_components = sum(int(b) for b in (has_school, has_major, bool(grad_year)))
    if edu_components == 3:
        checks.append(
            {
                "name": "education",
                "status": "pass",
                "hint": "school, major, graduation year all present",
            }
        )
    elif edu_components >= 1:
        missing = [
            label
            for label, present in (
                ("school", has_school),
                ("major", has_major),
                ("graduation year", bool(grad_year)),
            )
            if not present
        ]
        checks.append(
            {
                "name": "education",
                "status": "warn",
                "hint": f"missing: {', '.join(missing)}",
            }
        )
    else:
        checks.append(
            {
                "name": "education",
                "status": "fail",
                "hint": "no school / major / graduation year detectable",
            }
        )

    # ---- experience / projects ----
    project_signal = bool(
        _re.search(r"(项目|项目经历|实习|实习经历|工作经历|project|internship|experience)", text, _re.IGNORECASE)
    )
    if project_signal:
        checks.append(
            {
                "name": "experience",
                "status": "pass",
                "hint": "at least one project or internship section found",
            }
        )
    else:
        checks.append(
            {
                "name": "experience",
                "status": "fail",
                "hint": "no project / internship / experience header — even fresh grads need something here",
            }
        )

    # ---- quantitative evidence ----
    quant_count = len(_re.findall(r"\d+(?:\.\d+)?\s*(?:%|倍|w|万|k|qps|ms|百万|million|users|users\b)", text, _re.IGNORECASE))
    if quant_count >= 2:
        checks.append(
            {
                "name": "quantitative-evidence",
                "status": "pass",
                "hint": f"{quant_count} measurable outcomes found",
            }
        )
    elif quant_count == 1:
        checks.append(
            {
                "name": "quantitative-evidence",
                "status": "warn",
                "hint": "only one quantified result — recruiters want numbers (latency, QPS, users, savings)",
            }
        )
    else:
        checks.append(
            {
                "name": "quantitative-evidence",
                "status": "fail",
                "hint": "no numeric outcomes — every bullet should answer 'how much / how many / how fast'",
            }
        )

    # ---- puffery / unverifiable claims ----
    flagged = [w for w in _PUFFERY_HINTS if w in text]
    if flagged:
        checks.append(
            {
                "name": "puffery",
                "status": "warn",
                "hint": (
                    "vague superlatives detected: "
                    + ", ".join(flagged[:5])
                    + " — replace with concrete evidence or remove"
                ),
            }
        )
    else:
        checks.append(
            {
                "name": "puffery",
                "status": "pass",
                "hint": "no obvious superlative claims",
            }
        )

    # sort fail → warn → pass for readability
    order = {"fail": 0, "warn": 1, "pass": 2}
    checks.sort(key=lambda c: order.get(c["status"], 9))

    counts = {"pass": 0, "warn": 0, "fail": 0}
    for c in checks:
        counts[c["status"]] = counts.get(c["status"], 0) + 1

    return {
        "ok": True,
        "summary": counts,
        "checks": checks,
        "note": "Heuristics only — they don't judge content quality, just whether the skeleton is intact.",
    }


# ---------- persistent memory ----------

def _memory_path() -> str:
    """Resolve the memory file path, respecting `JOBPRO_HOME` for tests."""
    import os
    base = os.environ.get("JOBPRO_HOME") or os.path.expanduser("~/.jobpro")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "tencent-memory.json")


def _memory_load() -> dict[str, Any]:
    import os
    path = _memory_path()
    if not os.path.exists(path):
        return {"fields": {}, "events": []}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        # be liberal in what we accept — older versions might lack one half
        return {
            "fields": data.get("fields") or {},
            "events": data.get("events") or [],
        }
    except (OSError, json.JSONDecodeError):
        return {"fields": {}, "events": []}


def _memory_save(data: dict[str, Any]) -> None:
    path = _memory_path()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def memory_list() -> dict[str, Any]:
    data = _memory_load()
    return {"ok": True, "path": _memory_path(), **data}


def memory_set(pairs: list[str]) -> dict[str, Any]:
    """Set one or more key=value fields.

    Values are stored as strings — the caller can JSON-decode at read time
    if they want richer types. Keeping it stringly-typed avoids accidentally
    saving CLI escape sequences as structured data.
    """
    if not pairs:
        return {"ok": False, "message": "no key=value pairs provided"}

    data = _memory_load()
    applied: dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            return {"ok": False, "message": f"expected key=value, got: {pair!r}"}
        key, value = pair.split("=", 1)
        key = key.strip()
        if not key:
            return {"ok": False, "message": f"empty key in {pair!r}"}
        data["fields"][key] = value
        applied[key] = value

    _memory_save(data)
    return {"ok": True, "applied": applied, "path": _memory_path()}


def memory_event(kind: str, payload: str = "") -> dict[str, Any]:
    """Append an event with timestamp. Common kinds: applied, interview, offer, rejected."""
    if not kind:
        return {"ok": False, "message": "event kind is required"}
    data = _memory_load()
    from datetime import datetime as _dt
    entry = {
        "ts": _dt.now().isoformat(timespec="seconds"),
        "kind": kind,
        "payload": payload,
    }
    data["events"].append(entry)
    _memory_save(data)
    return {"ok": True, "event": entry, "total_events": len(data["events"])}


def memory_get(key: str | None) -> dict[str, Any]:
    data = _memory_load()
    if key:
        return {
            "ok": True,
            "key": key,
            "value": data["fields"].get(key),
        }
    return {"ok": True, **data}


def memory_clear() -> dict[str, Any]:
    """Wipe the file. Kept simple — no soft-delete, no backup."""
    import os
    path = _memory_path()
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True, "path": path, "message": "memory cleared"}


# ---------- announcements ----------

def list_notices() -> dict[str, Any]:
    response = _call("GET", "/noticeDynamic/getNoticeDynamicList", referer=NOTICE_PAGE)
    if not response.ok:
        return {"ok": False, "message": response.message, "notices": []}

    items = (response.data or {}).get("list") or []
    return {
        "ok": True,
        "source": "join.qq.com",
        "count": len(items),
        "notices": [
            {
                "id": n.get("id"),
                "title": n.get("title") or "",
                # NOTE: upstream field name is the misspelled `publisheTime`
                # (extra "e") — we surface a clean `publish_time` to callers.
                "publish_time": n.get("publisheTimeTxt") or n.get("publisheTime") or "",
                "tag": n.get("noticeTag") or "",
                "detail_url": f"https://join.qq.com/detail.html?id={n.get('id')}",
            }
            for n in items
        ],
    }


def find_notices_by_question(
    question: str,
    *,
    question_time: str | None = None,
    top_k: int = 3,
) -> dict[str, Any]:
    """Surface the announcements most likely to answer `question`.

    Strategy:
      1. List all announcements via the public API.
      2. Score each title by token overlap with the question.
      3. If `question_time` is provided (ISO-ish), prefer notices published
         on or before that time — newer ones might describe rules that did
         not exist when the user wrote the question.
      4. Pull full content for the top-K so the caller can quote excerpts.

    `question_time` examples that parse: "2026-05-13", "2026-05-13 14:00",
    "2026-05-13T14:00:00". Anything unparseable is ignored silently.
    """
    listing = list_notices()
    if not listing.get("ok"):
        return {"ok": False, "message": listing.get("message"), "matches": []}

    cutoff_ts = _parse_question_time(question_time) if question_time else None
    tokens = _tokenize_question(question)

    scored: list[tuple[float, dict[str, Any]]] = []
    for notice in listing.get("notices") or []:
        title = notice.get("title") or ""
        tag = notice.get("tag") or ""
        target = f"{title} {tag}".lower()
        hits = sum(1 for tok in tokens if tok in target)
        if hits == 0:
            continue

        score = float(hits * 10)

        publish_ts = _parse_question_time(notice.get("publish_time") or "")
        if cutoff_ts is not None and publish_ts is not None:
            if publish_ts <= cutoff_ts:
                # closer to (but not after) the question is better
                score += max(0.0, 5.0 - (cutoff_ts - publish_ts) / 86_400 / 30)
            else:
                # post-dates the question — still possibly useful, but demoted
                score -= 1.0

        scored.append((score, notice))

    scored.sort(key=lambda row: row[0], reverse=True)
    top = [notice for _score, notice in scored[: max(1, int(top_k or 3))]]

    enriched: list[dict[str, Any]] = []
    for notice in top:
        full = get_notice(str(notice["id"]))
        excerpt = ""
        if full.get("ok"):
            # crude HTML strip; the upstream `cont` is HTML, but we only want
            # a preview the caller can quote — not a full renderer.
            import re as _re
            import html as _html
            excerpt = _re.sub(r"<[^>]+>", "", full.get("content_html") or "")
            excerpt = _html.unescape(excerpt)
            excerpt = _re.sub(r"\s+", " ", excerpt).strip()[:400]
        enriched.append({**notice, "excerpt": excerpt})

    return {
        "ok": True,
        "source": "join.qq.com",
        "question": question,
        "question_time": question_time,
        "matched_tokens": tokens,
        "matches": enriched,
    }


def _tokenize_question(text: str) -> list[str]:
    """Cheap question tokenizer.

    Pulls Latin words, digits, and Chinese bigrams. The point is to find
    rare-ish substrings — common words like "the" or "什么" are filtered out
    by minimum length, not by a stoplist.
    """
    import re as _re
    text = (text or "").strip()
    if not text:
        return []
    tokens: list[str] = []
    seen: set[str] = set()

    for match in _re.findall(r"[A-Za-z0-9]{2,}", text):
        norm = match.lower()
        if norm not in seen:
            tokens.append(norm)
            seen.add(norm)

    # Chinese bigrams — sliding window of 2 over CJK chars only
    cjk_run = _re.findall(r"[一-鿿]+", text)
    for run in cjk_run:
        for i in range(len(run) - 1):
            bigram = run[i : i + 2]
            if bigram not in seen:
                tokens.append(bigram)
                seen.add(bigram)
            if len(tokens) >= 40:
                break
        if len(tokens) >= 40:
            break

    return tokens


def _parse_question_time(value: str) -> float | None:
    """Best-effort ISO-ish timestamp parsing. Returns epoch seconds or None."""
    if not value:
        return None
    from datetime import datetime as _dt
    candidates = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ]
    for fmt in candidates:
        try:
            return _dt.strptime(value.strip(), fmt).timestamp()
        except ValueError:
            continue
    return None


def get_notice(notice_id: str) -> dict[str, Any]:
    notice_id = str(notice_id or "").strip()
    if not notice_id:
        return {"ok": False, "message": "notice_id is required"}
    query = urllib.parse.urlencode({"id": notice_id})
    response = _call("GET", f"/noticeDynamic/getNoticeDynamicById?{query}", referer=NOTICE_PAGE)
    if not response.ok or not response.data:
        return {"ok": False, "message": response.message or "no notice returned"}

    raw = response.data
    return {
        "ok": True,
        "source": "join.qq.com",
        "id": raw.get("id") or notice_id,
        "title": raw.get("title") or "",
        "publish_time": raw.get("publisheTimeTxt") or raw.get("publisheTime") or "",
        "tag": raw.get("noticeTag") or "",
        # Upstream stores the HTML body under `cont`. We pass it through
        # untouched — callers can render or strip tags as they see fit.
        "content_html": raw.get("cont") or "",
        "detail_url": f"https://join.qq.com/detail.html?id={raw.get('id') or notice_id}",
    }


# ---------- CLI ----------

def _dump(result: Any, compact: bool) -> int:
    print(json.dumps(result, ensure_ascii=False, indent=None if compact else 2))
    return 0 if (isinstance(result, dict) and result.get("ok", True)) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Tencent join.qq.com campus-recruit API client",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_compact(p: argparse.ArgumentParser) -> None:
        p.add_argument("--compact", action="store_true", help="single-line JSON output")

    p_dicts = sub.add_parser("dicts", help="dump filter dictionaries")
    add_compact(p_dicts)

    p_search = sub.add_parser("search", help="search the public position list")
    p_search.add_argument("--keyword", default="", help="free-text query, max 30 chars")
    p_search.add_argument("--page", type=int, default=1)
    p_search.add_argument("--page-size", type=int, default=10)
    add_compact(p_search)

    p_detail = sub.add_parser("detail", help="fetch one position's full JD")
    p_detail.add_argument("post_id")
    add_compact(p_detail)

    p_all = sub.add_parser("all", help="drain every position via pagination")
    p_all.add_argument("--keyword", default="")
    p_all.add_argument("--max-pages", type=int, default=20)
    p_all.add_argument("--page-size", type=int, default=100)
    add_compact(p_all)

    p_match = sub.add_parser("match", help="rank positions against resume text")
    g = p_match.add_mutually_exclusive_group(required=True)
    g.add_argument("--text", help="resume text inline (quote it)")
    g.add_argument("--file", help="path to a resume text/markdown file")
    g.add_argument("--stdin", action="store_true", help="read resume text from stdin")
    p_match.add_argument("--top-n", type=int, default=5)
    p_match.add_argument("--candidates", type=int, default=20)
    add_compact(p_match)

    p_check = sub.add_parser("resume-check", help="structural sanity check on a resume")
    g2 = p_check.add_mutually_exclusive_group(required=True)
    g2.add_argument("--text", help="resume text inline (quote it)")
    g2.add_argument("--file", help="path to a resume text/markdown file")
    g2.add_argument("--stdin", action="store_true", help="read resume text from stdin")
    add_compact(p_check)

    p_mem = sub.add_parser("memory", help="persistent job-hunt state in ~/.jobpro/")
    mem_sub = p_mem.add_subparsers(dest="memory_cmd", required=True)

    mem_list = mem_sub.add_parser("list", help="dump every field and event")
    add_compact(mem_list)

    mem_get = mem_sub.add_parser("get", help="read one field by key")
    mem_get.add_argument("key")
    add_compact(mem_get)

    mem_set = mem_sub.add_parser("set", help="set one or more key=value fields")
    mem_set.add_argument("pairs", nargs="+", help="key=value pairs (quote values with spaces)")
    add_compact(mem_set)

    mem_event = mem_sub.add_parser("event", help="append a timestamped event")
    mem_event.add_argument("kind", help="event kind (applied, interview, offer, rejected, …)")
    mem_event.add_argument("payload", nargs="?", default="", help="free-form details")
    add_compact(mem_event)

    mem_clear = mem_sub.add_parser("clear", help="wipe the memory file")
    add_compact(mem_clear)

    p_notices = sub.add_parser("notices", help="list official announcements")
    add_compact(p_notices)

    p_notice = sub.add_parser("notice", help="fetch one announcement by id")
    p_notice.add_argument("notice_id")
    add_compact(p_notice)

    p_flow = sub.add_parser("flow", help="answer a question with the best-matching announcements")
    p_flow.add_argument("question", help="what the user is asking about (quote it)")
    p_flow.add_argument(
        "--question-time",
        default=None,
        help="when the user asked, ISO-ish (e.g. '2026-05-13' or '2026-05-13 14:00:00')",
    )
    p_flow.add_argument("--top-k", type=int, default=3)
    add_compact(p_flow)

    args = parser.parse_args(argv)

    if args.cmd == "dicts":
        return _dump(fetch_dictionaries(), args.compact)
    if args.cmd == "search":
        return _dump(
            search_positions(keyword=args.keyword, page=args.page, page_size=args.page_size),
            args.compact,
        )
    if args.cmd == "detail":
        return _dump(fetch_position_detail(args.post_id), args.compact)
    if args.cmd == "all":
        return _dump(
            fetch_all_positions(
                keyword=args.keyword,
                max_pages=args.max_pages,
                page_size=args.page_size,
            ),
            args.compact,
        )
    if args.cmd == "match":
        if args.stdin:
            resume_text = sys.stdin.read()
        elif args.file:
            with open(args.file, encoding="utf-8") as fh:
                resume_text = fh.read()
        else:
            resume_text = args.text or ""
        return _dump(
            match_resume(
                resume_text,
                top_n=args.top_n,
                detail_candidates=args.candidates,
            ),
            args.compact,
        )
    if args.cmd == "resume-check":
        if args.stdin:
            resume_text = sys.stdin.read()
        elif args.file:
            with open(args.file, encoding="utf-8") as fh:
                resume_text = fh.read()
        else:
            resume_text = args.text or ""
        return _dump(check_resume(resume_text), args.compact)
    if args.cmd == "memory":
        if args.memory_cmd == "list":
            return _dump(memory_list(), args.compact)
        if args.memory_cmd == "get":
            return _dump(memory_get(args.key), args.compact)
        if args.memory_cmd == "set":
            return _dump(memory_set(args.pairs), args.compact)
        if args.memory_cmd == "event":
            return _dump(memory_event(args.kind, args.payload), args.compact)
        if args.memory_cmd == "clear":
            return _dump(memory_clear(), args.compact)
    if args.cmd == "notices":
        return _dump(list_notices(), args.compact)
    if args.cmd == "notice":
        return _dump(get_notice(args.notice_id), args.compact)
    if args.cmd == "flow":
        return _dump(
            find_notices_by_question(
                args.question,
                question_time=args.question_time,
                top_k=args.top_k,
            ),
            args.compact,
        )

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
