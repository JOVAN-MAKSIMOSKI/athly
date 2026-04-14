import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAgent } from '../hooks/useAgent.ts'
import { authApi } from '../connection/api.ts'
import { mcpClient } from '../core/mcp/mcpClient.ts'
import { useAuth } from '../state/authSessionStore.ts'

type ParsedMarkdownTable = {
	before: string
	headers: string[]
	rows: string[][]
	after: string
}

function splitMarkdownRow(row: string): string[] {
	const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '')
	return trimmed.split('|').map((cell) => cell.trim())
}

function isTableSeparatorLine(line: string): boolean {
	return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function parseMarkdownTableFromText(text: string): ParsedMarkdownTable | null {
	const lines = text.split('\n')

	for (let index = 1; index < lines.length; index += 1) {
		const headerLine = lines[index - 1]
		const separatorLine = lines[index]

		if (!headerLine.includes('|') || !isTableSeparatorLine(separatorLine)) {
			continue
		}

		const headers = splitMarkdownRow(headerLine)
		if (headers.length < 2 || headers.some((header) => header.length === 0)) {
			continue
		}

		const rowLines: string[] = []
		for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
			const rowLine = lines[rowIndex]
			if (!rowLine.includes('|') || rowLine.trim().length === 0) {
				break
			}

			rowLines.push(rowLine)
		}

		if (rowLines.length === 0) {
			continue
		}

		const rows = rowLines
			.map(splitMarkdownRow)
			.filter((row) => row.length === headers.length)

		if (rows.length === 0) {
			continue
		}

		const tableEndIndex = index + 1 + rowLines.length
		const before = lines.slice(0, index - 1).join('\n').trim()
		const after = lines.slice(tableEndIndex).join('\n').trim()

		return { before, headers, rows, after }
	}

	return null
}

function MessageTextBlock({ text }: { text: string }) {
	return <p className="whitespace-pre-wrap">{text}</p>
}

