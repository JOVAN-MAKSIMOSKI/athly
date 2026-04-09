import { useEffect, useMemo, useState } from 'react'
import type { ExperienceLevel, FitnessGoal } from '../types/auth.ts'
import { useAuth } from '../state/authSessionStore.ts'
import { normalizeWorkoutDurationMinutes, WORKOUT_DURATION_OPTIONS } from '../utils/workoutDuration.ts'

type ProfileFormState = {
	firstName: string
	email: string
	weight: string
	height: string
	workoutDurationMinutes: string
	workoutFrequencyPerWeek: string
	experienceLevel: '' | ExperienceLevel
	goal: '' | FitnessGoal
	comfortableWithHeavierWeights: boolean
}

const experienceOptions: ExperienceLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']
const goalOptions: FitnessGoal[] = ['STRENGTH', 'HYPERTROPHY', 'ENDURANCE', 'WEIGHT_LOSS']

function displayEnum(value: string) {
	return value
		.toLowerCase()
		.split('_')
		.map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
		.join(' ')
}

function UserProfilePage() {
	const { user, token, setSession } = useAuth()
	const [saveMessage, setSaveMessage] = useState<string | null>(null)

	const initialState = useMemo<ProfileFormState>(() => {
		if (!user) {
			return {
				firstName: '',
				email: '',
				weight: '',
				height: '',
				workoutDurationMinutes: '',
				workoutFrequencyPerWeek: '',
				experienceLevel: '',
				goal: '',
				comfortableWithHeavierWeights: false,
			}
		}

		return {
			firstName: user.name,
			email: user.email,
			weight: String(user.profile.weight),
			height: String(user.profile.height),
			workoutDurationMinutes: String(normalizeWorkoutDurationMinutes(user.profile.workoutDurationMinutes)),
			workoutFrequencyPerWeek: String(user.profile.workoutFrequencyPerWeek),
			experienceLevel: user.profile.experienceLevel ?? '',
			goal: user.profile.goal ?? '',
			comfortableWithHeavierWeights: user.profile.comfortableWithHeavierWeights,
		}
	}, [user])

	const [form, setForm] = useState<ProfileFormState>(initialState)

	useEffect(() => {
		setForm(initialState)
	}, [initialState])

	if (!user) {
		return null
	}

	const onSave = () => {
		if (!token) {
			setSaveMessage('Your session is missing. Please log in again.')
			return
		}

		const mergedName = form.firstName.trim() || user.name

		setSession({
			token,
			user: {
				...user,
				name: mergedName,
				email: form.email.trim() || user.email,
				profile: {
					...user.profile,
					weight: Number(form.weight) || user.profile.weight,
					height: Number(form.height) || user.profile.height,
					workoutDurationMinutes: Number(form.workoutDurationMinutes) || user.profile.workoutDurationMinutes,
					workoutFrequencyPerWeek: Number(form.workoutFrequencyPerWeek) || user.profile.workoutFrequencyPerWeek,
					experienceLevel: form.experienceLevel || undefined,
					goal: form.goal || undefined,
					comfortableWithHeavierWeights: form.comfortableWithHeavierWeights,
				},
			},
		})

		setSaveMessage('Profile updated in current session.')
	}

	return (
		<section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
			<div className="w-full max-w-5xl rounded-xl border border-slate-200 bg-slate-50 p-5 md:p-6">
			<h2 className="text-xl font-semibold text-slate-900">Personal Information</h2>
			<p className="mt-1 text-sm text-slate-500">Update your profile fields used for coaching and workout planning.</p>

			<div className="mt-5 grid gap-4 md:grid-cols-2">
				<label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
					<span>Name</span>
					<input
						type="text"
						value={form.firstName}
						onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					/>
				</label>

				<label className="grid gap-1 text-sm text-slate-600 md:col-span-2">
					<span>Email Address</span>
					<input
						type="email"
						value={form.email}
						onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					/>
				</label>

				<label className="grid gap-1 text-sm text-slate-600">
					<span>Weight (kg)</span>
					<input
						type="number"
						min={1}
						value={form.weight}
						onChange={(event) => setForm((prev) => ({ ...prev, weight: event.target.value }))}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					/>
				</label>

				<label className="grid gap-1 text-sm text-slate-600">
					<span>Height (cm)</span>
					<input
						type="number"
						min={1}
						value={form.height}
						onChange={(event) => setForm((prev) => ({ ...prev, height: event.target.value }))}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					/>
				</label>

				<label className="grid gap-1 text-sm text-slate-600">
					<span>Available Time To Train</span>
					<select
						value={form.workoutDurationMinutes}
						onChange={(event) => setForm((prev) => ({ ...prev, workoutDurationMinutes: event.target.value }))}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					>
						{WORKOUT_DURATION_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				<label className="grid gap-1 text-sm text-slate-600">
					<span>Workouts / Week</span>
					<input
						type="number"
						min={1}
						max={7}
						value={form.workoutFrequencyPerWeek}
						onChange={(event) => setForm((prev) => ({ ...prev, workoutFrequencyPerWeek: event.target.value }))}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					/>
				</label>

				<label className="grid gap-1 text-sm text-slate-600">
					<span>Experience</span>
					<select
						value={form.experienceLevel}
						onChange={(event) =>
							setForm((prev) => ({
								...prev,
								experienceLevel: event.target.value as '' | ExperienceLevel,
							}))
						}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					>
						<option value="">Not set</option>
						{experienceOptions.map((option) => (
							<option key={option} value={option}>
								{displayEnum(option)}
							</option>
						))}
					</select>
				</label>

				<label className="grid gap-1 text-sm text-slate-600">
					<span>Goal</span>
					<select
						value={form.goal}
						onChange={(event) =>
							setForm((prev) => ({
								...prev,
								goal: event.target.value as '' | FitnessGoal,
							}))
						}
						className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none ring-sky-500/30 focus:ring-2"
					>
						<option value="">Not set</option>
						{goalOptions.map((option) => (
							<option key={option} value={option}>
								{displayEnum(option)}
							</option>
						))}
					</select>
				</label>

				<label className="md:col-span-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
					<input
						type="checkbox"
						checked={form.comfortableWithHeavierWeights}
						onChange={(event) =>
							setForm((prev) => ({ ...prev, comfortableWithHeavierWeights: event.target.checked }))
						}
						className="size-4"
					/>
					Comfortable with heavier weights
				</label>
			</div>

			<div className="mt-5 flex flex-wrap items-center justify-between gap-3">
				{saveMessage ? <p className="text-sm text-emerald-700">{saveMessage}</p> : <span className="text-sm text-slate-500">Edit fields and save your changes.</span>}
				<button
					type="button"
					onClick={onSave}
					className="rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-800"
				>
					Save changes
				</button>
			</div>
			</div>
		</section>
	)
}

export default UserProfilePage