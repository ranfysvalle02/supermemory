import { Hono } from "hono"
import { SpaceModel } from "../models/space"
import { DocumentModel } from "../models/document"
import { ChunkModel } from "../models/chunk"
import { requireAuth } from "../middleware"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

// GET /v3/projects
app.get("/", async (c) => {
	const orgId = c.get("orgId")

	const spaces = await SpaceModel.find({
		orgId,
		containerTag: { $regex: /^sm_project_/ },
	})
		.sort({ createdAt: -1 })
		.lean()

	const projects = await Promise.all(
		spaces.map(async (s) => {
			const documentCount = await DocumentModel.countDocuments({
				orgId,
				containerTags: s.containerTag as string,
			})
			return {
				id: s._id as string,
				name: (s.name as string) ?? "",
				containerTag: (s.containerTag as string) ?? "",
				createdAt: (s.createdAt as Date).toISOString(),
				updatedAt: (s.updatedAt as Date).toISOString(),
				isExperimental: s.isExperimental as boolean,
				documentCount,
				emoji: (s.emoji as string) ?? undefined,
			}
		}),
	)

	return c.json({ projects })
})

// POST /v3/projects
app.post("/", async (c) => {
	const orgId = c.get("orgId")
	const userId = c.get("userId")
	const body = await c.req.json()

	const { name, emoji } = body
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
	const containerTag = `sm_project_${slug}`

	const space = await SpaceModel.findOneAndUpdate(
		{ orgId, containerTag },
		{
			$setOnInsert: {
				name,
				orgId,
				ownerId: userId,
				containerTag,
				emoji: emoji ?? null,
			},
		},
		{ upsert: true, new: true },
	)

	return c.json({
		id: space._id as string,
		name: (space.name as string) ?? "",
		containerTag: (space.containerTag as string) ?? "",
		createdAt: (space.createdAt as Date).toISOString(),
		updatedAt: (space.updatedAt as Date).toISOString(),
		isExperimental: space.isExperimental as boolean,
		documentCount: 0,
		emoji: (space.emoji as string) ?? undefined,
	})
})

// DELETE /v3/projects/:projectId
app.delete("/:projectId", async (c) => {
	const orgId = c.get("orgId")
	const projectId = c.req.param("projectId")
	const body = await c.req.json().catch(() => ({ action: "delete" }))

	const space = await SpaceModel.findOne({ _id: projectId, orgId }).lean()
	if (!space) return c.json({ error: "Not found" }, 404)

	const tag = space.containerTag as string
	const docs = await DocumentModel.find({
		orgId,
		containerTags: tag,
	}).lean()
	const docIds = docs.map((d) => d._id as string)

	let documentsAffected = 0

	if (body.action === "move" && body.targetProjectId) {
		const target = await SpaceModel.findOne({
			_id: body.targetProjectId,
			orgId,
		}).lean()
		if (target?.containerTag) {
			await DocumentModel.updateMany(
				{ _id: { $in: docIds } },
				{
					$pull: { containerTags: tag },
					$addToSet: { containerTags: target.containerTag as string },
				},
			)
			documentsAffected = docIds.length
		}
	} else {
		await ChunkModel.deleteMany({ documentId: { $in: docIds } })
		const result = await DocumentModel.deleteMany({ _id: { $in: docIds } })
		documentsAffected = result.deletedCount
	}

	await SpaceModel.deleteOne({ _id: projectId })

	return c.json({
		success: true,
		message: "Project deleted successfully",
		documentsAffected,
		memoriesAffected: 0,
	})
})

export { app as projectRoutes }
