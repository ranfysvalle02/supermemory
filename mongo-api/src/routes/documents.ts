import { Hono } from "hono"
import { DocumentModel } from "../models/document"
import { ChunkModel } from "../models/chunk"
import { ApiRequestModel } from "../models/api-request"
import { SpaceModel } from "../models/space"
import { requireAuth } from "../middleware"
import {
	chunkText,
	generateEmbedding,
	generateEmbeddings,
	EMBEDDING_MODEL,
} from "../embeddings"
import type { AppEnv } from "../types"
import crypto from "node:crypto"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

async function ensureSpacesForTags(
	orgId: string,
	userId: string,
	tags: string[],
) {
	for (const tag of tags) {
		await SpaceModel.findOneAndUpdate(
			{ orgId, containerTag: tag },
			{
				$setOnInsert: {
					name: tag.replace(/^sm_project_/, "").replace(/_/g, " "),
					orgId,
					ownerId: userId,
					containerTag: tag,
				},
			},
			{ upsert: true, new: true },
		)
	}
}

async function processDocument(docId: string) {
	const doc = await DocumentModel.findById(docId).lean()
	if (!doc?.content || typeof doc.content !== "string") return

	const text: string = doc.content

	try {
		await DocumentModel.findByIdAndUpdate(docId, { status: "extracting" })

		const contentHash = crypto
			.createHash("sha256")
			.update(text)
			.digest("hex")
		const wordCount = text.split(/\s+/).length
		const tokenCount = Math.ceil(wordCount * 1.3)

		await DocumentModel.findByIdAndUpdate(docId, {
			status: "chunking",
			contentHash,
			wordCount,
			tokenCount,
		})

		const textChunks = chunkText(text)

		await DocumentModel.findByIdAndUpdate(docId, { status: "embedding" })

		let embeddings: number[][] = []
		try {
			embeddings = await generateEmbeddings(textChunks)
		} catch {
			// If embedding fails (no API key), continue without vectors
		}

		const chunkDocs = textChunks.map((content, i) => ({
			documentId: docId,
			orgId: doc.orgId as string,
			containerTags: (doc.containerTags as string[]) ?? [],
			content,
			type: "text" as const,
			position: i,
			embedding: embeddings[i] ?? undefined,
			embeddingModel: embeddings[i] ? EMBEDDING_MODEL : undefined,
		}))

		await ChunkModel.insertMany(chunkDocs)

		let summaryEmbedding: number[] | undefined
		try {
			summaryEmbedding = await generateEmbedding(text.slice(0, 3000))
		} catch {
			// Continue without summary embedding
		}

		await DocumentModel.findByIdAndUpdate(docId, {
			status: "done",
			chunkCount: textChunks.length,
			averageChunkSize: Math.round(
				textChunks.reduce((a, c) => a + c.length, 0) / textChunks.length,
			),
			summaryEmbedding: summaryEmbedding ?? undefined,
			summaryEmbeddingModel: summaryEmbedding ? EMBEDDING_MODEL : undefined,
		})
	} catch (err) {
		console.error(`Processing failed for doc ${docId}:`, err)
		await DocumentModel.findByIdAndUpdate(docId, { status: "failed" })
	}
}

// POST /v3/documents - Add a memory/document
app.post("/", async (c) => {
	const start = Date.now()
	const userId = c.get("userId")
	const orgId = c.get("orgId")
	const body = await c.req.json()

	const { content, customId, metadata, containerTags, entityContext } = body

	if (containerTags?.length) {
		await ensureSpacesForTags(orgId, userId, containerTags)
	}

	const doc = await DocumentModel.create({
		orgId,
		userId,
		content,
		customId: customId ?? null,
		metadata: metadata ?? null,
		containerTags: containerTags ?? [],
		status: content ? "queued" : "done",
		type: "text",
		raw: entityContext ? { entityContext } : null,
	})

	if (content) {
		processDocument(doc._id).catch(console.error)
	}

	await ApiRequestModel.create({
		type: "add",
		orgId,
		userId,
		statusCode: 200,
		duration: Date.now() - start,
		input: {
			content: typeof content === "string" ? content.slice(0, 200) : null,
			customId,
			containerTags,
		},
		output: { id: doc._id, status: doc.status },
	}).catch(() => {})

	return c.json({ id: doc._id, status: doc.status })
})

// POST /v3/documents/list - List memories
app.post("/list", async (c) => {
	const orgId = c.get("orgId")
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

	const page = Number(body.page) || 1
	const limit = Math.min(Number(body.limit) || 10, 1100)
	const skip = (page - 1) * limit

	const filter: Record<string, unknown> = { orgId }
	if (body.status) filter.status = body.status
	if (Array.isArray(body.containerTags) && body.containerTags.length > 0) {
		filter.containerTags = { $in: body.containerTags }
	}

	const [docs, totalItems] = await Promise.all([
		DocumentModel.find(filter)
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit)
			.lean(),
		DocumentModel.countDocuments(filter),
	])

	const memories = docs.map((d) => ({
		id: d._id as string,
		customId: d.customId as string | null,
		connectionId: d.connectionId as string | null,
		title: d.title as string | null,
		summary: d.summary as string | null,
		type: d.type as string,
		status: d.status as string,
		metadata: d.metadata,
		containerTags: d.containerTags as string[],
		createdAt: (d.createdAt as Date).toISOString(),
		updatedAt: (d.updatedAt as Date).toISOString(),
	}))

	return c.json({
		memories,
		pagination: {
			currentPage: page,
			limit,
			totalItems,
			totalPages: Math.ceil(totalItems / limit),
		},
	})
})

