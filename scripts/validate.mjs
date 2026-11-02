#!/usr/bin/env node
/**
 * Manifest and bundle sanity checks for dsh-peak-valley.
 *
 * Run with `npm run validate` (also the GitHub Actions job). Checks what a DSH
 * loader reads before mounting the package, plus the one thing that would
 * silently break the feature: the client module must still register into
 * `conversation.composer.dock`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

/** @param {string} message - 失败项。 */
function fail(message) {
	problems.push(message)
}

/**
 * @param {string} relative - 相对包根的路径。
 * @returns {any} 解析后的 JSON。
 */
function readJson(relative) {
	const path = join(root, relative)
	if (!existsSync(path)) {
		fail(`${relative}: missing`)
		return undefined
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
		fail(`${relative}: invalid JSON (${error.message})`)
		return undefined
	}
}

/**
 * @param {string} relative - 相对包根的路径。
 * @returns {string} 文件内容，缺失时为空串。
 */
function readText(relative) {
	const path = join(root, relative)
	if (!existsSync(path)) {
		fail(`${relative}: missing`)
		return ''
	}
	return readFileSync(path, 'utf8')
}

const manifest = readJson('package.json')
if (manifest) {
	for (const field of ['name', 'version', 'license', 'description']) {
		if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') fail(`package.json: "${field}" must be a non-empty string`)
	}
	if (manifest.private === true) fail('package.json: "private": true blocks npm publishing')

	const bundle = manifest.dsh?.bundle
	if (typeof bundle?.patch !== 'string') fail('package.json: dsh.bundle.patch must point at the bundle patch')
	else {
		const patch = readText(bundle.patch.replace(/^\.\//, ''))
		if (patch !== '') {
			if (!/^- insert:/m.test(patch)) fail(`${bundle.patch}: no "- insert:" list`)
			if (!patch.includes(`name: ${manifest.name}`)) fail(`${bundle.patch}: no row names ${manifest.name}`)
		}
	}

	const client = manifest.dsh?.client
	if (client?.platform !== 'web') fail('package.json: dsh.client.platform must be "web"')
	if (client !== undefined && client.immediately !== true) notes.push('package.json: dsh.client.immediately is not true — the chip would only load on demand')
	if (client !== undefined && !Array.isArray(client.inject)) fail('package.json: dsh.client.inject must be an array of client package ids')

	for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
		const relative = typeof target === 'string' ? target : target?.default
		if (typeof relative !== 'string') {
			fail(`package.json: exports["${subpath}"] must resolve to a file`)
			continue
		}
		if (relative.includes('*')) continue
		if (!existsSync(join(root, relative))) fail(`package.json: exports["${subpath}"] -> ${relative} is missing`)
	}

	for (const entry of manifest.files ?? []) {
		if (entry.includes('*')) {
			const prefix = entry.replace(/\*.*$/, '').replace(/\/$/, '')
			if (prefix !== '' && !existsSync(join(root, prefix))) fail(`package.json: files entry "${entry}" has no matching directory`)
			continue
		}
		if (!existsSync(join(root, entry))) fail(`package.json: files entry "${entry}" is missing on disk`)
	}

	const source = readText('client.js')
	if (source !== '') {
		if (!source.includes('window.__ModuleLoader__.load(')) fail('client.js: no window.__ModuleLoader__.load() registration')
		if (!source.includes(`id: "${manifest.name}"`)) fail(`client.js: the module id must be "${manifest.name}" (double-quoted)`)
		for (const symbol of ['exports.apply', 'exports.inject']) {
			if (!source.includes(symbol)) fail(`client.js: ${symbol} is not exported`)
		}
		if (/import\s.+from\s+["']@deepseek-ai\//.test(source)) fail('client.js: a client bundle must not import a Harness Client package')
		if (!source.includes("'conversation.composer.dock'")) fail('client.js: the chip must register into conversation.composer.dock')
	}

	const host = readText('index.js')
	if (host !== '' && !/export function apply\b/.test(host)) fail('index.js: the Host half must export apply()')

	for (const locale of ['en', 'zh']) {
		const dict = readJson(`locale/${locale}.json`)
		if (dict === undefined) continue
		if (typeof dict.meta?.title !== 'string' || dict.meta.title.trim() === '') fail(`locale/${locale}.json: meta.title is empty`)
		if (typeof dict.meta?.description !== 'string' || dict.meta.description.trim() === '') fail(`locale/${locale}.json: meta.description is empty`)
	}

	const icon = readText('icon.svg')
	if (icon !== '' && !/^<svg[\s>]/.test(icon.trim())) fail('icon.svg: does not start with an <svg> root element')

	// 峰谷判定必须能自证：拿几个已知时刻跑一遍。
	if (source !== '') {
		const holidays = source.includes("'2026-10-01', '2026-10-07', '国庆'")
		if (!holidays) notes.push('client.js: the 2026 National Day range is missing — the holiday table may be broken')
		if (!source.includes('9 * 60') || !source.includes('18 * 60')) fail('client.js: the peak-hour bounds (09:00–12:00 / 14:00–18:00) are not present')
	}
}

if (notes.length > 0) {
	process.stdout.write('notes:\n')
	for (const note of notes) process.stdout.write(`  - ${note}\n`)
}

if (problems.length > 0) {
	process.stdout.write('problems:\n')
	for (const problem of problems) process.stdout.write(`  - ${problem}\n`)
	process.exitCode = 1
} else {
	process.stdout.write(`ok: ${manifest?.name}@${manifest?.version} manifest, patch, exports, locale, icon and dock registration\n`)
}
