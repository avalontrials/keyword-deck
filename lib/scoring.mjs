import {
  asNumber,
  clamp,
  compactNumber,
  hoursSince,
  normalizeText,
  tokenize,
  unique,
} from "./util.mjs";

const STOPWORDS = new Set(
  `a about after again against all am an and any are as at be because been before being below
  between both but by can could did do does doing down during each few for from further had has
  have having he her here hers herself him himself his how i if in into is it its itself just me
  more most my myself no nor not now of off on once only or other our ours ourselves out over own
  same she should so some such than that the their theirs them themselves then there these they
  this those through to too under until up very was we were what when where which while who whom
  why will with without would you your yours yourself yourselves`.split(/\s+/),
);

const GENERIC_TERMS = new Set([
  "post",
  "posts",
  "reel",
  "reels",
  "instagram",
  "today",
  "new",
  "please",
  "thanks",
  "anyone",
]);

const QUESTION =
  /\?|\b(?:how|what|why|when|where|which|who|should|would|could|can)\b|\b(?:wondering|curious|unsure)\b/i;
const ADVICE =
  /\b(?:advice|tips|help|thoughts|opinions|recommendations?|suggestions?|experience|insight|guide|learn)\b/i;
const PROMO =
  /\b(?:dm me|link in bio|book (?:a )?call|free (?:guide|consultation|download)|comment\s+["']?\w+|double tap|follow (?:for|me|us)|join (?:my|our)|coaching|masterclass|webinar|affiliate|promo code|discount code)\b/i;
const GIVEAWAY = /\b(?:giveaway|winner|enter to win|contest)\b/i;
const CTA =
  /\b(?:follow\s+@?[a-z0-9._]+|send this to|like (?:the|this) post|share this|save this (?:post|video|reel)|tag a friend|subscribe)\b/i;

export function parseKeywords(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const parts = raw
    .split(/[,;\n|·]+/)
    .map((item) =>
      item
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((item) => item.length >= 2)
    .slice(0, 6);
  const seen = new Set();
  return parts.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildQueryProfile(keywords) {
  const phrases = parseKeywords(keywords);
  const allText = phrases.join(" ");
  const rawTerms = tokenize(allText);
  const terms = unique(
    rawTerms.filter(
      (term) =>
        term.length > 2 &&
        !STOPWORDS.has(term) &&
        !GENERIC_TERMS.has(term) &&
        !/^\d+$/.test(term),
    ),
  );
  return {
    keywords: phrases,
    phrases: phrases.map((item) => normalizeText(item)).filter(Boolean),
    terms,
    specificTerms: terms,
  };
}

export function matchKeywords(value, keywords) {
  const text = normalizeText(value);
  return parseKeywords(keywords).filter((keyword) =>
    text.includes(normalizeText(keyword)),
  );
}

function engagementPoints(metrics = {}) {
  const likes = asNumber(metrics.likes, 0);
  const comments = asNumber(metrics.comments, 0);
  const views = asNumber(metrics.views, 0);
  const shares = asNumber(metrics.shares, 0);
  const total = likes + comments * 4 + views / 25 + shares * 2;
  if (!total) return { points: 0, label: null };
  const points = Math.min(12, Math.log10(1 + total) * 2.6);
  const parts = [];
  if (likes) parts.push(`${compactNumber(likes)} likes`);
  if (comments) parts.push(`${compactNumber(comments)} comments`);
  if (views) parts.push(`${compactNumber(views)} views`);
  return { points, label: parts.join(" · ") };
}

export function scorePost(post, context = {}) {
  const profile = context.profile ?? buildQueryProfile(context.keywords ?? "");
  const caption = normalizeText(post.caption ?? "");
  const words = tokenize(caption);
  const ageHours = hoursSince(post.postedAt || post.indexedAt, context.now ?? Date.now());
  const windowHours = Number(context.windowHours ?? 168);
  const reasons = [];
  const flags = [];
  let score = 24;

  if (ageHours <= 6) {
    score += 14;
    reasons.push("Published or indexed in the last 6 hours");
  } else if (ageHours <= 24) {
    score += 11;
    reasons.push("Fresh — indexed today");
  } else if (ageHours <= 48) {
    score += 6;
  } else if (ageHours <= 72) {
    score += 3;
  } else if (ageHours <= windowHours) {
    score += 0;
  } else {
    score -= 12;
    flags.push("outside-window");
  }

  const exactMatches = profile.phrases.filter((phrase) => caption.includes(phrase));
  const hits = profile.terms.filter((term) => words.includes(term) || caption.includes(term));
  const ratio = profile.terms.length ? hits.length / profile.terms.length : 0;

  if (exactMatches.length) {
    score += Math.min(16, 10 + exactMatches.length * 3);
    reasons.push(`Exact keyword — ${exactMatches.slice(0, 3).join(", ")}`);
    flags.push("exact-keyword");
  } else if (ratio >= 0.75) {
    score += 10;
    reasons.push(`Strong keyword match (${hits.slice(0, 4).join(", ")})`);
  } else if (ratio >= 0.5) {
    score += 5;
    reasons.push(`Partial keyword match (${hits.slice(0, 3).join(", ")})`);
  } else if (ratio > 0) {
    score += 1;
  } else {
    score -= 20;
    flags.push("weak-keyword-match");
  }
  if (hits.length) flags.push("keyword-match");

  const question = QUESTION.test(caption);
  const advice = ADVICE.test(caption);
  const promo = PROMO.test(caption);
  const giveaway = GIVEAWAY.test(caption);
  const cta = CTA.test(caption);

  if (question) {
    score += 5;
    flags.push("question");
  }
  if (advice) {
    score += 5;
    reasons.push("Asks for advice or recommendations");
    flags.push("advice");
  }

  const engagement = engagementPoints(post.metrics ?? {});
  if (engagement.points) {
    score += engagement.points;
    reasons.push(`Public engagement — ${engagement.label}`);
    flags.push("engagement");
  }

  if (promo) {
    score -= 18;
    flags.push("promo-language");
  }
  if (giveaway) {
    score -= 22;
    flags.push("giveaway");
  }
  if (cta) {
    score -= 5;
    flags.push("cta");
  }
  if (!post.caption || post.caption.length < 20) score -= 5;

  score = Math.round(clamp(score, 5, 99));
  const priority =
    exactMatches.length > 0 && !promo && !giveaway ? "high" : "low";
  const label = priority === "high" ? "High relevance" : "Low relevance";

  const sortedReasons = unique(reasons).slice(0, 5);
  if (!sortedReasons.length) sortedReasons.push("Surfaced by the search index");

  return {
    score,
    label,
    priority,
    reasons: sortedReasons,
    flags: unique(flags),
    engagement: engagement.label,
    keywordMatches: exactMatches,
    ageHours: Math.round(ageHours * 10) / 10,
    isSignal: priority === "high",
  };
}

export function rankPosts(posts, context) {
  const profile = context.profile ?? buildQueryProfile(context.keywords ?? "");
  const scored = posts.map((post) => {
    const ranking = scorePost(post, { ...context, profile });
    return { ...post, ...ranking };
  });
  scored.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.postedAt || b.indexedAt || 0) - new Date(a.postedAt || a.indexedAt || 0);
  });
  return scored.map((post, index) => ({ ...post, rank: index + 1 }));
}

export function summarize(posts, windowHours) {
  const fresh24 = posts.filter(
    (post) => hoursSince(post.postedAt || post.indexedAt) <= 24,
  ).length;
  return {
    total: posts.length,
    fresh24,
    highPriority: posts.filter((post) => post.priority === "high").length,
    withEngagement: posts.filter((post) => post.engagement).length,
    windowHours,
  };
}
