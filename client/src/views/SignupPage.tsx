import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../connection/api.ts'
import { useAuth } from '../state/authSessionStore.ts'
import type { ExperienceLevel, FitnessGoal } from '../types/auth.ts'
import { WORKOUT_DURATION_OPTIONS } from '../utils/workoutDuration.ts'

const EQUIPMENT_OPTIONS: Array<{ label: string; value: string }> = [
	{ label: 'Dumbbells', value: 'dumbbell' },
	{ label: 'Barbell', value: 'barbell' },
	{ label: 'Bench + Barbell', value: 'barbell + bench' },
	{ label: 'Bench + Dumbbell', value: 'dumbbell + bench' },
	{ label: 'Pull-up Bar', value: 'pull-up-bar' },
	{ label: 'Cable Machine', value: 'cable' },
	{ label: 'Resistance Bands', value: 'resistance-band' },
	{ label: 'Kettlebells', value: 'kettlebell' },
	{ label: 'Smith Machine', value: 'smith-machine' },
	{ label: 'Bodyweight Only', value: 'bodyweight' },
]

const ALL_EQUIPMENT_VALUES = EQUIPMENT_OPTIONS.map((option) => option.value)

const EXPERIENCE_OPTIONS: ExperienceLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']
const GOAL_OPTIONS: FitnessGoal[] = ['STRENGTH', 'HYPERTROPHY', 'ENDURANCE', 'WEIGHT_LOSS']

type WorkoutLocation = 'HOME' | 'GYM'

const POST_SIGNUP_MESSAGE_FLAG_KEY_PREFIX = 'athly:post-signup-message'
const POST_SIGNUP_MESSAGE_FLAG_KEY_GLOBAL = 'athly:post-signup-message'

function displayEnum(value: string) {
	return value
		.toLowerCase()
		.split('_')
		.map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
		.join(' ')
}

