import { Hono } from "hono"
import { ConnectionModel } from "../models/connection"
import { DocumentModel } from "../models/document"
import { ChunkModel } from "../models/chunk"
import { requireAuth } from "../middleware"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

function formatConn(conn: Record<string, unknown>) {
	return {
		id: conn._id as string,
		provider: conn.provider as string,
		email: (conn.email as string) ?? undefined,
		documentLimit: conn.documentLimit as number,
		containerTags: conn.containerTags as string[],
		metadata: conn.metadata ?? undefined,
		createdAt: (conn.createdAt as Date).toISOString(),
		expiresAt: conn.expiresAt
			? (conn.expiresAt as Date).toISOString()
			: undefined,
	}
}

// GET /v3/connections
app.get("/", async (c) => {
	const orgId = c.get("orgId")
	const connections = await ConnectionModel.find({ orgId }).lean()
	return c.json(connections.map((conn) => formatConn(conn as Record<string, unknown>)))
})

// POST /v3/connections/list
app.post("/list", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json().catch(() => ({}))
	const filter: Record<string, unknown> = { orgId }

	if (body.containerTags?.length) {
		filter.containerTags = { $in: body.containerTags }
	}

	const connections = await ConnectionModel.find(filter).lean()
	return c.json(connections.map((conn) => formatConn(conn as Record<string, unknown>)))
})

// POST /v3/connections/:provider - Stub
app.post("/:provider", async (c) => {
	const provider = c.req.param("provider")
	return c.json(
		{
			error: `OAuth flow for ${provider} is not implemented in mongo-api. Configure externally.`,
		},
		501,
	)
})

// GET /v3/connections/:connectionId
app.get("/:connectionId", async (c) => {
	const orgId = c.get("orgId")
	const connectionId = c.req.param("connectionId")

	const conn = await ConnectionModel.findOne({
		_id: connectionId,
		orgId,
	}).lean()
	if (!conn) return c.json({ error: "Not found" }, 404)

	return c.json(formatConn(conn as Record<string, unknown>))
})

// DELETE /v3/connections/:connectionId
app.delete("/:connectionId", async (c) => {
	const orgId = c.get("orgId")
	const connectionId = c.req.param("connectionId")

	const conn = await ConnectionModel.findOne({
		_id: connectionId,
		orgId,
	}).lean()
	if (!conn) return c.json({ error: "Not found" }, 404)

	const deleteDocuments = c.req.query("deleteDocuments") === "true"
	if (deleteDocuments) {
		const docs = await DocumentModel.find({
			connectionId,
			orgId,
		}).lean()
		const docIds = docs.map((d) => d._id as string)
		await ChunkModel.deleteMany({ documentId: { $in: docIds } })
		await DocumentModel.deleteMany({ connectionId, orgId })
	}

	await ConnectionModel.deleteOne({ _id: connectionId })

	return c.json({ id: connectionId, provider: conn.provider as string })
})

export { app as connectionRoutes }
