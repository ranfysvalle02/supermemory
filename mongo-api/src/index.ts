import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { connectDB } from "./db"
import { auth } from "./auth"
import { documentRoutes } from "./routes/documents"
import { searchRoutes } from "./routes/search"
import { projectRoutes } from "./routes/projects"
import { connectionRoutes } from "./routes/connections"
import { settingsRoutes } from "./routes/settings"
import { analyticsRoutes } from "./routes/analytics"
import { containerTagRoutes } from "./routes/container-tags"
import { graphRoutes } from "./routes/graph"
import { spaceHighlightsRoutes } from "./routes/space-highlights"
import { chatRoutes } from "./routes/chat"
import { demoRoutes } from "./routes/demo"

const app = new Hono()

app.use("*", logger())
app.use(
	"*",
	cors({
		origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
		credentials: true,
		allowHeaders: ["Content-Type", "Authorization", "Cookie"],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
	}),
)

// Better Auth handler
app.all("/api/auth/*", (c) => auth.handler(c.req.raw))

// v3 API routes
app.route("/v3/documents", documentRoutes)
app.route("/v3/search", searchRoutes)
app.route("/v3/projects", projectRoutes)
app.route("/v3/connections", connectionRoutes)
app.route("/v3/settings", settingsRoutes)
app.route("/v3/analytics", analyticsRoutes)
app.route("/v3/container-tags", containerTagRoutes)
app.route("/v3/graph", graphRoutes)
app.route("/v3/space-highlights", spaceHighlightsRoutes)
app.route("/chat/v2", chatRoutes)

// Stub endpoints
app.get("/v3/mcp/has-login", (c) => c.json({ previousLogin: false }))
app.get("/v3/waitlist/status", (c) =>
	c.json({
		inWaitlist: false,
		accessGranted: true,
		createdAt: new Date().toISOString(),
	}),
)
app.post("/v3/emails/welcome/pro", (c) => c.json({ message: "ok" }))

// Demo auto-login (creates user + seeds data + redirects to web app)
app.route("/demo-login", demoRoutes)

// Health check
app.get("/health", (c) => c.json({ status: "ok" }))

const port = Number(process.env.PORT ?? 3100)

await connectDB()
console.log(`mongo-api running on http://localhost:${port}`)

export default {
	port,
	fetch: app.fetch,
}
