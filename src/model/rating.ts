// Ratings are always stored on a 1–10 scale and are the user's own score —
// upstream critic/community scores are deliberately never imported. This module
// owns the scale so the "what is a valid rating" rule lives in one place.

export const RATING_MIN = 1;
export const RATING_MAX = 10;

/** Clamp an arbitrary number to the valid rating range and round to an integer. */
export function clampRating(value: number): number {
	return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(value)));
}
