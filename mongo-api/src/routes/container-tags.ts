import { Hono } from "hono"
import { SpaceModel } from "../models/space"
import { requireAuth } from "../middleware"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

// GET /v3/container-tags/list
app.get("/list", async (c) => {
	const orgId = c.get("orgId")

	const spaces = await SpaceModel.find({ orgId })
		.sort({ createdAt: -1 })
		.lean()

	const result = spaces.map((s) => {
		const tag = (s.containerTag as string) ?? ""
		return {
			id: s._id as string,
			name: (s.name as string) ?? "",
			containerTag: tag,
			createdAt: (s.createdAt as Date).toISOString(),
			updatedAt: (s.updatedAt as Date).toISOString(),
			isExperimental: s.isExperimental as boolean,
			emoji: (s.emoji as string) ?? undefined,
			isNova: tag.startsWith("sm_project_"),
		}
	})

	return c.json(result)
})

export { app as containerTagRoutes }
