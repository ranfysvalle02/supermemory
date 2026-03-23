import { Hono } from "hono"
import { auth } from "../auth"
import { DocumentModel } from "../models/document"
import { ChunkModel } from "../models/chunk"
import { SpaceModel } from "../models/space"
import { nanoid } from "nanoid"

const DEMO_EMAIL = "demo@supermemory.local"
const DEMO_NAME = "Demo User"
const DEMO_PASSWORD = "demo-local-only-not-for-prod"

const SEED_SPACES = [
	{ name: "Research", emoji: "🔬", description: "Research notes and papers" },
	{
		name: "Work",
		emoji: "💼",
		description: "Work-related documents and tasks",
	},
	{
		name: "Bookmarks",
		emoji: "🔖",
		description: "Interesting links and articles",
	},
]

const SEED_DOCUMENTS = [
	{
		title: "How Vector Search Works",
		content:
			"Vector search (also called semantic search) finds documents by meaning rather than exact keyword matches. It works by converting text into high-dimensional vectors using embedding models, then finding the nearest neighbors in vector space. MongoDB Atlas Vector Search uses the $vectorSearch aggregation stage to perform approximate nearest neighbor (ANN) searches efficiently. The key advantage is that a query like 'how to cook pasta' will match documents about 'Italian recipe instructions' even if those exact words don't appear.",
		type: "text",
		source: "note",
		space: "Research",
	},
	{
		title: "Weekly Standup Notes - Project Alpha",
		content:
			"Sprint 14 progress: Authentication module complete. Search API at 80% — vector index creation done, need to wire up filtering by space/tags. Blockers: waiting on design review for the settings page. Action items: 1) Finish search route tests by Wednesday 2) Deploy staging build for QA 3) Schedule demo with stakeholders for Friday. Team velocity looking good at 34 points, up from 28 last sprint.",
		type: "text",
		source: "note",
		space: "Work",
	},
	{
		title: "The Illustrated Transformer",
		content:
			'Transformers are the architecture behind modern LLMs. The key innovation is the self-attention mechanism, which allows the model to weigh the importance of different parts of the input when producing each part of the output. Unlike RNNs, transformers process all positions in parallel, making them much faster to train. The architecture consists of an encoder (which reads the input) and a decoder (which produces the output), each made of stacked layers of multi-head attention and feed-forward networks. The "Attention Is All You Need" paper by Vaswani et al. (2017) introduced this architecture.',
		type: "text",
		source: "url",
		url: "https://jalammar.github.io/illustrated-transformer/",
		space: "Bookmarks",
	},
	{
		title: "MongoDB Atlas Local Development Setup",
		content:
			"To run MongoDB Atlas features locally (including Vector Search), use the mongodb/mongodb-atlas-local Docker image. It bundles mongod with mongot (the search/vector engine) in a single container. Key steps: 1) Pull the image 2) Create a docker-compose.yml with healthcheck 3) Mount an init script to create vector search indexes 4) Collections must exist before calling createSearchIndex(). The local image supports $vectorSearch aggregation with cosine, euclidean, and dotProduct similarity metrics.",
		type: "text",
		source: "note",
		space: "Research",
	},
	{
		title: "Reading List: Distributed Systems",
		content:
			'Essential reading for distributed systems: "Designing Data-Intensive Applications" by Martin Kleppmann covers the fundamentals of replication, partitioning, and consistency. The CAP theorem states you can only have two of three: Consistency, Availability, and Partition tolerance. In practice, since network partitions are inevitable, the real choice is between consistency and availability during a partition. Raft and Paxos are the most common consensus algorithms. For eventual consistency, CRDTs (Conflict-free Replicated Data Types) allow merging concurrent updates without coordination.',
		type: "text",
		source: "note",
		space: "Bookmarks",
	},
	{
		title: "API Design Best Practices",
		content:
			"REST API design guidelines we follow: Use nouns for resource URLs (/documents, /users), HTTP verbs for actions (GET, POST, PUT, DELETE). Always version your API (/v3/documents). Return consistent error shapes with status codes. Use cursor-based pagination for large collections. Include rate limiting headers (X-RateLimit-Remaining). For search endpoints, POST is acceptable since query bodies can be complex. Use ETags for caching. Authentication via Bearer tokens in the Authorization header. CORS should be configured per-environment.",
		type: "text",
		source: "note",
		space: "Work",
	},
]

async function seedDemoData(userId: string, orgId: string) {
	const existingDocs = await DocumentModel.countDocuments({ orgId })
	if (existingDocs > 0) return

	console.log("[demo] Seeding demo data...")

	const spaceMap = new Map<string, string>()
	for (const s of SEED_SPACES) {
		const tag = `space-${nanoid(10)}`
		await SpaceModel.create({
			name: s.name,
			emoji: s.emoji,
			description: s.description,
			orgId,
			ownerId: userId,
			containerTag: tag,
		})
		spaceMap.set(s.name, tag)
	}

	for (const doc of SEED_DOCUMENTS) {
		const containerTags = doc.space ? [spaceMap.get(doc.space)!] : []
		const words = doc.content.split(/\s+/)

		const created = await DocumentModel.create({
			orgId,
			userId,
			title: doc.title,
			content: doc.content,
			type: doc.type,
			source: doc.source,
			url: (doc as Record<string, unknown>).url ?? null,
			status: "completed",
			containerTags,
			wordCount: words.length,
			tokenCount: Math.ceil(words.length * 1.3),
			chunkCount: 1,
		})

		await ChunkModel.create({
			documentId: created._id,
			orgId,
			containerTags,
			content: doc.content,
			type: "text",
			position: 0,
		})
	}

	console.log(
		`[demo] Seeded ${SEED_DOCUMENTS.length} documents in ${SEED_SPACES.length} spaces`,
	)
}

export const demoRoutes = new Hono()

demoRoutes.get("/", async (c) => {
	try {
		// Ensure demo user exists
		await auth.api
			.signUpEmail({
				body: {
					email: DEMO_EMAIL,
					name: DEMO_NAME,
					password: DEMO_PASSWORD,
				},
			})
			.catch(() => {})

		// Sign in and get the raw Response with Set-Cookie headers
		const res = await auth.api.signInEmail({
			body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
			asResponse: true,
		})

		// Extract the user ID from the JSON body so we can seed data
		const cloned = res.clone()
		const body = (await cloned.json()) as {
			user?: { id?: string }
			session?: Record<string, unknown>
		}
		const userId = body?.user?.id
		if (userId) {
			const orgId =
				(body.session?.activeOrganizationId as string) ?? userId
			await seedDemoData(userId, orgId)
		}

		// Forward auth cookies to the browser
		const origin = process.env.CORS_ORIGIN ?? "http://localhost:3000"
		const cookies = res.headers.getSetCookie()

		const headers = new Headers()
		headers.set("Location", origin)
		for (const cookie of cookies) {
			headers.append("Set-Cookie", cookie)
		}

		return new Response(null, { status: 302, headers })
	} catch (err) {
		console.error("[demo-login] Error:", err)
		return c.json(
			{ error: "Demo login failed", detail: String(err) },
			500,
		)
	}
})
