#!/usr/bin/env node
// Lightweight structural validator for this single-plugin Cursor repo.
// Mirrors the checks Cursor's reviewer runs against .cursor-plugin/plugin.json
// without requiring network access or extra dependencies.

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

const nameAndSkillPattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath, context) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    addError(`${context} is missing: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(`${context} contains invalid JSON (${filePath}): ${error.message}`);
    return null;
  }
}

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) return null;
  const fields = {};
  for (const line of normalized.slice(4, closingIndex).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

async function walkFiles(dirPath) {
  const files = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

async function validateSkills(pluginRoot) {
  const skillsDir = path.join(pluginRoot, "skills");
  if (!(await pathExists(skillsDir))) {
    addWarning("No skills/ directory found (only needed if the plugin ships skills).");
    return;
  }
  const files = await walkFiles(skillsDir);
  const skillFiles = files.filter((file) => path.basename(file) === "SKILL.md");
  if (skillFiles.length === 0) {
    addWarning("skills/ exists but contains no SKILL.md files.");
  }
  for (const file of skillFiles) {
    const content = await fs.readFile(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    const relativeFile = path.relative(repoRoot, file);
    if (!frontmatter) {
      addError(`Skill file missing YAML frontmatter: ${relativeFile}`);
      continue;
    }
    for (const key of ["name", "description"]) {
      if (!frontmatter[key]) {
        addError(`Skill file missing "${key}" in frontmatter: ${relativeFile}`);
      }
    }
    if (frontmatter.name && !nameAndSkillPattern.test(frontmatter.name)) {
      addError(`Skill "name" must be lowercase kebab-case: ${relativeFile}`);
    }
  }
}

async function validateMcp(pluginRoot) {
  const mcpPath = path.join(pluginRoot, "mcp.json");
  if (!(await pathExists(mcpPath))) {
    addWarning("No mcp.json file found (only needed if the plugin ships MCP servers).");
    return;
  }
  const mcp = await readJsonFile(mcpPath, "mcp.json");
  if (!mcp) return;
  if (!mcp.mcpServers || typeof mcp.mcpServers !== "object") {
    addError('mcp.json must declare an "mcpServers" object.');
    return;
  }
  for (const [serverName, server] of Object.entries(mcp.mcpServers)) {
    if (!server.command && !server.url) {
      addError(`mcp.json server "${serverName}" must declare "command" or "url".`);
    }
  }
}

async function validateLogo(pluginRoot, manifest) {
  if (!manifest.logo) return;
  if (manifest.logo.startsWith("http://") || manifest.logo.startsWith("https://")) return;
  const resolved = path.resolve(pluginRoot, manifest.logo);
  if (!(await pathExists(resolved))) {
    addError(`Manifest "logo" references a missing file: ${manifest.logo}`);
  }
}

async function main() {
  const manifestPath = path.join(repoRoot, ".cursor-plugin", "plugin.json");
  const manifest = await readJsonFile(manifestPath, "Plugin manifest");
  if (!manifest) {
    summarizeAndExit();
    return;
  }

  if (typeof manifest.name !== "string" || !nameAndSkillPattern.test(manifest.name)) {
    addError('Plugin manifest "name" must be lowercase kebab-case.');
  }
  if (!manifest.description) {
    addWarning('Plugin manifest is missing a "description".');
  }

  await validateLogo(repoRoot, manifest);
  await validateSkills(repoRoot);
  await validateMcp(repoRoot);

  summarizeAndExit();
}

function summarizeAndExit() {
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
    console.log("");
  }
  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Validation passed.");
}

await main();
