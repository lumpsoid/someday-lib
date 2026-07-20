import { requestUrl, type RequestUrlParam } from 'obsidian';

// Thin wrapper over Obsidian's requestUrl (bypasses CORS, works on mobile) that
// normalizes failures into typed errors and applies a light rate-limit backoff.
// This is I/O plumbing — it never decides anything about the payload.

const RATE_LIMIT_BACKOFF_MS = 10_000; // 429: brief wait, then one retry
const RATE_LIMIT_MAX_RETRIES = 1;

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

async function request(param: RequestUrlParam): Promise<unknown> {
	for (let attempt = 0; ; attempt += 1) {
		let status: number;
		let bodyText: string;
		try {
			// Read the raw text so we control JSON parsing and can surface the
			// body when a request fails (APIs like AniList report errors in it).
			const res = await requestUrl({ ...param, throw: false });
			status = res.status;
			bodyText = res.text;
		} catch (err) {
			// Network-level failure (offline, DNS, TLS): no HTTP status.
			throw new HttpError(0, `Network request failed: ${String(err)}`);
		}

		if (status >= 200 && status < 300) {
			try {
				return JSON.parse(bodyText);
			} catch {
				throw new HttpError(status, 'Response was not valid JSON.');
			}
		}

		if (status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
			await sleep(RATE_LIMIT_BACKOFF_MS);
			continue;
		}

		const detail = bodyDetail(bodyText);
		if (status === 429) {
			throw new HttpError(429, `Rate limited. Please wait and try again.${detail}`);
		}
		if (status === 403) {
			throw new HttpError(
				403,
				`Blocked by the service (403). Wait a few minutes and retry.${detail}`,
			);
		}
		throw new HttpError(status, `Request failed with status ${status}.${detail}`);
	}
}

/** Extract a short, human-useful snippet from an error response body. */
function bodyDetail(bodyText: string): string {
	const trimmed = bodyText.trim();
	if (!trimmed) return '';
	try {
		const parsed = JSON.parse(trimmed) as {
			errors?: Array<{ message?: string }>;
		};
		if (parsed.errors?.length) {
			const messages = parsed.errors
				.map((e) => e.message)
				.filter(Boolean)
				.join('; ');
			if (messages) return ` ${messages}`;
		}
	} catch {
		// Not JSON — fall through to a raw snippet.
	}
	return ` ${trimmed.slice(0, 200)}`;
}

export async function getJson<T>(
	url: string,
	headers?: Record<string, string>,
): Promise<T> {
	return (await request({ url, method: 'GET', headers })) as T;
}

export async function postJson<T>(
	url: string,
	body: unknown,
	headers?: Record<string, string>,
): Promise<T> {
	return (await request({
		url,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify(body),
		headers: { Accept: 'application/json', ...headers },
	})) as T;
}
