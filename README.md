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
<Your Vault>/.obsidian/plugins/obsidian_account_manager/

markdown
Code kopieren
2. Ensure these files exist:
- `manifest.json`
- `main.js`
- (optional) `styles.css`

3. In Obsidian:
- Settings → Community Plugins → turn on community plugins
- Find and enable **Obsidian Account Manager**

### From GitHub Releases
If you downloaded a release asset (ZIP or files):
1. Create the folder:
<Your Vault>/.obsidian/plugins/obsidian_account_manager/

yaml
Code kopieren
2. Put the release files inside:
- `manifest.json`
- `main.js`
- `styles.css` (optional)
3. Reload Obsidian and enable the plugin.

---

## Quick Start

### 1) Login as Admin
- Open Command Palette (`Ctrl+P`)
- **Select character** → `Admin`
- **Login (password)** → enter: `Passwort` (default in initial users.json)

Your status bar should show something like:
- `authentificator: Admin (unlocked) [ADMIN]`

### 2) Create a Player User
Use the Admin tools to create a user, for example:
- Name: `Castro`
- Password: `test`
- Groups: `party`

### 3) Gate Content
- Create a note and add frontmatter or `dndgate` blocks (examples below).
- Log in as `Castro` and verify what shows/hides.

---

## Accounts & Groups

### `DnDAuth/users.json`
Users are stored in a JSON file in your vault (created automatically on first run).

Typical structure:
```json
{
"users": [
 {
   "name": "Admin",
   "salt": "initAdminSalt",
   "hash": "....",
   "groups": ["admin", "dm"]
 },
 {
   "name": "Castro",
   "salt": "....",
   "hash": "....",
   "groups": ["party"]
 }
]
}
name: the character/authenticator identifier

salt + hash: password verification (basic hashing; not encryption)

groups: list of strings used for access checks

Admin User
The plugin bootstraps an Admin user in users.json:

User: Admin

Password: Passwort

You should change the Admin password later if you share the vault.

Groups
Groups are how access is granted:

party

house_cannith

dm

session_01_reveal

etc.

The plugin checks groups, not individual usernames (recommended for flexibility).

Gating Content
Gate Whole Notes (Frontmatter)
Add YAML frontmatter at the top of a note:

yaml
Code kopieren
---
dnd_access_groups: [party]
dnd_require_auth: true
---
# Party Secret
This content should only be visible to logged-in users in group "party".
Meaning:

dnd_access_groups: array of group names allowed to access

dnd_require_auth: when true, user must be logged in

Admin override: Admin can always see everything.

Hiding frontmatter:
Obsidian Settings → Editor → Show frontmatter → OFF
(This hides it in Reading View, but not in Source Mode.)

Gate Sections (dndgate Code Blocks)
Use the custom dndgate code block to hide only parts of a note.

Example:

md
Code kopieren
# The Letter

The parchment is old and smells faintly of smoke.

```dndgate
groups: party
---
The handwriting matches the Duke's private correspondence.
```

The rest of the note stays visible.
Multiple groups (OR)
md
Code kopieren
```dndgate
groups: party, house_cannith
---
Either the Party or House Cannith may see this section.
```
Authentication requirement
By default, gated blocks require authentication. You can control it:

md
Code kopieren
```dndgate
groups: party
requireAuth: true
---
You must be logged in and in the party group.
```
Or allow viewing even if not logged in (rare use case):

md
Code kopieren
```dndgate
groups: party
requireAuth: false
---
Visible to group members even if authentication isn't enforced.
```
Common Patterns
Session-based reveals
md
Code kopieren
```dndgate
groups: session_03_reveal
---
The traitor is **Auren d’Lyrandar**.
```
Faction knowledge
md
Code kopieren
```dndgate
groups: house_cannith
---
This rune is a Cannith forge-mark used only in secret workshops.
```
Skill/role-based gating
md
Code kopieren
```dndgate
groups: perception_high
---
You notice a nearly invisible seam in the stone wall.
```
Admin Area
The plugin can create an Admin-only folder named:

mathematica
Code kopieren
Admin Area/
This is intended for DM tools, user management, and reports.

Generated Files
Common generated/managed notes:

Admin Area/UserManagement.md
A DM-facing dashboard note.

Admin Area/UserReport.md
A generated report listing users and groups.

These notes are typically created with frontmatter:

yaml
Code kopieren
---
dnd_access_groups: [admin]
dnd_require_auth: true
---
So players won’t see them in Reading View (unless they’re Admin).

Admin Panel UI in Notes (dndadmin)
The plugin can render interactive UI elements inside a note using a custom codeblock:

md
Code kopieren
```dndadmin
mode: users
```
In Reading View, this can render:

Buttons like “Create/Update user”

“Regenerate report”

Live lists of users and their groups

Note: Buttons are powered by plugin commands and are intended for the DM (Admin).

Commands
(Exact command names may vary depending on your build, but typically include:)

Authentication
Select character
Choose which authenticator/character is active.

Login (password)
Prompts for password, verifies against users.json.

Logout / Lock
Clears authentication state.

Admin Commands
Admin: Setup Admin Area
Creates Admin Area/ and initial admin notes.

Admin: Generate user report
Writes/updates Admin Area/UserReport.md.

Admin: Create/Update user
Create a user and assign groups.

Admin: Who has group?
Shows which users belong to a given group.

Troubleshooting
“Plugin failure… main.js not found”
Obsidian loads main.js. Ensure your plugin folder contains:

manifest.json

main.js

If you build locally:

run npm run build (or npm run dev depending on setup)

confirm main.js is written into the plugin folder

“commands does not exist on type App” (TypeScript build)
This is a typing mismatch across Obsidian versions/typings.
Solution: use a safe wrapper like:

ts
Code kopieren
(this.app as any).commands?.executeCommandById?.("...");
“Frontmatter is visible”
Turn it off in Obsidian:

Settings → Editor → Show frontmatter → OFF

“Players can still see secrets in Source Mode”
Yes — this plugin is not encryption.
It hides content in Reading View and can provide spoiler protection, but it cannot prevent file access.

Roadmap Ideas
If you want to expand the plugin:

Auto-flow: select character → auto-login prompt → auto-open dashboard

Recently unlocked: show players newly accessible notes

Session groups: one-click grant/reset of session_* groups

Content templates: create gated NPC/Quest/Lore notes via wizard

Better admin UI: inline group toggles, per-user buttons, audit log

Disclaimer
This plugin is designed for campaign management and spoiler reduction in Obsidian.
It is not a security product and provides no encryption or strong protection against direct file access.
