import type { Context, Next } from "hono"
import { auth } from "./auth"

export async function requireAuth(c: Context, next: Next) {
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	})
	if (!session) {
		return c.json({ error: "Unauthorized" }, 401)
	}
	c.set("userId", session.user.id)
	const orgId =
		(session.session as Record<string, unknown>).activeOrganizationId ??
		session.user.id
	c.set("orgId", orgId as string)
	return next()
}
