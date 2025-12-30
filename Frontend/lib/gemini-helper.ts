export const COMMON_GEMINI_MODELS = ['gemini-2.0-flash-lite'];

/**
 * Call Gemini, trying multiple models and both v1beta and v1 endpoints.
 * Returns the first successful response as { ok: true, model, endpoint, data }
 * or { ok: false, status, text } on failure.
 */
export async function callGemini(
	promptText: string,
	opts?: {
		candidateModels?: string[];
		maxOutputTokens?: number;
		temperature?: number;
	}
) {
	const key = process.env.GEMINI_API_KEY;
	if (!key) return { ok: false, status: null, text: 'no_gemini_key' };

	const candidateModels = (opts && opts.candidateModels) || COMMON_GEMINI_MODELS;
	const maxOutputTokens = (opts && opts.maxOutputTokens) || 1000;
	const temperature = (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.25;

	// Prefer v1beta (contents + generationConfig) payload shape, then fall back to v1 variants
	const tryEndpoints = ['v1beta', 'v1'];

	for (const model of candidateModels) {
		for (const ep of tryEndpoints) {
			const base = ep === 'v1' ? 'v1' : 'v1beta';
			const url = `https://generativelanguage.googleapis.com/${base}/models/${model}:generateContent?key=${key}`;

			let bodyToSend: any;
			if (ep === 'v1') {
				bodyToSend = {
					prompt: { text: promptText },
					temperature,
					maxOutputTokens,
					candidateCount: 1
				};
			} else {
				bodyToSend = {
					contents: [{ parts: [{ text: promptText }] }],
					generationConfig: { temperature, maxOutputTokens, candidateCount: 1 }
				};
			}

			try {
				const resp = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(bodyToSend)
				});
				const text = await resp.text().catch(() => '');
				if (!resp.ok) {
					console.warn('[gemini-helper] request failed', { model, endpoint: ep, status: resp.status, bodyPreview: (text || '').slice(0,500) });
					continue;
				}
				let data: any = {};
				try { data = text ? JSON.parse(text) : {}; } catch (e) {
					console.warn('[gemini-helper] invalid JSON from gemini', { model, endpoint: ep, preview: (text || '').slice(0,500) });
					continue;
				}

				const genText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.output?.[0]?.content || data.candidates?.[0]?.output || '';
				return { ok: true, model, endpoint: ep, data: { ...data, text: genText } };
			} catch (err) {
				console.warn('[gemini-helper] network/exception', { model, endpoint: ep, err: err instanceof Error ? err.message : String(err) });
				continue;
			}
		}
	}

	return { ok: false, status: null, text: 'no_model_endpoint_succeeded' };
}

