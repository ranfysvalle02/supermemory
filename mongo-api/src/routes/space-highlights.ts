import { Hono } from "hono"
import { requireAuth } from "../middleware"
import { DocumentModel } from "../models/document"
import { SpaceModel } from "../models/space"
import OpenAI from "openai"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

app.post("/", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()
	const {
		spaceId,
		highlightsCount = 3,
		questionsCount = 4,
		includeHighlights = true,
		includeQuestions = true,
	} = body

	const filter: Record<string, unknown> = { orgId }
	if (spaceId && spaceId !== "sm_project_default") {
		const space = await SpaceModel.findOne({
			_id: spaceId,
			orgId,
		}).lean()
		if (space?.containerTag) {
			filter.containerTags = { $in: [space.containerTag] }
		}
	}

	const docs = await DocumentModel.find(filter)
		.select("_id title content summary")
		.sort({ createdAt: -1 })
		.limit(20)
		.lean()

	if (docs.length === 0) {
		return c.json({
			highlights: [],
			questions: [],
			generatedAt: new Date().toISOString(),
		})
	}

	if (!process.env.OPENAI_API_KEY) {
		return c.json({
			highlights: docs.slice(0, highlightsCount).map((doc, i) => ({
				id: `hl-${i}`,
				title: (doc.title as string) ?? "Untitled",
				content:
					(doc.summary as string) ??
					((doc.content as string) ?? "").slice(0, 200),
				format: "paragraph" as const,
				query: (doc.title as string) ?? "",
				sourceDocumentIds: [doc._id as string],
			})),
			questions: [
				"What are the main themes across my memories?",
				"Summarize my recent notes",
				"What connections exist between my documents?",
				"What should I focus on next?",
			],
			generatedAt: new Date().toISOString(),
		})
	}

	const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

	const docSummaries = docs
		.map(
			(d) =>
				`[${d._id}] "${(d.title as string) ?? "Untitled"}": ${((d.summary as string) ?? (d.content as string) ?? "").slice(0, 300)}`,
		)
		.join("\n")

	const res = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		temperature: 0.7,
		response_format: { type: "json_object" },
		messages: [
			{
				role: "system",
				content: `You generate highlights and questions from a user's saved documents.
Return JSON with this shape:
{
  "highlights": [{ "title": "string", "content": "string", "format": "paragraph"|"bullets"|"quote"|"one_liner", "query": "string", "sourceDocumentIds": ["id1"] }],
  "questions": ["string"]
}
- highlights: ${highlightsCount} insightful summaries connecting themes across documents. Each format should vary.
- questions: ${questionsCount} interesting questions the user could ask about their collection.
- sourceDocumentIds should reference the [id] tags from the input.
- Keep highlights concise (2-3 sentences for paragraph, 3-4 items for bullets).`,
			},
			{
				role: "user",
				content: `Here are my saved documents:\n\n${docSummaries}`,
			},
		],
	})

	try {
		const parsed = JSON.parse(res.choices[0].message.content ?? "{}")
		const highlights = (
			(parsed.highlights as Array<Record<string, unknown>>) ?? []
		)
			.slice(0, highlightsCount)
			.map((h: Record<string, unknown>, i: number) => ({
				id: `hl-${i}`,
				title: h.title ?? "Insight",
				content: h.content ?? "",
				format: h.format ?? "paragraph",
				query: h.query ?? h.title ?? "",
				sourceDocumentIds: h.sourceDocumentIds ?? [],
			}))

		const questions = (
			(parsed.questions as string[]) ?? []
		).slice(0, questionsCount)

		return c.json({
			highlights: includeHighlights ? highlights : [],
			questions: includeQuestions ? questions : [],
			generatedAt: new Date().toISOString(),
		})
	} catch {
		return c.json({
			highlights: [],
			questions: [],
			generatedAt: new Date().toISOString(),
		})
	}
})

export const spaceHighlightsRoutes = app
