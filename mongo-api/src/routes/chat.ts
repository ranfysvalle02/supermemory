import { Hono } from "hono"
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { requireAuth } from "../middleware"
import { DocumentModel } from "../models/document"
import { ChunkModel } from "../models/chunk"
import { generateEmbedding } from "../embeddings"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

async function retrieveContext(
	orgId: string,
	query: string,
): Promise<string> {
	let chunks: Array<Record<string, unknown>> = []

	if (process.env.OPENAI_API_KEY) {
		try {
			const embedding = await generateEmbedding(query)
			chunks = await ChunkModel.aggregate([
				{
					$vectorSearch: {
						index: "chunk_embedding_index",
						path: "embedding",
						queryVector: embedding,
						numCandidates: 60,
						limit: 6,
						filter: { orgId },
					},
				},
				{
					$project: {
						content: 1,
						documentId: 1,
						score: { $meta: "vectorSearchScore" },
					},
				},
			])
		} catch {
			// Vector search unavailable — fall back to text match
		}
	}

	if (chunks.length === 0) {
		const docs = await DocumentModel.find({ orgId })
			.select("_id title content summary")
			.sort({ createdAt: -1 })
			.limit(8)
			.lean()

		return docs
			.map(
				(d) =>
					`## ${(d.title as string) ?? "Untitled"}\n${((d.content as string) ?? (d.summary as string) ?? "").slice(0, 600)}`,
			)
			.join("\n\n")
	}

	const docIds = [...new Set(chunks.map((ch) => ch.documentId as string))]
	const docs = await DocumentModel.find({ _id: { $in: docIds } })
		.select("_id title")
		.lean()
	const titleMap = new Map(
		docs.map((d) => [d._id as string, (d.title as string) ?? "Untitled"]),
	)

	return chunks
		.map((ch) => {
			const title = titleMap.get(ch.documentId as string) ?? "Untitled"
			return `## ${title}\n${ch.content}`
		})
		.join("\n\n")
}

app.post("/", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()
	const { messages } = body

	if (!process.env.OPENAI_API_KEY) {
		return c.json(
			{
				error:
					"OPENAI_API_KEY not configured. Set it in your .env to enable chat.",
			},
			500,
		)
	}

	const lastUserMessage = [...messages]
		.reverse()
		.find((m: { role: string }) => m.role === "user")
	const query = lastUserMessage?.content ?? ""

	const context = await retrieveContext(orgId, query)

	const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

	const result = streamText({
		model: openai("gpt-4o-mini"),
		system: `You are Nova, the AI assistant for Supermemory. You help users explore and understand their saved memories, documents, and notes.

You have access to the user's saved content below. Use it to answer their questions accurately. If the content doesn't cover the question, say so honestly and offer to help with what you do know about their collection.

Be conversational, helpful, and reference specific documents when relevant. Keep responses concise but thorough.

---
USER'S SAVED CONTENT:
${context}
---`,
		messages: messages.map((m: { role: string; content: string }) => ({
			role: m.role as "user" | "assistant" | "system",
			content: typeof m.content === "string" ? m.content : "",
		})),
	})

	return result.toUIMessageStreamResponse({
		headers: {
			"Access-Control-Allow-Origin":
				process.env.CORS_ORIGIN ?? "http://localhost:3000",
			"Access-Control-Allow-Credentials": "true",
		},
	})
})

export const chatRoutes = app
