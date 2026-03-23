import { Hono } from "hono"
import { ApiRequestModel } from "../models/api-request"
import { DocumentModel } from "../models/document"
import { ConnectionModel } from "../models/connection"
import { requireAuth } from "../middleware"
import type { AppEnv } from "../types"

const app = new Hono<AppEnv>()

app.use("*", requireAuth)

function emptyPeriodStats() {
	return {
		amountSaved: { current: 0, previousPeriod: 0 },
		tokensProcessed: { current: 0, previousPeriod: 0 },
		tokensSent: { current: 0, previousPeriod: 0 },
		totalTokensSaved: { current: 0, previousPeriod: 0 },
	}
}

// GET /v3/analytics/usage
app.get("/usage", async (c) => {
	const orgId = c.get("orgId")
	const totalMemories = await DocumentModel.countDocuments({ orgId })

	const usageAgg = await ApiRequestModel.aggregate([
		{ $match: { orgId } },
		{
			$group: {
				_id: "$type",
				count: { $sum: 1 },
				avgDuration: { $avg: "$duration" },
				lastUsed: { $max: "$createdAt" },
			},
		},
	])

	const usage = usageAgg.map((u) => ({
		type: u._id as string,
		count: u.count as number,
		avgDuration: Math.round((u.avgDuration as number) ?? 0),
		lastUsed: u.lastUsed,
	}))

	return c.json({
		byKey: [],
		hourly: [],
		pagination: {
			currentPage: 1,
			limit: 20,
			totalItems: usage.length,
			totalPages: 1,
		},
		totalMemories,
		usage,
	})
})

// GET /v3/analytics/chat
app.get("/chat", async (c) => {
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
	const now = new Date()
	const currentDay = days[now.getDay()]

	return c.json({
		analytics: {
			apiUsage: { current: 0, limit: 10000 },
			latency: { current: 0, trend: [], unit: "ms" as const },
			usage: {
				currentDay,
				tokensByDay: {
					Sun: 0,
					Mon: 0,
					Tue: 0,
					Wed: 0,
					Thu: 0,
					Fri: 0,
					Sat: 0,
				},
			},
		},
		overview: {
			"7d": emptyPeriodStats(),
			"30d": emptyPeriodStats(),
			"90d": emptyPeriodStats(),
			lifetime: emptyPeriodStats(),
		},
	})
})

// GET /v3/analytics/memory
app.get("/memory", async (c) => {
	const orgId = c.get("orgId")

	const [totalMemories, totalConnections, searchQueries] = await Promise.all([
		DocumentModel.countDocuments({ orgId }),
		ConnectionModel.countDocuments({ orgId }),
		ApiRequestModel.countDocuments({ orgId, type: "search" }),
	])

	return c.json({
		totalMemories,
		totalConnections,
		searchQueries,
		tokensProcessed: 0,
		memoriesGrowth: 0,
		connectionsGrowth: 0,
		searchGrowth: 0,
		tokensGrowth: 0,
	})
})

export { app as analyticsRoutes }
