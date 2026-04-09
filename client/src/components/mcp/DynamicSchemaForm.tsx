import Ajv from 'ajv'
import { useMemo, useState } from 'react'
import type { ElicitationContent } from '../../types/mcp.ts'

type JsonSchemaProperty = {
	type?: string
	title?: string
	description?: string
	enum?: string[]
	enumNames?: string[]
	minimum?: number
	maximum?: number
	items?: unknown
	[key: string]: unknown
}

type RequestedSchema = {
	type: 'object'
	properties?: Record<string, JsonSchemaProperty>
	required?: string[]
}

type DynamicSchemaFormProps = {
	schema: RequestedSchema
	onSubmit: (content: ElicitationContent) => void
}

const ajv = new Ajv({ allErrors: true })

function castValue(rawValue: unknown, fieldSchema: JsonSchemaProperty) {
	if (fieldSchema.type === 'number') {
		const parsed = Number(rawValue)
		if (Number.isNaN(parsed)) {
			throw new Error('must be a valid number')
		}
		return parsed
	}

	if (fieldSchema.type === 'boolean') {
		return rawValue === true || rawValue === 'true'
	}

	if (fieldSchema.type === 'array') {
		if (Array.isArray(rawValue)) {
			return rawValue.map((entry) => String(entry))
		}

		const asText = String(rawValue ?? '')
		return asText
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
	}

	return String(rawValue ?? '')
}

export function DynamicSchemaForm({ schema, onSubmit }: DynamicSchemaFormProps) {
	const [formData, setFormData] = useState<Record<string, unknown>>({})
	const [errors, setErrors] = useState<Record<string, string>>({})

	const fields = useMemo(() => Object.entries(schema.properties ?? {}), [schema.properties])

	const submit = () => {
		const casted: ElicitationContent = {}
		const nextErrors: Record<string, string> = {}

		for (const [key, fieldSchema] of fields) {
			const value = formData[key]

			try {
				casted[key] = castValue(value, fieldSchema)
			} catch (error) {
				nextErrors[key] = `${key} ${(error as Error).message}`
			}
		}

		const validate = ajv.compile(schema)
		const isValid = validate(casted)
		if (!isValid) {
			for (const issue of validate.errors ?? []) {
				const issuePath =
					'instancePath' in issue && typeof issue.instancePath === 'string'
						? issue.instancePath
						: 'dataPath' in issue && typeof issue.dataPath === 'string'
							? issue.dataPath
							: ''

				const issueKey = issuePath.replace(/^\//, '').replace(/^\./, '')
				if (!issueKey) {
					continue
				}
				nextErrors[issueKey] = issue.message ?? 'invalid value'
			}
		}

		if (Object.keys(nextErrors).length > 0) {
			setErrors(nextErrors)
			return
		}

		setErrors({})
		onSubmit(casted)
	}

	return (
		<form
			className="mt-4 grid gap-3"
			onSubmit={(event) => {
				event.preventDefault()
				submit()
			}}
		>
			{fields.map(([key, fieldSchema]) => {
				const isRequired = Boolean(schema.required?.includes(key))
				const label = fieldSchema.title || key
				const value = formData[key]

				return (
					<label key={key} className="grid gap-1 text-sm text-slate-200">
						<span className="font-medium">
							{label}
							{isRequired ? ' *' : ''}
						</span>
						{fieldSchema.description ? (
							<span className="text-xs text-slate-400">{fieldSchema.description}</span>
						) : null}

						{fieldSchema.enum ? (
							<select
								value={String(value ?? '')}
								required={isRequired}
								onChange={(event) => {
									setFormData((current) => ({
										...current,
										[key]: event.target.value,
									}))
								}}
								className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
							>
								<option value="">Select...</option>
								{fieldSchema.enum.map((enumValue, index) => (
									<option key={enumValue} value={enumValue}>
										{fieldSchema.enumNames?.[index] || enumValue}
									</option>
								))}
							</select>
						) : fieldSchema.type === 'boolean' ? (
							<input
								type="checkbox"
								checked={Boolean(value)}
								onChange={(event) => {
									setFormData((current) => ({
										...current,
										[key]: event.target.checked,
									}))
								}}
								className="size-4"
							/>
						) : (
							<input
								type={fieldSchema.type === 'number' ? 'number' : 'text'}
								value={String(value ?? '')}
								required={isRequired}
								min={fieldSchema.minimum}
								max={fieldSchema.maximum}
								onChange={(event) => {
									setFormData((current) => ({
										...current,
										[key]: event.target.value,
									}))
								}}
								className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
							/>
						)}
						{errors[key] ? <span className="text-xs text-red-300">{errors[key]}</span> : null}
					</label>
				)
			})}

			<button
				type="submit"
				className="mt-2 w-fit rounded-lg border border-sky-500 px-4 py-2 text-sm font-medium text-sky-200"
			>
				Submit
			</button>
		</form>
	)
}