// POST /v3/documents/documents - Documents with memory entries
app.post("/documents", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()

	const page = body.page ?? 1
	const limit = Math.min(body.limit ?? 10, 100)
	const skip = (page - 1) * limit
	const sortField = body.sort ?? "createdAt"
	const sortOrder = body.order === "asc" ? 1 : -1

	const filter: Record<string, unknown> = { orgId }
	if (Array.isArray(body.containerTags) && body.containerTags.length > 0) {
		filter.containerTags = { $in: body.containerTags }
	}

	const [docs, totalItems] = await Promise.all([
		DocumentModel.find(filter)
			.sort({ [sortField]: sortOrder })
			.skip(skip)
			.limit(limit)
			.lean(),
		DocumentModel.countDocuments(filter),
	])

	const documents = docs.map((d) => ({
		id: d._id as string,
		customId: d.customId,
		contentHash: d.contentHash,
		orgId: d.orgId,
		userId: d.userId,
		connectionId: d.connectionId,
		title: d.title,
		content: d.content,
		summary: d.summary,
		url: d.url,
		source: d.source,
		type: d.type,
		status: d.status,
		metadata: d.metadata,
		processingMetadata: d.processingMetadata,
		raw: d.raw,
		tokenCount: d.tokenCount,
		wordCount: d.wordCount,
		chunkCount: d.chunkCount,
		averageChunkSize: d.averageChunkSize,
		summaryEmbedding: d.summaryEmbedding,
		summaryEmbeddingModel: d.summaryEmbeddingModel,
		createdAt: d.createdAt as Date,
		updatedAt: d.updatedAt as Date,
		memoryEntries: [],
	}))

	return c.json({
		documents,
		pagination: {
			currentPage: page,
			limit,
			totalItems,
			totalPages: Math.ceil(totalItems / limit),
		},
	})
})

// POST /v3/documents/documents/by-ids
app.post("/documents/by-ids", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()
	const { ids, by, containerTags } = body

	const field = by === "customId" ? "customId" : "_id"
	const filter: Record<string, unknown> = {
		orgId,
		[field]: { $in: ids },
	}
	if (Array.isArray(containerTags) && containerTags.length > 0) {
		filter.containerTags = { $in: containerTags }
	}

	const docs = await DocumentModel.find(filter).lean()

	const documents = docs.map((d) => ({
		id: d._id as string,
		customId: d.customId,
		contentHash: d.contentHash,
		orgId: d.orgId,
		userId: d.userId,
		connectionId: d.connectionId,
		title: d.title,
		content: d.content,
		summary: d.summary,
		url: d.url,
		source: d.source,
		type: d.type,
		status: d.status,
		metadata: d.metadata,
		processingMetadata: d.processingMetadata,
		raw: d.raw,
		tokenCount: d.tokenCount,
		wordCount: d.wordCount,
		chunkCount: d.chunkCount,
		averageChunkSize: d.averageChunkSize,
		summaryEmbedding: d.summaryEmbedding,
		summaryEmbeddingModel: d.summaryEmbeddingModel,
		createdAt: d.createdAt as Date,
		updatedAt: d.updatedAt as Date,
		memoryEntries: [],
	}))

	return c.json({
		documents,
		pagination: {
			currentPage: 1,
			limit: documents.length,
			totalItems: documents.length,
			totalPages: 1,
		},
	})
})

// POST /v3/documents/migrate-mcp
app.post("/migrate-mcp", async (c) => {
	return c.json({
		success: true,
		migratedCount: 0,
		message: "No documents to migrate",
		documentIds: [],
	})
})

// GET /v3/documents/:id
app.get("/:id", async (c) => {
	const orgId = c.get("orgId")
	const id = c.req.param("id")

	const doc = await DocumentModel.findOne({ _id: id, orgId }).lean()
	if (!doc) return c.json({ error: "Not found" }, 404)

	return c.json({
		id: doc._id as string,
		customId: doc.customId,
		connectionId: doc.connectionId,
		content: doc.content,
		metadata: doc.metadata,
		source: doc.source,
		status: doc.status,
		summary: doc.summary,
		title: doc.title,
		type: doc.type,
		url: doc.url,
		containerTags: doc.containerTags,
		chunkCount: doc.chunkCount,
		createdAt: (doc.createdAt as Date).toISOString(),
		updatedAt: (doc.updatedAt as Date).toISOString(),
	})
})

// DELETE /v3/documents/bulk - must be before /:id
app.delete("/bulk", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()
	const { ids, containerTags } = body

	let deletedCount = 0

	if (ids?.length) {
		const docs = await DocumentModel.find({
			_id: { $in: ids },
			orgId,
		}).lean()
		const docIds = docs.map((d) => d._id as string)
		await ChunkModel.deleteMany({ documentId: { $in: docIds } })
		const result = await DocumentModel.deleteMany({
			_id: { $in: docIds },
			orgId,
		})
		deletedCount = result.deletedCount
	} else if (containerTags?.length) {
		const docs = await DocumentModel.find({
			orgId,
			containerTags: { $in: containerTags },
		}).lean()
		const docIds = docs.map((d) => d._id as string)
		await ChunkModel.deleteMany({ documentId: { $in: docIds } })
		const result = await DocumentModel.deleteMany({ _id: { $in: docIds } })
		deletedCount = result.deletedCount
	}

	return c.json({
		success: true,
		deletedCount,
		containerTags: containerTags ?? undefined,
	})
})

// DELETE /v3/documents/:id
app.delete("/:id", async (c) => {
	const orgId = c.get("orgId")
	const id = c.req.param("id")

	await ChunkModel.deleteMany({ documentId: id })
	await DocumentModel.deleteOne({ _id: id, orgId })

	return c.body(null, 204)
})

export { app as documentRoutes }
