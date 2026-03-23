import { Hono } from "hono"
import { streamText, generateText, type LanguageModel } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { requireAuth } from "../middleware"
import { DocumentModel } from "../models/document"
import { ChunkModel } from "../models/chunk"
import { ThreadModel } from "../models/thread"
import { generateEmbedding } from "../embeddings"
import type { AppEnv } from "../types"
import { nanoid } from "nanoid"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * AI SDK v6 UIMessages use `parts: [{ type: "text", text: "..." }]`.
 * Legacy formats may use `content: "string"`. Handle both.
 */
function extractContent(msg: Record<string, unknown>): string {
	if (typeof msg.content === "string" && msg.content.length > 0)
		return msg.content

	if (Array.isArray(msg.parts)) {
		return (msg.parts as Array<Record<string, unknown>>)
			.filter((p) => p.type === "text" && typeof p.text === "string")
			.map((p) => p.text as string)
			.join(" ")
			.trim()
	}

	return ""
}

function resolveModel(modelId: string): LanguageModel | null {
	if (modelId.startsWith("gemini")) {
		const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
		if (apiKey) {
			const google = createGoogleGenerativeAI({ apiKey })
			return google(modelId)
		}
	}

	if (process.env.OPENAI_API_KEY) {
		const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
		const id = modelId.startsWith("gpt") ? modelId : "gpt-4o-mini"
		return openai(id)
	}

	// Last resort: try any available Gemini key
	const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
	if (geminiKey) {
		const google = createGoogleGenerativeAI({ apiKey: geminiKey })
		return google("gemini-2.0-flash")
	}

	return null
}

/** Cheapest available model for utility tasks (follow-ups, title gen). */
function getUtilityModel(): LanguageModel | null {
	if (process.env.OPENAI_API_KEY) {
		return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o-mini")
	}
	const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
	if (geminiKey) {
		return createGoogleGenerativeAI({ apiKey: geminiKey })("gemini-2.0-flash")
	}
	return null
}

