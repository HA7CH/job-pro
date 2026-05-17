// Match-path smoke test — verifies the two regressions fixed in this round:
//
//   Bug 1: termMatches did a bare substring `includes` for 3+ char Latin
//          vocab. Result: "rust" matched "Trustworthy", "lua" matched
//          "evaluation", "scala" matched "scalable", "ios" matched
//          "scenarios". The fix enforces word-boundary regex for all Latin
//          terms regardless of length.
//
//   Bug 2: matchResume joined the top-3 extracted terms with " " into a
//          single keyword (e.g. "python rust lua"), which Tencent's API
//          treats as AND. With Bug 1 polluting top-3, the query nearly
//          always returned 0–2 results. The fix fans out one query per
//          distinctive (non-generic) term, merges by post_id, then scores
//          the union.
//
// We use a synthetic AI-engineer resume that intentionally contains the
// classic decoy substrings ("Trustworthy", "evaluation", "scalable",
// "scenarios") to make sure those don't reappear as detected skills.
//
// Run with: pnpm test:match
// Exit code: 0 = all pass, 1 = at least one regression.

import { extractResumeSignals, matchResume } from "../src/tencent.js";

const RESUME = `
AI Engineer specialising in RAG pipelines and LLM-powered agent systems.
Designed end-to-end Python pipelines for ingesting and indexing knowledge
sources. Built RAG backend using FAISS, BGE embeddings, BGE reranker, and
Qwen2.5-72B for answer generation, significantly improving evaluation
metrics. Deployed Docker-based scalable model-serving stacks across
heterogeneous GPU/NPU environments, ensuring trustworthy cross-platform
behaviour across diverse scenarios. Fine-tuned BERT classifier with
PyTorch and Hugging Face. Designed hybrid agent memory and state
management using LangGraph for multi-turn reasoning. Multimodal document
QA with InternVL2.5 and CLIP. Experience with reinforcement learning,
transformer architectures, and prompt engineering.
`;

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

console.log("Bug 1 — termMatches word-boundary");
const { terms } = extractResumeSignals(RESUME);
const lower = terms.map((t) => t.toLowerCase());
check(
  "no false-positive 'rust' from 'Trustworthy'",
  !lower.includes("rust"),
  `extracted_terms contained: ${JSON.stringify(terms.slice(0, 15))}`
);
check(
  "no false-positive 'lua' from 'evaluation'",
  !lower.includes("lua"),
  `extracted_terms contained: ${JSON.stringify(terms.slice(0, 15))}`
);
check(
  "no false-positive 'scala' from 'scalable'",
  !lower.includes("scala"),
  `extracted_terms contained: ${JSON.stringify(terms.slice(0, 15))}`
);
check(
  "no false-positive 'ios' from 'scenarios'",
  !lower.includes("ios"),
  `extracted_terms contained: ${JSON.stringify(terms.slice(0, 15))}`
);
check(
  "real signals preserved (rag, llm, python, pytorch)",
  ["rag", "llm", "python", "pytorch"].every((t) => lower.includes(t)),
  `extracted_terms: ${JSON.stringify(terms.slice(0, 20))}`
);

console.log("\nBug 2 — matchResume fan-out recall");
const result = await matchResume(RESUME, { topN: 10, candidates: 30 });
if (!("ok" in result) || !result.ok) {
  check("matchResume returned ok=true", false, JSON.stringify(result));
} else {
  const matches = (result as { matches: unknown[] }).matches;
  check(
    `matchResume returned ≥ 8 matches (got ${matches.length})`,
    matches.length >= 8
  );
  const titles = (matches as Array<{ title: string }>).map((m) => m.title);
  console.log(`    sample titles:`);
  for (const t of titles.slice(0, 3)) console.log(`      • ${t}`);
}

if (failures > 0) {
  console.log(`\n✗ ${failures} regression(s)`);
  process.exit(1);
}
console.log("\n✓ all match-smoke checks passed");
