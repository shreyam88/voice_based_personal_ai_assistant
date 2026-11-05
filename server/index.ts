import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose, { Schema, Types } from 'mongoose'
import type { NextFunction, Request, Response as ExpressResponse } from 'express'
import { z } from 'zod'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const model = process.env.OLLAMA_MODEL || 'llama3.2:latest'
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me'
const mongoConnected = () => mongoose.connection.readyState === 1

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set outside local development.')
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true })

const messageSchema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 12000 },
}, { _id: false })

const conversationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, maxlength: 80 },
  messages: { type: [messageSchema], default: [] },
}, { timestamps: true })

const User = mongoose.models.User || mongoose.model('User', userSchema)
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema)

type AuthRequest = Request & { userId?: string }
function requireAuth(req: Request, res: ExpressResponse, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' })
  try {
    const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload
    if (!payload.sub) return res.status(401).json({ error: 'Invalid session.' })
    ;(req as AuthRequest).userId = payload.sub
    next()
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

function optionalAuth(req: Request, res: ExpressResponse, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return next()
  try {
    const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload
    if (!payload.sub) return res.status(401).json({ error: 'Invalid session.' })
    ;(req as AuthRequest).userId = payload.sub
    return next()
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

const authInput = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(60).optional(),
})

app.get('/api/health', async (_req, res) => {
  let ollama = false
  try {
    const result = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) })
    ollama = result.ok
  } catch { /* Ollama is an optional local dependency. */ }
  res.json({ ok: true, ollama, mongodb: mongoConnected(), model })
})

app.post('/api/auth/register', async (req, res) => {
  if (!mongoConnected()) return res.status(503).json({ error: 'MongoDB is not connected. Configure MONGODB_URI to create an account.' })
  const parsed = authInput.safeParse(req.body)
  if (!parsed.success || !parsed.data.name) return res.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' })
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const user = await User.create({ name: parsed.data.name, email: parsed.data.email, passwordHash })
    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' })
    return res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } })
  } catch (error) {
    if (error instanceof mongoose.Error && error.name === 'ValidationError') return res.status(400).json({ error: 'Please check the account details and try again.' })
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' })
    console.error('Registration failed:', error)
    return res.status(500).json({ error: 'Could not create the account.' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  if (!mongoConnected()) return res.status(503).json({ error: 'MongoDB is not connected. Configure MONGODB_URI to sign in.' })
  const parsed = authInput.pick({ email: true, password: true }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
  const user = await User.findOne({ email: parsed.data.email }).select('+passwordHash')
  if (!user || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' })
  const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' })
  return res.json({ token, user: { id: user.id, name: user.name, email: user.email } })
})

app.get('/api/auth/me', requireAuth, async (req, res) => {
  if (!mongoConnected()) return res.status(503).json({ error: 'MongoDB is not connected.' })
  const user = await User.findById((req as AuthRequest).userId).select('name email')
  if (!user) return res.status(401).json({ error: 'Account not found.' })
  return res.json({ id: user.id, name: user.name, email: user.email })
})

app.get('/api/conversations', requireAuth, async (req, res) => {
  if (!mongoConnected()) return res.status(503).json({ error: 'MongoDB is not connected.' })
  const conversations = await Conversation.find({ userId: (req as AuthRequest).userId }).sort({ updatedAt: -1 }).limit(50).lean()
  return res.json(conversations.map((chat) => ({ id: String(chat._id), title: chat.title, updatedAt: chat.updatedAt, messages: chat.messages })))
})

app.delete('/api/conversations/:id', requireAuth, async (req, res) => {
  if (!mongoConnected()) return res.status(503).json({ error: 'MongoDB is not connected.' })
  const conversationId = req.params.id
  if (typeof conversationId !== 'string' || !Types.ObjectId.isValid(conversationId)) return res.status(400).json({ error: 'Invalid conversation id.' })
  await Conversation.deleteOne({ _id: conversationId, userId: (req as AuthRequest).userId })
  return res.status(204).end()
})

const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(12000) })).min(1).max(40),
  conversationId: z.string().optional().nullable(),
  language: z.enum(['en', 'hi']).default('en'),
  persona: z.enum(['assistant', 'teacher', 'coach']).default('assistant'),
})

const personaInstructions = {
  assistant: 'Be a thoughtful, capable personal assistant. Be clear, warm, and practical.',
  teacher: 'Be a patient teacher. Explain ideas in small steps, check understanding, and use concrete examples.',
  coach: 'Be an interview coach. Ask focused practice questions, give specific feedback, and help the user improve without taking over.',
}

app.post('/api/chat', optionalAuth, async (req, res) => {
  const parsed = chatInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Send a message to begin the conversation.' })
  const { messages, language, persona } = parsed.data
  const system = `${personaInstructions[persona]} Reply in ${language === 'hi' ? 'Hindi' : 'English'}, matching the user naturally if they switch languages. Keep responses concise and conversational because they may be read aloud. This is a private local assistant.`
  let response: globalThis.Response
  try {
    response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: system }, ...messages] }),
      signal: AbortSignal.timeout(120000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return res.status(503).json({ error: timedOut ? 'Ollama took too long to respond.' : 'Ollama is not reachable at the configured local address.' })
  }
  if (!response.ok) return res.status(502).json({ error: `Ollama returned ${response.status}. Check that ${model} is installed and running.` })
  const result = await response.json() as { message?: { content?: string } }
  const reply = result.message?.content?.trim()
  if (!reply) return res.status(502).json({ error: 'Ollama returned an empty response.' })

  const userId = (req as AuthRequest).userId
  let conversationId = parsed.data.conversationId
  if (!conversationId || !Types.ObjectId.isValid(conversationId)) conversationId = new Types.ObjectId().toString()
  if (userId && mongoConnected()) {
    const existing = await Conversation.findOne({ _id: conversationId, userId }).select('_id')
    if (!existing) conversationId = new Types.ObjectId().toString()
    const completeMessages = [...messages, { role: 'assistant' as const, content: reply }]
    const firstMessage = messages.find((message) => message.role === 'user')?.content || 'New conversation'
    await Conversation.findOneAndUpdate(
      { _id: conversationId, userId },
      { $set: { title: firstMessage.slice(0, 80), messages: completeMessages } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }
  return res.json({ reply, conversationId, updatedAt: new Date().toISOString() })
})

app.use((error: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) => {
  console.error('API error:', error)
  return res.status(500).json({ error: 'An unexpected local server error occurred.' })
})

if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('MongoDB connected'))
    .catch((error: unknown) => console.error('MongoDB unavailable; local guest chat remains enabled:', error instanceof Error ? error.message : error))
} else {
  console.log('MONGODB_URI is not set; account sync is disabled and local chat remains enabled.')
}

app.listen(port, '127.0.0.1', () => console.log(`VoxAI API listening on http://127.0.0.1:${port} (model: ${model})`))