const SUPPRESSED_SENTENCE =
  "That season-pattern context is intentionally suppressed for this matchup, so I'm sticking to the live game data here.";

const UNAVAILABLE_SENTENCE =
  "That season-pattern context is unavailable right now, so I'm sticking to the live game data here.";

const sectionStatus = (section) => {
  if (!section || typeof section !== "object") return "unavailable";
  return typeof section.status === "string" ? section.status.toLowerCase() : "unavailable";
};

const sectionSummary = (section) => {
  if (!section || typeof section !== "object") return null;
  if (typeof section.summary === "string" && section.summary.trim()) return section.summary.trim();
  if (typeof section.detail === "string" && section.detail.trim()) return section.detail.trim();
  return null;
};

const sectionSample = (section) => {
  if (!section || typeof section !== "object") return null;
  if (typeof section.sampleLabel === "string" && section.sampleLabel.trim()) return section.sampleLabel.trim();
  return null;
};

const sectionScope = (section) => {
  if (!section || typeof section !== "object") return null;
  if (typeof section.scope === "string" && section.scope.trim()) return section.scope.trim();
  return null;
};

const normalizeAvailability = (packet) => {
  if (!packet || typeof packet !== "object") return null;
  const availability = packet.availability;
  return availability && typeof availability === "object" ? availability : null;
};

const hasReadySection = (packet) => {
  const sections = [packet?.seasonContext, packet?.liveStateContext, packet?.environmentContext];
  return sections.some((section) => sectionStatus(section) === "ready");
};

const hasSuppressedSection = (packet) => {
  const sections = [packet?.seasonContext, packet?.liveStateContext, packet?.environmentContext];
  return sections.some((section) => sectionStatus(section) === "suppressed");
};

export const deriveNbaContextState = (packet) => {
  if (!packet || typeof packet !== "object") return "unavailable";
  if (hasReadySection(packet)) return "available";
  if (hasSuppressedSection(packet)) return "suppressed";
  return "unavailable";
};

export const buildNbaContextResponsePolicy = (state) => {
  if (state === "available") {
    return [
      "NBA_CONTEXT_STATE: AVAILABLE",
      "NBA_CONTEXT_POLICY: Use provided NBA context summaries directly and only from supplied packet fields.",
      "Do not invent additional season, live-state, or environment claims outside the packet.",
    ].join("\n");
  }

  if (state === "suppressed") {
    return [
      "NBA_CONTEXT_STATE: SUPPRESSED",
      "NBA_CONTEXT_POLICY: You may mention context availability in at most one sentence.",
      `Use this exact sentence when needed: "${SUPPRESSED_SENTENCE}"`,
      "Do not use causal or speculative language for suppressed context.",
      "Do not infer season-pattern or historical game-shape claims from suppressed context.",
    ].join("\n");
  }

  return [
    "NBA_CONTEXT_STATE: UNAVAILABLE",
    "NBA_CONTEXT_POLICY: You may mention context availability in at most one sentence.",
    `Use this exact sentence when needed: "${UNAVAILABLE_SENTENCE}"`,
    "Do not use causal or speculative language for unavailable context.",
    "Do not infer season-pattern or historical game-shape claims when context is unavailable.",
  ].join("\n");
};

const summarizeSection = (label, section) => {
  const status = sectionStatus(section);
  const summary = sectionSummary(section) || "Unavailable.";
  const sample = sectionSample(section) || "no sample label";
  const scope = sectionScope(section) || "NA";
  return `${label} [${status}] (${scope}) -> ${summary} | sample: ${sample}`;
};

export const buildNbaProductContextBrief = (packet) => {
  if (!packet || typeof packet !== "object") return "";
  const availability = normalizeAvailability(packet);
  const availabilityLine = availability
    ? [
        `season=${availability.seasonContext ? "on" : "off"}`,
        `live_state=${availability.liveStateContext ? "on" : "off"}`,
        `environment=${availability.environmentContext ? "on" : "off"}`,
        `recent_overlay=${availability.recentOverlaySupplement ? "on" : "off"}`,
      ].join(" | ")
    : "season=off | live_state=off | environment=off | recent_overlay=off";

  return [
    `AVAILABILITY: ${availabilityLine}`,
    summarizeSection("Season", packet.seasonContext),
    summarizeSection("LiveState", packet.liveStateContext),
    summarizeSection("Environment", packet.environmentContext),
  ].join("\n");
};

export const buildNbaPromptContextBlock = (packet) => {
  const brief = buildNbaProductContextBrief(packet);
  if (!brief) return "";
  const state = deriveNbaContextState(packet);
  const policy = buildNbaContextResponsePolicy(state);
  return [`NBA_PRODUCT_CONTEXT:`, brief, policy].join("\n");
};

export const __test = {
  SUPPRESSED_SENTENCE,
  UNAVAILABLE_SENTENCE,
};

