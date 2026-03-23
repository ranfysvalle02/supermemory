import { Hono } from "hono"
import { OrgSettingsModel } from "../models/org-settings"
import { requireAuth } from "../middleware"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

// GET /v3/settings
app.get("/", async (c) => {
	const orgId = c.get("orgId")
	const settings = await OrgSettingsModel.findOne({ orgId }).lean()

	return c.json({
		settings: settings
			? {
					shouldLLMFilter: settings.shouldLLMFilter,
					filterPrompt: settings.filterPrompt,
					includeItems: settings.includeItems,
					excludeItems: settings.excludeItems,
					googleDriveCustomKeyEnabled:
						settings.googleDriveCustomKeyEnabled,
					googleDriveClientId: settings.googleDriveClientId,
					googleDriveClientSecret: settings.googleDriveClientSecret,
					notionCustomKeyEnabled: settings.notionCustomKeyEnabled,
					notionClientId: settings.notionClientId,
					notionClientSecret: settings.notionClientSecret,
					onedriveCustomKeyEnabled: settings.onedriveCustomKeyEnabled,
					onedriveClientId: settings.onedriveClientId,
					onedriveClientSecret: settings.onedriveClientSecret,
				}
			: {},
	})
})

// PATCH /v3/settings
app.patch("/", async (c) => {
	const orgId = c.get("orgId")
	const body = await c.req.json()

	const settings = await OrgSettingsModel.findOneAndUpdate(
		{ orgId },
		{ $set: body },
		{ upsert: true, new: true },
	)

	return c.json({
		message: "Settings updated",
		settings: {
			shouldLLMFilter: settings.shouldLLMFilter,
			filterPrompt: settings.filterPrompt,
			includeItems: settings.includeItems,
			excludeItems: settings.excludeItems,
		},
	})
})

export { app as settingsRoutes }