async function retrieveContext(
	orgId: string,
	query: string,
): Promise<string> {
	let chunks: Array<Record<string, unknown>> = []

	if (process.env.OPENAI_API_KEY && query.length > 0) {
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
			// Vector search unavailable — fall back below
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

// ---------------------------------------------------------------------------
// POST /v2 — streaming chat
// ---------------------------------------------------------------------------

app.post("/v2", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()
	const { messages, metadata } = body
	const chatId: string | undefined = metadata?.chatId
	const projectId: string | undefined = metadata?.projectId
	const modelId: string = metadata?.model || "gpt-4o-mini"

	const normalizedMessages = (messages as Array<Record<string, unknown>>)
		.map((m) => ({
			role: m.role as "user" | "assistant" | "system",
			content: extractContent(m),
		}))
		.filter((m) => m.content.length > 0)

	if (normalizedMessages.length === 0) {
		return c.json({ error: "No message content found" }, 400)
	}

	const lastUserMessage = [...normalizedMessages]
		.reverse()
		.find((m) => m.role === "user")
	const query = lastUserMessage?.content ?? ""

	const model = resolveModel(modelId)
	if (!model) {
		return c.json(
			{
				error: `No API key configured for model "${modelId}". Set OPENAI_API_KEY or GEMINI_API_KEY in your environment.`,
			},
			500,
		)
	}

	const context = await retrieveContext(orgId, query)

	const result = streamText({
		model,
		system: `You are Nova, the AI assistant for Supermemory. You help users explore and understand their saved memories, documents, and notes.

You have access to the user's saved content below. Use it to answer their questions accurately. If the content doesn't cover the question, say so honestly and offer to help with what you do know about their collection.

Be conversational, helpful, and reference specific documents when relevant. Keep responses concise but thorough.

---
USER'S SAVED CONTENT:
${context}
---`,
		messages: normalizedMessages,
		onFinish: async ({ text }) => {
			if (!chatId) return
			try {
				const incomingParts = (
					messages as Array<Record<string, unknown>>
				).map((m) => ({
					id: (m.id as string) || nanoid(),
					role: m.role as string,
					parts: Array.isArray(m.parts)
						? m.parts
						: [{ type: "text", text: extractContent(m) }],
					createdAt: m.createdAt ? new Date(m.createdAt as string) : new Date(),
				}))

				const allMessages = [
					...incomingParts,
					{
						id: nanoid(),
						role: "assistant",
						parts: [{ type: "text", text }],
						createdAt: new Date(),
					},
				]

				const title = query.slice(0, 100) || "New Chat"

				await ThreadModel.findByIdAndUpdate(
					chatId,
					{
						orgId,
						projectId: projectId ?? null,
						title,
						messages: allMessages,
					},
					{ upsert: true, new: true, setDefaultsOnInsert: true },
				)
			} catch (err) {
				console.error("Failed to save thread:", err)
			}
		},
	})

	const aiResponse = result.toUIMessageStreamResponse()
	const responseText = await aiResponse.text()

	return c.text(responseText, 200)
})

// ---------------------------------------------------------------------------
// POST /follow-ups — generate follow-up questions
// ---------------------------------------------------------------------------

app.post("/follow-ups", async (c) => {
	const body = await c.req.json()
	const { messages, assistantResponse } = body

	const model = getUtilityModel()
	if (!model) {
		return c.json({ questions: [] })
	}

	try {
		const conversationSummary = (
			messages as Array<{ role: string; content: string }>
		)
			.slice(-4)
			.map((m) => `${m.role}: ${m.content}`)
			.join("\n")

		const { text } = await generateText({
			model,
			system:
				"Generate exactly 3 short follow-up questions the user might want to ask next, based on the conversation. Return ONLY a JSON array of 3 strings, no other text.",
			prompt: `Conversation:\n${conversationSummary}\n\nAssistant's latest response:\n${(assistantResponse as string).slice(0, 1000)}`,
		})

		const cleaned = text.replace(/```json\n?|```\n?/g, "").trim()
		const parsed = JSON.parse(cleaned)
		if (Array.isArray(parsed)) {
			return c.json({ questions: parsed.slice(0, 3) })
		}
	} catch (err) {
		console.error("Failed to generate follow-ups:", err)
	}

	return c.json({ questions: [] })
})

// ---------------------------------------------------------------------------
// GET /threads — list threads for a project
// ---------------------------------------------------------------------------

app.get("/threads", async (c) => {
	const orgId = c.get("orgId")
	const projectId = c.req.query("projectId") || null

	const filter: Record<string, unknown> = { orgId }
	if (projectId) filter.projectId = projectId

	const threads = await ThreadModel.find(filter)
		.select("_id title createdAt updatedAt")
		.sort({ updatedAt: -1 })
		.limit(50)
		.lean()

	return c.json({
		threads: threads.map((t) => ({
			id: t._id,
			title: t.title,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt,
		})),
	})
})

// ---------------------------------------------------------------------------
// GET /threads/:id — load a thread's messages
// ---------------------------------------------------------------------------

app.get("/threads/:id", async (c) => {
	const orgId = c.get("orgId")
	const threadId = c.req.param("id")

	const thread = await ThreadModel.findOne({
		_id: threadId,
		orgId,
	}).lean()

	if (!thread) {
		return c.json({ error: "Thread not found" }, 404)
	}

	return c.json({
		id: thread._id,
		title: thread.title,
		messages: thread.messages,
	})
})

// ---------------------------------------------------------------------------
// DELETE /threads/:id — delete a thread
// ---------------------------------------------------------------------------

app.delete("/threads/:id", async (c) => {
	const orgId = c.get("orgId")
	const threadId = c.req.param("id")

	const result = await ThreadModel.deleteOne({ _id: threadId, orgId })
	if (result.deletedCount === 0) {
		return c.json({ error: "Thread not found" }, 404)
	}

	return c.json({ ok: true })
})

export const chatRoutes = app
