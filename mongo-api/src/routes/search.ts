import { Hono } from "hono"
import { ChunkModel } from "../models/chunk"
import { DocumentModel } from "../models/document"
import { requireAuth } from "../middleware"
import { generateEmbedding } from "../embeddings"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

interface ChunkHit {
	_id: string
	content: string
	documentId: string
	score: number
	position: number
}

// POST /v3/search
app.post("/", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()

	const {
		q,
		limit = 10,
		containerTags,
		docId,
		chunkThreshold = 0,
		documentThreshold = 0,
		includeFullDocs = false,
		includeSummary = false,
	} = body

	const start = Date.now()

	let queryEmbedding: number[]
	try {
		queryEmbedding = await generateEmbedding(q)
	} catch {
		return c.json({ error: "Failed to generate query embedding" }, 500)
	}

	const docFilter: Record<string, unknown> = { orgId }
	if (containerTags?.length) {
		docFilter.containerTags = { $in: containerTags }
	}
	if (docId) {
		docFilter._id = docId
	}

	const scopedDocIds = await DocumentModel.find(docFilter)
		.select("_id")
		.lean()
		.then((docs) => docs.map((d) => d._id as string))

	if (scopedDocIds.length === 0) {
		return c.json({ results: [], timing: Date.now() - start, total: 0 })
	}

	let chunkResults: ChunkHit[]

	try {
		chunkResults = await ChunkModel.aggregate([
			{
				$vectorSearch: {
					index: "chunk_embedding_index",
					path: "embedding",
					queryVector: queryEmbedding,
					numCandidates: limit * 20,
					limit: limit * 3,
					filter: {
						documentId: { $in: scopedDocIds },
					},
				},
			},
			{
				$project: {
					_id: 1,
					content: 1,
					documentId: 1,
					position: 1,
					score: { $meta: "vectorSearchScore" },
				},
			},
		])
	} catch {
		// Fallback: in-memory cosine similarity (works without Atlas Search index)
		const chunks = await ChunkModel.find({
			documentId: { $in: scopedDocIds },
			embedding: { $exists: true, $ne: null },
		})
			.select("_id content documentId position embedding")
			.lean()

		chunkResults = chunks
			.map((chunk) => ({
				_id: chunk._id as string,
				content: chunk.content as string,
				documentId: chunk.documentId as string,
				position: chunk.position as number,
				score: cosineSimilarity(
					queryEmbedding,
					chunk.embedding as number[],
				),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, limit * 3)
	}

	const filteredChunks = chunkResults.filter(
		(ch) => ch.score >= chunkThreshold,
	)

	const byDoc = new Map<
		string,
		Array<{ content: string; score: number; position: number }>
	>()
	for (const ch of filteredChunks) {
		const arr = byDoc.get(ch.documentId) ?? []
		arr.push({
			content: ch.content,
			score: ch.score,
			position: ch.position,
		})
		byDoc.set(ch.documentId, arr)
	}

	const docIds = [...byDoc.keys()]
	const docs = await DocumentModel.find({ _id: { $in: docIds } }).lean()
	const docMap = new Map(docs.map((d) => [d._id as string, d]))

	const results = docIds
		.map((id) => {
			const doc = docMap.get(id)
			const chunks = byDoc.get(id) ?? []
			const bestScore = Math.max(...chunks.map((ch) => ch.score))

			if (bestScore < documentThreshold) return null

			const sortedChunks = chunks.sort((a, b) => b.score - a.score)

			return {
				documentId: id,
				title: (doc?.title as string) ?? null,
				type: (doc?.type as string) ?? null,
				metadata: doc?.metadata ?? null,
				score: bestScore,
				summary: includeSummary
					? ((doc?.summary as string) ?? null)
					: undefined,
				content: includeFullDocs
					? ((doc?.content as string) ?? null)
					: undefined,
				createdAt: doc?.createdAt as Date,
				updatedAt: doc?.updatedAt as Date,
				chunks: sortedChunks.slice(0, 5).map((ch) => ({
					content: ch.content,
					score: ch.score,
					isRelevant: ch.score >= 0.5,
				})),
			}
		})
		.filter(Boolean)
		.sort((a, b) => b!.score - a!.score)
		.slice(0, limit)

	return c.json({
		results,
		timing: Date.now() - start,
		total: results.length,
	})
})

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0
	let dot = 0
	let normA = 0
	let normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB)
	return denom === 0 ? 0 : dot / denom
}

export { app as searchRoutes }
