// Ratings are always stored on a 1–10 scale. This module owns both the scale
// bounds and the conversion from upstream percent scores (AniList averageScore,
// Steam metacritic) so the "what is a valid rating" rule lives in one place.

export const RATING_MIN = 1;
export const RATING_MAX = 10;

/** Clamp an arbitrary number to the valid rating range and round to an integer. */
export function clampRating(value: number): number {
	return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(value)));
}

/**
 * Convert an upstream 0–100 score to a 1–10 rating, or undefined when the
 * source has no score (0 / missing means "unrated" upstream, not a 1).
 */
export function percentScoreToRating(
	score: number | null | undefined,
): number | undefined {
	if (score === null || score === undefined || score <= 0) return undefined;
	return clampRating(score / 10);
}
