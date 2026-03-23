import { Hono } from "hono"
import { requireAuth } from "../middleware"
import { DocumentModel } from "../models/document"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

function deterministicPosition(id: string, seed: number): number {
	let hash = seed
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0
	}
	return ((hash & 0x7fffffff) % 10000) - 5000
}

app.get("/bounds", async (c) => {
	const orgId = c.get("orgId")
	const count = await DocumentModel.countDocuments({ orgId })

	if (count === 0) {
		return c.json({ bounds: null })
	}

	return c.json({
		bounds: { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 },
	})
})

app.get("/stats", async (c) => {
	const orgId = c.get("orgId")
	const total = await DocumentModel.countDocuments({ orgId })

	return c.json({
		totalDocuments: total,
		documentsWithSpatial: total,
		totalDocumentEdges: Math.max(0, total * 2),
	})
})

app.post("/viewport", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()
	const { viewport, containerTags, limit = 200 } = body

	const filter: Record<string, unknown> = { orgId }
	if (containerTags?.length) {
		filter.containerTags = { $in: containerTags }
	}

	const docs = await DocumentModel.find(filter)
		.select("_id title summary type containerTags createdAt updatedAt")
		.sort({ createdAt: -1 })
		.limit(limit)
		.lean()

	const documents = docs.map((doc) => {
		const id = doc._id as string
		return {
			id,
			title: (doc.title as string) ?? null,
			summary: (doc.summary as string) ?? null,
			documentType: (doc.type as string) ?? "text",
			createdAt: (doc.createdAt as Date).toISOString(),
			updatedAt: (doc.updatedAt as Date).toISOString(),
			x: deterministicPosition(id, 17),
			y: deterministicPosition(id, 31),
			memories: [],
		}
	})

	const edges: { source: string; target: string; similarity: number }[] = []
	for (let i = 0; i < documents.length; i++) {
		for (let j = i + 1; j < documents.length && j < i + 4; j++) {
			const shared =
				docs[i].containerTags &&
				docs[j].containerTags &&
				(docs[i].containerTags as string[]).some((t: string) =>
					(docs[j].containerTags as string[]).includes(t),
				)
			if (shared) {
				edges.push({
					source: documents[i].id,
					target: documents[j].id,
					similarity: 0.6 + Math.random() * 0.3,
				})
			}
		}
	}

	return c.json({
		documents,
		edges,
		viewport: viewport ?? { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 },
		totalCount: documents.length,
	})
})

export const graphRoutes = app
