/**
 * Legacy shim: canonical trends payload/HTML contract lives in functions/lib/render.js.
 * Keep this file as a pass-through to avoid duplicate truth paths.
 */
export {
  buildTeamTrendPayload,
  renderTeamTrendPage,
  buildTrendsIndexPayload,
  renderTrendsIndexPage,
  renderTeamPage,
} from '../../functions/lib/render.js';
