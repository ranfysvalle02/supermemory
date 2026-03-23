import mongoose, { Schema } from "mongoose"
import { nanoid } from "nanoid"

const orgSettingsSchema = new Schema(
	{
		_id: { type: String, default: () => nanoid() },
		orgId: { type: String, required: true, unique: true },
		shouldLLMFilter: { type: Boolean, default: false },
		filterPrompt: { type: String, default: null },
		includeItems: { type: [String], default: null },
		excludeItems: { type: [String], default: null },
		googleDriveCustomKeyEnabled: { type: Boolean, default: false },
		googleDriveClientId: { type: String, default: null },
		googleDriveClientSecret: { type: String, default: null },
		notionCustomKeyEnabled: { type: Boolean, default: false },
		notionClientId: { type: String, default: null },
		notionClientSecret: { type: String, default: null },
		onedriveCustomKeyEnabled: { type: Boolean, default: false },
		onedriveClientId: { type: String, default: null },
		onedriveClientSecret: { type: String, default: null },
	},
	{
		timestamps: { createdAt: false, updatedAt: true },
		toJSON: {
			transform(_doc, ret: Record<string, unknown>) {
				ret.id = ret._id
				delete ret._id
				delete ret.__v
				return ret
			},
		},
	},
)

export const OrgSettingsModel = mongoose.model("OrgSettings", orgSettingsSchema)