function SignupPage() {
	const navigate = useNavigate()
	const { setSession } = useAuth()

	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [weight, setWeight] = useState('')
	const [height, setHeight] = useState('')
	const [workoutDurationMinutes, setWorkoutDurationMinutes] = useState(String(WORKOUT_DURATION_OPTIONS[1]?.value ?? 60))
	const [workoutFrequencyPerWeek, setWorkoutFrequencyPerWeek] = useState('3')
	const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('BEGINNER')
	const [goal, setGoal] = useState<FitnessGoal>('HYPERTROPHY')
	const [workoutLocation, setWorkoutLocation] = useState<WorkoutLocation>('GYM')
	const [availableEquipment, setAvailableEquipment] = useState<string[]>(ALL_EQUIPMENT_VALUES)
	const [comfortableWithHeavierWeights, setComfortableWithHeavierWeights] = useState(false)

	const signupMutation = useMutation({
		mutationFn: authApi.signup,
		onSuccess: (response) => {
			sessionStorage.setItem(POST_SIGNUP_MESSAGE_FLAG_KEY_GLOBAL, '1')
			const userId = response.data.user._id
			if (typeof userId === 'string' && userId.length > 0) {
				sessionStorage.setItem(`${POST_SIGNUP_MESSAGE_FLAG_KEY_PREFIX}:${userId}`, '1')
			}
			setSession({ token: response.token, user: response.data.user })
			void navigate('/profile', { replace: true })
		},
	})

	return (
		<section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
			<div className="w-full max-w-3xl">
				<h2 className="text-center text-4xl font-semibold text-slate-800">Create your athlete profile</h2>
				<p className="mt-3 text-center text-sm text-slate-500">
					Set your baseline once so Athly can personalize every plan.
				</p>

				<form
					className="mt-8 grid gap-4"
					onSubmit={(event) => {
						event.preventDefault()

						signupMutation.mutate({
							name,
							email,
							password,
							profile: {
								weight: Number(weight),
								height: Number(height),
								experienceLevel,
								goal,
								comfortableWithHeavierWeights,
								workoutDurationMinutes: Number(workoutDurationMinutes),
								workoutFrequencyPerWeek: Number(workoutFrequencyPerWeek),
								availableEquipment,
							},
						})
					}}
				>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<label className="grid gap-1 text-sm text-slate-500">
						<span>Name</span>
						<input
							type="text"
							required
							value={name}
							onChange={(event) => setName(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Email</span>
						<input
							type="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1 text-sm text-slate-500 md:col-span-2">
						<span>Password</span>
						<input
							type="password"
							required
							minLength={6}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Weight (kg)</span>
						<input
							type="number"
							required
							min={1}
							value={weight}
							onChange={(event) => setWeight(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Height (cm)</span>
						<input
							type="number"
							required
							min={1}
							value={height}
							onChange={(event) => setHeight(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Available time to train</span>
						<select
							required
							value={workoutDurationMinutes}
							onChange={(event) => setWorkoutDurationMinutes(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						>
							{WORKOUT_DURATION_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Workouts per week</span>
						<input
							type="number"
							required
							min={1}
							max={7}
							value={workoutFrequencyPerWeek}
							onChange={(event) => setWorkoutFrequencyPerWeek(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Experience level</span>
						<select
							value={experienceLevel}
							onChange={(event) => setExperienceLevel(event.target.value as ExperienceLevel)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						>
							{EXPERIENCE_OPTIONS.map((option) => (
								<option key={option} value={option}>
									{displayEnum(option)}
								</option>
							))}
						</select>
					</label>

					<label className="grid gap-1 text-sm text-slate-500">
						<span>Goal</span>
						<select
							value={goal}
							onChange={(event) => setGoal(event.target.value as FitnessGoal)}
							className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						>
							{GOAL_OPTIONS.map((option) => (
								<option key={option} value={option}>
									{displayEnum(option)}
								</option>
							))}
						</select>
					</label>

					<label className="grid gap-1 text-sm text-slate-500 md:col-span-2">
						<span>Where do you train?</span>
						<div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
							<label className="flex items-center gap-2 text-sm text-slate-700">
								<input
									type="radio"
									name="workoutLocation"
									value="GYM"
									checked={workoutLocation === 'GYM'}
									onChange={() => {
										setWorkoutLocation('GYM')
										setAvailableEquipment(ALL_EQUIPMENT_VALUES)
									}}
									className="size-4"
								/>
								Gym
							</label>
							<label className="flex items-center gap-2 text-sm text-slate-700">
								<input
									type="radio"
									name="workoutLocation"
									value="HOME"
									checked={workoutLocation === 'HOME'}
									onChange={() => {
										setWorkoutLocation('HOME')
										setAvailableEquipment([])
									}}
									className="size-4"
								/>
								At home
							</label>
						</div>
					</label>

					{workoutLocation === 'HOME' ? (
						<div className="grid gap-2 text-sm text-slate-500 md:col-span-2">
							<span>Available equipment</span>
							<p className="text-xs text-slate-500">
								Select all equipment you can access in your current training setup.
							</p>
							<div className="grid gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
								{EQUIPMENT_OPTIONS.map((option) => (
									<label key={option.value} className="flex items-center gap-2 text-slate-700">
										<input
											type="checkbox"
											checked={availableEquipment.includes(option.value)}
											onChange={(event) => {
												setAvailableEquipment((current) =>
													event.target.checked
														? [...current, option.value]
														: current.filter((value) => value !== option.value),
												)
											}}
											className="size-4"
										/>
										{option.label}
									</label>
								))}
							</div>
						</div>
					) : null}
				</div>

				<label className="flex items-center gap-2 text-sm text-slate-600">
					<input
						type="checkbox"
						checked={comfortableWithHeavierWeights}
						onChange={(event) => setComfortableWithHeavierWeights(event.target.checked)}
						className="size-4"
					/>
					Please click this if you do not feel comfortable with lifting heavy weights
				</label>

				{signupMutation.isError ? (
					<p className="text-sm text-rose-600">{(signupMutation.error as Error).message}</p>
				) : null}

				<button
					type="submit"
					disabled={signupMutation.isPending}
					className="mt-2 w-full rounded-xl bg-sky-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-800 disabled:opacity-60"
				>
					{signupMutation.isPending ? 'Creating account...' : 'Create account'}
				</button>
			</form>

			<p className="mt-5 text-center text-sm text-slate-500">
				Already registered?{' '}
				<Link to="/login" className="font-medium text-sky-700 underline-offset-2 hover:underline">
					Log in
				</Link>
			</p>
			</div>
		</section>
	)
}

export default SignupPage