function AssistantMessageBody({ text }: { text: string }) {
	const parsedTable = parseMarkdownTableFromText(text)

	if (!parsedTable) {
		return <MessageTextBlock text={text} />
	}

	return (
		<div className="space-y-3">
			{parsedTable.before ? <MessageTextBlock text={parsedTable.before} /> : null}
			<div className="overflow-x-auto rounded-md border border-slate-200">
				<table className="min-w-full border-collapse text-left text-xs md:text-sm">
					<thead className="bg-slate-100 text-slate-800">
						<tr>
							{parsedTable.headers.map((header) => (
								<th key={header} className="border-b border-slate-200 px-3 py-2 font-semibold">
									{header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{parsedTable.rows.map((row, rowIndex) => (
							<tr key={`${row.join('-')}-${rowIndex}`} className="odd:bg-slate-50">
								{row.map((cell, cellIndex) => (
									<td key={`${rowIndex}-${cellIndex}`} className="border-t border-slate-200 px-3 py-2 align-top text-slate-800">
										{cell}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{parsedTable.after ? <MessageTextBlock text={parsedTable.after} /> : null}
		</div>
	)
}

function getSplitOptionsByTrainingDays(trainingDaysPerWeek: number): string[] {
	if (trainingDaysPerWeek <= 2) {
		return ['U/L']
	}

	if (trainingDaysPerWeek === 3) {
		return ['PPL','Chest and biceps/Back and triceps/Legs', 'Upper/Lower/Full body']
	}

	if (trainingDaysPerWeek === 4) {
		return ['UL/UL', 'PPL/Upper body', 'Torso/Limbs']
	}

	if (trainingDaysPerWeek === 5) {
		return ['PPL/UL', 'PPL/Arnold']
	}

	if (trainingDaysPerWeek >= 6) {
		return ['PPL/PPL', 'UL/UL/UL']
	}

	return ['PPL']
}

function HomePage() {
	const [userText, setUserText] = useState('')
	const [selectedSplit, setSelectedSplit] = useState('')
	const [splitSaveError, setSplitSaveError] = useState<string | null>(null)
	const [isSavingSplit, setIsSavingSplit] = useState(false)
	const { messages, isRunning, error, run, triggerOnboarding } = useAgent()
	const { isAuthenticated, token, user, setSession } = useAuth()

	const trainingDaysPerWeek = user?.profile.workoutFrequencyPerWeek ?? 3
	const splitOptions = useMemo(
		() => getSplitOptionsByTrainingDays(trainingDaysPerWeek),
		[trainingDaysPerWeek],
	)
	const effectiveSelectedSplit = splitOptions.includes(selectedSplit) ? selectedSplit : (splitOptions[0] ?? '')

	const visibleMessages = useMemo(
		() => messages.filter((message) => message.role === 'user' || message.role === 'assistant'),
		[messages],
	)
	const isUserTyping = userText.trim().length > 0

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmed = userText.trim()
		if (!isAuthenticated || !trimmed || isRunning) {
			return
		}

		void run(trimmed)
		setUserText('')
	}

	const avatarClassName =
		'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold md:size-10'

	const submitSplitSelection = async () => {
		if (!isAuthenticated || !token || !user || isRunning || isSavingSplit) {
			return
		}

		setIsSavingSplit(true)
		setSplitSaveError(null)

		try {
			const response = await authApi.updateWorkoutSplit({ WorkoutSplit: effectiveSelectedSplit }, token)
			setSession({
				token,
				user: response.data.user,
			})

			triggerOnboarding(effectiveSelectedSplit)

			const toolResult = await mcpClient.callTool(
				'athly.plan_split_workouts',
				{
					userId: response.data.user._id,
					split: effectiveSelectedSplit,
					createPlaceholders: true,
				},
				token,
			)

			if (toolResult.isError) {
				setSplitSaveError('Split saved, but workout planning failed. Please try again.')
			}
		} catch {
			setSplitSaveError('Could not save your split right now. Please try again.')
			return
		} finally {
			setIsSavingSplit(false)
		}
	}

	return (
		<div className="flex h-screen min-h-[620px] flex-col bg-white">
			<div className="w-full flex-1">
				{!isAuthenticated ? (
					<p className="px-4 pt-3 text-sm text-amber-700 md:px-8 md:pt-6">
						Log in to use chat. <Link to="/login" className="underline underline-offset-2">Go to login</Link>
					</p>
				) : null}

				<div className="flex h-full flex-col overflow-hidden bg-white">
					<div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-72 md:px-8 md:py-6 md:pb-80">
						{visibleMessages.length === 0 ? (
							<div className="flex h-full items-center justify-center">
								<div className="w-full max-w-2xl space-y-4 text-center">
									<p className="text-center text-lg text-slate-600 md:text-2xl">Hello. my name is Athly and I will be your personal AI-fitness coach, before we start, do you have any training split in mind?</p>
									<div className="mx-auto w-full max-w-xl space-y-3">
										<p className="text-sm text-slate-600 md:text-base">Based on your {trainingDaysPerWeek} training days per week, choose one split:</p>
										<div className="flex items-center gap-2">
											<select
												value={effectiveSelectedSplit}
												onChange={(event) => setSelectedSplit(event.target.value)}
												disabled={!isAuthenticated || isRunning || splitOptions.length === 0}
												className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-sky-500/30 focus:ring-2"
											>
												{splitOptions.map((option) => (
													<option key={option} value={option}>
														{option}
													</option>
												))}
											</select>
											<button
												type="button"
												onClick={() => {
													void submitSplitSelection()
												}}
												disabled={!isAuthenticated || isRunning || isSavingSplit}
												className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
											>
												{isSavingSplit ? 'Saving...' : 'Save'}
											</button>
										</div>
										{splitSaveError ? <p className="text-xs text-rose-600">{splitSaveError}</p> : null}
									</div>
								</div>
							</div>
						) : (
							visibleMessages.map((message, index) => (
								<div
									key={`${message.role}-${index}`}
									className={`mr-auto flex w-full max-w-[95%] items-start gap-3 ${
										index === visibleMessages.length - 1 ? 'chat-message-pop' : ''
									}`}
								>
									<span
										className={`${avatarClassName} ${
											message.role === 'user'
												? 'bg-sky-700 text-white'
												: 'bg-slate-800 text-slate-100'
										}`}
									>
										{message.role === 'user' ? 'U' : 'A'}
									</span>
									<div
										className={`w-fit max-w-[92%] rounded-xl px-5 py-4 text-left text-base leading-7 md:text-lg ${
											message.role === 'user'
												? 'bg-sky-200 text-sky-950'
												: 'bg-slate-50 text-slate-800'
										}`}
									>
										{message.role === 'assistant' ? (
											<AssistantMessageBody text={message.content.text} />
										) : (
											<MessageTextBlock text={message.content.text} />
										)}
									</div>
								</div>
							))
						)}
						{isRunning ? (
							<div className="mr-auto flex w-full max-w-[95%] items-start gap-3">
								<span className={`${avatarClassName} bg-slate-800 text-slate-100`}>A</span>
								<div className="w-fit max-w-[92%] rounded-xl bg-slate-50 px-5 py-4 text-left text-base leading-7 text-slate-700 md:text-lg chat-message-pop">
									<div className="flex items-center gap-2">
										<span>Thinking</span>
										<span className="typing-dots" aria-hidden="true">
											<span className="typing-dot" />
											<span className="typing-dot" />
											<span className="typing-dot" />
										</span>
									</div>
								</div>
							</div>
						) : null}
					</div>

					<form onSubmit={onSubmit} className="fixed bottom-0 left-0 right-0 z-10 bg-white px-4 py-3 md:left-80 md:px-8 md:py-4">
						<div className="w-full">
						<div className="relative">
							<textarea
								value={userText}
								onChange={(event) => setUserText(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== 'Enter' || event.shiftKey) {
										return
									}

									event.preventDefault()
									const trimmed = userText.trim()
									if (!isAuthenticated || isRunning || trimmed.length === 0) {
										return
									}

									void run(trimmed)
									setUserText('')
								}}
								placeholder="Ask Athly anything about your next workout..."
								rows={6}
								disabled={!isAuthenticated}
								className={`min-h-40 w-full rounded-2xl bg-slate-50 px-6 pb-14 pt-5 pr-16 text-base text-slate-900 outline-none ring-sky-600 transition focus:ring-2 md:text-lg ${
									isUserTyping ? 'typing-active' : ''
								}`}
							/>
							<button
								type="submit"
								disabled={!isAuthenticated || isRunning || userText.trim().length === 0}
								aria-label="Send message"
								className={`absolute bottom-4 right-4 grid size-10 place-items-center rounded-full bg-sky-700 text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 ${
									isUserTyping ? 'send-button-ready' : ''
								}`}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M22 2 11 13" />
									<path d="M22 2 15 22 11 13 2 9 22 2z" />
								</svg>
							</button>
						</div>
						<div className="mt-2 flex items-center justify-start gap-3">
							{error ? <p className="text-sm text-rose-600">{error}</p> : <span className="text-xs text-slate-500">Athly uses tools when needed.</span>}
						</div>
						</div>
					</form>
				</div>
			</div>
		</div>
	)
}

export default HomePage