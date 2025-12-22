# Obsidian Account Manager (D&D Authentication & Content Gating)

A utility plugin for **Obsidian** that lets you simulate a lightweight “login” system for your vault (perfect for **D&D / TTRPG campaigns**).  
It supports:

- **Character selection + password login**
- **Group-based access control**
- **Gating entire notes** (via frontmatter)
- **Gating specific sections** (via `dndgate` code blocks)
- An **Admin Area** that can generate and display **user/group reports**
- Optional **admin UI panels** rendered inside notes (buttons & live lists)

> ⚠️ **Important security note:** This plugin is **not encryption** and does **not** provide real security.  
> It controls what is **rendered/shown** in Reading View and can provide a “spoiler protection” workflow.  
> Any user with direct access to your vault files may still read raw Markdown outside Obsidian or in Source Mode.

---

## Table of Contents

- [Use Cases](#use-cases)
- [How It Works (Concept)](#how-it-works-concept)
- [Installation](#installation)
  - [Manual Installation](#manual-installation)
  - [From GitHub Releases](#from-github-releases)
- [Quick Start](#quick-start)
- [Accounts & Groups](#accounts--groups)
  - [`DnDAuth/users.json`](#dndauthusersjson)
  - [Admin User](#admin-user)
  - [Groups](#groups)
- [Gating Content](#gating-content)
  - [Gate Whole Notes (Frontmatter)](#gate-whole-notes-frontmatter)
  - [Gate Sections (dndgate Code Blocks)](#gate-sections-dndgate-code-blocks)
  - [Common Patterns](#common-patterns)
- [Admin Area](#admin-area)
  - [Generated Files](#generated-files)
  - [Admin Panel UI in Notes (`dndadmin`)](#admin-panel-ui-in-notes-dndadmin)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Roadmap Ideas](#roadmap-ideas)
- [Disclaimer](#disclaimer)

---

## Use Cases

### D&D / TTRPG Campaign Vaults
- Keep lore, NPC secrets, quest hooks, and handouts **hidden until unlocked**
- Give specific information to certain characters, factions, or groups
- Run “session reveals” (e.g., unlock `session_03_reveal` mid-game)

### Multi-user Vault Sharing (Lightweight)
- A shared Obsidian vault on a shared PC, synced folder, etc.
- Players should only see content intended for them (in Reading View)

---

## How It Works (Concept)

This plugin maintains a simple authentication state:

- A **selected character**
- An **authenticated** flag (locked/unlocked)
- A list of **groups** for the logged-in user

When Obsidian renders notes, the plugin:

1. Checks the note’s frontmatter access rules (whole-note gating).
2. Processes custom code blocks (e.g. `dndgate`) and only renders their content if permitted.
3. Optionally provides an **Admin dashboard** note that displays users/groups and triggers admin actions.

Again: This is primarily designed for **spoiler protection inside Obsidian**, not real security.

---

## Installation

### Manual Installation (Development / Local)
1. Copy the plugin folder into your vault:
