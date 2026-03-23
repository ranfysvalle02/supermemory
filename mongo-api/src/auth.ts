import { betterAuth } from "better-auth"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import { MongoClient } from "mongodb"
import {
	admin,
	anonymous,
	bearer,
	emailOTP,
	magicLink,
	organization,
	username,
} from "better-auth/plugins"

const client = new MongoClient(process.env.MONGODB_URI!)
const db = client.db()

export const auth = betterAuth({
	database: mongodbAdapter(db),
	secret: process.env.BETTER_AUTH_SECRET,
	baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3100",
	trustedOrigins: [process.env.CORS_ORIGIN ?? "http://localhost:3000"],
	emailAndPassword: { enabled: true },
	plugins: [
		username(),
		magicLink({
			sendMagicLink: async ({ email, url }) => {
				console.log(`[auth] Magic link for ${email}: ${url}`)
			},
		}),
		emailOTP({
			sendVerificationOTP: async ({ email, otp }) => {
				console.log(`[auth] OTP for ${email}: ${otp}`)
			},
		}),
		bearer(),
		admin(),
		organization(),
		anonymous(),
	],
})
