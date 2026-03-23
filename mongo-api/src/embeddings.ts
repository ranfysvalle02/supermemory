import OpenAI from "openai"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const EMBEDDING_MODEL = "text-embedding-3-small"

export async function generateEmbedding(text: string): Promise<number[]> {
	const trimmed = text.slice(0, 8000)
	const res = await openai.embeddings.create({
		model: EMBEDDING_MODEL,
		input: trimmed,
	})
	return res.data[0].embedding
}

export async function generateEmbeddings(
	texts: string[],
): Promise<number[][]> {
	if (texts.length === 0) return []
	const trimmed = texts.map((t) => t.slice(0, 8000))
	const res = await openai.embeddings.create({
		model: EMBEDDING_MODEL,
		input: trimmed,
	})
	return res.data
		.sort((a, b) => a.index - b.index)
		.map((d) => d.embedding)
}

export function chunkText(text: string, maxChunkSize = 1500): string[] {
	const paragraphs = text.split(/\n\n+/)
	const chunks: string[] = []
	let current = ""

	for (const para of paragraphs) {
		if (current.length + para.length > maxChunkSize && current.length > 0) {
			chunks.push(current.trim())
			current = para
		} else {
			current += (current ? "\n\n" : "") + para
		}
	}
	if (current.trim()) chunks.push(current.trim())

	const result: string[] = []
	for (const chunk of chunks) {
		if (chunk.length > maxChunkSize * 1.5) {
			const sentences = chunk.match(/[^.!?]+[.!?]+/g) || [chunk]
			let sub = ""
			for (const sent of sentences) {
				if (sub.length + sent.length > maxChunkSize && sub.length > 0) {
					result.push(sub.trim())
					sub = sent
				} else {
					sub += sent
				}
			}
			if (sub.trim()) result.push(sub.trim())
		} else {
			result.push(chunk)
		}
	}

	return result.length > 0 ? result : [text]
}

export { EMBEDDING_MODEL }
